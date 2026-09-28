const RATES = Object.freeze({
  USD: 1,
  GBP: 0.78,
  CNY: 7.12,
  INR: 83.2
});

const ASSETS = new Set(["USDG", "USDC", "USDT"]);

export function buildSandboxQuote(input = {}) {
  const fundingAsset = String(input.fundingAsset || "").toUpperCase();
  const destinationCurrency = String(input.destinationCurrency || "").toUpperCase();
  const fundingAmount = Number(input.fundingAmount);

  if (!ASSETS.has(fundingAsset)) throw new Error("Funding asset must be USDG, USDC, or USDT");
  if (!RATES[destinationCurrency]) throw new Error("Destination currency must be USD, GBP, CNY, or INR");
  if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) throw new Error("Funding amount must be positive");

  const feeBps = 65;
  const flatFeeUsd = 2.5;
  const percentageFee = fundingAmount * (feeBps / 10000);
  const feeAmount = Math.round((percentageFee + flatFeeUsd) * 100) / 100;
  const netUsd = Math.max(0, fundingAmount - feeAmount);
  const rate = RATES[destinationCurrency];
  const destinationAmount = Math.round(netUsd * rate * 100) / 100;

  return {
    mode: "sandbox",
    fundingAsset,
    fundingAmount,
    destinationCurrency,
    exchangeRate: rate,
    destinationAmount,
    feeAmount,
    feeBps,
    flatFeeUsd,
    partner: "33Jack Sandbox Payout Rail",
    eta: destinationCurrency === "CNY" ? "same business day" : "under 2 hours",
    expiresAt: Date.now() + 15 * 60 * 1000,
    disclaimer: "Sandbox quote only. No fiat conversion or bank transfer occurs."
  };
}
