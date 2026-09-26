import { ensureSchema, persistenceMode } from "./_lib/db.js";
import postgres from "postgres";

const memory = globalThis.__33jackStore || { beneficiaries: [] };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({
      beneficiaries: memory.beneficiaries || [],
      persistence: "memory"
    });
  }

  await ensureSchema();
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  try {
    const rows = await sql`
      select id, supplier_name, destination_currency, bank_name,
             account_last4, country, payment_handle, metadata,
             first_seen_at, last_seen_at
      from jack_beneficiaries
      order by last_seen_at desc
      limit 100
    `;
    return res.status(200).json({
      beneficiaries: rows,
      persistence: persistenceMode()
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
