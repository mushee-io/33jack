# 33jack

**The autonomous finance operator for cross-border businesses.**

33jack turns a messy supplier-payment workflow into one controlled loop:

**invoice → AI checks → route proposal → exact approval → settlement → reconciliation**

This repository is the Colosseum MVP.

## What works now

- Premium business-finance dashboard
- Real PDF / image / text invoice analysis through the OpenAI Responses API when `OPENAI_API_KEY` is configured
- Deterministic demo analysis when an AI key is not configured
- Stored-history duplicate checks when Postgres is configured
- Risk review for suspicious invoices, missing data and beneficiary changes
- Exact human approval step before execution
- Solana Devnet USDC transfer adapter
- Safe simulated settlement when Devnet credentials are absent
- Payment-state API with Postgres persistence and an in-memory demo fallback
- Settlement receipt + reconciliation state
- WhatsApp / Telegram / Web product surfaces
- Responsive desktop + mobile UI
- CI build verification

## Product thesis

Businesses paying suppliers across borders do much more than click "send":

1. receive invoices
2. verify suppliers and beneficiary details
3. identify duplicates and suspicious changes
4. choose a payment / FX route
5. get internal approval
6. execute
7. chase failures and uncertain states
8. attach settlement evidence
9. reconcile the payment

33jack is the AI operator across that lifecycle.

## Architecture

```
Web / WhatsApp / Telegram
            ↓
      33jack Agent
            ↓
 Invoice + Risk Analysis
            ↓
 Stored Business State
            ↓
 Exact Human Approval
            ↓
     USDC on Solana
            ↓
 Licensed payout / FX rails
            ↓
 Recipient + reconciliation
```

AI prepares and explains. Deterministic controls constrain money movement.

## Runtime APIs

| Endpoint | Purpose |
| --- | --- |
| `POST /api/analyze` | Analyse an invoice and prepare a structured payment/risk record |
| `POST /api/settle` | Execute Devnet USDC settlement when configured; otherwise return a safe demo settlement |
| `GET /api/payments` | Retrieve recent payment state |
| `POST /api/payments` | Persist/update a payment record |
| `GET /api/health` | Show which runtime integrations are configured |

## Environment

Copy `.env.example` to `.env.local`.

```bash
OPENAI_API_KEY=
OPENAI_INVOICE_MODEL=gpt-5.6-luna

DATABASE_URL=

SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_DEVNET_USDC_MINT=
SOLANA_SETTLEMENT_RECEIVER=
SOLANA_DEVNET_PAYER_SECRET_KEY=
```

`SOLANA_DEVNET_PAYER_SECRET_KEY` is a JSON array of the 64 secret-key bytes. Use a **Devnet-only wallet**. Never put a Mainnet private key in the project or client bundle.

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Deploy to Vercel

Vercel configuration is included in `vercel.json`.

[Deploy 33jack to Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmushee-io%2F33jack)

Framework: **Vite**

- Build command: `npm run build`
- Output directory: `dist`

After importing the repository, add the environment variables above in Vercel and redeploy.

## Devnet settlement

The settlement endpoint creates the recipient associated token account idempotently, transfers a configured SPL token with 6 decimals, confirms the transaction on Solana Devnet and returns a Solana Explorer URL.

If the signer, mint, or recipient is not configured, the endpoint intentionally returns `mode: "demo"` and **does not move tokens**.

## AI invoice analysis

The analysis endpoint accepts PDF, image and text invoices. PDF inputs are sent as file inputs; image invoices are sent as vision inputs. The model is instructed not to invent missing commercial data and not to claim historical verification it has not performed.

When Postgres state exists, 33jack performs an additional stored-history duplicate check after the model extraction.

## Safety model

33jack should never give an LLM unrestricted signing authority.

- AI prepares a structured proposal
- deterministic validation constrains the execution path
- user approval binds to exact transaction details
- material changes require fresh approval
- settlement is server-side
- duplicate and uncertain states should block or escalate
- production local-currency payouts should use licensed / approved payment partners

## Next milestones

- Real FX / payout quote adapters
- Supplier beneficiary history and independent bank-detail verification
- Organization roles + multi-user approval policies
- Idempotency keys and payout state machine
- Webhook-driven local payout reconciliation
- WhatsApp and Telegram secure ingestion
- KYB/KYC and partner-compliance boundary
- Accounting integrations

---

Built for Colosseum on Solana.
