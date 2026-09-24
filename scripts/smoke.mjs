import assert from "node:assert/strict";
import analyze from "../api/analyze.js";
import approve from "../api/approve.js";
import settle from "../api/settle.js";
import health from "../api/health.js";

function invoke(handler, method = "GET", body = undefined) {
  return new Promise((resolve, reject) => {
    const req = { method, body, headers: {} };
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

const analysis = await invoke(analyze, "POST", {
  fileName: "ci-invoice.txt",
  mimeType: "text/plain",
  fileData: invoice,
  corridor: "NGN"
});

assert.equal(analysis.status, 200);
assert.ok(analysis.data.id);
assert.equal(analysis.data.destination_currency, "NGN");
assert.ok(analysis.data.recommended_route);

const approval = await invoke(approve, "POST", {
  paymentId: analysis.data.id,
  invoiceName: analysis.data.invoice_name,
  supplier: analysis.data.supplier,
  sourceCurrency: analysis.data.source_currency,
  destinationCurrency: analysis.data.destination_currency,
  sourceAmount: analysis.data.source_amount,
  destinationAmount: analysis.data.destination_amount,
  route: analysis.data.recommended_route,
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

const second = await invoke(settle, "POST", {
  approvalToken: approval.data.approvalToken
});
assert.equal(second.status, 200);
assert.equal(second.data.idempotent, true);
assert.equal(second.data.signature, settlement.data.signature);

const status = await invoke(health, "GET");
assert.equal(status.status, 200);
assert.equal(status.data.ok, true);

console.log("33jack smoke: analyze → approve → settle → idempotent replay PASS");
