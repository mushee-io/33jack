import { addAuditEvent } from "./_lib/db.js";
import { verifyPayoutApproval } from "./_lib/payout-approval.js";
import { getPayout, savePayout } from "./_lib/payout-store.js";

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const approved = verifyPayoutApproval(req.body?.approvalToken);
    const payout = await getPayout(approved.payoutId);
    if (!payout) return res.status(404).json({ error: "Payout not found" });

    if (payout.status === "paid_sandbox" && payout.receipt_id) {
      return res.status(200).json({ payout, idempotent: true });
    }
    if (payout.status !== "approved") {
      return res.status(409).json({ error: "Payout is not approved", detail: payout.status });
    }

    const checks = [
      [payout.funding_asset, approved.fundingAsset],
      [Number(payout.funding_amount), Number(approved.fundingAmount)],
      [payout.destination_currency, approved.destinationCurrency],
      [Number(payout.destination_amount), Number(approved.destinationAmount)],
      [Number(payout.exchange_rate), Number(approved.exchangeRate)],
      [Number(payout.fee_amount), Number(approved.feeAmount)],
      [payout.beneficiary, approved.beneficiary]
    ];
    if (checks.some(([stored, signed]) => !same(stored, signed))) {
      throw new Error("Approved payout no longer matches the stored quote");
    }

    await savePayout({ ...payout, status: "processing" });
    await addAuditEvent(payout.id, "fiat_payout_processing", "sandbox-payout-adapter", {
      partner: payout.quote?.partner || "33Jack Sandbox Payout Rail"
    });

    const receiptId = "33J-FIAT-" + Date.now().toString(36).toUpperCase();
    const settled = await savePayout({
      ...payout,
      status: "paid_sandbox",
      receipt_id: receiptId
    });

    await addAuditEvent(payout.id, "fiat_payout_reconciled", "reconciliation-engine", {
      mode: "sandbox",
      receipt_id: receiptId,
      destination_currency: payout.destination_currency,
      destination_amount: Number(payout.destination_amount),
      beneficiary: {
        name: payout.beneficiary?.name || null,
        bank_name: payout.beneficiary?.bank_name || null,
        account_last4: payout.beneficiary?.account_last4 || null,
        country: payout.beneficiary?.country || null
      }
    });

    return res.status(200).json({
      payout: settled,
      idempotent: false,
      receipt: {
        id: receiptId,
        status: "PAID (SANDBOX)",
        funding: `${payout.funding_amount} ${payout.funding_asset}`,
        delivered: `${payout.destination_amount} ${payout.destination_currency}`,
        beneficiary: payout.beneficiary?.name || "Beneficiary",
        bank: payout.beneficiary?.bank_name || "Bank",
        account_last4: payout.beneficiary?.account_last4 || null,
        reconciled: true
      }
    });
  } catch (error) {
    return res.status(400).json({
      error: "Sandbox payout failed",
      detail: error?.message || "Unknown error"
    });
  }
}
