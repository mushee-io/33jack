import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction
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

async function existingSettlementResponse(payment, connection) {
  if ([PAYMENT_STATUS.SETTLED_DEMO, PAYMENT_STATUS.SETTLED_DEVNET].includes(payment.status) && payment.settlement_signature) {
    const isDevnet = payment.status === PAYMENT_STATUS.SETTLED_DEVNET;
    return {
      mode: isDevnet ? "devnet" : "demo",
      signature: payment.settlement_signature,
      explorer: isDevnet
        ? `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`
        : null,
      idempotent: true,
      status: payment.status
    };
  }

  if (
    [PAYMENT_STATUS.SETTLING, PAYMENT_STATUS.FAILED].includes(payment.status) &&
    payment.settlement_signature &&
    !String(payment.settlement_signature).startsWith("demo_")
  ) {
    const status = await connection.getSignatureStatus(payment.settlement_signature, {
      searchTransactionHistory: true
    });

    const confirmed = ["confirmed", "finalized"].includes(status?.value?.confirmationStatus);
    if (confirmed && !status?.value?.err) {
      await transitionPayment(
        payment.id,
        PAYMENT_STATUS.SETTLED_DEVNET,
        {},
        "reconciliation-engine",
        {
          recovered_signature: payment.settlement_signature,
          previous_status: payment.status
        }
      );

      return {
        mode: "devnet",
        signature: payment.settlement_signature,
        explorer: `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`,
        idempotent: true,
        reconciled: true,
        status: PAYMENT_STATUS.SETTLED_DEVNET
      };
    }

    return {
      mode: "devnet",
      signature: payment.settlement_signature,
      explorer: `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`,
      idempotent: true,
      pending: true,
      status: payment.status
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let payment;
  let connection;

  try {
    const { approvalToken, recipient } = req.body || {};
    const approved = verifyApproval(approvalToken);
    const paymentId = approved.paymentId;

    payment = await getPayment(paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    connection = new Connection(DEVNET, "confirmed");

    const existingResponse = await existingSettlementResponse(payment, connection);
    if (existingResponse) {
      return res.status(existingResponse.pending ? 202 : 200).json(existingResponse);
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
        PAYMENT_STATUS.SETTLING,
        { settlement_signature: simulated },
        "settlement-engine",
        { mode: "demo", amount_usdc: amountUsdc }
      );

      await transitionPayment(
        payment.id,
        PAYMENT_STATUS.SETTLED_DEMO,
        {},
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

    const mint = new PublicKey(mintString);
    const receiver = new PublicKey(destination);
    const senderAta = await getAssociatedTokenAddress(mint, signer.publicKey);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);
    const latest = await connection.getLatestBlockhash("confirmed");

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

    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);

    if (!tx.signature) throw new Error("Transaction signing failed");
    const precomputedSignature = bs58.encode(tx.signature);

    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.SETTLING,
      { settlement_signature: precomputedSignature },
      "settlement-engine",
      {
        mode: "devnet",
        amount_usdc: amountUsdc,
        signature: precomputedSignature,
        mint: mint.toBase58(),
        recipient: receiver.toBase58()
      }
    );

    await addAuditEvent(payment.id, "transaction_signed", "settlement-engine", {
      signature: precomputedSignature,
      blockhash: latest.blockhash,
      last_valid_block_height: latest.lastValidBlockHeight
    });

    const networkSignature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });

    if (networkSignature !== precomputedSignature) {
      throw new Error("Network signature did not match the precomputed transaction signature");
    }

    const confirmation = await connection.confirmTransaction(
      {
        signature: networkSignature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight
      },
      "confirmed"
    );

    if (confirmation?.value?.err) {
      throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    const explorer = `https://explorer.solana.com/tx/${networkSignature}?cluster=devnet`;

    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.SETTLED_DEVNET,
      {},
      "settlement-engine",
      {
        mode: "devnet",
        signature: networkSignature,
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
      signature: networkSignature,
      explorer
    });

    return res.status(200).json({
      mode: "devnet",
      signature: networkSignature,
      explorer,
      idempotent: false
    });
  } catch (error) {
    console.error("settlement failed", error);

    if (payment?.id) {
      try {
        const current = await getPayment(payment.id);
        if (current?.status === PAYMENT_STATUS.SETTLING) {
          await transitionPayment(
            payment.id,
            PAYMENT_STATUS.FAILED,
            {},
            "settlement-engine",
            {
              error: error?.message || "Unknown error",
              signature: current.settlement_signature || null
            }
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
