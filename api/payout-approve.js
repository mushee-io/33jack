import { addAuditEvent } from "./_lib/db.js";
import { signPayoutApproval } from "./_lib/payout-approval.js";
import { buildSandboxQuote } from "./_lib/payout-quote.js";
import { getPayout, savePayout } from "./_lib/payout-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const payout = await getPayout(req.body?.payoutId);
    if (!payout) return res.status(404).json({ error: "Payout not found" });
    if (payout.status !== "quoted") {
      return res.status(409).json({ error: "Payout is not awaiting approval", detail: payout.status });
    }
    if (Date.now() > Number(payout.quote?.expiresAt || 0)) {
      const freshQuote = buildSandboxQuote({
        fundingAsset: payout.funding_asset,
        fundingAmount: Number(payout.funding_amount),
        destinationCurrency: payout.destination_currency
      });
      const refreshed = await savePayout({
        ...payout,
        destination_amount: freshQuote.destinationAmount,
        exchange_rate: freshQuote.exchangeRate,
        fee_amount: freshQuote.feeAmount,
        quote: freshQuote,
        status: "quoted"
      });
      await addAuditEvent(payout.id, "fiat_payout_quote_refreshed", "33jack-pay", {
        previous_expires_at: payout.quote?.expiresAt || null,
        refreshed_expires_at: freshQuote.expiresAt,
        destination_amount: freshQuote.destinationAmount,
        exchange_rate: freshQuote.exchangeRate,
        fee_amount: freshQuote.feeAmount
      });
      return res.status(409).json({
        error: "Quote refreshed",
        detail: "The previous quote expired. 33Jack refreshed it automatically; review the updated terms and approve again.",
        refreshedPayout: refreshed
      });
    }

    const approvalToken = signPayoutApproval(payout);
    const updated = await savePayout({ ...payout, status: "approved" });

    await addAuditEvent(payout.id, "fiat_payout_approved", "human-approver", {
      funding_asset: payout.funding_asset,
      funding_amount: Number(payout.funding_amount),
      destination_currency: payout.destination_currency,
      destination_amount: Number(payout.destination_amount),
      fee_amount: Number(payout.fee_amount)
    });

    return res.status(200).json({
      payout: updated,
      approvalToken,
      mode: process.env.APPROVAL_HMAC_SECRET ? "secure" : "demo"
    });
  } catch (error) {
    return res.status(400).json({
      error: "Payout approval failed",
      detail: error?.message || "Unknown error"
    });
  }
}
