export default async function handler(req, res) {
  const checks = {
    ai: Boolean(process.env.OPENAI_API_KEY),
    database: Boolean(process.env.DATABASE_URL),
    secureApprovals: Boolean(process.env.APPROVAL_HMAC_SECRET),
    devnetSigner: Boolean(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY),
    settlementRecipient: Boolean(process.env.SOLANA_SETTLEMENT_RECEIVER),
    routeQuotes: Boolean(process.env.ROUTE_QUOTES_JSON)
  };

  const coreReady =
    checks.ai &&
    checks.database &&
    checks.secureApprovals;

  const devnetReady =
    checks.devnetSigner &&
    checks.settlementRecipient;

  return res.status(200).json({
    ok: true,
    service: "33jack",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    network: "solana-devnet",
    mode: coreReady && devnetReady ? "integrated-devnet" : "development",
    checks,
    readiness: {
      core: coreReady,
      solanaDevnet: devnetReady,
      productionMoneyMovement: false
    },
    note:
      "Production money movement stays false until licensed payout/FX partners, KYB/KYC, authorization, monitoring and production custody controls are integrated."
  });
}
