import crypto from "node:crypto";
import { buildSandboxQuote } from "./payout-quote.js";

const STABLECOINS = new Set(["USDG", "USDC", "USDT"]);

function payoutProvider() {
  return String(process.env.PAYOUT_PROVIDER || "internal_sandbox").trim().toLowerCase();
}

function wiseBaseUrl() {
  return String(
    process.env.WISE_SANDBOX_BASE_URL || "https://api.wise-sandbox.com/2026Q3"
  ).replace(/\/$/, "");
}

function requireWiseQuoteConfig() {
  const token = process.env.WISE_SANDBOX_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  if (!token || !profileId) {
    throw new Error(
      "Wise Sandbox quote adapter requires WISE_SANDBOX_TOKEN and WISE_PROFILE_ID"
    );
  }
  return { token, profileId };
}

function requireWiseTransferConfig() {
  const base = requireWiseQuoteConfig();
  const recipientId = process.env.WISE_RECIPIENT_ACCOUNT_ID;
  if (!recipientId) {
    throw new Error(
      "Wise Sandbox transfer adapter requires WISE_RECIPIENT_ACCOUNT_ID"
    );
  }
  return { ...base, recipientId };
}

function correlationId(seed = "") {
  const hex = crypto.createHash("sha256").update(String(seed || "33jack")).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20, 32)
  ].join("-");
}

async function wiseRequest(path, options = {}) {
  const token = process.env.WISE_SANDBOX_TOKEN;
  const response = await fetch(wiseBaseUrl() + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-External-Correlation-Id":
        options.correlationId || correlationId(path + JSON.stringify(options.body || "")),
      ...(options.headers || {})
    },
    body:
      options.body && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const first = Array.isArray(data?.errors) ? data.errors[0] : null;
    const detail =
      first?.message ||
      data?.message ||
      data?.error ||
      data?.raw ||
      `Wise Sandbox HTTP ${response.status}`;
    const error = new Error(String(detail));
    error.status = response.status;
    error.providerBody = data;
    throw error;
  }

  return data;
}

function firstPaymentOption(quote = {}) {
  if (!Array.isArray(quote.paymentOptions)) return null;
  return (
    quote.paymentOptions.find((option) => option?.disabled !== true) ||
    quote.paymentOptions[0] ||
    null
  );
}

function readFee(option = {}) {
  const values = [
    option?.fee?.total,
    option?.fee?.transferwise,
    option?.fee?.value,
    option?.price?.total?.value,
    option?.price?.total
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function readTargetAmount(quote = {}, option = {}) {
  for (const value of [
    quote.targetAmount,
    quote.targetValue,
    option?.targetAmount,
    option?.targetValue
  ]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readSourceAmount(quote = {}, option = {}, fallback) {
  for (const value of [
    quote.sourceAmount,
    quote.sourceValue,
    option?.sourceAmount,
    option?.sourceValue,
    fallback
  ]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readRate(quote = {}, option = {}, sourceAmount, targetAmount) {
  for (const value of [quote.rate, option?.rate, option?.rate?.value]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  if (sourceAmount && targetAmount) return targetAmount / sourceAmount;
  return null;
}

function readExpiry(quote = {}) {
  for (const value of [
    quote.rateExpirationTime,
    quote.expirationTime,
    quote.expiresAt
  ]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > Date.now()) return numeric;
  }
  return Date.now() + 25 * 60 * 1000;
}

async function getWiseQuote(input = {}) {
  const { profileId } = requireWiseQuoteConfig();
  const fundingAsset = String(input.fundingAsset || "").toUpperCase();
  const destinationCurrency = String(input.destinationCurrency || "").toUpperCase();
  const fundingAmount = Number(input.fundingAmount);

  if (!STABLECOINS.has(fundingAsset)) {
    throw new Error("Funding asset must be USDG, USDC, or USDT");
  }
  if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) {
    throw new Error("Funding amount must be positive");
  }

  const targetAccount = process.env.WISE_RECIPIENT_ACCOUNT_ID
    ? Number(process.env.WISE_RECIPIENT_ACCOUNT_ID)
    : null;

  const wiseQuote = await wiseRequest(`/profiles/${profileId}/quotes`, {
    method: "POST",
    correlationId: correlationId(
      `quote:${input.payoutId || input.invoiceRef || Date.now()}`
    ),
    body: {
      sourceCurrency: "USD",
      targetCurrency: destinationCurrency,
      sourceAmount: fundingAmount,
      targetAmount: null,
      targetAccount: Number.isFinite(targetAccount) ? targetAccount : null,
      payOut: null,
      preferredPayIn: null
    }
  });

  const option = firstPaymentOption(wiseQuote) || {};
  const sourceAmount = readSourceAmount(wiseQuote, option, fundingAmount);
  const targetAmount = readTargetAmount(wiseQuote, option);
  const rate = readRate(wiseQuote, option, sourceAmount, targetAmount);
  const fee = readFee(option);
  const quoteId = wiseQuote.id || wiseQuote.quoteUuid || wiseQuote.uuid;

  if (!quoteId || !Number.isFinite(targetAmount) || !Number.isFinite(rate)) {
    throw new Error("Wise Sandbox returned an incomplete quote");
  }

  return {
    mode: "external_sandbox",
    provider: "wise_sandbox",
    providerQuoteId: String(quoteId),
    fundingAsset,
    fundingAmount,
    sourceCurrency: "USD",
    destinationCurrency,
    exchangeRate: rate,
    destinationAmount: targetAmount,
    feeAmount: fee,
    partner: "Wise Sandbox",
    eta:
      option?.estimatedDelivery ||
      option?.estimatedDeliveryTime ||
      wiseQuote?.deliveryEstimate ||
      "provider estimate",
    expiresAt: readExpiry(wiseQuote),
    rawStatus: wiseQuote?.status || null,
    disclaimer:
      "Wise Sandbox uses test data and does not move real money. Stablecoin funding is represented as USD-equivalent for this integration test."
  };
}

export async function getPayoutQuote(input = {}) {
  const provider = payoutProvider();
  if (provider === "wise_sandbox") return getWiseQuote(input);
  return {
    ...buildSandboxQuote(input),
    provider: "internal_sandbox"
  };
}

export function getPayoutProviderReadiness() {
  const provider = payoutProvider();
  const wiseQuoteReady = Boolean(
    process.env.WISE_SANDBOX_TOKEN && process.env.WISE_PROFILE_ID
  );
  const wiseTransferReady = Boolean(
    wiseQuoteReady && process.env.WISE_RECIPIENT_ACCOUNT_ID
  );
  const wiseFundingReady = Boolean(
    wiseTransferReady && process.env.WISE_BALANCE_ID
  );

  return {
    provider,
    externalSandbox: provider === "wise_sandbox",
    wiseQuoteReady,
    wiseTransferReady,
    wiseFundingReady
  };
}

export async function executeExternalPayout(payout) {
  if (String(payout?.quote?.provider || "") !== "wise_sandbox") return null;

  const { profileId, recipientId } = requireWiseTransferConfig();
  const quoteUuid = payout?.quote?.providerQuoteId;
  if (!quoteUuid) throw new Error("Wise Sandbox quote ID is missing from payout");

  const transactionId = correlationId(`transfer:${payout.id}`);
  const transfer = await wiseRequest("/transfers", {
    method: "POST",
    correlationId: correlationId(`create:${payout.id}`),
    body: {
      targetAccount: Number(recipientId),
      quoteUuid,
      customerTransactionId: transactionId,
      details: {
        reference: String(payout.invoice_ref || payout.id).slice(0, 35)
      }
    }
  });

  let funding = null;
  const balanceId = process.env.WISE_BALANCE_ID;
  if (balanceId && transfer?.id) {
    funding = await wiseRequest(
      `/profiles/${profileId}/transfers/${transfer.id}/payments`,
      {
        method: "POST",
        correlationId: correlationId(`fund:${payout.id}`),
        body: {
          type: "BALANCE",
          balanceId: Number(balanceId)
        }
      }
    );
  }

  let latest = transfer;
  if (transfer?.id) {
    try {
      latest = await wiseRequest(`/transfers/${transfer.id}`, {
        method: "GET",
        correlationId: correlationId(`status:${payout.id}`)
      });
    } catch {
      latest = transfer;
    }
  }

  return {
    provider: "wise_sandbox",
    transferId: String(transfer?.id || ""),
    providerStatus: String(latest?.status || transfer?.status || "created"),
    fundingStatus: funding?.status || null,
    balanceTransactionId: funding?.balanceTransactionId || null,
    funded: funding?.status === "COMPLETED",
    customerTransactionId: transactionId,
    rawTransfer: latest
  };
}
