import postgres from "postgres";
import { assertTransition } from "./state.js";

let sql;
let ready = false;

const memory = globalThis.__33jackStore || (globalThis.__33jackStore = {
  payments: [],
  events: [],
  beneficiaries: []
});

function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2 });
  return sql;
}

export async function ensureSchema() {
  const client = db();
  if (!client || ready) return Boolean(client);

  await client`
    create table if not exists jack_payments (
      id text primary key,
      invoice_name text not null,
      invoice_number text,
      invoice_hash text,
      supplier text,
      source_currency text,
      destination_currency text,
      source_amount numeric,
      destination_amount text,
      route text,
      route_options jsonb,
      beneficiary jsonb,
      risk jsonb,
      status text not null,
      settlement_signature text,
      approval jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await client`alter table jack_payments add column if not exists invoice_number text`;
  await client`alter table jack_payments add column if not exists invoice_hash text`;
  await client`alter table jack_payments add column if not exists route_options jsonb`;
  await client`alter table jack_payments add column if not exists beneficiary jsonb`;
  await client`alter table jack_payments add column if not exists approval jsonb`;

  await client`
    create index if not exists jack_payments_invoice_hash_idx
    on jack_payments(invoice_hash)
  `;
  await client`
    create index if not exists jack_payments_supplier_idx
    on jack_payments(lower(supplier))
  `;
  await client`
    create index if not exists jack_payments_status_idx
    on jack_payments(status)
  `;

  await client`
    create table if not exists jack_events (
      id bigserial primary key,
      payment_id text,
      event_type text not null,
      actor text not null default 'system',
      data jsonb,
      created_at timestamptz not null default now()
    )
  `;
  await client`
    create index if not exists jack_events_payment_idx
    on jack_events(payment_id, created_at desc)
  `;

  await client`
    create table if not exists jack_beneficiaries (
      id bigserial primary key,
      supplier_key text not null,
      supplier_name text not null,
      destination_currency text,
      bank_name text,
      account_last4 text,
      country text,
      payment_handle text,
      metadata jsonb,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique(supplier_key, destination_currency)
    )
  `;

  ready = true;
  return true;
}

function normalizeSupplier(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getPayment(id) {
  if (!id) return null;
  const client = db();
  if (!client) return memory.payments.find((p) => String(p.id) === String(id)) || null;
  await ensureSchema();
  const rows = await client`select * from jack_payments where id = ${String(id)} limit 1`;
  return rows[0] || null;
}

export async function findPaymentByInvoiceHash(invoiceHash) {
  if (!invoiceHash) return null;
  const client = db();
  if (!client) return memory.payments.find((p) => p.invoice_hash === invoiceHash) || null;
  await ensureSchema();
  const rows = await client`
    select * from jack_payments
    where invoice_hash = ${invoiceHash}
    order by created_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function savePayment(payment) {
  if (!payment?.id || !payment?.invoice_name) throw new Error("Payment id and invoice_name are required");

  const client = db();
  if (!client) {
    const idx = memory.payments.findIndex((x) => x.id === payment.id);
    if (idx >= 0) {
      const existing = memory.payments[idx];
      memory.payments[idx] = {
        ...existing,
        ...payment,
        risk: payment.risk === undefined ? existing.risk : payment.risk,
        route_options: payment.route_options === undefined ? existing.route_options : payment.route_options,
        beneficiary: payment.beneficiary === undefined ? existing.beneficiary : payment.beneficiary,
        approval: payment.approval === undefined ? existing.approval : payment.approval,
        updated_at: new Date().toISOString()
      };
      return memory.payments[idx];
    }
    const row = {
      ...payment,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memory.payments.unshift(row);
    return row;
  }

  await ensureSchema();

  const risk = payment.risk === undefined ? null : JSON.stringify(payment.risk);
  const routeOptions = payment.route_options === undefined ? null : JSON.stringify(payment.route_options);
  const beneficiary = payment.beneficiary === undefined ? null : JSON.stringify(payment.beneficiary);
  const approval = payment.approval === undefined ? null : JSON.stringify(payment.approval);

  const [row] = await client`
    insert into jack_payments (
      id, invoice_name, invoice_number, invoice_hash, supplier,
      source_currency, destination_currency, source_amount, destination_amount,
      route, route_options, beneficiary, risk, status, settlement_signature, approval
    ) values (
      ${payment.id}, ${payment.invoice_name}, ${payment.invoice_number || null},
      ${payment.invoice_hash || null}, ${payment.supplier || null},
      ${payment.source_currency || null}, ${payment.destination_currency || null},
      ${payment.source_amount ?? null}, ${payment.destination_amount || null},
      ${payment.route || null},
      ${routeOptions}::jsonb, ${beneficiary}::jsonb, ${risk}::jsonb,
      ${payment.status || "analyzed"}, ${payment.settlement_signature || null},
      ${approval}::jsonb
    )
    on conflict (id) do update set
      invoice_name = coalesce(excluded.invoice_name, jack_payments.invoice_name),
      invoice_number = coalesce(excluded.invoice_number, jack_payments.invoice_number),
      invoice_hash = coalesce(excluded.invoice_hash, jack_payments.invoice_hash),
      supplier = coalesce(excluded.supplier, jack_payments.supplier),
      source_currency = coalesce(excluded.source_currency, jack_payments.source_currency),
      destination_currency = coalesce(excluded.destination_currency, jack_payments.destination_currency),
      source_amount = coalesce(excluded.source_amount, jack_payments.source_amount),
      destination_amount = coalesce(excluded.destination_amount, jack_payments.destination_amount),
      route = coalesce(excluded.route, jack_payments.route),
      route_options = coalesce(excluded.route_options, jack_payments.route_options),
      beneficiary = coalesce(excluded.beneficiary, jack_payments.beneficiary),
      risk = coalesce(excluded.risk, jack_payments.risk),
      status = excluded.status,
      settlement_signature = coalesce(excluded.settlement_signature, jack_payments.settlement_signature),
      approval = coalesce(excluded.approval, jack_payments.approval),
      updated_at = now()
    returning *
  `;
  return row;
}

export async function transitionPayment(id, nextStatus, patch = {}, actor = "system", data = {}) {
  const existing = await getPayment(id);
  if (!existing) throw new Error("Payment not found");
  assertTransition(existing.status, nextStatus);
  const updated = await savePayment({
    ...patch,
    id: existing.id,
    invoice_name: existing.invoice_name,
    status: nextStatus
  });
  await addAuditEvent(id, "payment_status_changed", actor, {
    from: existing.status,
    to: nextStatus,
    ...data
  });
  return updated;
}

export async function listPayments(limit = 25) {
  const client = db();
  if (!client) return memory.payments.slice(0, limit);
  await ensureSchema();
  return client`select * from jack_payments order by created_at desc limit ${limit}`;
}

export async function addAuditEvent(paymentId, eventType, actor = "system", data = {}) {
  const event = {
    payment_id: paymentId || null,
    event_type: eventType,
    actor,
    data,
    created_at: new Date().toISOString()
  };
  const client = db();
  if (!client) {
    memory.events.unshift({ id: memory.events.length + 1, ...event });
    return event;
  }
  await ensureSchema();
  const [row] = await client`
    insert into jack_events (payment_id, event_type, actor, data)
    values (${paymentId || null}, ${eventType}, ${actor}, ${JSON.stringify(data)}::jsonb)
    returning *
  `;
  return row;
}

export async function listAuditEvents(paymentId, limit = 50) {
  const client = db();
  if (!client) {
    return memory.events
      .filter((e) => !paymentId || String(e.payment_id) === String(paymentId))
      .slice(0, limit);
  }
  await ensureSchema();
  if (paymentId) {
    return client`
      select * from jack_events
      where payment_id = ${String(paymentId)}
      order by created_at desc
      limit ${limit}
    `;
  }
  return client`select * from jack_events order by created_at desc limit ${limit}`;
}

export async function getBeneficiaryHistory(supplier, destinationCurrency) {
  const supplierKey = normalizeSupplier(supplier);
  if (!supplierKey) return null;
  const client = db();
  if (!client) {
    return memory.beneficiaries.find((b) =>
      b.supplier_key === supplierKey &&
      (!destinationCurrency || b.destination_currency === destinationCurrency)
    ) || null;
  }
  await ensureSchema();
  const rows = await client`
    select * from jack_beneficiaries
    where supplier_key = ${supplierKey}
      and (${destinationCurrency || null}::text is null or destination_currency = ${destinationCurrency || null})
    order by last_seen_at desc
    limit 1
  `;
  return rows[0] || null;
}

export async function upsertBeneficiary({ supplier, destinationCurrency, beneficiary = {}, metadata = {} }) {
  const supplierKey = normalizeSupplier(supplier);
  if (!supplierKey || !supplier) return null;

  const record = {
    supplier_key: supplierKey,
    supplier_name: supplier,
    destination_currency: destinationCurrency || null,
    bank_name: beneficiary.bank_name || null,
    account_last4: beneficiary.account_last4 || null,
    country: beneficiary.country || null,
    payment_handle: beneficiary.payment_handle || null,
    metadata
  };

  const client = db();
  if (!client) {
    const idx = memory.beneficiaries.findIndex((b) =>
      b.supplier_key === supplierKey && b.destination_currency === record.destination_currency
    );
    if (idx >= 0) {
      memory.beneficiaries[idx] = {
        ...memory.beneficiaries[idx],
        ...record,
        last_seen_at: new Date().toISOString()
      };
      return memory.beneficiaries[idx];
    }
    const row = {
      id: memory.beneficiaries.length + 1,
      ...record,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    memory.beneficiaries.unshift(row);
    return row;
  }

  await ensureSchema();
  const [row] = await client`
    insert into jack_beneficiaries (
      supplier_key, supplier_name, destination_currency, bank_name,
      account_last4, country, payment_handle, metadata
    ) values (
      ${record.supplier_key}, ${record.supplier_name}, ${record.destination_currency},
      ${record.bank_name}, ${record.account_last4}, ${record.country},
      ${record.payment_handle}, ${JSON.stringify(metadata)}::jsonb
    )
    on conflict (supplier_key, destination_currency) do update set
      supplier_name = excluded.supplier_name,
      bank_name = coalesce(excluded.bank_name, jack_beneficiaries.bank_name),
      account_last4 = coalesce(excluded.account_last4, jack_beneficiaries.account_last4),
      country = coalesce(excluded.country, jack_beneficiaries.country),
      payment_handle = coalesce(excluded.payment_handle, jack_beneficiaries.payment_handle),
      metadata = coalesce(excluded.metadata, jack_beneficiaries.metadata),
      last_seen_at = now()
    returning *
  `;
  return row;
}

export function persistenceMode() {
  return process.env.DATABASE_URL ? "postgres" : "memory";
}
