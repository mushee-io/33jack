import { signApproval } from "./_lib/approval.js";
import {
  addAuditEvent,
  getPayment,
  transitionPayment
} from "./_lib/db.js";
import {
  PAYMENT_STATUS,
  assertApprovalAllowed,
  requiredAcknowledgements
} from "./_lib/state.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    if (!body.paymentId) {
      return res.status(400).json({ error: "paymentId is required" });
    }

    const payment = await getPayment(body.paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const acknowledgements = body.acknowledgements || {};
    assertApprovalAllowed(payment, acknowledgements);

    const amountUsdc = Number(body.amountUsdc || 1);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: "amountUsdc must be a positive number" });
    }

    const signed = signApproval({
      paymentId: payment.id,
      invoiceName: payment.invoice_name,
      supplier: payment.supplier,
      sourceCurrency: payment.source_currency,
      destinationCurrency: payment.destination_currency,
      sourceAmount: payment.source_amount,
      destinationAmount: payment.destination_amount,
      route: payment.route,
      amountUsdc
    });

    await transitionPayment(
      payment.id,
      PAYMENT_STATUS.APPROVED,
      {
        approval: {
          expires_at: signed.payload.expiresAt,
          acknowledgements,
          amount_usdc: amountUsdc,
          mode: signed.mode
        }
      },
      "human-approver",
      {
        required_acknowledgements: requiredAcknowledgements(payment),
        provided_acknowledgements: acknowledgements,
        approval_expires_at: signed.payload.expiresAt,
        amount_usdc: amountUsdc
      }
    );

    await addAuditEvent(payment.id, "payment_approved", "human-approver", {
      route: payment.route,
      source_amount: payment.source_amount,
      source_currency: payment.source_currency,
      destination_currency: payment.destination_currency,
      expires_at: signed.payload.expiresAt
    });

    return res.status(200).json({
      approvalToken: signed.token,
      expiresAt: signed.payload.expiresAt,
      mode: signed.mode,
      payment: {
        id: payment.id,
        status: PAYMENT_STATUS.APPROVED,
        supplier: payment.supplier,
        route: payment.route
      }
    });
  } catch (error) {
    return res.status(400).json({
      error: "Approval rejected",
      detail: error?.message || "Unknown approval error"
    });
  }
}
