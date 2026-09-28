import assert from "node:assert/strict";
import analyze from "../api/analyze.js";
import approve from "../api/approve.js";
import settle from "../api/settle.js";
import paymentDetail from "../api/payment.js";
import payments from "../api/payments.js";
import health from "../api/health.js";
import payoutQuote from "../api/payout-quote.js";
import payoutApprove from "../api/payout-approve.js";
import payoutSettle from "../api/payout-settle.js";
import { getPayout, savePayout } from "../api/_lib/payout-store.js";

function invoke(handler, method = "GET", body = undefined, query = undefined) {
  return new Promise((resolve, reject) => {
    const req = { method, body, query: query || {}, headers: {} };
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(data) { resolve({ status: this.code, data }); return this; },
      end() { resolve({ status: this.code, data: null }); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

process.env.OPENAI_API_KEY = "";
process.env.DATABASE_URL = "";
process.env.SOLANA_DEVNET_PAYER_SECRET_KEY = "";
process.env.SOLANA_SETTLEMENT_RECEIVER = "";
process.env.APPROVAL_HMAC_SECRET = "ci-smoke-secret";

const invoice = Buffer.from(
  "INVOICE 33J-CI-1\nSupplier: Austin Software Inc.\nAmount due: GBP 4850\nTarget: USD",
  "utf8"
).toString("base64");

const first = await invoke(analyze, "POST", {
  fileName: "ci-invoice.txt",
  mimeType: "text/plain",
  fileData: invoice,
  corridor: "USD"
});

assert.equal(first.status, 200);
assert.ok(first.data.id);
assert.equal(first.data.destination_currency, "USD");
assert.ok(first.data.recommended_route);
assert.equal(first.data.risk.duplicate, false);
assert.ok(first.data.invoice_hash);

const approval = await invoke(approve, "POST", {
  paymentId: first.data.id,
  acknowledgements: {},
  amountUsdc: 1
});

assert.equal(approval.status, 200);
assert.ok(approval.data.approvalToken);

const settlement = await invoke(settle, "POST", {
  approvalToken: approval.data.approvalToken
});

assert.equal(settlement.status, 200);
assert.equal(settlement.data.mode, "demo");
assert.ok(settlement.data.signature.startsWith("demo_"));

const replay = await invoke(settle, "POST", {
  approvalToken: approval.data.approvalToken
});
assert.equal(replay.status, 200);
assert.equal(replay.data.idempotent, true);
assert.equal(replay.data.signature, settlement.data.signature);

const detail = await invoke(paymentDetail, "GET", undefined, { id: first.data.id });
assert.equal(detail.status, 200);
assert.equal(detail.data.payment.status, "settled_demo");
assert.ok(detail.data.events.length >= 3);

// Analyze the exact same invoice again. The deterministic SHA-256 fingerprint
// must detect the duplicate even without AI.
const duplicate = await invoke(analyze, "POST", {
  fileName: "ci-invoice-copy.txt",
  mimeType: "text/plain",
  fileData: invoice,
  corridor: "USD"
});
assert.equal(duplicate.status, 200);
assert.equal(duplicate.data.risk.duplicate, true);

const blockedApproval = await invoke(approve, "POST", {
  paymentId: duplicate.data.id,
  acknowledgements: {},
  amountUsdc: 1
});
assert.equal(blockedApproval.status, 400);
assert.match(blockedApproval.data.detail, /acknowledgement/i);

const acknowledgedApproval = await invoke(approve, "POST", {
  paymentId: duplicate.data.id,
  acknowledgements: { duplicate: true },
  amountUsdc: 1
});
assert.equal(acknowledgedApproval.status, 200);
assert.ok(acknowledgedApproval.data.approvalToken);

const fiatQuote = await invoke(payoutQuote, "POST", {
  fundingAsset: "USDG",
  fundingAmount: 10000,
  destinationCurrency: "CNY",
  invoiceRef: "33J-CI-FIAT-1",
  beneficiary: {
    name: "CI Supplier Ltd",
    bank_name: "CI Bank",
    account_last4: "5678",
    country: "China"
  }
});
assert.equal(fiatQuote.status, 200);
assert.equal(fiatQuote.data.payout.status, "quoted");
assert.equal(fiatQuote.data.payout.funding_asset, "USDG");
assert.equal(fiatQuote.data.payout.destination_currency, "CNY");
assert.ok(Number(fiatQuote.data.payout.destination_amount) > 0);

const refreshedFiatQuote = await invoke(payoutQuote, "POST", {
  payoutId: fiatQuote.data.payout.id,
  fundingAsset: "USDG",
  fundingAmount: 10000,
  destinationCurrency: "CNY",
  invoiceRef: "33J-CI-FIAT-1",
  beneficiary: {
    name: "CI Supplier Ltd",
    bank_name: "CI Bank",
    account_last4: "5678",
    country: "China"
  }
});
assert.equal(refreshedFiatQuote.status, 200);
assert.equal(refreshedFiatQuote.data.payout.id, fiatQuote.data.payout.id);
assert.equal(refreshedFiatQuote.data.payout.status, "quoted");

const fiatApproval = await invoke(payoutApprove, "POST", {
  payoutId: fiatQuote.data.payout.id
});
assert.equal(fiatApproval.status, 200);
assert.ok(fiatApproval.data.approvalToken);

// Mimic Postgres JSONB returning beneficiary keys in a different order.
const approvedStoredPayout = await getPayout(fiatQuote.data.payout.id);
await savePayout({
  ...approvedStoredPayout,
  beneficiary: {
    country: approvedStoredPayout.beneficiary.country,
    account_last4: approvedStoredPayout.beneficiary.account_last4,
    bank_name: approvedStoredPayout.beneficiary.bank_name,
    name: approvedStoredPayout.beneficiary.name
  }
});

const fiatSettlement = await invoke(payoutSettle, "POST", {
  approvalToken: fiatApproval.data.approvalToken
});
assert.equal(fiatSettlement.status, 200);
assert.equal(fiatSettlement.data.payout.status, "paid_sandbox");
assert.ok(fiatSettlement.data.receipt.id.startsWith("33J-FIAT-"));
assert.equal(fiatSettlement.data.receipt.reconciled, true);
assert.equal(fiatSettlement.data.receipt.beneficiary, "CI Supplier Ltd");
assert.equal(fiatSettlement.data.receipt.bank, "CI Bank");
assert.equal(fiatSettlement.data.receipt.account_last4, "5678");

const payoutList = await invoke(payments, "GET", undefined, { kind: "payouts", limit: 10 });
assert.equal(payoutList.status, 200);
assert.ok(payoutList.data.payouts.some((p) => p.id === fiatQuote.data.payout.id));
assert.equal(
  payoutList.data.payouts.filter((p) => p.invoice_ref === "33J-CI-FIAT-1").length,
  1
);

const status = await invoke(health, "GET");
assert.equal(status.status, 200);
assert.equal(status.data.ok, true);
assert.equal(status.data.checks.secureApprovals, true);

console.log("33jack smoke: invoice settlement + stablecoin→fiat quote→approval→sandbox payout→reconciliation PASS");
