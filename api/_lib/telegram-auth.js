import crypto from "node:crypto";

function telegramBotToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function launchSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || telegramBotToken()).trim();
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signTelegramLaunch({ paymentId, userId, expiresInMs = 15 * 60 * 1000 }) {
  const payload = {
    paymentId: String(paymentId),
    userId: String(userId),
    expiresAt: Date.now() + Math.min(Number(expiresInMs) || 900000, 900000)
  };
  const body = encode(payload);
  const signature = crypto
    .createHmac("sha256", launchSecret())
    .update(body)
    .digest("base64url");
  return body + "." + signature;
}

export function verifyTelegramLaunch(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Missing Telegram launch token");
  }
  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", launchSecret())
    .update(body)
    .digest("base64url");
  if (!timingSafeEqualText(signature, expected)) {
    throw new Error("Invalid Telegram launch signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.paymentId || !payload.userId) throw new Error("Telegram launch token is incomplete");
  if (!payload.expiresAt || Date.now() > Number(payload.expiresAt)) {
    throw new Error("Telegram payment review link expired");
  }
  return payload;
}

export function verifyTelegramInitData(rawInitData, maxAgeSeconds = 900) {
  const raw = String(rawInitData || "").trim();
  if (!raw) throw new Error("Telegram Mini App authentication is missing");

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram Mini App hash is missing");
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(telegramBotToken())
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualText(hash, expectedHash)) {
    throw new Error("Telegram Mini App authentication failed");
  }

  const authDate = Number(params.get("auth_date") || 0);
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate || age < -30 || age > maxAgeSeconds) {
    throw new Error("Telegram Mini App session expired");
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }
  if (!user?.id) throw new Error("Telegram Mini App user is missing");

  return { user, authDate, queryId: params.get("query_id") || null };
}

export function verifyTelegramApproval({ initData, launchToken, paymentId }) {
  const auth = verifyTelegramInitData(initData);
  const launch = verifyTelegramLaunch(launchToken);
  if (String(launch.paymentId) !== String(paymentId)) {
    throw new Error("Telegram payment link does not match this payment");
  }
  if (String(launch.userId) !== String(auth.user.id)) {
    throw new Error("Telegram payment link belongs to a different user");
  }
  return { ...auth, launch };
}
