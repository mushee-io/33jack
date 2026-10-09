import crypto from "node:crypto";

function secret() {
  const value = String(
    process.env.WECHAT_REVIEW_SECRET || process.env.APPROVAL_HMAC_SECRET || ""
  ).trim();
  if (value.length < 32) {
    throw new Error("WECHAT_REVIEW_SECRET or APPROVAL_HMAC_SECRET must contain at least 32 characters");
  }
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signWeChatLaunch({
  paymentId,
  wechatOpenId,
  workspaceId,
  expiresInMs = 15 * 60 * 1000
}) {
  if (!paymentId || !wechatOpenId || !workspaceId) {
    throw new Error("WeChat payment, OpenID and workspace are required");
  }
  const ttl = Number(expiresInMs);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("Invalid WeChat review expiry");
  }
  const payload = {
    type: "wechat_payment_review",
    paymentId: String(paymentId),
    wechatOpenId: String(wechatOpenId),
    workspaceId: String(workspaceId || ""),
    expiresAt: Date.now() + Math.min(ttl, 900000)
  };
  const body = encode(payload);
  const signature = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  return body + "." + signature;
}

export function verifyWeChatLaunch(token, paymentId = null) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Missing WeChat review token");
  }

  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");

  if (!safeEqual(signature, expected)) {
    throw new Error("Invalid WeChat review signature");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.type !== "wechat_payment_review" || !payload.paymentId || !payload.wechatOpenId || !payload.workspaceId) {
    throw new Error("WeChat review token is incomplete");
  }
  if (paymentId != null && String(payload.paymentId) !== String(paymentId)) {
    throw new Error("WeChat review link does not match this payment");
  }
  if (!Number.isFinite(Number(payload.expiresAt)) ||
      Number(payload.expiresAt) < Date.now() ||
      Number(payload.expiresAt) > Date.now() + 15 * 60 * 1000) {
    throw new Error("WeChat payment review link expired");
  }
  return payload;
}
