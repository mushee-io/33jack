import postgres from "postgres";

let sql;
let ready = false;

const memory = globalThis.__33jackPayoutStore || (globalThis.__33jackPayoutStore = []);

function parseJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizePayout(row) {
  if (!row) return row;
  return {
    ...row,
    quote: parseJson(row.quote),
    beneficiary: parseJson(row.beneficiary)
  };
}

function db() {
  if (!process.env.DATABASE_URL) {
    const isProduction =
      process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production";
    if (isProduction) {
      throw new Error("DATABASE_URL is required in production.");
    }
    return null;
  }
  if (!sql) sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2 });
  return sql;
}

export async function ensurePayoutSchema() {
  const client = db();
  if (!client || ready) return Boolean(client);
  await client`
    create table if not exists jack_payouts (
      id text primary key,
      invoice_ref text,
      funding_asset text not null,
      funding_amount numeric not null,
      destination_currency text not null,
      destination_amount numeric not null,
      exchange_rate numeric not null,
      fee_amount numeric not null,
      quote jsonb not null,
      beneficiary jsonb not null,
      status text not null,
      receipt_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await client`
    create index if not exists jack_payouts_status_idx
    on jack_payouts(status)
  `;
  ready = true;
  return true;
}

export async function savePayout(payout) {
  if (!payout?.id) throw new Error("Payout id is required");
  const client = db();
  if (!client) {
    const idx = memory.findIndex((x) => x.id === payout.id);
    if (idx >= 0) {
      memory[idx] = { ...memory[idx], ...payout, updated_at: new Date().toISOString() };
      return normalizePayout(memory[idx]);
    }
    const row = { ...payout, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    memory.unshift(row);
    return normalizePayout(row);
  }
  await ensurePayoutSchema();
  const [row] = await client`
    insert into jack_payouts (
      id, invoice_ref, funding_asset, funding_amount, destination_currency,
      destination_amount, exchange_rate, fee_amount, quote, beneficiary,
      status, receipt_id
    ) values (
      ${payout.id}, ${payout.invoice_ref || null}, ${payout.funding_asset},
      ${payout.funding_amount}, ${payout.destination_currency},
      ${payout.destination_amount}, ${payout.exchange_rate},
      ${payout.fee_amount}, ${JSON.stringify(payout.quote)}::jsonb,
      ${JSON.stringify(payout.beneficiary)}::jsonb,
      ${payout.status}, ${payout.receipt_id || null}
    )
    on conflict (id) do update set
      invoice_ref = excluded.invoice_ref,
      funding_asset = excluded.funding_asset,
      funding_amount = excluded.funding_amount,
      destination_currency = excluded.destination_currency,
      destination_amount = excluded.destination_amount,
      exchange_rate = excluded.exchange_rate,
      fee_amount = excluded.fee_amount,
      quote = excluded.quote,
      beneficiary = excluded.beneficiary,
      status = excluded.status,
      receipt_id = coalesce(excluded.receipt_id, jack_payouts.receipt_id),
      updated_at = now()
    returning *
  `;
  return normalizePayout(row);
}

export async function getPayout(id) {
  if (!id) return null;
  const client = db();
  if (!client) return normalizePayout(memory.find((x) => x.id === id) || null);
  await ensurePayoutSchema();
  const rows = await client`select * from jack_payouts where id = ${String(id)} limit 1`;
  return normalizePayout(rows[0] || null);
}

export async function listPayouts(limit = 25) {
  const client = db();
  if (!client) {
    const ranked = [...memory].sort((a, b) => {
      const score = (row) =>
        row.status === "paid_sandbox" ? 0 :
        row.status === "processing" ? 1 :
        row.status === "approved" ? 2 : 3;
      const statusDelta = score(a) - score(b);
      if (statusDelta !== 0) return statusDelta;
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
    const seen = new Set();
    return ranked.filter((row) => {
      const key = row.invoice_ref || row.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit).map(normalizePayout);
  }

  await ensurePayoutSchema();
  const rows = await client`
    select *
    from (
      select distinct on (coalesce(invoice_ref, id)) *
      from jack_payouts
      order by
        coalesce(invoice_ref, id),
        case
          when status = 'paid_sandbox' then 0
          when status = 'processing' then 1
          when status = 'approved' then 2
          else 3
        end,
        updated_at desc
    ) ranked
    order by updated_at desc
    limit ${limit}
  `;
  return rows.map(normalizePayout);
}


export async function findPayoutByProviderTransferId(transferId) {
  const value = String(transferId || "").trim();
  if (!value) return null;
  const client = db();
  if (!client) {
    return normalizePayout(
      memory.find((row) => String(normalizePayout(row)?.quote?.providerTransferId || "") === value) || null
    );
  }
  await ensurePayoutSchema();
  const rows = await client`
    select *
    from jack_payouts
    where quote->>'providerTransferId' = ${value}
    order by updated_at desc
    limit 1
  `;
  return normalizePayout(rows[0] || null);
}
