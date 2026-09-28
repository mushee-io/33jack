import { addAuditEvent } from "./_lib/db.js";
import { buildSandboxQuote } from "./_lib/payout-quote.js";
import { savePayout } from "./_lib/payout-store.js";

function cleanBeneficiary(input = {}) {
  return {
    name: String(input.name || "").trim(),
    bank_name: String(input.bank_name || "").trim(),
    account_last4: String(input.account_last4 || "").trim().slice(-4),
    country: String(input.country || "").trim()
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const beneficiary = cleanBeneficiary(body.beneficiary);
    const missing = Object.entries(beneficiary).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      return res.status(400).json({ error: "Beneficiary details are incomplete", detail: missing.join(", ") });
    }

    const quote = buildSandboxQuote(body);
    const payout = await savePayout({
      id: "payout_" + Date.now().toString(36),
      invoice_ref: String(body.invoiceRef || "").trim() || null,
      funding_asset: quote.fundingAsset,
      funding_amount: quote.fundingAmount,
      destination_currency: quote.destinationCurrency,
      destination_amount: quote.destinationAmount,
      exchange_rate: quote.exchangeRate,
      fee_amount: quote.feeAmount,
      quote,
      beneficiary,
      status: "quoted"
    });

    await addAuditEvent(payout.id, "fiat_payout_quoted", "33jack-pay", {
      mode: "sandbox",
      funding_asset: quote.fundingAsset,
      funding_amount: quote.fundingAmount,
      destination_currency: quote.destinationCurrency,
      destination_amount: quote.destinationAmount,
      fee_amount: quote.feeAmount
    });

    return res.status(200).json({ payout });
  } catch (error) {
    return res.status(400).json({
      error: "Could not prepare payout quote",
      detail: error?.message || "Unknown error"
    });
  }
}
