// Public V2 agent-facing interface: unsigned intentions and independently verifiable receipts.
// Public endpoints never possess credentials capable of moving funds.
import { CHAIN_ID, USDC, assertMainnet, prepareUSDC, verifyUSDC } from "./_lib/celo-v2.mjs";

function json(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = String(req.query?.action || "manifest").toLowerCase();
  if (req.method === "GET" && action === "manifest") {
    return json(res, 200, {
      name: "33JACK V2 Celo Agent Payment Gateway",
      version: "2.0.0-alpha",
      network: "Celo Mainnet",
      chainId: CHAIN_ID,
      asset: USDC,
      documentation: "/v2",
      capabilities: ["prepare_unsigned_usdc_transfer", "verify_mainnet_usdc_transfer"],
      endpoints: {
        prepare: "POST /api/celo-v2?action=prepare",
        verify: "POST /api/celo-v2?action=verify",
        health: "GET /api/celo-v2?action=health"
      },
      security: "No server-side signing. An authorized payer wallet must separately approve each payment.",
      limitations: "Agent identity, escrow, delegated spending permissions, durable intent storage and real agent-to-agent execution are not implemented yet."
    });
  }
  if (req.method === "GET" && action === "health") {
    try {
      await assertMainnet();
      return json(res, 200, { ok: true, chainId: CHAIN_ID, network: "Celo Mainnet", rpcVerified: true, paymentSigningConfigured: false });
    } catch {
      return json(res, 503, { ok: false, network: "Celo Mainnet", rpcVerified: false });
    }
  }
  if (req.method === "POST" && ["prepare", "verify"].includes(action)) {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(String(req.body || "{}"));
      if (JSON.stringify(body).length > 4096) return json(res, 413, { ok: false, error: "Request too large" });
      if (action === "prepare") return json(res, 200, { ok: true, ...prepareUSDC(body) });
      const result = await verifyUSDC(body);
      return json(res, result.ok ? 200 : result.state === "pending" ? 202 : 422, result);
    } catch (error) {
      return json(res, 400, { ok: false, error: error?.message || "Invalid request" });
    }
  }
  return json(res, 405, { ok: false, error: "Unsupported method or action" });
}
