import { getPayment, listAuditEvents } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const id = req.query?.id || req.body?.id;
  if (!id) return res.status(400).json({ error: "id is required" });

  const payment = await getPayment(id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const events = await listAuditEvents(id, 100);
  return res.status(200).json({ payment, events });
}
