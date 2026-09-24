import postgres from "postgres";

let sql;
let ready = false;
const memory = globalThis.__33jackMemory || (globalThis.__33jackMemory = []);

function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  return sql;
}

export async function ensureSchema() {
  const client = db();
  if (!client || ready) return Boolean(client);
  await client`
    create table if not exists jack_payments (
      id text primary key,
      invoice_name text not null,
      supplier text,
      source_currency text,
      destination_currency text,
      source_amount numeric,
      destination_amount text,
      route text,
      risk jsonb,
      status text not null,
      settlement_signature text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  ready = true;
  return true;
}

export async function savePayment(payment) {
  const client = db();
  if (!client) {
    const idx = memory.findIndex((x) => x.id === payment.id);
    if (idx >= 0) memory[idx] = { ...memory[idx], ...payment, updated_at: new Date().toISOString() };
    else memory.unshift({ ...payment, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return payment;
  }
  await ensureSchema();
  const risk = JSON.stringify(payment.risk || {});
  const [row] = await client`
    insert into jack_payments (
      id, invoice_name, supplier, source_currency, destination_currency,
      source_amount, destination_amount, route, risk, status, settlement_signature
    ) values (
      ${payment.id}, ${payment.invoice_name}, ${payment.supplier || null},
      ${payment.source_currency || null}, ${payment.destination_currency || null},
      ${payment.source_amount || null}, ${payment.destination_amount || null},
      ${payment.route || null}, ${risk}::jsonb, ${payment.status || "prepared"},
      ${payment.settlement_signature || null}
    )
    on conflict (id) do update set
      supplier = excluded.supplier,
      source_currency = excluded.source_currency,
      destination_currency = excluded.destination_currency,
      source_amount = excluded.source_amount,
      destination_amount = excluded.destination_amount,
      route = excluded.route,
      risk = excluded.risk,
      status = excluded.status,
      settlement_signature = excluded.settlement_signature,
      updated_at = now()
    returning *
  `;
  return row;
}

export async function listPayments(limit = 25) {
  const client = db();
  if (!client) return memory.slice(0, limit);
  await ensureSchema();
  return client`select * from jack_payments order by created_at desc limit ${limit}`;
}
