# Test matrix (latest full run: 26 Nov 2026, HEAD 08d4804 + audit fixes)

| Layer | Command | Result | Notes |
|---|---|---|---|
| Lint | `npx eslint .` | clean | 30 errors found and fixed this run |
| Typecheck | `npm run typecheck`, `frontend: tsc --noEmit` | clean except F-08 | |
| Unit (API, packages, scripts) | `npx vitest run --project unit` | 830 passed | |
| Unit (frontend) | `frontend: npx vitest run` | 102 passed | |
| Integration (Postgres + Meilisearch) | `npx vitest run --project int` | 815 passed, 0 failed, 14 skipped, 3 expected-fail | fresh test DB; Meilisearch started for the run |
| Browser: staff console | `npm run e2e:staff` | 58/58 | every section, roles, a11y (axe) |
| Browser: customer | `npm run e2e:customer` | 118/118 + 55/55 | journey, break-it, restart |
| Load (local, disposable stack) | `E2E_LOADCHECK=1 npm run e2e:customer` | search p95 273 ms; CRM reads p95 ≤ 98 ms | 25 Nov |
| Dependencies | `npm audit` (root, frontend) | 0 vulnerabilities | |
| Secrets | pattern scan of tracked files; bundle scan | clean | |
| Production build | `vite build` | builds | |
| Not run | live/staging smoke, OWASP ZAP, Semgrep, k6 soak | — | production changes need approval; tools not installed (not added for count's sake) |
