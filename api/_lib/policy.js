const DEFAULT_ALLOWED = ["USD", "GBP", "CNY", "INR"];

function csv(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function getPolicyConfig() {
  const allowedCurrencies = csv(process.env.PAYOUT_ALLOWED_CURRENCIES);
  const blockedCountries = csv(process.env.PAYOUT_BLOCKED_COUNTRIES).map((x) => x.toLowerCase());
  const singleLimit = Number(process.env.PAYOUT_SINGLE_LIMIT_USD || 0);
  const kybRequired = String(process.env.PAYOUT_REQUIRE_KYB || "").toLowerCase() === "true";
  const kybStatus = String(process.env.BUSINESS_KYB_STATUS || "not_configured").toLowerCase();

  return {
    allowedCurrencies: allowedCurrencies.length ? allowedCurrencies.map((x) => x.toUpperCase()) : DEFAULT_ALLOWED,
    blockedCountries,
    singleLimitUsd: Number.isFinite(singleLimit) && singleLimit > 0 ? singleLimit : null,
    kybRequired,
    kybStatus,
    configured: Boolean(
      process.env.PAYOUT_ALLOWED_CURRENCIES ||
      process.env.PAYOUT_BLOCKED_COUNTRIES ||
      process.env.PAYOUT_SINGLE_LIMIT_USD ||
      process.env.PAYOUT_REQUIRE_KYB ||
      process.env.BUSINESS_KYB_STATUS
    )
  };
}

export function evaluatePayoutPolicy(payout = {}) {
  const config = getPolicyConfig();
  const reasons = [];
  const currency = String(payout.destination_currency || "").toUpperCase();
  const country = String(payout.beneficiary?.country || "").trim().toLowerCase();
  const amount = Number(payout.funding_amount || 0);

  if (currency && !config.allowedCurrencies.includes(currency)) {
    reasons.push(`Destination currency ${currency} is not allowed by policy`);
  }

  if (country && config.blockedCountries.includes(country)) {
    reasons.push(`Beneficiary country ${payout.beneficiary?.country} is blocked by policy`);
  }

  if (config.singleLimitUsd && Number.isFinite(amount) && amount > config.singleLimitUsd) {
    reasons.push(`Payout amount exceeds the configured single-payment limit of ${config.singleLimitUsd} USD-equivalent`);
  }

  if (config.kybRequired && config.kybStatus !== "approved") {
    reasons.push("Business KYB approval is required before payout approval");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    config: {
      allowedCurrencies: config.allowedCurrencies,
      blockedCountriesConfigured: config.blockedCountries.length > 0,
      singleLimitUsd: config.singleLimitUsd,
      kybRequired: config.kybRequired,
      kybStatus: config.kybStatus
    }
  };
}
