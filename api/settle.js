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
import { listPayments, savePayment } from "./_lib/db.js";

const DEVNET = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function signerFromEnv() {
  if (!process.env.SOLANA_DEVNET_PAYER_SECRET_KEY) return null;
  const raw = JSON.parse(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { approvalToken, recipient } = req.body || {};
    const approved = verifyApproval(approvalToken);
    const paymentId = approved.paymentId;
    const invoiceName = approved.invoiceName || "invoice";
    const amountUsdc = Number(approved.amountUsdc || 1);

    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: "Approved USDC amount is invalid" });
    }

    const max = Number(process.env.MAX_DEVNET_USDC_PER_PAYMENT || 5);
    if (amountUsdc > max) {
      return res.status(400).json({ error: `Approved amount exceeds Devnet safety limit of ${max} USDC` });
    }

    const existing = (await listPayments(50)).find((p) => String(p.id) === String(paymentId));
    if (existing?.settlement_signature) {
      const signature = existing.settlement_signature;
      const isDevnet = String(existing.status) === "settled_devnet";
      return res.status(200).json({
        mode: isDevnet ? "devnet" : "demo",
        signature,
        explorer: isDevnet ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null,
        idempotent: true
      });
    }

    const signer = signerFromEnv();
    const mintString = process.env.SOLANA_DEVNET_USDC_MINT;
    const fallbackRecipient = process.env.SOLANA_SETTLEMENT_RECEIVER;
    const destination = recipient || fallbackRecipient;

    if (!signer || !mintString || !destination) {
      const simulated = "demo_" + Math.random().toString(36).slice(2, 12);
      await savePayment({
        id: paymentId,
        invoice_name: invoiceName,
        supplier: approved.supplier || null,
        source_currency: approved.sourceCurrency || null,
        destination_currency: approved.destinationCurrency || null,
        source_amount: approved.sourceAmount || null,
        destination_amount: approved.destinationAmount || null,
        route: approved.route || null,
        status: "settled_demo",
        settlement_signature: simulated
      });
      return res.status(200).json({
        mode: "demo",
        signature: simulated,
        explorer: null,
        message: "Approval was verified, but Devnet signer/mint/recipient are not fully configured, so no tokens were moved."
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

    const signature = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" });
    const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

    await savePayment({
      id: paymentId,
      invoice_name: invoiceName,
      supplier: approved.supplier || null,
      source_currency: approved.sourceCurrency || null,
      destination_currency: approved.destinationCurrency || null,
      source_amount: approved.sourceAmount || null,
      destination_amount: approved.destinationAmount || null,
      route: approved.route || null,
      status: "settled_devnet",
      settlement_signature: signature
    });

    return res.status(200).json({ mode: "devnet", signature, explorer, idempotent: false });
  } catch (error) {
    console.error("devnet settlement failed", error);
    return res.status(400).json({ error: "Settlement rejected", detail: error?.message || "Unknown error" });
  }
}
