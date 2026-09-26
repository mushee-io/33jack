const demoCatalog = {
  USD: [
    { id: "solana-usd-a", label: "USDC / Solana → US bank payout", feeBps: 24, fixedFee: 0.5, etaMinutes: 20, reliability: 0.994 },
    { id: "us-bank-a", label: "US domestic bank payout", feeBps: 38, fixedFee: 1.0, etaMinutes: 90, reliability: 0.997 },
    { id: "swift-usd", label: "International USD wire", feeBps: 72, fixedFee: 16, etaMinutes: 720, reliability: 0.998 }
  ],
  CNY: [
    { id: "solana-cny-a", label: "USDC / Solana → approved CNY payout partner", feeBps: 48, fixedFee: 1.2, etaMinutes: 240, reliability: 0.982 },
    { id: "bank-cny-a", label: "Business FX → CNY bank payout", feeBps: 62, fixedFee: 4, etaMinutes: 480, reliability: 0.994 },
    { id: "swift-cny", label: "International CNY bank wire", feeBps: 95, fixedFee: 22, etaMinutes: 1440, reliability: 0.996 }
  ],
  INR: [
    { id: "solana-inr-a", label: "USDC / Solana → approved INR payout partner", feeBps: 36, fixedFee: 0.9, etaMinutes: 45, reliability: 0.989 },
    { id: "bank-inr-a", label: "Business FX → India bank payout", feeBps: 54, fixedFee: 1.5, etaMinutes: 180, reliability: 0.995 },
    { id: "swift-inr", label: "International INR bank wire", feeBps: 88, fixedFee: 18, etaMinutes: 1440, reliability: 0.996 }
  ],
  GBP: [
    { id: "solana-gbp-a", label: "USDC / Solana → UK bank payout", feeBps: 22, fixedFee: 0.5, etaMinutes: 20, reliability: 0.994 },
    { id: "uk-bank-a", label: "UK domestic bank payout", feeBps: 34, fixedFee: 0.8, etaMinutes: 60, reliability: 0.998 },
    { id: "swift-gbp", label: "International GBP wire", feeBps: 70, fixedFee: 16, etaMinutes: 720, reliability: 0.998 }
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
  const currency = String(destinationCurrency || "USD").toUpperCase();
  const catalog = parseCatalog();
  const candidates = Array.isArray(catalog[currency]) ? catalog[currency] : (catalog.default || []);
  const amount = Math.max(Number(sourceAmount || 0), 1);

  const ranked = candidates.map((r) => {
    const estimatedFee = amount * (Number(r.feeBps || 0) / 10000) + Number(r.fixedFee || 0);
    const speedPenalty = Number(r.etaMinutes || 99999) > urgencyMinutes
      ? 25
      : Math.min(Number(r.etaMinutes || 0) / Math.max(urgencyMinutes, 1), 1) * 8;
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
