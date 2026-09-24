import { listPayments, savePayment } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const rows = await listPayments(25);
    return res.status(200).json({ payments: rows, persistence: process.env.DATABASE_URL ? "postgres" : "memory" });
  }
  if (req.method === "POST") {
    const body = req.body || {};
    if (!body.id || !body.invoice_name) return res.status(400).json({ error: "id and invoice_name are required" });
    const row = await savePayment(body);
    return res.status(200).json({ payment: row });
  }
  return res.status(405).json({ error: "GET or POST only" });
}
