import { getPayoutProviderReadiness } from "./_lib/payout-provider.js";
import { getPolicyConfig } from "./_lib/policy.js";
import { telegramReadiness } from "./_lib/telegram.js";
import { whatsappReadiness } from "./_lib/whatsapp.js";
import { wechatReadiness } from "./_lib/wechat.js";
import { listAuditEvents } from "./_lib/db.js";


async function whatsappDiagnostic() {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const version = String(process.env.WHATSAPP_GRAPH_VERSION || "v25.0").trim();

  let phoneProbe = { ok: false, reason: "missing_credentials" };
  if (token && phoneId) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json().catch(() => ({}));
      phoneProbe = response.ok && !data?.error
        ? {
            ok: true,
            httpStatus: response.status,
            idMatchesConfigured: String(data.id || "") === phoneId,
            hasDisplayPhoneNumber: Boolean(data.display_phone_number),
            hasVerifiedName: Boolean(data.verified_name),
            qualityRating: data.quality_rating || null
          }
        : {
            ok: false,
            httpStatus: response.status,
            error: {
              code: data?.error?.code ?? null,
              subcode: data?.error?.error_subcode ?? null,
              type: data?.error?.type || null,
              message: data?.error?.message || null
            }
          };
    } catch (error) {
      phoneProbe = { ok: false, reason: "probe_failed", message: error?.message || "Unknown error" };
    }
  }

  const wabaId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "1062705723268139").trim();
  let wabaSubscription = { ok: false, reason: "missing_credentials" };
  if (token && wabaId) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json().catch(() => ({}));
      wabaSubscription = response.ok && !data?.error
        ? {
            ok: true,
            httpStatus: response.status,
            subscribedAppCount: Array.isArray(data?.data) ? data.data.length : 0,
            hasSubscriptions: Array.isArray(data?.data) && data.data.length > 0,
            appIds: Array.isArray(data?.data)
              ? data.data.map((item) => String(item?.whatsapp_business_api_data?.id || item?.id || "")).filter(Boolean)
              : []
          }
        : {
            ok: false,
            httpStatus: response.status,
            error: {
              code: data?.error?.code ?? null,
              subcode: data?.error?.error_subcode ?? null,
              type: data?.error?.type || null,
              message: data?.error?.message || null
            }
          };
    } catch (error) {
      wabaSubscription = { ok: false, reason: "probe_failed", message: error?.message || "Unknown error" };
    }
  }

  let events = [];
  try {
    events = await listAuditEvents(null, 300);
  } catch {}

  const whatsappEvents = events
    .filter((event) => String(event.event_type || "").startsWith("whatsapp_"))
    .slice(0, 50);
  const inbound = whatsappEvents.filter(
    (event) => event.event_type === "whatsapp_message_received"
  );
  const failures = whatsappEvents.filter(
    (event) => String(event.event_type || "").includes("failed")
  );

  return {
    phoneProbe,
    wabaSubscription,
    audit: {
      whatsappEvents: whatsappEvents.length,
      inboundMessages: inbound.length,
      failures: failures.length,
      latestInboundAt: inbound[0]?.created_at || inbound[0]?.timestamp || null,
      latestEventTypes: whatsappEvents.slice(0, 12).map((event) => {
        let data = event.data || {};
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch { data = {}; }
        }
        return {
          type: event.event_type,
          at: event.created_at || event.timestamp || null,
          messageType: data?.message_type || null,
          error: String(data?.error || "").slice(0, 500) || null,
          dataKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 12) : []
        };
      })
    }
  };
}

export default async function handler(req, res) {
  if (
    req.method === "GET" &&
    String(req.query?.diagnostic || "").toLowerCase() === "whatsapp" &&
    String(req.query?.recipientProbe || "") === "new-number"
  ) {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
    const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    const version = String(process.env.WHATSAPP_GRAPH_VERSION || "v26.0").trim();
    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: "447835338831",
            type: "template",
            template: {
              name: "hello_world",
              language: { code: "en_US" }
            }
          })
        }
      );
      const data = await response.json().catch(() => ({}));
      return res.status(response.ok ? 200 : response.status).json({
        ok: response.ok,
        status: response.status,
        accepted: Boolean(data?.messages?.[0]?.id),
        messageStatus: data?.messages?.[0]?.message_status || null,
        error: response.ok ? null : {
          code: data?.error?.code ?? null,
          subcode: data?.error?.error_subcode ?? null,
          type: data?.error?.type || null,
          message: data?.error?.message || null,
          details: data?.error?.error_data?.details || null
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "Recipient probe failed" });
    }
  }
  if (
    req.method === "GET" &&
    String(req.query?.diagnostic || "").toLowerCase() === "whatsapp" &&
    String(req.query?.send || "") === "latest"
  ) {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
    const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    const version = String(process.env.WHATSAPP_GRAPH_VERSION || "v25.0").trim();
    const events = await listAuditEvents(null, 300).catch(() => []);
    const latest = events.find((event) =>
      event.event_type === "whatsapp_message_received" &&
      event.data?.whatsapp_user_id
    );
    if (!latest?.data?.whatsapp_user_id) {
      return res.status(404).json({ ok: false, error: "No inbound WhatsApp user found" });
    }
    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: String(latest.data.whatsapp_user_id),
            type: "text",
            text: { preview_url: false, body: "33Jack WhatsApp test ✅" }
          })
        }
      );
      const data = await response.json().catch(() => ({}));
      return res.status(response.ok ? 200 : response.status).json({
        ok: response.ok,
        meta: response.ok
          ? { accepted: Boolean(data?.messages?.[0]?.id), status: response.status }
          : {
              status: response.status,
              code: data?.error?.code ?? null,
              subcode: data?.error?.error_subcode ?? null,
              type: data?.error?.type || null,
              message: data?.error?.message || null,
              details: data?.error?.error_data?.details || null
            }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "Outbound probe failed" });
    }
  }

    const payoutProvider = getPayoutProviderReadiness();
  const payoutPolicy = getPolicyConfig();
  const telegram = telegramReadiness();
  const whatsapp = whatsappReadiness();
  const wechat = wechatReadiness();
  const diagnostic = String(req.query?.diagnostic || "").toLowerCase() === "whatsapp"
    ? await whatsappDiagnostic()
    : null;
  const checks = {
    ai: Boolean(process.env.GROQ_API_KEY),
    database: Boolean(process.env.DATABASE_URL),
    secureApprovals: Boolean(process.env.APPROVAL_HMAC_SECRET),
    devnetSigner: Boolean(process.env.SOLANA_DEVNET_PAYER_SECRET_KEY),
    settlementRecipient: Boolean(process.env.SOLANA_SETTLEMENT_RECEIVER),
    routeQuotes: Boolean(process.env.ROUTE_QUOTES_JSON),
    externalPayoutQuotes: payoutProvider.wiseQuoteReady,
    externalPayoutTransfer: payoutProvider.wiseTransferReady,
    externalPayoutBalanceConfigured: payoutProvider.wiseBalanceConfigured,
    externalPayoutAutoFunding: payoutProvider.wiseAutoFundingEnabled,
    externalPayoutFunding: payoutProvider.wiseFundingReady
  };

  const coreReady =
    checks.ai &&
    checks.database &&
    checks.secureApprovals;

  const devnetReady =
    checks.devnetSigner &&
    checks.settlementRecipient;

  return res.status(200).json({
    ok: true,
    service: "33jack",
    aiProvider: process.env.GROQ_API_KEY ? "groq" : "none",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    network: "solana-devnet",
    payoutProvider: payoutProvider.provider,
    channels: {
      whatsapp,
      telegram,
      wechat
    },
    ...(diagnostic ? { whatsappDiagnostic: diagnostic } : {}),
    payoutPolicy: {
      configured: payoutPolicy.configured,
      allowedCurrencies: payoutPolicy.allowedCurrencies,
      singleLimitUsd: payoutPolicy.singleLimitUsd,
      kybRequired: payoutPolicy.kybRequired,
      kybStatus: payoutPolicy.kybStatus,
      blockedCountriesConfigured: payoutPolicy.blockedCountries.length > 0
    },
    mode: coreReady && devnetReady ? "integrated-devnet" : "development",
    checks,
    readiness: {
      core: coreReady,
      solanaDevnet: devnetReady,
      externalPayoutSandbox:
        payoutProvider.externalSandbox && payoutProvider.wiseTransferReady,
      productionMoneyMovement: false
    },
    note:
      "Production money movement stays false until licensed payout/FX partners, KYB/KYC, authorization, monitoring and production custody controls are integrated."
  });
}
