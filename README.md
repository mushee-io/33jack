# 33jack

**The autonomous finance operator for cross-border businesses.**

33jack turns a messy supplier-payment workflow into one controlled loop:

**invoice → AI checks → route proposal → exact approval → settlement → reconciliation**

This repository is the Colosseum MVP.

## Demo

The current demo includes:

- Business finance dashboard
- Invoice upload / sample invoice flow
- AI-style duplicate, beneficiary-change, policy and missing-data checks
- Exact cross-border payment proposal
- Human approval bound to the proposed transaction
- Simulated USDC settlement on Solana
- Local payout stage and settlement tracking
- Automatic invoice reconciliation
- WhatsApp / Telegram / Web channel concept
- Responsive desktop + mobile UI

> The payment flow is intentionally **demo mode** today. It does not move real funds.

## Product thesis

Businesses paying suppliers across borders do much more than click "send":

1. receive invoices
2. verify suppliers and beneficiary details
3. identify duplicates and suspicious changes
4. choose a payment/FX route
5. get internal approval
6. execute
7. chase failures and uncertain states
8. attach settlement evidence
9. reconcile the payment

33jack is the AI operator across that entire lifecycle.

## Solana

Solana is the settlement fabric for the MVP. The intended production architecture is:

```
Web / WhatsApp / Telegram
            ↓
      33jack Agent
            ↓
 Risk + Policy Engine
            ↓
 Exact Human Approval
            ↓
     USDC on Solana
            ↓
 Licensed payout / FX rails
            ↓
 Recipient + reconciliation
```

AI proposes and explains. Deterministic controls validate money movement.

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Vercel

Import this repository into Vercel. Framework preset: **Vite**.

- Build command: `npm run build`
- Output directory: `dist`

## Next production milestones

- Persist invoices, suppliers, approvals and payments
- Real PDF/image invoice extraction
- Supplier/beneficiary history and risk scoring
- Solana wallet + USDC settlement adapter
- Partner payout/FX adapter
- Idempotent payment state machine
- Webhook-driven reconciliation
- Organization roles and approval policies
- Secure chat-channel ingestion
- KYB/KYC and partner compliance boundary

## Safety model

33jack should never give an LLM unrestricted signing authority. The production pattern is:

- AI prepares a structured proposal
- deterministic validation checks amount, beneficiary, currency, quote expiry, permissions and limits
- user approval binds to exact transaction details
- execution is idempotent
- material changes require fresh approval
- uncertain outcomes escalate instead of blindly retrying

---

Built for Colosseum on Solana.
