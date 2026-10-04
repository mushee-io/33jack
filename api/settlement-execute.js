import { executeDemoSettlement, quoteSettlementRoutes } from "./_lib/settlement.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const quote = body.quote || quoteSettlementRoutes(body.paymentIntent || {});
    const result = executeDemoSettlement({
      quote,
      routeId: body.routeId,
      approved: body.approved === true
    });

    return res.status(result.ok ? 200 : result.status === "awaiting_approval" ? 409 : 400).json(result);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: "Settlement execution failed",
      detail: error?.message || "Unable to execute settlement"
    });
  }
}
