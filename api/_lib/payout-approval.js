import crypto from "node:crypto";

const fallbackSecret = "33jack-payout-sandbox-secret-not-for-production";

function secret() {
  return process.env.APPROVAL_HMAC_SECRET || fallbackSecret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signPayoutApproval(payout) {
  const payload = {
    type: "fiat_payout_sandbox",
    payoutId: payout.id,
    invoiceRef: payout.invoice_ref || "",
    fundingAsset: payout.funding_asset,
    fundingAmount: Number(payout.funding_amount),
    destinationCurrency: payout.destination_currency,
    destinationAmount: Number(payout.destination_amount),
    exchangeRate: Number(payout.exchange_rate),
    feeAmount: Number(payout.fee_amount),
    provider: payout.quote?.provider || "internal_sandbox",
    providerQuoteId: payout.quote?.providerQuoteId || null,
    beneficiary: payout.beneficiary,
    quoteExpiresAt: Number(payout.quote?.expiresAt || 0),
    expiresAt: Date.now() + 15 * 60 * 1000
  };
  const body = encode(payload);
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + signature;
}

export function verifyPayoutApproval(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) throw new Error("Missing payout approval token");
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid payout approval signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (Date.now() > Number(payload.expiresAt || 0)) throw new Error("Payout approval expired");
  return payload;
}
