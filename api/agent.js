import OpenAI from "openai";
import { listBeneficiaries, listPayments } from "./_lib/db.js";

function compactPayment(p) {
  return {
    id: p.id,
    supplier: p.supplier || null,
    invoice: p.invoice_number || p.invoice_name || null,
    source_currency: p.source_currency || null,
    source_amount: p.source_amount == null ? null : Number(p.source_amount),
    destination_currency: p.destination_currency || null,
    destination_amount: p.destination_amount || null,
    route: p.route || null,
    status: p.status || null,
    risk: {
      duplicate: Boolean(p.risk?.duplicate),
      beneficiary_changed: Boolean(p.risk?.beneficiary_changed),
      suspicious: Boolean(p.risk?.suspicious),
      missing_fields: Array.isArray(p.risk?.missing_fields) ? p.risk.missing_fields : []
    },
    created_at: p.created_at || null
  };
}

function fallbackAnswer(message, payments) {
  const risky = payments.filter((p) =>
    p.risk?.duplicate ||
    p.risk?.beneficiary_changed ||
    p.risk?.suspicious ||
    (Array.isArray(p.risk?.missing_fields) && p.risk.missing_fields.length)
  );
  const pending = payments.filter((p) =>
    ["analyzed", "approved", "settling", "failed"].includes(String(p.status || ""))
  );
  const settled = payments.filter((p) =>
    ["settled_demo", "settled_devnet"].includes(String(p.status || ""))
  );

  const lower = String(message || "").toLowerCase();
  if (lower.includes("risk") || lower.includes("attention") || lower.includes("problem")) {
    if (!risky.length) return "I do not see any currently stored payment with an active risk flag.";
    return `You have ${risky.length} payment${risky.length === 1 ? "" : "s"} needing risk review: ${risky
      .slice(0, 5)
      .map((p) => `${p.supplier || p.id} (${p.id})`)
      .join(", ")}.`;
  }
  if (lower.includes("failed")) {
    const failed = payments.filter((p) => p.status === "failed");
    return failed.length
      ? `There are ${failed.length} failed payment${failed.length === 1 ? "" : "s"}: ${failed.map((p) => p.id).join(", ")}.`
      : "I do not see any failed payments in the current 33jack records.";
  }
  return `33jack currently has ${payments.length} payment record${payments.length === 1 ? "" : "s"}: ${pending.length} pending/active, ${settled.length} settled, and ${risky.length} carrying risk flags. Ask me about a supplier, invoice, payment status, failures, or what needs attention.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "message is required" });
  if (message.length > 2000) return res.status(400).json({ error: "message is too long" });

  const [paymentRows, beneficiaryRows] = await Promise.all([
    listPayments(50),
    listBeneficiaries(50)
  ]);
  const payments = paymentRows.map(compactPayment);
  const beneficiaries = beneficiaryRows.map((b) => ({
    supplier: b.supplier_name,
    destination_currency: b.destination_currency,
    bank_name: b.bank_name,
    account_last4: b.account_last4,
    country: b.country,
    last_seen_at: b.last_seen_at
  }));

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      answer: fallbackAnswer(message, payments),
      mode: "deterministic",
      canExecute: false
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_INVOICE_MODEL || "gpt-5.6-luna",
      input: [{
        role: "system",
        content: [{
          type: "input_text",
          text: `You are 33jack, a business finance operations assistant.
You can inspect the supplied 33jack payment and beneficiary state and explain it clearly.
You are READ-ONLY in this endpoint. Never claim you executed, approved, cancelled, retried, or moved money.
Do not invent information that is absent.
When a payment has risk flags, mention the concrete flags.
When asked to execute money movement, explain that the user must use the structured approval/payment flow.
Be concise and operational.`
        }]
      }, {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            question: message,
            payments,
            beneficiaries
          })
        }]
      }]
    });

    return res.status(200).json({
      answer: response.output_text || fallbackAnswer(message, payments),
      mode: "ai",
      canExecute: false
    });
  } catch (error) {
    return res.status(500).json({
      error: "Agent failed",
      detail: error?.message || "Unknown error"
    });
  }
}
