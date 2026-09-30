import crypto from "node:crypto";
import {
  addAuditEvent,
  assignPaymentWorkspace,
  createWorkspaceInvite,
  getOrCreateTelegramWorkspace,
  getPayment,
  getTelegramPreferences,
  getTelegramWorkspaceMembership,
  joinWorkspaceInvite,
  listAuditEvents,
  listBeneficiaries,
  listPaymentsByWorkspace,
  listWorkspaceMembers,
  roleCan,
  setBeneficiaryControl,
  setWorkspaceMemberRole,
  updateTelegramPreferences
} from "./db.js";
import { listPayoutsByWorkspace } from "./payout-store.js";
import { signWhatsAppLaunch } from "./whatsapp-auth.js";

const MAX_INVOICE_BYTES = Math.floor(3.2 * 1024 * 1024);

function graphVersion() {
  return String(process.env.WHATSAPP_GRAPH_VERSION || "v26.0").trim();
}

function accessToken() {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  return token;
}

function phoneNumberId() {
  const id = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  return id;
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

export function whatsappReadiness() {
  return {
    configured: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID
    ),
    verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
    graphVersion: graphVersion()
  };
}

export function verifyWhatsAppChallenge(req) {
  const mode = String(req?.query?.["hub.mode"] || "");
  const token = String(req?.query?.["hub.verify_token"] || "");
  const challenge = String(req?.query?.["hub.challenge"] || "");
  const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || "").trim();

  if (!expected) return { ok: false, challenge: null };
  return {
    ok: mode === "subscribe" && token === expected,
    challenge: mode === "subscribe" && token === expected ? challenge : null
  };
}

export function verifyWhatsAppSignature(rawBody, signatureHeader) {
  const secret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  if (!secret) return !isProduction;
  const header = String(signatureHeader || "");
  if (!header.startsWith("sha256=")) return false;

  const received = header.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function graphRequest(path, options = {}) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion()}/${String(path).replace(/^\//, "")}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body:
        options.body && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body
    }
  );

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      data?.raw ||
      `WhatsApp Graph API HTTP ${response.status}`
    );
  }
  return data;
}

async function sendText(to, text, extra = {}) {
  return graphRequest(`${phoneNumberId()}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "text",
      text: {
        preview_url: false,
        body: String(text).slice(0, 4096)
      },
      ...extra
    }
  });
}

async function sendReviewLink(to, text, url) {
  if (!url) return sendText(to, text);
  return graphRequest(`${phoneNumberId()}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: String(text).slice(0, 1024) },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Review in 33Jack",
            url
          }
        }
      }
    }
  }).catch(() =>
    sendText(to, `${text}\n\nReview securely: ${url}`)
  );
}

async function markRead(messageId) {
  if (!messageId) return;
  await graphRequest(`${phoneNumberId()}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId
    }
  }).catch(() => {});
}

async function retrieveMedia(mediaId) {
  const meta = await graphRequest(
    `${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId())}`,
    { method: "GET" }
  );
  if (!meta?.url) throw new Error("WhatsApp did not return a media URL");

  const response = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken()}` }
  });
  if (!response.ok) {
    throw new Error(`WhatsApp media download failed with HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_INVOICE_BYTES) {
    throw new Error("Invoice is over the 3.2 MB 33Jack demo limit");
  }
  return {
    bytes,
    mimeType: meta.mime_type || response.headers.get("content-type") || "application/octet-stream"
  };
}

function messageText(message = {}) {
  return String(
    message?.text?.body ||
    message?.image?.caption ||
    message?.document?.caption ||
    ""
  ).trim();
}

function mediaDescriptor(message = {}) {
  if (message.document?.id) {
    return {
      id: message.document.id,
      fileName:
        message.document.filename ||
        `whatsapp_invoice_${message.id || Date.now()}.pdf`,
      mimeType: message.document.mime_type || "application/pdf"
    };
  }
  if (message.image?.id) {
    return {
      id: message.image.id,
      fileName: `whatsapp_invoice_${message.id || Date.now()}.jpg`,
      mimeType: message.image.mime_type || "image/jpeg"
    };
  }
  return null;
}

async function analyzeWhatsAppInvoice(req, message, corridor = "USD") {
  const descriptor = mediaDescriptor(message);
  if (!descriptor) return null;

  const media = await retrieveMedia(descriptor.id);
  const base = appBaseUrl(req);
  if (!base) throw new Error("PUBLIC_APP_URL is not configured");

  const response = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: descriptor.fileName,
      mimeType: descriptor.mimeType || media.mimeType,
      fileData: media.bytes.toString("base64"),
      corridor
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || "Invoice analysis failed");
  }
  return data;
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
    "AI prepared the instruction. Exact approval and money movement stay inside 33Jack."
  ].join("\n");
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

function extractMessages(payload = {}) {
  const messages = [];
  for (const entry of payload.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const message of value.messages || []) {
        messages.push({
          ...message,
          metadata: value.metadata || {},
          contact: (value.contacts || [])[0] || null
        });
      }
    }
  }
  return messages;
}

export async function sendWhatsAppPaymentReceipt({ payment, whatsappUserId, base = "" }) {
  if (!payment?.id) throw new Error("Payment is required for WhatsApp receipt");
  if (!whatsappUserId) throw new Error("WhatsApp user is required for receipt");

  const identity = `whatsapp:${whatsappUserId}`;
  const membership = await getTelegramWorkspaceMembership(identity);
  if (!membership || String(payment.workspace_id || "") !== String(membership.workspace.id)) {
    throw new Error("Payment is not available to this WhatsApp workspace");
  }

  const preferences = await getTelegramPreferences(membership.workspace.id, identity);
  if (preferences.receipt_messages === false) {
    return { ok: true, idempotent: false, suppressed: true };
  }

  if (!["settled_demo", "settled_devnet"].includes(String(payment.status || ""))) {
    throw new Error(`Payment is not settled yet (current status: ${payment.status || "unknown"})`);
  }

  const events = await listAuditEvents(payment.id, 100);
  const alreadySent = events.some((event) =>
    event.event_type === "whatsapp_receipt_sent" &&
    String(event.data?.whatsapp_user_id || "") === String(whatsappUserId)
  );
  if (alreadySent) return { ok: true, idempotent: true };

  const amount = payment.source_amount && payment.source_currency
    ? `${payment.source_currency} ${Number(payment.source_amount).toLocaleString()}`
    : "—";
  const status = payment.status === "settled_devnet"
    ? "Settled on Solana Devnet"
    : "Settled in controlled demo";

  const lines = [
    "33Jack payment complete",
    "",
    `Supplier: ${payment.supplier || "—"}`,
    `Invoice: ${payment.invoice_number || payment.invoice_name || payment.id}`,
    `Invoice amount: ${amount}`,
    `Destination: ${payment.destination_amount || payment.destination_currency || "—"}`,
    `Status: ${status}`,
    "Reconciled: ✓",
    payment.settlement_signature ? `Reference: ${payment.settlement_signature}` : null
  ].filter(Boolean);

  if (payment.status === "settled_devnet" && payment.settlement_signature) {
    lines.push(
      "",
      `Solana Explorer: https://explorer.solana.com/tx/${payment.settlement_signature}?cluster=devnet`
    );
  }
  if (base) lines.push("", `Open 33Jack: ${base}`);

  await sendText(whatsappUserId, lines.join("\n"));
  await addAuditEvent(payment.id, "whatsapp_receipt_sent", `whatsapp-user:${whatsappUserId}`, {
    whatsapp_user_id: String(whatsappUserId),
    workspace_id: membership.workspace.id,
    status: payment.status,
    settlement_signature: payment.settlement_signature || null
  });

  return { ok: true, idempotent: false };
}

export async function handleWhatsAppWebhook(req, res, rawBody) {
  if (req.method === "GET") {
    const verification = verifyWhatsAppChallenge(req);
    if (!verification.ok) {
      return res.status(403).send ? res.status(403).send("Forbidden") : res.status(403).json({ error: "Forbidden" });
    }
    if (typeof res.send === "function") return res.status(200).send(verification.challenge);
    res.statusCode = 200;
    return res.end(verification.challenge);
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }

  if (!verifyWhatsAppSignature(rawBody, req.headers?.["x-hub-signature-256"])) {
    return res.status(401).json({ error: "Invalid WhatsApp webhook signature" });
  }

  let payload;
  try {
    payload = rawBody?.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    return res.status(400).json({ error: "Invalid WhatsApp webhook JSON" });
  }

  const messages = extractMessages(payload);
  if (!messages.length) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  for (const message of messages) {
    const from = String(message.from || "").trim();
    if (!from) continue;

    await markRead(message.id);
    const text = messageText(message);
    const lower = text.toLowerCase();
    const base = appBaseUrl(req);

    try {
      // Reuse the same workspace/RBAC backend as Telegram, but namespace the
      // messaging identity so a WhatsApp phone can never collide with a
      // Telegram numeric user id.
      const workspaceContext = await getOrCreateTelegramWorkspace({
        id: `whatsapp:${from}`,
        first_name:
          message?.contact?.profile?.name ||
          `WhatsApp ••••${from.slice(-4)}`
      });
      const workspace = workspaceContext.workspace;
      const member = workspaceContext.member;
      const identity = `whatsapp:${from}`;
      const whatsappUser = {
        id: identity,
        first_name:
          message?.contact?.profile?.name ||
          `WhatsApp ••••${from.slice(-4)}`
      };

      if (lower === "team") {
        const members = await listWorkspaceMembers(workspace.id);
        await sendText(
          from,
          [
            `33Jack team · ${workspace.name || workspace.id}`,
            "",
            ...members.map((item, index) =>
              `${index + 1}. ${item.display_name || "Member"} — ${item.role}${String(item.telegram_user_id) === identity ? " (you)" : ""}`
            ),
            "",
            roleCan(member.role, "manage_team")
              ? "Manage: INVITE <role> or ROLE <number> <role>"
              : "Your role can view the team but cannot change roles."
          ].join("\n")
        );
        continue;
      }

      if (lower.startsWith("invite ")) {
        if (!roleCan(member.role, "manage_team")) {
          await sendText(from, "Your workspace role cannot invite team members.");
          continue;
        }
        const role = lower.split(/\s+/)[1] || "viewer";
        const invite = await createWorkspaceInvite(workspace.id, identity, role, 1440);
        await sendText(
          from,
          [
            "33Jack workspace invite",
            "",
            `Role: ${invite.role}`,
            `Code: ${invite.code}`,
            "Expires: 24 hours",
            "",
            `The other person can message: JOIN ${invite.code}`
          ].join("\n")
        );
        continue;
      }

      if (lower.startsWith("join ")) {
        const code = text.split(/\s+/)[1] || "";
        const joined = await joinWorkspaceInvite(whatsappUser, code);
        await addAuditEvent(null, "workspace_member_joined", `whatsapp-user:${from}`, {
          workspace_id: joined.workspace.id,
          role: joined.member.role,
          whatsapp_user_id: from
        });
        await sendText(
          from,
          `Joined ${joined.workspace.name || joined.workspace.id} as ${joined.member.role}. Send STATUS or TEAM to continue.`
        );
        continue;
      }

      if (lower.startsWith("role ")) {
        if (!roleCan(member.role, "manage_team")) {
          await sendText(from, "Your workspace role cannot manage team roles.");
          continue;
        }
        const match = text.match(/^role\s+(\d+)\s+(owner|admin|approver|operator|viewer)$/i);
        if (!match) {
          await sendText(from, "Use: ROLE <team number> <admin|approver|operator|viewer>");
          continue;
        }
        const members = await listWorkspaceMembers(workspace.id);
        const target = members[Number(match[1]) - 1];
        if (!target) {
          await sendText(from, "That team number does not exist. Send TEAM first.");
          continue;
        }
        if (String(target.telegram_user_id) === identity) {
          await sendText(from, "You cannot change your own role from WhatsApp.");
          continue;
        }
        const changed = await setWorkspaceMemberRole(
          workspace.id,
          target.telegram_user_id,
          match[2].toLowerCase()
        );
        await addAuditEvent(null, "workspace_member_role_changed", `whatsapp-user:${from}`, {
          workspace_id: workspace.id,
          target_user_id: target.telegram_user_id,
          role: changed.role
        });
        await sendText(from, `${target.display_name || "Member"} is now ${changed.role}.`);
        continue;
      }

      if (lower === "beneficiaries") {
        const [payments, allBeneficiaries] = await Promise.all([
          listPaymentsByWorkspace(workspace.id, 100),
          listBeneficiaries(200)
        ]);
        const keys = new Set(
          payments.map((payment) =>
            `${String(payment.supplier || "").trim().toLowerCase()}|${String(payment.destination_currency || "").toUpperCase()}`
          )
        );
        const scoped = allBeneficiaries.filter((beneficiary) =>
          keys.has(
            `${String(beneficiary.supplier_name || "").trim().toLowerCase()}|${String(beneficiary.destination_currency || "").toUpperCase()}`
          )
        );
        await sendText(
          from,
          scoped.length
            ? [
                "33Jack beneficiaries",
                "",
                ...scoped.slice(0, 20).map((b, index) =>
                  `${index + 1}. ${b.supplier_name} · ${b.destination_currency || "—"} · ${b.bank_name || b.payment_handle || "profile"}${b.account_last4 ? " ••••" + b.account_last4 : ""}`
                ),
                "",
                roleCan(member.role, "manage_beneficiaries")
                  ? "Control: BLOCK Supplier | USD | reason  or  ALLOW Supplier | USD"
                  : "Your role cannot change beneficiary controls."
              ].join("\n")
            : "No settled beneficiary profiles are stored for this workspace yet."
        );
        continue;
      }

      if (lower.startsWith("block ") || lower.startsWith("allow ") || lower.startsWith("review ")) {
        if (!roleCan(member.role, "manage_beneficiaries")) {
          await sendText(from, "Your workspace role cannot manage beneficiaries.");
          continue;
        }
        const mode = lower.startsWith("block ")
          ? "blocked"
          : lower.startsWith("allow ")
            ? "allowlisted"
            : "review";
        const raw = text.replace(/^(block|allow|review)\s+/i, "");
        const [supplier, currency, ...noteParts] = raw.split("|").map((part) => part.trim());
        if (!supplier || !currency) {
          await sendText(from, "Use: BLOCK Supplier | USD | optional reason");
          continue;
        }
        const control = await setBeneficiaryControl(
          workspace.id,
          supplier,
          currency,
          mode,
          noteParts.join(" | "),
          identity
        );
        await addAuditEvent(null, "beneficiary_control_changed", `whatsapp-user:${from}`, {
          workspace_id: workspace.id,
          supplier,
          destination_currency: String(currency).toUpperCase(),
          status: control.status
        });
        await sendText(
          from,
          `${supplier} · ${String(currency).toUpperCase()} is now ${control.status}.`
        );
        continue;
      }

      if (lower === "notify") {
        const preferences = await getTelegramPreferences(workspace.id, identity);
        await sendText(
          from,
          [
            "33Jack WhatsApp notifications",
            "",
            `Payments: ${preferences.payment_updates ? "ON" : "OFF"}`,
            `Risk alerts: ${preferences.risk_alerts ? "ON" : "OFF"}`,
            `Payouts: ${preferences.payout_updates ? "ON" : "OFF"}`,
            `Receipts: ${preferences.receipt_messages ? "ON" : "OFF"}`,
            "",
            "Change: NOTIFY <PAYMENTS|RISK|PAYOUTS|RECEIPTS> <ON|OFF>"
          ].join("\n")
        );
        continue;
      }

      if (lower.startsWith("notify ")) {
        const match = text.match(/^notify\s+(payments|risk|payouts|receipts)\s+(on|off)$/i);
        if (!match) {
          await sendText(from, "Use: NOTIFY <PAYMENTS|RISK|PAYOUTS|RECEIPTS> <ON|OFF>");
          continue;
        }
        const keyMap = {
          payments: "payment_updates",
          risk: "risk_alerts",
          payouts: "payout_updates",
          receipts: "receipt_messages"
        };
        const key = keyMap[match[1].toLowerCase()];
        const enabled = match[2].toLowerCase() === "on";
        const preferences = await updateTelegramPreferences(workspace.id, identity, {
          [key]: enabled
        });
        await sendText(
          from,
          `${match[1].toUpperCase()} notifications are now ${enabled ? "ON" : "OFF"}.`
        );
        continue;
      }

      if (lower === "payouts") {
        const payouts = await listPayoutsByWorkspace(workspace.id, 20);
        await sendText(
          from,
          payouts.length
            ? [
                "33Jack payouts",
                "",
                ...payouts.map((payout, index) =>
                  `${index + 1}. ${payout.id} · ${payout.funding_amount} ${payout.funding_asset} → ${payout.destination_amount} ${payout.destination_currency} · ${payout.status}`
                ),
                "",
                "Fiat payout execution remains inside the controlled 33Jack approval flow."
              ].join("\n")
            : "No fiat payout records are stored for this workspace yet."
        );
        continue;
      }

      if (lower === "status" || lower === "/status") {
        const payments = await listPaymentsByWorkspace(workspace.id, 50);
        const { active, settled, flagged } = compactStatus(payments);
        await sendText(
          from,
          [
            "33Jack status",
            "",
            `Workspace: ${workspace.name || workspace.id}`,
            `Role: ${member.role}`,
            `Stored payments: ${payments.length}`,
            `Active / pending: ${active.length}`,
            `Settled: ${settled.length}`,
            `Risk review: ${flagged.length}`
          ].join("\n")
        );
        continue;
      }

      if (
        lower === "help" ||
        lower === "/help" ||
        lower === "hi" ||
        lower === "hello" ||
        lower === "start"
      ) {
        await sendText(
          from,
          [
            "33Jack WhatsApp",
            "",
            "Send an invoice as PDF, JPG or PNG and I’ll prepare the payment review.",
            "",
            "Commands:",
            "STATUS · payment state",
            "TEAM · workspace members",
            "INVITE <role> · create team invite",
            "JOIN <code> · join a workspace",
            "BENEFICIARIES · supplier profiles",
            "PAYOUTS · fiat payout state",
            "NOTIFY · notification settings",
            "",
            "Money movement still requires the exact human approval flow in 33Jack."
          ].join("\n")
        );
        continue;
      }

      if (mediaDescriptor(message)) {
        await sendText(from, "Invoice received. 33Jack is extracting and checking it…");
        const corridorMatch = text.match(/\b(USD|GBP|CNY|INR)\b/i);
        const analysis = await analyzeWhatsAppInvoice(
          req,
          message,
          corridorMatch?.[1]?.toUpperCase() || "USD"
        );
        if (!analysis?.id) {
          throw new Error("Invoice analysis did not return a payment id");
        }

        await assignPaymentWorkspace(analysis.id, workspace.id);
        await addAuditEvent(
          analysis.id,
          "whatsapp_invoice_attached",
          `whatsapp-user:${from}`,
          {
            workspace_id: workspace.id,
            whatsapp_user_id: from,
            role: member.role,
            file_name: mediaDescriptor(message)?.fileName || null
          }
        );

        const launchToken = signWhatsAppLaunch({
          paymentId: analysis.id,
          whatsappUserId: from,
          workspaceId: workspace.id
        });
        const reviewUrl = base
          ? `${base}/?channel=whatsapp&paymentId=${encodeURIComponent(analysis.id)}&waToken=${encodeURIComponent(launchToken)}`
          : base;
        await sendReviewLink(from, invoiceSummary(analysis), reviewUrl);
        continue;
      }

      const payments = await listPaymentsByWorkspace(workspace.id, 25);
      const { active, flagged } = compactStatus(payments);
      await sendText(
        from,
        `33Jack is connected. Upload an invoice here and I’ll prepare it for review. There are currently ${active.length} active payment(s) and ${flagged.length} requiring risk review.`
      );
    } catch (error) {
      await sendText(
        from,
        `33Jack could not process that request: ${error?.message || "Unknown error"}`
      ).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true });
}
