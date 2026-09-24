const demoCatalog = {
  NGN: [
    { id: "solana-local-a", label: "USDC / Solana → local payout", feeBps: 42, fixedFee: 0.8, etaMinutes: 8, reliability: 0.985 },
    { id: "bank-partner-a", label: "Bank FX → local payout", feeBps: 78, fixedFee: 1.5, etaMinutes: 180, reliability: 0.992 },
    { id: "swift-ngn", label: "International bank wire", feeBps: 115, fixedFee: 18, etaMinutes: 1440, reliability: 0.995 }
  ],
  CNY: [
    { id: "solana-cny-a", label: "USDC / Solana → approved CNY partner", feeBps: 48, fixedFee: 1.2, etaMinutes: 240, reliability: 0.982 },
    { id: "bank-cny-a", label: "Business FX → CNY bank payout", feeBps: 62, fixedFee: 4, etaMinutes: 480, reliability: 0.994 },
    { id: "swift-cny", label: "International bank wire", feeBps: 95, fixedFee: 22, etaMinutes: 1440, reliability: 0.996 }
  ]
};

function parseCatalog() {
  if (!process.env.ROUTE_QUOTES_JSON) return demoCatalog;
  try {
    return JSON.parse(process.env.ROUTE_QUOTES_JSON);
  } catch {
    return demoCatalog;
  }
}

export function rankRoutes({ destinationCurrency, sourceAmount = 0, urgencyMinutes = 1440 }) {
  const currency = String(destinationCurrency || "NGN").toUpperCase();
  const catalog = parseCatalog();
  const candidates = Array.isArray(catalog[currency]) ? catalog[currency] : (catalog.default || []);
  const amount = Math.max(Number(sourceAmount || 0), 1);

  const ranked = candidates.map((r) => {
    const estimatedFee = amount * (Number(r.feeBps || 0) / 10000) + Number(r.fixedFee || 0);
    const speedPenalty = Number(r.etaMinutes || 99999) > urgencyMinutes ? 25 : Math.min(Number(r.etaMinutes || 0) / Math.max(urgencyMinutes, 1), 1) * 8;
    const reliabilityPenalty = (1 - Number(r.reliability || 0.95)) * 100;
    const costPenalty = (estimatedFee / amount) * 1000;
    const score = Math.max(0, 100 - costPenalty - speedPenalty - reliabilityPenalty);

    return {
      id: r.id,
      label: r.label,
      estimatedFee: Number(estimatedFee.toFixed(2)),
      feeBps: Number(r.feeBps || 0),
      etaMinutes: Number(r.etaMinutes || 0),
      reliability: Number(r.reliability || 0),
      score: Number(score.toFixed(2))
    };
  }).sort((a, b) => b.score - a.score);

  return {
    mode: process.env.ROUTE_QUOTES_JSON ? "configured" : "demo",
    currency,
    best: ranked[0] || null,
    alternatives: ranked.slice(1)
  };
}
