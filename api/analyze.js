import OpenAI from "openai";
import { listPayments, savePayment } from "./_lib/db.js";

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
  beneficiary: { name: corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co.", changed: true },
  risk: {
    duplicate: false,
    beneficiary_changed: true,
    missing_fields: [],
    suspicious: false,
    summary: "Beneficiary payment details differ from the previous demo record and require acknowledgement."
  },
  recommended_route: `GBP → USDC/Solana → ${corridor}`,
  confidence: 0.91,
  mode: "demo"
});

function extractJson(text) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { fileName, mimeType, fileData, corridor = "NGN" } = req.body || {};
  if (!fileName || !fileData) {
    return res.status(400).json({ error: "fileName and fileData are required" });
  }

  if (!process.env.OPENAI_API_KEY) {
    const result = fallback(fileName, corridor);
    await savePayment({ ...result, status: "analyzed" });
    return res.status(200).json({ ...result, notice: "OPENAI_API_KEY is not configured; deterministic demo analysis returned." });
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

    const prompt = `You are 33jack's invoice-risk analyst. Extract the commercial payment instruction from this invoice and return ONLY valid JSON.
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
  "beneficiary": {"name": string|null, "changed": boolean|null},
  "risk": {
    "duplicate": boolean,
    "beneficiary_changed": boolean,
    "missing_fields": string[],
    "suspicious": boolean,
    "summary": string
  },
  "recommended_route": string,
  "confidence": number
}

Important: you cannot truly know whether this invoice is a duplicate or whether beneficiary details changed unless supplied historical evidence exists. In those cases set the relevant value false or null and explain the limitation in risk.summary. Do not claim external verification you did not perform.`;

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
    const previous = await listPayments(50);
    const duplicate = previous.some((p) =>
      String(p.supplier || "").toLowerCase() === String(parsed.supplier || "").toLowerCase() &&
      Number(p.source_amount || 0) === Number(parsed.source_amount || 0) &&
      ["analyzed","approved","settled_demo","settled_devnet"].includes(String(p.status || ""))
    );
    const result = {
      id: "pay_" + Date.now().toString(36),
      invoice_name: fileName,
      ...parsed,
      risk: {
        ...(parsed.risk || {}),
        duplicate,
        summary: duplicate
          ? "33jack found a previous payment record with the same supplier and source amount. Review before approval."
          : parsed.risk?.summary || "No duplicate signal found in stored payment history."
      },
      recommended_route: parsed.recommended_route || `${parsed.source_currency || "GBP"} → USDC/Solana → ${parsed.destination_currency || corridor}`,
      mode: "ai"
    };
    await savePayment({ ...result, route: result.recommended_route, status: "analyzed" });
    return res.status(200).json(result);
  } catch (error) {
    console.error("invoice analysis failed", error);
    return res.status(500).json({ error: "Invoice analysis failed", detail: error?.message || "Unknown error" });
  }
}
