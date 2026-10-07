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
