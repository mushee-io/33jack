import { getSettlementRegistry } from "./_lib/settlement.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const registry = getSettlementRegistry();
  return res.status(200).json({
    ok: true,
    mode: "demo",
    generatedAt: new Date().toISOString(),
    networks: registry.networks,
    providers: registry.providers
  });
}
