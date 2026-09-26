import { Connection } from "@solana/web3.js";
import {
  addAuditEvent,
  getPayment,
  transitionPayment
} from "./_lib/db.js";
import { PAYMENT_STATUS } from "./_lib/state.js";

const DEVNET = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "GET or POST only" });
  }

  const paymentId = req.query?.id || req.body?.paymentId;
  if (!paymentId) return res.status(400).json({ error: "payment id is required" });

  const payment = await getPayment(paymentId);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  if ([PAYMENT_STATUS.SETTLED_DEMO, PAYMENT_STATUS.SETTLED_DEVNET].includes(payment.status)) {
    return res.status(200).json({
      status: payment.status,
      signature: payment.settlement_signature,
      reconciled: true
    });
  }

  if (!payment.settlement_signature) {
    return res.status(200).json({
      status: payment.status,
      reconciled: false,
      pending: false,
      message: "No settlement signature is recorded yet."
    });
  }

  if (String(payment.settlement_signature).startsWith("demo_")) {
    if ([PAYMENT_STATUS.SETTLING, PAYMENT_STATUS.FAILED].includes(payment.status)) {
      await transitionPayment(
        payment.id,
        PAYMENT_STATUS.SETTLED_DEMO,
        {},
        "reconciliation-engine",
        { signature: payment.settlement_signature }
      );
    }
    return res.status(200).json({
      status: PAYMENT_STATUS.SETTLED_DEMO,
      signature: payment.settlement_signature,
      reconciled: true,
      mode: "demo"
    });
  }

  const connection = new Connection(DEVNET, "confirmed");
  const result = await connection.getSignatureStatus(payment.settlement_signature, {
    searchTransactionHistory: true
  });

  const chainStatus = result?.value || null;
  const confirmed =
    chainStatus &&
    !chainStatus.err &&
    ["confirmed", "finalized"].includes(chainStatus.confirmationStatus);

  if (confirmed && [PAYMENT_STATUS.SETTLING, PAYMENT_STATUS.FAILED].includes(payment.status)) {
    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.SETTLED_DEVNET,
      {},
      "reconciliation-engine",
      {
        recovered_signature: payment.settlement_signature,
        confirmation_status: chainStatus.confirmationStatus
      }
    );

    await addAuditEvent(payment.id, "settlement_reconciled", "reconciliation-engine", {
      signature: payment.settlement_signature,
      confirmation_status: chainStatus.confirmationStatus
    });
  }

  return res.status(200).json({
    status: confirmed ? PAYMENT_STATUS.SETTLED_DEVNET : payment.status,
    signature: payment.settlement_signature,
    explorer: `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`,
    reconciled: Boolean(confirmed),
    pending: !confirmed && !chainStatus?.err,
    chain: chainStatus
      ? {
          confirmationStatus: chainStatus.confirmationStatus,
          confirmations: chainStatus.confirmations,
          err: chainStatus.err
        }
      : null
  });
}
