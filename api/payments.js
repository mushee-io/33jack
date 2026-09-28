import { addAuditEvent, listPayments, persistenceMode, savePayment } from "./_lib/db.js";
import { listPayouts } from "./_lib/payout-store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const rawLimit = Number(req.query?.limit || 25);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 25, 1), 100);

    if (String(req.query?.kind || "").toLowerCase() === "payouts") {
      const payouts = await listPayouts(limit);
      return res.status(200).json({
        payouts,
        persistence: persistenceMode()
      });
    }

    const rows = await listPayments(limit);
    if (String(req.query?.kind || "").toLowerCase() === "invoices") {
      return res.status(200).json({
        invoices: rows.filter((row) => row.route === "invoice_draft"),
        persistence: persistenceMode()
      });
    }
    return res.status(200).json({
      payments: rows,
      persistence: persistenceMode()
    });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const kind = String(body.kind || "").toLowerCase();

    if (kind === "invoice") {
      const supplier = String(body.supplier || "").trim();
      const customer = String(body.customer || "").trim();
      const amount = Number(body.amount);
      const currency = String(body.currency || "").trim().toUpperCase();
      const dueDate = String(body.dueDate || "").trim();
      const description = String(body.description || "").trim();
      const invoiceNumber = String(body.invoiceNumber || "").trim();

      const missing = [];
      if (!supplier) missing.push("supplier");
      if (!customer) missing.push("customer");
      if (!Number.isFinite(amount) || amount <= 0) missing.push("amount");
      if (!currency) missing.push("currency");
      if (!dueDate) missing.push("dueDate");
      if (!description) missing.push("description");
      if (!invoiceNumber) missing.push("invoiceNumber");
      if (missing.length) {
        return res.status(400).json({
          error: "Invoice fields are incomplete",
          detail: missing.join(", ")
        });
      }

      const id = String(body.id || ("invoice_" + Date.now().toString(36)));
      const row = await savePayment({
        id,
        invoice_name: invoiceNumber + ".33jack",
        invoice_number: invoiceNumber,
        supplier,
        source_currency: currency,
        destination_currency: currency,
        source_amount: amount,
        destination_amount: `${amount} ${currency}`,
        route: "invoice_draft",
        route_options: null,
        beneficiary: null,
        risk: {
          duplicate: false,
          beneficiary_changed: false,
          suspicious: false,
          missing_fields: ["beneficiary"],
          summary: "Invoice created in 33Jack. Beneficiary verification is required before payment approval."
        },
        invoice_meta: {
          customer,
          due_date: dueDate,
          description,
          created_by: "33jack-invoice"
        },
        status: "analyzed"
      });

      await addAuditEvent(row.id, "invoice_created", "33jack-invoice", {
        invoice_number: invoiceNumber,
        supplier,
        customer,
        amount,
        currency,
        due_date: dueDate
      });

      return res.status(200).json({ invoice: row });
    }

    if (!body.id || !body.invoice_name) {
      return res.status(400).json({ error: "id and invoice_name are required" });
    }

    // This endpoint is intentionally not allowed to bypass the payment lifecycle.
    if (body.status && body.status !== "analyzed") {
      return res.status(400).json({
        error: "Direct status mutation is not allowed",
        detail: "Use /api/approve and /api/settle for payment state transitions."
      });
    }

    const row = await savePayment({
      ...body,
      status: "analyzed"
    });
    return res.status(200).json({ payment: row });
  }

  return res.status(405).json({ error: "GET or POST only" });
}
