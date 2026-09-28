import { listPayouts } from "./_lib/payout-store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);
    const payouts = await listPayouts(limit);
    return res.status(200).json({ payouts });
  } catch (error) {
    return res.status(500).json({ error: "Could not load payouts", detail: error?.message || "Unknown error" });
  }
}
