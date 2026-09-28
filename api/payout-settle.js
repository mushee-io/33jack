import { addAuditEvent } from "./_lib/db.js";
import { verifyPayoutApproval } from "./_lib/payout-approval.js";
import { getPayout, savePayout } from "./_lib/payout-store.js";

function sameValue(a, b) {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a ?? "") === String(b ?? "");
}

function sameBeneficiary(stored = {}, approved = {}) {
  const keys = ["name", "bank_name", "account_last4", "country"];
  return keys.every((key) =>
    String(stored?.[key] ?? "").trim() === String(approved?.[key] ?? "").trim()
  );
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

    const termsMatch =
      sameValue(payout.funding_asset, approved.fundingAsset) &&
      sameValue(Number(payout.funding_amount), Number(approved.fundingAmount)) &&
      sameValue(payout.destination_currency, approved.destinationCurrency) &&
      sameValue(Number(payout.destination_amount), Number(approved.destinationAmount)) &&
      sameValue(Number(payout.exchange_rate), Number(approved.exchangeRate)) &&
      sameValue(Number(payout.fee_amount), Number(approved.feeAmount)) &&
      sameBeneficiary(payout.beneficiary, approved.beneficiary);

    if (!termsMatch) {
      throw new Error("Approved payout terms changed before settlement");
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
