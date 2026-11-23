# Baseline (24 Nov 2026, before the audit fixes)

- Repository: `MUSHIN`, branch `feat/redesign-2026-11-16`, HEAD `0f52c35`. Production deploys from
  `github/feat/internal-completion-and-search-acceptance` (tip `184ad7f`, Vercel project omega-api).
- Uncommitted owner work preserved, never committed by the audit: `apps/api/src/modules/discovery/live-order.test.ts`,
  deletion of `.env.example`, and untracked bundles/assets in the repo root.
- Typecheck (`npm run typecheck`): pass.
- Lint (`npx eslint .`): 1 error (scripts/catalog/ig-contact-test.ts, useless assignment).
- Unit tests (`vitest --project unit`): 776 / 777 pass. Failing: `scripts/search-eval/retention.test.ts` (YouTube
  evaluation data past the owner's 2026-11-12 deletion deadline).
- Integration tests (subset run on a fresh local test database): key-rotation "covers every encrypted column" failing;
  billing and reveal-cost tests failing only when run after the staff pricing test (shared-database pollution).
- Frontend tests: 98 / 98 pass. Frontend typecheck: pass.
- `npm audit`: 0 known vulnerabilities (info 0, low 0, moderate 0, high 0, critical 0).
- Production: database migrations through 0099 applied; 0100 not applied. No background worker runs in production
  (only the daily Vercel cron), see APPROVAL_REQUIRED AP-06.
