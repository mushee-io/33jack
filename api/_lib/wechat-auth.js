import crypto from "node:crypto";

function secret() {
  return String(
    process.env.WECHAT_REVIEW_SECRET ||
    process.env.APPROVAL_HMAC_SECRET ||
    process.env.WECHAT_TOKEN ||
    "33jack-wechat-demo-launch-secret-not-for-production"
  ).trim();
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
  const payload = {
    type: "wechat_payment_review",
    paymentId: String(paymentId),
    wechatOpenId: String(wechatOpenId),
    workspaceId: String(workspaceId || ""),
    expiresAt: Date.now() + Math.min(Number(expiresInMs) || 900000, 900000)
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
  if (!payload.paymentId || !payload.wechatOpenId || !payload.workspaceId) {
    throw new Error("WeChat review token is incomplete");
  }
  if (paymentId != null && String(payload.paymentId) !== String(paymentId)) {
    throw new Error("WeChat review link does not match this payment");
  }
  if (!payload.expiresAt || Date.now() > Number(payload.expiresAt)) {
    throw new Error("WeChat payment review link expired");
  }
  return payload;
}
