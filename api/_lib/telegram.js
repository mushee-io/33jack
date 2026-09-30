import crypto from "node:crypto";
import {
  addAuditEvent,
  getPayment,
  listAuditEvents,
  listPayments
} from "./db.js";
import {
  signTelegramLaunch,
  verifyTelegramApproval,
  verifyTelegramInitData
} from "./telegram-auth.js";

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


function dashboardUrl(base) {
  return base ? `${base}/telegram-dashboard.html` : "";
}

async function ensureTelegramMenuButton(base) {
  const url = dashboardUrl(base);
  if (!url) return false;
  try {
    await telegramApi("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Open 33Jack",
        web_app: { url }
      }
    });
    return true;
  } catch {
    return false;
  }
}

function telegramUserIdFromEvent(event) {
  const fromData = event?.data?.telegram_user_id;
  if (fromData != null) return String(fromData);
  const actor = String(event?.actor || "");
  const match = actor.match(/^telegram-user:(.+)$/);
  return match?.[1] || "";
}

async function telegramScopedData(userId, limit = 100) {
  const [payments, events] = await Promise.all([
    listPayments(Math.min(Math.max(Number(limit) || 100, 1), 100)),
    listAuditEvents(null, 500)
  ]);

  const uid = String(userId);
  const ownedIds = new Set(
    events
      .filter((event) => telegramUserIdFromEvent(event) === uid)
      .map((event) => String(event.payment_id || ""))
      .filter(Boolean)
  );

  const ownedPayments = payments.filter((payment) => ownedIds.has(String(payment.id)));
  const ownedEvents = events
    .filter((event) =>
      ownedIds.has(String(event.payment_id || "")) ||
      telegramUserIdFromEvent(event) === uid
    )
    .slice(0, 120);

  return { payments: ownedPayments, events: ownedEvents };
}

function dashboardPayment(payment, userId, base) {
  const missing = Array.isArray(payment.risk?.missing_fields)
    ? payment.risk.missing_fields
    : [];
  const reviewable =
    ["analyzed", "failed"].includes(String(payment.status || "")) &&
    missing.length === 0;
  const launchToken = reviewable
    ? signTelegramLaunch({ paymentId: payment.id, userId })
    : null;

  return {
    id: payment.id,
    supplier: payment.supplier || null,
    invoice: payment.invoice_number || payment.invoice_name || payment.id,
    invoice_name: payment.invoice_name || null,
    source_currency: payment.source_currency || null,
    source_amount: payment.source_amount == null ? null : Number(payment.source_amount),
    destination_currency: payment.destination_currency || null,
    destination_amount: payment.destination_amount || null,
    route: payment.route || null,
    status: payment.status || null,
    created_at: payment.created_at || null,
    updated_at: payment.updated_at || null,
    beneficiary: {
      name: payment.beneficiary?.name || null,
      bank_name: payment.beneficiary?.bank_name || null,
      account_last4: payment.beneficiary?.account_last4 || null,
      country: payment.beneficiary?.country || null
    },
    risk: {
      duplicate: Boolean(payment.risk?.duplicate),
      beneficiary_changed: Boolean(payment.risk?.beneficiary_changed),
      suspicious: Boolean(payment.risk?.suspicious),
      missing_fields: missing
    },
    settlement: {
      amount_usdg: payment.approval?.amount_usdg == null
        ? null
        : Number(payment.approval.amount_usdg),
      signature: payment.settlement_signature || null,
      explorer: payment.status === "settled_devnet" && payment.settlement_signature
        ? `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`
        : null
    },
    review_url: base && launchToken
      ? `${base}/telegram.html?payment=${encodeURIComponent(payment.id)}&launch=${encodeURIComponent(launchToken)}`
      : null
  };
}

function dashboardEvent(event) {
  return {
    id: event.id || null,
    payment_id: event.payment_id || null,
    event_type: event.event_type || null,
    actor: event.actor || null,
    created_at: event.created_at || null,
    data: {
      from: event.data?.from || null,
      to: event.data?.to || null,
      mode: event.data?.mode || null,
      route: event.data?.route || null,
      amount_usdg: event.data?.amount_usdg == null ? null : Number(event.data.amount_usdg),
      signature: event.data?.signature || null
    }
  };
}

export async function handleTelegramDashboard(req, res) {
  try {
    const auth = verifyTelegramInitData(req.body?.telegramInitData);
    if (!allowedChat(auth.user.id)) {
      return res.status(403).json({ error: "This Telegram account is not allowed to open 33Jack." });
    }

    const base = appBaseUrl(req);
    const scoped = await telegramScopedData(auth.user.id, 100);
    const payments = scoped.payments.map((payment) =>
      dashboardPayment(payment, auth.user.id, base)
    );
    const { active, settled, flagged } = compactStatus(scoped.payments);
    const invoices = payments.filter((payment) => Boolean(payment.invoice));

    return res.status(200).json({
      ok: true,
      user: {
        id: String(auth.user.id),
        first_name: auth.user.first_name || "",
        last_name: auth.user.last_name || "",
        username: auth.user.username || ""
      },
      summary: {
        payments: payments.length,
        active: active.length,
        settled: settled.length,
        risk_review: flagged.length,
        invoices: invoices.length
      },
      payments,
      invoices,
      history: scoped.events.map(dashboardEvent)
    });
  } catch (error) {
    return res.status(401).json({
      error: "Telegram dashboard authentication failed",
      detail: error?.message || "Unknown Telegram dashboard error"
    });
  }
}

export async function sendTelegramPaymentReceipt({ payment, userId, base = "" }) {
  if (!payment?.id) throw new Error("Payment is required for Telegram receipt");
  if (!userId) throw new Error("Telegram user is required for receipt");

  if (!["settled_demo", "settled_devnet"].includes(String(payment.status || ""))) {
    throw new Error(`Payment is not settled yet (current status: ${payment.status || "unknown"})`);
  }

  const existingEvents = await listAuditEvents(payment.id, 100);
  const alreadySent = existingEvents.some((event) =>
    event.event_type === "telegram_receipt_sent" &&
    String(event.data?.telegram_user_id || "") === String(userId)
  );

  if (alreadySent) {
    return { ok: true, idempotent: true };
  }

  const settlementAmount = Number(payment.approval?.amount_usdg || 0);
  const statusLabel = payment.status === "settled_devnet"
    ? "Settled on Solana Devnet"
    : "Settled in controlled demo";
  const invoiceAmount = payment.source_amount && payment.source_currency
    ? `${payment.source_currency} ${Number(payment.source_amount).toLocaleString()}`
    : "—";

  const lines = [
    "33Jack payment complete",
    "",
    `Supplier: ${payment.supplier || "—"}`,
    `Invoice: ${payment.invoice_number || payment.invoice_name || payment.id}`,
    `Invoice amount: ${invoiceAmount}`,
    settlementAmount > 0 ? `Settlement amount: ${settlementAmount} USDG` : null,
    `Destination: ${payment.destination_amount || payment.destination_currency || "—"}`,
    `Status: ${statusLabel}`,
    "Reconciled: ✓",
    payment.settlement_signature ? `Reference: ${payment.settlement_signature}` : null
  ].filter(Boolean);

  const buttons = [];
  if (payment.status === "settled_devnet" && payment.settlement_signature) {
    buttons.push([{
      text: "View Solana transaction",
      url: `https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`
    }]);
  }
  if (base) {
    buttons.push([{ text: "Open 33Jack", url: base }]);
  }

  await sendMessage(
    userId,
    lines.join("\n"),
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );

  await addAuditEvent(payment.id, "telegram_receipt_sent", `telegram-user:${userId}`, {
    telegram_user_id: String(userId),
    status: payment.status,
    settlement_signature: payment.settlement_signature || null
  });

  return { ok: true, idempotent: false };
}

export async function handleTelegramMiniAppAction(req, res) {
  const body = req.body || {};
  const action = String(body.action || "").toLowerCase();

  if (action === "dashboard") {
    return handleTelegramDashboard(req, res);
  }

  if (action !== "receipt") {
    return res.status(400).json({ error: "Unsupported Telegram Mini App action" });
  }

  try {
    const paymentId = String(body.paymentId || "").trim();
    if (!paymentId) return res.status(400).json({ error: "paymentId is required" });

    const auth = verifyTelegramApproval({
      initData: body.telegramInitData,
      launchToken: body.telegramLaunchToken,
      paymentId
    });

    const payment = await getPayment(paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if (!["settled_demo", "settled_devnet"].includes(String(payment.status || ""))) {
      return res.status(409).json({
        error: "Payment is not settled yet",
        detail: `Current status is ${payment.status || "unknown"}`
      });
    }

    const result = await sendTelegramPaymentReceipt({
      payment,
      userId: auth.user.id,
      base: appBaseUrl(req)
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error: "Telegram receipt rejected",
      detail: error?.message || "Unknown Telegram receipt error"
    });
  }
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
      await ensureTelegramMenuButton(base);
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
                inline_keyboard: [[{ text: "Open 33Jack", web_app: { url: dashboardUrl(base) } }]]
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
      const telegramUserId = message?.from?.id || chatId;
      const scoped = await telegramScopedData(telegramUserId, 100);
      const payments = scoped.payments;
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
                inline_keyboard: [[{ text: "Open dashboard", web_app: { url: dashboardUrl(base) } }]]
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
      if (analysis?.id) {
        await addAuditEvent(analysis.id, "telegram_invoice_received", `telegram-user:${telegramUserId}`, {
          telegram_user_id: String(telegramUserId),
          chat_id: String(chatId),
          invoice_name: analysis.invoice_name || null
        });
      }
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

    const telegramUserId = message?.from?.id || chatId;
    const scoped = await telegramScopedData(telegramUserId, 100);
    const { active, flagged } = compactStatus(scoped.payments);
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
