import { listAuditEvents } from "./_lib/db.js";
import { whatsappReadiness } from "./_lib/whatsapp.js";

function graphVersion() {
  return String(process.env.WHATSAPP_GRAPH_VERSION || "v25.0").trim();
}

function sanitizeMetaError(data = {}) {
  const error = data?.error || {};
  return {
    code: error.code ?? null,
    subcode: error.error_subcode ?? null,
    type: error.type || null,
    message: error.message || null
  };
}

async function probePhoneNumber() {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  if (!token || !phoneId) {
    return { ok: false, reason: "missing_credentials" };
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.error) {
    return {
      ok: false,
      httpStatus: response.status,
      error: sanitizeMetaError(data)
    };
  }

  return {
    ok: true,
    httpStatus: response.status,
    idMatchesConfigured: String(data.id || "") === phoneId,
    hasDisplayPhoneNumber: Boolean(data.display_phone_number),
    hasVerifiedName: Boolean(data.verified_name),
    qualityRating: data.quality_rating || null
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const readiness = whatsappReadiness();
  const [phoneProbe, events] = await Promise.all([
    probePhoneNumber().catch((error) => ({
      ok: false,
      reason: "probe_failed",
      message: error?.message || "Unknown diagnostic error"
    })),
    listAuditEvents(null, 300).catch(() => [])
  ]);

  const whatsappEvents = events
    .filter((event) => String(event.event_type || "").startsWith("whatsapp_"))
    .slice(0, 50);

  const inbound = whatsappEvents.filter(
    (event) => event.event_type === "whatsapp_message_received"
  );
  const failures = whatsappEvents.filter(
    (event) => String(event.event_type || "").includes("failed")
  );

  return res.status(200).json({
    ok: true,
    checkedAt: new Date().toISOString(),
    graphVersion: readiness.graphVersion,
    configured: readiness.fullyConfigured,
    phoneProbe,
    audit: {
      whatsappEvents: whatsappEvents.length,
      inboundMessages: inbound.length,
      failures: failures.length,
      latestInboundAt: inbound[0]?.created_at || inbound[0]?.timestamp || null,
      latestEventTypes: whatsappEvents.slice(0, 12).map((event) => ({
        type: event.event_type,
        at: event.created_at || event.timestamp || null,
        messageType: event.data?.message_type || null
      }))
    }
  });
}
