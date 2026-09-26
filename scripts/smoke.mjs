import assert from "node:assert/strict";
import analyze from "../api/analyze.js";
import approve from "../api/approve.js";
import settle from "../api/settle.js";
import paymentDetail from "../api/payment.js";
import health from "../api/health.js";

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
  "INVOICE 33J-CI-1\nSupplier: Lagos Studio Co.\nAmount due: GBP 4850\nTarget: NGN",
  "utf8"
).toString("base64");

const first = await invoke(analyze, "POST", {
  fileName: "ci-invoice.txt",
  mimeType: "text/plain",
  fileData: invoice,
  corridor: "NGN"
});

assert.equal(first.status, 200);
assert.ok(first.data.id);
assert.equal(first.data.destination_currency, "NGN");
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
  corridor: "NGN"
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

const status = await invoke(health, "GET");
assert.equal(status.status, 200);
assert.equal(status.data.ok, true);
assert.equal(status.data.checks.secureApprovals, true);

console.log("33jack smoke: fingerprint → analyze → gated approve → settle → idempotency → audit PASS");
