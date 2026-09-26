import { listPayments, persistenceMode, savePayment } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const rawLimit = Number(req.query?.limit || 25);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 25, 1), 100);
    const rows = await listPayments(limit);
    return res.status(200).json({
      payments: rows,
      persistence: persistenceMode()
    });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    if (!body.id || !body.invoice_name) {
      return res.status(400).json({ error: "id and invoice_name are required" });
    }

    // This endpoint is intentionally not allowed to bypass the payment lifecycle.
    if (body.status && body.status !== "analyzed") {
      return res.status(400).json({
        error: "Direct status mutation is not allowed",
        detail: "Use /api/approve and /api/settle for payment state transitions."
      });
    }

    const row = await savePayment({
      ...body,
      status: "analyzed"
    });
    return res.status(200).json({ payment: row });
  }

  return res.status(405).json({ error: "GET or POST only" });
}
