import { listBeneficiaries, persistenceMode } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const beneficiaries = await listBeneficiaries(100);
  return res.status(200).json({
    beneficiaries,
    persistence: persistenceMode()
  });
}
