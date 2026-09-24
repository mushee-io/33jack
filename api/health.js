export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "33jack",
    network: "solana-devnet",
    ai: Boolean(process.env.OPENAI_API_KEY),
    database: Boolean(process.env.DATABASE_URL),
    devnetSettlement: Boolean(
      process.env.SOLANA_DEVNET_PAYER_SECRET_KEY &&
      process.env.SOLANA_DEVNET_USDC_MINT &&
      process.env.SOLANA_SETTLEMENT_RECEIVER
    )
  });
}
