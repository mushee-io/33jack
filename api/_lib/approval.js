import crypto from "node:crypto";

const demoSecret = "33jack-demo-approval-secret-not-for-production";

function secret() {
  return process.env.APPROVAL_HMAC_SECRET || demoSecret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signApproval(input) {
  const payload = {
    paymentId: String(input.paymentId),
    invoiceName: String(input.invoiceName || "invoice"),
    supplier: String(input.supplier || ""),
    sourceCurrency: String(input.sourceCurrency || ""),
    destinationCurrency: String(input.destinationCurrency || ""),
    sourceAmount: input.sourceAmount == null ? null : Number(input.sourceAmount),
    destinationAmount: String(input.destinationAmount || ""),
    route: String(input.route || ""),
    amountUsdc: Number(input.amountUsdc || 1),
    expiresAt: Date.now() + Math.min(Number(input.expiresInMs || 300000), 900000)
  };
  const body = encode(payload);
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return {
    token: body + "." + signature,
    payload,
    mode: process.env.APPROVAL_HMAC_SECRET ? "secure" : "demo"
  };
}

export function verifyApproval(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) throw new Error("Missing approval token");
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid approval signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.expiresAt || Date.now() > Number(payload.expiresAt)) throw new Error("Approval expired");
  if (!payload.paymentId) throw new Error("Approval missing payment id");
  return payload;
}
