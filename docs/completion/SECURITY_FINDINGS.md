# Security findings register: 2026-10-27

Scope: the local working tree (API, worker, frontend, database migrations to 0059), checked against OWASP ASVS 5.0 and
the API Security Top 10. Static review, automated scans and tests on local disposable databases only. No external
penetration test, no production system, no credential was read, printed or rotated.

Severity: Critical / High / Medium / Low / Info. Status: **fixed** (with the test that proves it), **accepted**
(reason given), **owner action** (needs something only the owner can do), **open**.

| ID | Area | Finding | Severity | Status | Evidence |
|---|---|---|---|---|---|
| SF-01 | Dependencies (ASVS V15) | zod <4.6.6 can exhaust memory validating oversized collections; zod validates every request body | High | fixed | `npm audit --omit=dev`: 0 (root, frontend); zod 4.6.7 |
| SF-02 | Dependencies | fastify 5.12.5 header validation bypass | Low | fixed | fastify 5.12.7; integration 689 passed |
| SF-03 | Dependencies | fast-uri scheme spoofing (via ajv) | Moderate | fixed | fast-uri 3.1.9 / 4.2.3 |
| SF-04 | Account enumeration (ASVS V6) | Sign-up revealed whether an email had an account ("User already registered") and falsely claimed a link was sent | Medium | fixed | BUG-22; `signup-outcome.test`; browser AUTH-1..4 |
| SF-05 | Access control (API5) | Only four endpoints were checked for refusing anonymous calls | Medium (coverage) | fixed | `route-guards.test.ts`: every route needs a guard or a listed public reason; mutation-checked (an unguarded probe route fails it) |
| SF-06 | SSRF / uploads (ASVS V12) | Profile photos: host allowlist, HTTPS, no redirects, size cap were already in place; the declared content type was trusted | Low | fixed | `avatar.ts` checks JPEG/PNG/WebP signatures; `avatar.test` "refuses bytes that do not match" |
| SF-07 | Secrets (ASVS V13) | No secret in tracked files. Real keys exist only in the git-ignored `.env`. A Groq key is still in `.env` although Groq is no longer used | Low | owner action | revoke the Groq key in the Groq console and delete the line |
| SF-08 | Secrets | The JWT in the built bundle is the Supabase `anon` (publishable) key | Info | accepted | public by design; `check-bundle-secrets` guards against service keys |
| SF-09 | Database (RLS) | Every `wp.*` table forces row-level security. `gcp.*` and `platform.*` tables have no RLS; `anon`/`authenticated` hold no grants on any table, so Supabase's Data API cannot read them | Low (defence in depth) | accepted | grants query: none for `anon`/`authenticated`; no security-definer function lacks `search_path` |
| SF-10 | Mock payments | `/mock-paddle/checkout/*` is unauthenticated | Info | accepted | registered only with the mock provider, which config refuses in production; needs workspace id + random checkout id |
| SF-11 | Sessions (ASVS V7) | supabase-js keeps the session in `localStorage` | Low | accepted | strict CSP (`script-src 'self'`, no inline script) limits XSS reach; moving to cookie sessions is a larger auth change needing approval |
| SF-12 | Headers (ASVS V3) | CSP `default-src 'self'`, frame-ancestors none, HSTS, nosniff, COOP, Permissions-Policy on the site; helmet on the API | Info | verified | `vercel.json`, `http/security.ts` |
| SF-13 | CORS | Explicit origin list; other origins refused | Info | verified | `app.test` origin test |
| SF-14 | Rate limits (API4) | IP, user, auth, AI, jobs buckets; PostgreSQL-backed store for multiple instances; staff sign-in locks after 5 failures for 15 min | Info | verified | `customer-auth.test`, `trials.int`, staff `service.ts` |
| SF-15 | Webhooks | Paddle and Resend: signature on the raw body, stale timestamps refused, each event stored once, duplicates grant once | Info | verified | `billing-api.int`, `service.int` "duplicate events grant once", `outreach.int` |
| SF-16 | Errors | 5xx answer a generic message with a request id; details go to server logs only | Info | verified | `http/errors.ts` |
| SF-17 | Tenant isolation (API1) | Cross-workspace reads/writes refused through the real API and RLS | Info | verified | `security.int` SEC-05+, browser SEC-01..09 |
| SF-19 | Authentication (ASVS V6) | Changing the password while signed in does not ask for the current password; a stolen session could lock the owner out | Medium | owner action | turn on Supabase "Secure password change" (recent sign-in required); a UI-only check is not a boundary |
| SF-18 | LLM (LLM01/05) | Model replies are schema-validated, labels limited to the taxonomy, quotes must appear verbatim in the creator's text; AI never decides permissions | Info | verified | `semantic-niche.test` |

## Not done here (needs approval or another environment)

- External penetration test, production configuration review, credential rotation: not authorized.
- Git history: all 337 commits' added lines were scanned for live-key, Google, Groq, Apify, Resend, JWT, private-key and
  credentialed Supabase URL shapes. The only matches (commits 0df288ef, 5fc412f8) are fake fixtures inside the secret
  scanners' own tests. A dedicated tool (`gitleaks detect`) with its full rule set is still recommended before release.
- Supabase project settings (email confirmation, leaked-password protection, MFA for staff dashboard): need dashboard access.

## Release gate

No open Critical or High finding. Owner actions SF-07 (revoke the unused Groq key) and SF-19 (Secure password change)
before any release.
