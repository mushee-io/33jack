import crypto from "node:crypto";
import { listPayments } from "./db.js";
import { signTelegramLaunch } from "./telegram-auth.js";

const MAX_INVOICE_BYTES = Math.floor(3.2 * 1024 * 1024);

function botToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function appBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const host =
    req?.headers?.["x-forwarded-host"] ||
    req?.headers?.host ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "";
  return host ? `https://${String(host).replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
}

function allowedChat(chatId) {
  const configured = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!configured.length) return true;
  return configured.includes(String(chatId));
}

export function telegramReadiness() {
  return {
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    chatAllowlistConfigured: Boolean(
      String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || "").trim()
    )
  };
}

export function verifyTelegramWebhook(req) {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  if (!expected) return !isProduction;

  const actual = String(
    req?.headers?.["x-telegram-bot-api-secret-token"] || ""
  );
  if (!actual) return false;

  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function telegramApi(method, payload = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken()}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(
      data?.description || `Telegram ${method} failed with HTTP ${response.status}`
    );
  }
  return data?.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4096),
    disable_web_page_preview: true,
    ...extra
  });
}

function compactStatus(payments = []) {
  const active = payments.filter((p) =>
    ["analyzed", "approved", "settling", "failed"].includes(String(p.status || ""))
  );
  const settled = payments.filter((p) =>
    ["settled_demo", "settled_devnet"].includes(String(p.status || ""))
  );
  const flagged = payments.filter((p) =>
    p.risk?.duplicate ||
    p.risk?.beneficiary_changed ||
    p.risk?.suspicious ||
    (Array.isArray(p.risk?.missing_fields) && p.risk.missing_fields.length)
  );
  return { active, settled, flagged };
}

function riskFlags(risk = {}) {
  const flags = [];
  if (risk.duplicate) flags.push("duplicate");
  if (risk.beneficiary_changed) flags.push("beneficiary changed");
  if (risk.suspicious) flags.push("suspicious");
  if (Array.isArray(risk.missing_fields) && risk.missing_fields.length) {
    flags.push(`missing: ${risk.missing_fields.join(", ")}`);
  }
  return flags;
}

async function getTelegramFile(message) {
  const document = message?.document || null;
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const photo = photos.length ? photos[photos.length - 1] : null;
  const file = document || photo;
  if (!file?.file_id) return null;

  if (Number(file.file_size || 0) > MAX_INVOICE_BYTES) {
    throw new Error("Invoice is over the 3.2 MB 33Jack demo limit");
  }

  const meta = await telegramApi("getFile", { file_id: file.file_id });
  if (!meta?.file_path) throw new Error("Telegram did not return a file path");

  const response = await fetch(
    `https://api.telegram.org/file/bot${botToken()}/${meta.file_path}`
  );
  if (!response.ok) {
    throw new Error(`Could not download Telegram file (HTTP ${response.status})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_INVOICE_BYTES) {
    throw new Error("Invoice is over the 3.2 MB 33Jack demo limit");
  }

  const fileName =
    document?.file_name ||
    (photo ? `telegram_invoice_${message.message_id || Date.now()}.jpg` : "telegram_invoice.bin");
  const mimeType =
    document?.mime_type ||
    (photo ? "image/jpeg" : "application/octet-stream");

  return {
    fileName,
    mimeType,
    fileData: bytes.toString("base64")
  };
}

async function analyzeTelegramInvoice(req, message, corridor = "USD") {
  const file = await getTelegramFile(message);
  if (!file) return null;

  const base = appBaseUrl(req);
  if (!base) throw new Error("PUBLIC_APP_URL is not configured");

  const response = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...file, corridor })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || "Invoice analysis failed");
  }
  return data;
}

function invoiceSummary(analysis = {}) {
  const flags = riskFlags(analysis.risk);
  const amount =
    analysis.source_amount && analysis.source_currency
      ? `${analysis.source_currency} ${Number(analysis.source_amount).toLocaleString()}`
      : "Not extracted";
  return [
    "33Jack invoice review",
    "",
    `Supplier: ${analysis.supplier || "Not extracted"}`,
    `Invoice: ${analysis.invoice_number || analysis.invoice_name || analysis.id || "—"}`,
    `Amount: ${amount}`,
    `Target: ${analysis.destination_currency || "—"}`,
    `Route: ${analysis.recommended_route || "Pending"}`,
    `Risk: ${flags.length ? flags.join("; ") : "No active deterministic flags"}`,
    "",
    "AI prepared the instruction. Exact approval and money movement stay inside the controlled 33Jack approval flow."
  ].join("\n");
}

export async function handleTelegramWebhook(req, res) {
  if (!verifyTelegramWebhook(req)) {
    return res.status(401).json({ error: "Invalid Telegram webhook secret" });
  }

  const update = req.body || {};
  const message = update.message || update.edited_message || null;
  if (!message?.chat?.id) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const chatId = message.chat.id;
  if (!allowedChat(chatId)) {
    await sendMessage(chatId, "This 33Jack Telegram demo is restricted to approved test chats.");
    return res.status(200).json({ ok: true, restricted: true });
  }

  try {
    const text = String(message.text || message.caption || "").trim();
    const base = appBaseUrl(req);

    if (/^\/start\b/i.test(text)) {
      await sendMessage(
        chatId,
        [
          "33Jack Telegram",
          "",
          "Send me an invoice as PDF, PNG, JPG, WEBP or TXT and I’ll prepare the payment review.",
          "",
          "Commands:",
          "/status — current 33Jack payment state",
          "/help — how this demo works",
          "",
          "Money movement still requires the exact human approval flow in 33Jack."
        ].join("\n"),
        base
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: "Open 33Jack", url: base }]]
              }
            }
          : {}
      );
      return res.status(200).json({ ok: true });
    }

    if (/^\/help\b/i.test(text)) {
      await sendMessage(
        chatId,
        "Upload an invoice. 33Jack extracts the instruction, checks duplicate / beneficiary / suspicious signals, prepares a route, then gives you a secure link back to the web control centre for approval."
      );
      return res.status(200).json({ ok: true });
    }

    if (/^\/status\b/i.test(text)) {
      const payments = await listPayments(50);
      const { active, settled, flagged } = compactStatus(payments);
      await sendMessage(
        chatId,
        [
          "33Jack status",
          "",
          `Stored payments: ${payments.length}`,
          `Active / pending: ${active.length}`,
          `Settled: ${settled.length}`,
          `Risk review: ${flagged.length}`
        ].join("\n"),
        base
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: "Open dashboard", url: base }]]
              }
            }
          : {}
      );
      return res.status(200).json({ ok: true });
    }

    if (message.document || message.photo) {
      await sendMessage(chatId, "Invoice received. 33Jack is extracting and checking it…");
      const corridorMatch = text.match(/\b(USD|GBP|CNY|INR)\b/i);
      const analysis = await analyzeTelegramInvoice(
        req,
        message,
        corridorMatch?.[1]?.toUpperCase() || "USD"
      );
      const telegramUserId = message?.from?.id || chatId;
      const launchToken = analysis?.id
        ? signTelegramLaunch({ paymentId: analysis.id, userId: telegramUserId })
        : null;
      const miniAppUrl = base && analysis?.id && launchToken
        ? `${base}/telegram.html?payment=${encodeURIComponent(analysis.id)}&launch=${encodeURIComponent(launchToken)}`
        : base;
      await sendMessage(
        chatId,
        invoiceSummary(analysis),
        base
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: "Review & Pay", web_app: { url: miniAppUrl } }]]
              }
            }
          : {}
      );
      return res.status(200).json({
        ok: true,
        paymentId: analysis?.id || null
      });
    }

    const payments = await listPayments(25);
    const { active, flagged } = compactStatus(payments);
    await sendMessage(
      chatId,
      `33Jack is connected. I can receive invoices here and prepare them for review. Right now there are ${active.length} active payment(s) and ${flagged.length} requiring risk review. Use /status or upload an invoice.`,
      base
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: "Open 33Jack", url: base }]]
            }
          }
        : {}
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    await sendMessage(
      chatId,
      `33Jack could not process that request: ${error?.message || "Unknown error"}`
    ).catch(() => {});
    return res.status(200).json({
      ok: false,
      detail: error?.message || "Unknown error"
    });
  }
}
