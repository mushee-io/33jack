import { getSettlementRegistry, quoteSettlementRoutes } from "./_lib/settlement.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      mode: "demo",
      registry: getSettlementRegistry()
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const quote = quoteSettlementRoutes(req.body || {});
    return res.status(200).json({ ok: true, ...quote });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: "Settlement quote failed",
      detail: error?.message || "Unable to prepare settlement routes"
    });
  }
}
