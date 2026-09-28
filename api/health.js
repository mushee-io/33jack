import { getPayoutProviderReadiness } from "./_lib/payout-provider.js";
import { getPolicyConfig } from "./_lib/policy.js";
import { telegramReadiness } from "./_lib/telegram.js";
import { whatsappReadiness } from "./_lib/whatsapp.js";

export default async function handler(req, res) {
  const payoutProvider = getPayoutProviderReadiness();
  const payoutPolicy = getPolicyConfig();
  const telegram = telegramReadiness();
  const whatsapp = whatsappReadiness();
  const checks = {
    ai: Boolean(process.env.GROQ_API_KEY),
    database: Boolean(process.env.DATABASE_URL),
    secureApprovals: Boolean(process.env.APPROVAL_HMAC_SECRET),
    devnetSigner: Boolean(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY),
    settlementRecipient: Boolean(process.env.SOLANA_SETTLEMENT_RECEIVER),
    routeQuotes: Boolean(process.env.ROUTE_QUOTES_JSON),
    externalPayoutQuotes: payoutProvider.wiseQuoteReady,
    externalPayoutTransfer: payoutProvider.wiseTransferReady,
    externalPayoutBalanceConfigured: payoutProvider.wiseBalanceConfigured,
    externalPayoutAutoFunding: payoutProvider.wiseAutoFundingEnabled,
    externalPayoutFunding: payoutProvider.wiseFundingReady
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
    aiProvider: process.env.GROQ_API_KEY ? "groq" : "none",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    network: "solana-devnet",
    payoutProvider: payoutProvider.provider,
    channels: {
      whatsapp,
      telegram
    },
    payoutPolicy: {
      configured: payoutPolicy.configured,
      allowedCurrencies: payoutPolicy.allowedCurrencies,
      singleLimitUsd: payoutPolicy.singleLimitUsd,
      kybRequired: payoutPolicy.kybRequired,
      kybStatus: payoutPolicy.kybStatus,
      blockedCountriesConfigured: payoutPolicy.blockedCountries.length > 0
    },
    mode: coreReady && devnetReady ? "integrated-devnet" : "development",
    checks,
    readiness: {
      core: coreReady,
      solanaDevnet: devnetReady,
      externalPayoutSandbox:
        payoutProvider.externalSandbox && payoutProvider.wiseTransferReady,
      productionMoneyMovement: false
    },
    note:
      "Production money movement stays false until licensed payout/FX partners, KYB/KYC, authorization, monitoring and production custody controls are integrated."
  });
}
