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
import { savePayment } from "./_lib/db.js";

const DEVNET = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function signerFromEnv() {
  if (!process.env.SOLANA_DEVNET_PAYER_SECRET_KEY) return null;
  const raw = JSON.parse(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { paymentId, invoiceName, recipient, amountUsdc = 1 } = req.body || {};

  if (!paymentId) return res.status(400).json({ error: "paymentId is required" });

  const signer = signerFromEnv();
  const mintString = process.env.SOLANA_DEVNET_USDC_MINT;
  const fallbackRecipient = process.env.SOLANA_SETTLEMENT_RECEIVER;
  const destination = recipient || fallbackRecipient;

  if (!signer || !mintString || !destination) {
    const simulated = "demo_" + Math.random().toString(36).slice(2, 12);
    await savePayment({
      id: paymentId,
      invoice_name: invoiceName || "invoice",
      status: "settled_demo",
      settlement_signature: simulated
    });
    return res.status(200).json({
      mode: "demo",
      signature: simulated,
      explorer: null,
      message: "Devnet signer/mint/recipient not fully configured, so no tokens were moved."
    });
  }

  try {
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
        Math.round(Number(amountUsdc) * 1_000_000),
        6
      )
    );

    const signature = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" });
    const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

    await savePayment({
      id: paymentId,
      invoice_name: invoiceName || "invoice",
      status: "settled_devnet",
      settlement_signature: signature
    });

    return res.status(200).json({ mode: "devnet", signature, explorer });
  } catch (error) {
    console.error("devnet settlement failed", error);
    return res.status(500).json({ error: "Devnet settlement failed", detail: error?.message || "Unknown error" });
  }
}
