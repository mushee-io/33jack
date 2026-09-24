import { signApproval } from "./_lib/approval.js";
import { savePayment } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body || {};
  if (!body.paymentId || !body.invoiceName) {
    return res.status(400).json({ error: "paymentId and invoiceName are required" });
  }

  const signed = signApproval(body);
  await savePayment({
    id: body.paymentId,
    invoice_name: body.invoiceName,
    supplier: body.supplier || null,
    source_currency: body.sourceCurrency || null,
    destination_currency: body.destinationCurrency || null,
    source_amount: body.sourceAmount || null,
    destination_amount: body.destinationAmount || null,
    route: body.route || null,
    status: "approved",
    risk: { approval_expires_at: signed.payload.expiresAt }
  });

  return res.status(200).json({
    approvalToken: signed.token,
    expiresAt: signed.payload.expiresAt,
    mode: signed.mode
  });
}
