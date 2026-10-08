# MUSHIN 2.0

## Requirements
- Node 22.12+ (24 recommended)
- A filled-in `.env` at the repo root (see `.env.example`).

## Setup
```bash
npm install
npm --prefix frontend install
npm run env:secrets      # adds DATA_ENCRYPTION_KEY and STAFF_JWT_SECRET if missing
npm run db:migrate       # applies migrations using DIRECT_URL (session pooler, port 5432)
```

## Run everything
```bash
npm run dev              # API on :4000, worker, and the web app on :5173
```
The API and the worker's queries use `DATABASE_URL` (transaction pooler, port 6543). Only the worker's
job queue (pg-boss, 3 connections) and its LISTEN connection use `DIRECT_URL` (session pooler), which on
Supabase's free tier allows about 15 clients in all.

## Create the first staff admin
```bash
npm run create-admin -- --email you@mushin.pk --name "Your Name"
```
Scan the printed QR code with an authenticator app. The temporary password is shown once.

## Checks
```bash
npm run verify           # lint + typecheck + module boundaries + all tests
npm run test:int         # database tests only (uses TEST_DATABASE_URL)
```

## Billing (sub-project 2)

- Without Paddle keys the API uses a **mock payment provider**: purchases open a test-mode checkout page at
  `PUBLIC_API_URL/mock-paddle/checkout/<workspaceId>/<id>` with **Pay** and **Simulate failed payment**. `npm run env:secrets` creates
  `MOCK_PADDLE_WEBHOOK_SECRET`. Run both the API and the worker so webhooks are applied.
- Switching to Paddle sandbox:
  1. Create a sandbox account (sandbox-vendors.paddle.com), products and prices for the three plans (monthly and yearly) and the three top-up packs.
  2. Put the sandbox price ids into `platform.plans.paddle_price_ids` and `platform.topup_packs.paddle_price_id` (replacing the `pri_mock_*` ids).
  3. Set a default payment link, and a notification destination pointing to `<public API URL>/webhooks/paddle`.
  4. Set `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT=sandbox` and restart the API and the worker.
- Prices, credit costs, trial length and meter thresholds live in `platform.plans`, `platform.topup_packs`,
  `platform.credit_action_costs` and `platform.billing_settings` and can be changed without a deploy.
