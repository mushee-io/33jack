import crypto from "node:crypto";
import OpenAI from "openai";
import {
  addAuditEvent,
  findPaymentByInvoiceHash,
  getBeneficiaryHistory,
  listPayments,
  savePayment
} from "./_lib/db.js";
import { rankRoutes } from "./_lib/routing.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const fallback = (name = "supplier_invoice.pdf", corridor = "NGN") => ({
  id: "pay_" + Date.now().toString(36),
  invoice_name: name,
  supplier: corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co.",
  invoice_number: corridor === "CNY" ? "CN-44018" : "LS-0192",
  source_currency: "GBP",
  source_amount: 4850,
  destination_currency: corridor,
  destination_amount: corridor === "CNY" ? "¥42,000" : "₦8,250,000",
  due_date: null,
  beneficiary: {
    name: corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co.",
    bank_name: "Demo Settlement Bank",
    account_last4: "1840",
    country: corridor === "CNY" ? "CN" : "NG",
    payment_handle: null
  },
  risk: {
    duplicate: false,
    beneficiary_changed: false,
    missing_fields: [],
    suspicious: false,
    summary: "Demo analysis completed. Production beneficiary-change checks require stored beneficiary history."
  },
  confidence: 0.91,
  mode: "demo"
});

function extractJson(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function invoiceHash(fileData) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(String(fileData || ""), "base64"))
    .digest("hex");
}

function beneficiaryChanged(previous, current) {
  if (!previous || !current) return false;
  const comparable = [
    ["bank_name", previous.bank_name, current.bank_name],
    ["account_last4", previous.account_last4, current.account_last4],
    ["country", previous.country, current.country],
    ["payment_handle", previous.payment_handle, current.payment_handle]
  ].filter(([, a, b]) => a && b);

  return comparable.some(([, a, b]) =>
    String(a).trim().toLowerCase() !== String(b).trim().toLowerCase()
  );
}

function missingCoreFields(parsed) {
  const missing = [];
  if (!parsed.supplier) missing.push("supplier");
  if (!parsed.source_currency) missing.push("source_currency");
  if (!parsed.source_amount) missing.push("source_amount");
  if (!parsed.destination_currency) missing.push("destination_currency");
  return missing;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { fileName, mimeType, fileData, corridor = "NGN" } = req.body || {};
  if (!fileName || !fileData) {
    return res.status(400).json({ error: "fileName and fileData are required" });
  }

  const hash = invoiceHash(fileData);
  const exactDuplicate = await findPaymentByInvoiceHash(hash);

  if (!process.env.OPENAI_API_KEY) {
    const base = fallback(fileName, corridor);
    const history = await getBeneficiaryHistory(base.supplier, corridor);
    const changed = beneficiaryChanged(history, base.beneficiary);
    const duplicate = Boolean(exactDuplicate);
    const routing = rankRoutes({
      destinationCurrency: corridor,
      sourceAmount: base.source_amount,
      urgencyMinutes: 1440
    });

    const result = {
      ...base,
      invoice_hash: hash,
      beneficiary_history_found: Boolean(history),
      risk: {
        ...base.risk,
        duplicate,
        beneficiary_changed: changed,
        summary: duplicate
          ? "Exact invoice file already exists in 33jack payment history."
          : changed
            ? "Beneficiary details differ from the stored supplier profile and require explicit acknowledgement."
            : base.risk.summary
      },
      recommended_route: routing.best?.label || `GBP → USDC/Solana → ${corridor}`,
      route_options: routing,
      quote_mode: routing.mode
    };

    const saved = await savePayment({
      ...result,
      route: result.recommended_route,
      status: "analyzed"
    });
    await addAuditEvent(saved.id, "invoice_analyzed", "33jack-agent", {
      mode: "demo",
      invoice_hash: hash,
      duplicate,
      beneficiary_changed: changed
    });

    return res.status(200).json({
      ...result,
      notice: "OPENAI_API_KEY is not configured; deterministic demo analysis returned."
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const type = String(mimeType || "");
    const isImage = type.startsWith("image/");
    const isPdf = type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    const source = isImage
      ? { type: "input_image", image_url: `data:${mimeType};base64,${fileData}`, detail: "high" }
      : isPdf
        ? { type: "input_file", filename: fileName, file_data: `data:${mimeType || "application/pdf"};base64,${fileData}`, detail: "high" }
        : { type: "input_file", filename: fileName, file_data: `data:${mimeType || "text/plain"};base64,${fileData}` };

    const prompt = `You are 33jack's invoice-risk analyst.
Extract the commercial payment instruction from this invoice and return ONLY valid JSON.
Never invent missing values. Flag uncertainty.
Target payout currency requested by the UI: ${corridor}.

JSON shape:
{
  "supplier": string|null,
  "invoice_number": string|null,
  "source_currency": string|null,
  "source_amount": number|null,
  "destination_currency": string|null,
  "destination_amount": string|null,
  "due_date": string|null,
  "beneficiary": {
    "name": string|null,
    "bank_name": string|null,
    "account_last4": string|null,
    "country": string|null,
    "payment_handle": string|null
  },
  "risk": {
    "suspicious": boolean,
    "missing_fields": string[],
    "summary": string
  },
  "confidence": number
}

Privacy rule: never return a full bank-account number. If an account number is present, return only its final four characters as account_last4.
Do not claim duplicate detection or beneficiary-history verification; 33jack performs those checks deterministically after extraction.`;

    const response = await client.responses.create({
      model: process.env.OPENAI_INVOICE_MODEL || "gpt-5.6-luna",
      input: [{
        role: "user",
        content: [
          source,
          { type: "input_text", text: prompt }
        ]
      }]
    });

    const parsed = extractJson(response.output_text);
    const previous = await listPayments(100);
    const semanticDuplicate = previous.some((p) =>
      p.invoice_number &&
      parsed.invoice_number &&
      String(p.invoice_number).trim().toLowerCase() === String(parsed.invoice_number).trim().toLowerCase() &&
      String(p.supplier || "").trim().toLowerCase() === String(parsed.supplier || "").trim().toLowerCase() &&
      String(p.status || "") !== "rejected"
    );

    const history = await getBeneficiaryHistory(
      parsed.supplier,
      parsed.destination_currency || corridor
    );
    const changed = beneficiaryChanged(history, parsed.beneficiary);
    const duplicate = Boolean(exactDuplicate || semanticDuplicate);
    const missing = Array.from(new Set([
      ...(Array.isArray(parsed.risk?.missing_fields) ? parsed.risk.missing_fields : []),
      ...missingCoreFields(parsed)
    ]));

    const routing = rankRoutes({
      destinationCurrency: parsed.destination_currency || corridor,
      sourceAmount: parsed.source_amount || 0,
      urgencyMinutes: 1440
    });

    const risk = {
      ...(parsed.risk || {}),
      duplicate,
      beneficiary_changed: changed,
      missing_fields: missing,
      summary: duplicate
        ? "33jack found this invoice, or the same supplier/invoice number, in payment history."
        : changed
          ? "Beneficiary details differ from the stored supplier profile and require explicit acknowledgement."
          : parsed.risk?.summary || "No deterministic duplicate or beneficiary-change signal found."
    };

    const result = {
      id: "pay_" + Date.now().toString(36),
      invoice_name: fileName,
      invoice_hash: hash,
      ...parsed,
      risk,
      beneficiary_history_found: Boolean(history),
      recommended_route: routing.best?.label ||
        `${parsed.source_currency || "GBP"} → USDC/Solana → ${parsed.destination_currency || corridor}`,
      route_options: routing,
      quote_mode: routing.mode,
      mode: "ai"
    };

    const saved = await savePayment({
      ...result,
      route: result.recommended_route,
      status: "analyzed"
    });

    await addAuditEvent(saved.id, "invoice_analyzed", "33jack-agent", {
      mode: "ai",
      invoice_hash: hash,
      confidence: parsed.confidence ?? null,
      duplicate,
      beneficiary_changed: changed,
      missing_fields: missing,
      route_id: routing.best?.id || null
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("invoice analysis failed", error);
    return res.status(500).json({
      error: "Invoice analysis failed",
      detail: error?.message || "Unknown error"
    });
  }
}
