import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { verifyApproval } from "./_lib/approval.js";
import {
  addAuditEvent,
  getPayment,
  transitionPayment,
  upsertBeneficiary
} from "./_lib/db.js";
import { PAYMENT_STATUS } from "./_lib/state.js";

const DEVNET = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function signerFromEnv() {
  if (!process.env.SOLANA_DEVNET_PAYER_SECRET_KEY) return null;
  const raw = JSON.parse(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function assertApprovalMatches(payment, approved) {
  const checks = [
    ["invoiceName", payment.invoice_name, approved.invoiceName],
    ["supplier", payment.supplier, approved.supplier],
    ["sourceCurrency", payment.source_currency, approved.sourceCurrency],
    ["destinationCurrency", payment.destination_currency, approved.destinationCurrency],
    ["destinationAmount", payment.destination_amount, approved.destinationAmount],
    ["route", payment.route, approved.route]
  ];

  for (const [field, stored, signed] of checks) {
    if (!sameText(stored, signed)) {
      throw new Error(`Approval no longer matches stored payment field: ${field}`);
    }
  }

  if (Number(payment.source_amount || 0) !== Number(approved.sourceAmount || 0)) {
    throw new Error("Approval no longer matches stored source amount");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let payment;
  try {
    const { approvalToken, recipient } = req.body || {};
    const approved = verifyApproval(approvalToken);
    const paymentId = approved.paymentId;
    payment = await getPayment(paymentId);

    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if ([PAYMENT_STATUS.SETTLED_DEMO, PAYMENT_STATUS.SETTLED_DEVNET].includes(payment.status) && payment.settlement_signature) {
      const isDevnet = payment.status === PAYMENT_STATUS.SETTLED_DEVNET;
      return res.status(200).json({
        mode: isDevnet ? "devnet" : "demo",
        signature: payment.settlement_signature,
        explorer: isDevnet
          ? `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`
          : null,
        idempotent: true
      });
    }

    if (payment.status !== PAYMENT_STATUS.APPROVED) {
      return res.status(409).json({
        error: "Payment is not approved",
        detail: `Current status is ${payment.status}`
      });
    }

    assertApprovalMatches(payment, approved);

    const amountUsdc = Number(approved.amountUsdc || 1);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: "Approved USDC amount is invalid" });
    }

    const max = Number(process.env.MAX_DEVNET_USDC_PER_PAYMENT || 5);
    if (amountUsdc > max) {
      return res.status(400).json({
        error: `Approved amount exceeds Devnet safety limit of ${max} USDC`
      });
    }

    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.SETTLING,
      {},
      "settlement-engine",
      { amount_usdc: amountUsdc }
    );

    const signer = signerFromEnv();
    const mintString =
      process.env.SOLANA_DEVNET_USDC_MINT ||
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const fallbackRecipient = process.env.SOLANA_SETTLEMENT_RECEIVER;
    const destination = recipient || fallbackRecipient;

    if (!signer || !mintString || !destination) {
      const simulated = "demo_" + Math.random().toString(36).slice(2, 12);
      await transitionPayment(
        payment.id,
        PAYMENT_STATUS.SETTLED_DEMO,
        { settlement_signature: simulated },
        "settlement-engine",
        { mode: "demo", signature: simulated }
      );
      await addAuditEvent(payment.id, "settlement_confirmed", "settlement-engine", {
        mode: "demo",
        signature: simulated
      });
      return res.status(200).json({
        mode: "demo",
        signature: simulated,
        explorer: null,
        idempotent: false,
        message:
          "Approval was verified and state was reconciled, but Devnet signer/recipient are not configured, so no tokens were moved."
      });
    }

    const connection = new Connection(DEVNET, "confirmed");
    const mint = new PublicKey(mintString);
    const receiver = new PublicKey(destination);
    const senderAta = await getAssociatedTokenAddress(mint, signer.publicKey);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);

    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        signer.publicKey,
        receiverAta,
        receiver,
        mint
      ),
      createTransferCheckedInstruction(
        senderAta,
        mint,
        receiverAta,
        signer.publicKey,
        Math.round(amountUsdc * 1_000_000),
        6
      )
    );

    const signature = await sendAndConfirmTransaction(connection, tx, [signer], {
      commitment: "confirmed"
    });
    const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.SETTLED_DEVNET,
      { settlement_signature: signature },
      "settlement-engine",
      {
        mode: "devnet",
        signature,
        mint: mint.toBase58(),
        recipient: receiver.toBase58()
      }
    );

    await upsertBeneficiary({
      supplier: payment.supplier,
      destinationCurrency: payment.destination_currency,
      beneficiary: payment.beneficiary || {},
      metadata: {
        payment_id: payment.id,
        verified_by: "successful_devnet_settlement"
      }
    });

    await addAuditEvent(payment.id, "settlement_confirmed", "settlement-engine", {
      mode: "devnet",
      signature,
      explorer
    });

    return res.status(200).json({
      mode: "devnet",
      signature,
      explorer,
      idempotent: false
    });
  } catch (error) {
    console.error("settlement failed", error);

    if (payment?.id && payment.status === PAYMENT_STATUS.APPROVED) {
      try {
        const current = await getPayment(payment.id);
        if (current?.status === PAYMENT_STATUS.SETTLING) {
          await transitionPayment(
            payment.id,
            PAYMENT_STATUS.FAILED,
            {},
            "settlement-engine",
            { error: error?.message || "Unknown error" }
          );
        }
      } catch {
        // Preserve the original settlement error.
      }
    }

    return res.status(400).json({
      error: "Settlement rejected",
      detail: error?.message || "Unknown error"
    });
  }
}
