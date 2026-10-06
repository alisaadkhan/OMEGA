# MUSHIN 2.0 Backend: Requirements Analysis & Open Questions

**Date:** 2026-10-06
**Phase:** 1, Analysis (nothing implemented yet)
**Sources reviewed:**
- `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf` (SRS v1.0)
- `reference_files/MUSHIN_System_Diagrams.pdf` (13 diagrams + consistency notes)
- `frontend/` source (screens, mock stores, type shapes, design plans)
- `.env` (key names and whether each is set; secret values not inspected)

**Classification:** Architectural (a new backend subsystem plus a database for an existing frontend).
**Process:** questions → approaches → sectioned design → written spec → implementation plan → step-by-step build (plan, implement, test and debug each task before moving on). Each stage needs your approval.

---

## 1. What I Understand

### 1.1 Product

MUSHIN 2.0 is an AI-powered creator-intelligence and influencer-marketing platform. It replaces the 4–6 separate tools brands use per campaign. It launches in Pakistan first.

Core user flow (the "Golden Path"): **sign up → search → enrich one creator → save to a list**, with the first ranked result in under 5 minutes.

### 1.2 Feature Areas (SRS §4)

| # | Area | S1 Must / Should highlights |
|---|---|---|
| 4.1 | Creator Intelligence | Unified multi-platform profile; authenticity score always shown with evidence; credit-gated contact reveal; freshness indicator + paid refresh; audience demographics labeled "estimated" |
| 4.2 | Search & Discovery | Filtered search under 1 s p95; natural-language query interpreted into editable filter chips; fit-ranked results; saved searches; "Two Brains" (index first, then live discovery after explicit confirmation); add-by-URL fallback |
| 4.3 | AI Layer | 3-sentence AI summary per creator; query assistance; **cost recorded for every AI call**; AI output is always a suggestion and never auto-executes |
| 4.4 | Lists & CRM | Named lists, bulk add, notes and tags, sharing, comments, change history; CSV export (entitlement-gated); file attachments |
| 4.5 | Campaigns | Structured brief; pipeline with customizable stages; tasks, milestones and assignees; budget spent per creator |
| 4.6 | Outreach | Gmail/Outlook OAuth; templates with variables; sequences that stop on reply; opt-out (consent) blocks enrollment |
| 4.7 | Workspace | Workspaces, invites, Owner/Admin/Member roles; DB-level (RLS) isolation |
| 4.8 | Billing & Credits | Paddle-hosted checkout; webhook-driven state; append-only ledger; reserve → commit/release; hard trial cap |
| 4.9 | Analytics | Basic campaign dashboard: statuses, spend vs. budget, deliverables |
| 4.10 | Admin (internal) | User/workspace lookup; audited impersonation; feature flags; provider usage, cost and error dashboard |

### 1.3 Required Architecture (SRS + Diagrams)

- **Language:** TypeScript, strict mode, no `any`.
- **Shape:** modular monolith API + separate worker processes from the same codebase. No module touches another module's tables.
- **Database:** PostgreSQL with two planes:
  - **GCP (Global Creator Plane):** creators, profiles, contacts, enrichment snapshots. Shared, no tenant data.
  - **WP (Workspace Plane):** lists, notes, campaigns, ledger, etc. Every table carries a tenant id and has RLS.
- **Tenant isolation** is enforced at 3 layers: middleware, repository, and Postgres RLS.
- **Migrations** follow expand-contract. No `DROP` on production data. Ledger and timeline tables are append-only.
- **Search:** Meilisearch holds global creator data only and is a derived projection of Postgres.
- **Async work:** transactional outbox → queue (SQS FIFO) → workers. API handlers never write to the queue directly.
- **External services** are called only through adapters: Apify, Serper, YouTube, LLM, Paddle, Gmail/Graph, storage.
- **Auth:** managed provider; RS256 JWT (15 min) + rotating refresh tokens; JWKS validation; optional TOTP. Staff auth is a **completely separate** realm with deny-by-default roles.
- **Observability:** request ID on every request; structured JSON logs; cost recorded on every external call.
- **Rate limiting** at the API boundary (Upstash Redis).
- **Safety rules:**
  - Minor-flagged creators are blocked from reveal, outreach and campaigns. Only MUSHIN staff can override.
  - Scraped data is treated as hostile input.
  - Raw payloads are archived.
- **Business rules:**
  - Credits can only be purchased, never earned.
  - Every credit price is at least 3× raw API cost.
  - Paddle is the source of truth for entitlements.

### 1.4 Diagram Highlights

- **ERD entities:**
  - User side: USER, SUBSCRIPTION, CREDIT_LEDGER_ENTRY, CREDIT_RESERVATION
  - Lists: LIST, LIST_MEMBERSHIP, SAVED_CREATOR, CREATOR_NOTE, INTERACTION_TIMELINE
  - Campaigns: CAMPAIGN, CAMPAIGN_CREATOR, CAMPAIGN_TASK, CAMPAIGN_MILESTONE, COLLABORATION, RATING
  - Creator plane: CREATOR, CREATOR_PROFILE, CREATOR_CONTACT, ENRICHMENT_SNAPSHOT
- **Live discovery sequence:**
  1. `POST /discovery` checks the index, reserves credits, creates a job and enqueues it.
  2. The API returns `202 {job_id, poll_url}`.
  3. A worker runs: interpret → Serper → LLM relevance filter → merge known / Apify extract → LLM rank → persist.
  4. The client polls `GET /discovery/jobs/{id}` for progressive results.
- **Queues named:** `q-discovery-high`, `q-discovery-standard`, `q-rescore-low`, `q-outbox-relay`, `q-erasure`.
- **Campaign lifecycle:** Prospect → Contacted → In Negotiation → Agreed → Content In Progress → Published/Completed, with a Declined/Dropped branch.
- **Authentication sequence:** client authenticates with the IdP; API validates the Bearer JWT against cached JWKS and resolves the user record in Postgres.

### 1.5 Frontend Reality

- **Stack:** Vite + React 18 SPA, hash-based routing, Tailwind, shadcn/Radix. **Not Next.js**, despite what the diagrams say.
- **All data is mocked in memory.** There is no API layer.

| Area | Current mock source |
|---|---|
| Auth (user) | `auth/AuthContext.tsx`: any email logs in as a hardcoded profile |
| Auth (admin) | `admin/AdminAuthContext.tsx`: any email; picks the `admin` or `support` role |
| Credits | `lib/credits.ts`: in-memory balance 8,420; placeholder costs |
| Plans | `lib/plans.ts`: Explorer / Growth / Scale (PKR prices, credit allowances) |
| Campaigns | `lib/campaignStore.ts`: seeded campaigns + pipeline creators |
| Mailbox | `lib/mailbox.ts`: hardcoded Gmail address |
| Creator intel | `dashboard/data.ts`: deterministic fake freshness, audience, contacts, recommendation |
| Search | `SearchModule.tsx`: rule-based query "interpretation", fake streaming results |
| Lists | `Lists.tsx`: seeded lists/creators, notes, tags |
| Inbox | `Inbox.tsx`: seeded sequences. **Not reachable from the navigation.** |
| Notifications | `NotificationCenter.tsx`: seeded |
| Activity log | `ActivityLog.tsx`: seeded |
| Billing | `Billing.tsx`: seeded invoices; EasyPaisa/JazzCash/Visa payment methods |
| Settings | `Settings.tsx`: profile, security, sessions, notifications, integrations, AI, privacy, danger zone (all toast-only) |
| Support | `Support.tsx`: seeded tickets |
| Admin console | `AdminConsole.tsx`: 10 views (users, credits, revenue, search ops, providers, security, support, monitoring, settings/flags), all seeded |

- **Workspace UI:** the frontend plan files state *"Workspace was deliberately removed, so do not re-add the workspace switcher."* `WorkspaceOnboarding.tsx` is intentionally empty.

---

## 2. Conflicts Between Sources

| Topic | SRS says | Diagrams / frontend say |
|---|---|---|
| Tenancy | Workspaces with Owner/Admin/Member roles, invites, switcher, RLS on `workspace_id` | ERD is user-owned (`user_id`). Frontend plan: workspace deliberately removed |
| LLM provider | OpenAI | Ollama. `.env` has Groq + Ollama keys, no OpenAI key |
| Hosting | API on Vercel, workers on Railway | API and workers on Railway (Fly.io fallback) |
| Web client | (not specified) | Diagrams: Next.js. Actual frontend: Vite + React |
| Pipeline stages | Customizable (TBD-009) | Diagram: Prospect → Contacted → In Negotiation → Agreed → Content In Progress → Published/Completed / Declined. Frontend: identified → contacted → negotiating → confirmed + separate content status |
| Payments | Paddle only | Billing UI shows EasyPaisa / JazzCash / Visa, priced in PKR |
| Reputation | Outside v1 scope | Diagrams include a Collaboration + Rating workflow with a creator feedback link |
| Sidebar | Exactly six items: Search, Lists, Campaigns, Inbox, Analytics, Settings | Frontend sidebar: Dashboard, Search, Lists, Campaigns, Analytics, Credits & billing. Inbox unreachable; Settings in the top-bar menu |
| Outreach | S1 Must | Diagrams: "planned (TBD-031)" |

---

## 3. Credentials & Environment Gaps

### 3.1 `.env` status

| Service | Status | Impact |
|---|---|---|
| Supabase (URL, anon, service role, `DATABASE_URL`) | Set | Usable |
| `DIRECT_URL` | **Placeholder:** host is literally `host` | Needs the real direct/pooler URL |
| `JWT_ISSUER` / `JWKS_URI` | Point to `auth.mushin.io` (doesn't exist) | Must change to the real auth provider (e.g. Supabase Auth) |
| Meilisearch (host, admin key, search key) | Set | Usable |
| Upstash Redis | Set | Usable |
| Serper, Apify token, YouTube API | Set | Usable |
| Apify actor IDs (IG / TikTok / YT) | **Empty** | Need actor choices |
| Groq, Ollama | Set | Usable |
| HuggingFace | Set | Purpose unclear |
| AWS SQS (keys, region, all queue URLs) | **Empty** | No queue available |
| Paddle (API key, webhook secret) | **Empty** (env = sandbox) | Billing can't hit Paddle |
| Resend API key | **Looks like a placeholder**; `RESEND_FROM_EMAIL` empty | Transactional email blocked |
| Cloudflare R2 | **No keys at all** | No object storage |
| Gmail / Microsoft OAuth client IDs & secrets | **Missing entirely** | Outreach blocked |
| OpenAI | **Missing** | Only relevant if OpenAI is required |
| Sentry, Vercel, PostHog | Empty | Optional / deployment only |
| `TEST_DATABASE_URL` | Empty | No separate test DB |

### 3.2 Local machine

- No Docker, so no local Postgres or local Supabase.
- No `psql`. Supabase CLI is available via `npx`.
- `D:\projects\MUSHIN` is **not a git repository**.

---

## 4. Questions

Each question has my recommendation; reply "agree" or override by number. An answer line is under each one.

### A. Core decisions

**Q1. Tenancy model.**
- (a) User-owned data, matching the diagrams and frontend.
- (b) Workspace tables + RLS in the database, with one personal workspace auto-created per user and no team UI for now.
- (c) Full workspaces with invites and roles; needs new frontend screens.

**Recommendation: (b).** It meets the SRS isolation rule and keeps the frontend unchanged. Team features can be added later without a data migration.

> Answer: (b) accepted. One personal workspace per user, enforced with RLS, and no team UI for now.

**Q2. Customer authentication provider.** Use **Supabase Auth**? It's managed, issues asymmetric JWTs with a JWKS endpoint, rotates refresh tokens with reuse detection, and supports TOTP MFA. Is email/password enough, or do you also want Google sign-in?

> Answer: Supabase Auth with email/password only. Google sign-in may be added later.

**Q3. Staff/admin authentication.** The SRS requires a completely separate system. Recommendation: a `staff` table in the backend with hashed passwords (argon2), **mandatory TOTP**, a separate JWT signing key, and deny-by-default roles `admin` and `support` (matching the frontend). Every staff action is audit-logged.

> Answer: Accepted. Separate `staff` table, argon2 passwords, mandatory TOTP, separate JWT signing key, deny-by-default roles `admin`/`support`, full audit log. The first admin is created with a one-time CLI script (no public staff sign-up).

**Q4. Scope of this build.** Recommendation:
- Build S1 Must + Should requirements.
- Give real backing to every screen the frontend already shows (notifications, activity log, support tickets, admin views).
- Defer the creator rating/feedback-link workflow and anything marked S2/S3.

> Answer: Accepted. S1 Must + Should, real backing for every existing frontend screen; rating/feedback-link workflow and S2/S3 deferred.

**Q5. Frontend modifications.** May I modify the frontend to:
- replace the mocks with API calls,
- add the auth client,
- add loading/error states,
- add an Inbox nav link?

No redesign; only what the wiring requires.

> Answer: Yes. Frontend may be modified for wiring only (API calls, auth client, loading/error states, Inbox link). Sidebar follows the SRS exactly: Search, Lists, Campaigns, Inbox, Analytics, Settings. Dashboard is reached via the logo, Credits & billing via the top-bar menu.

### B. Infrastructure without credentials

**Q6. Job queue.** Are AWS SQS credentials coming? If not, recommendation: a Postgres-backed queue (pg-boss or Supabase Queues/pgmq) behind a queue adapter, swappable to SQS later. The outbox pattern stays identical either way.

> Answer: Postgres-backed queue (pg-boss or Supabase Queues/pgmq; final pick at the approaches stage) behind a queue adapter, swappable to SQS later. No AWS for now.

**Q7. Object storage.** Without Cloudflare R2, recommendation: Supabase Storage behind a storage adapter, used for raw scrape payloads, attachments and data exports.

> Answer: Supabase Storage behind a storage adapter, swappable to Cloudflare R2 later. No R2 for now.

**Q8. LLM providers.** Groq as the default cheap tier, with Ollama Cloud as the escalation tier? And what is the **HuggingFace** key for: embeddings for similarity search, or something else?

> Answer: Accepted. Groq is the default tier; Ollama Cloud is the fallback/escalation tier; both behind one LLM adapter with per-call cost recording. HuggingFace provides embeddings for semantic search/lookalikes, stored in Postgres via pgvector.

**Q9. Paddle.** Do you have a Paddle sandbox account to get API and webhook keys from? If not yet, I'll build billing against a mock Paddle adapter and the real webhook contract. Also: should the EasyPaisa/JazzCash payment-method UI be removed, since Paddle doesn't support those wallets?

> Answer: No sandbox keys yet. Build against a mock Paddle adapter that follows the real webhook contract; switch to the Paddle sandbox by filling `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` later. Remove EasyPaisa/JazzCash from the UI (Billing, Pricing, Overview, AdminConsole, NotificationCenter); card payments via Paddle only.

**Q10. Outreach (Gmail/Outlook).** This needs a Google Cloud OAuth client and an Azure app registration. Can you create these, or should outreach be scheduled last in the build order (it's S1 Must per the SRS, "planned" per the diagrams)?

> Answer: Outreach is scheduled last, behind an email adapter. Templates, sequences, opt-outs, reply handling and Inbox are built and tested against a mock mailbox; real Gmail/Outlook OAuth is connected once the Google Cloud and Azure credentials exist.

**Q11. Apify actors.** Use the standard public actors?
- Instagram: `apify/instagram-profile-scraper`
- TikTok: `clockworks/tiktok-profile-scraper`
- YouTube: `streamers/youtube-channel-scraper`

Is there a monthly Apify (and Serper) spend limit I should respect while testing?

> Answer: Instagram: `apify/instagram-profile-scraper`; TikTok: `clockworks/tiktok-profile-scraper`; YouTube: official YouTube Data API (existing `YOUTUBE_API_KEY`), with `streamers/youtube-channel-scraper` as fallback only. All behind a scraper adapter; actor IDs filled into `.env` during implementation. Spend limits not specified: default to configurable caps (Apify $5/month, Serper 2,500 searches/month) that halt live discovery and log a warning when reached; adjustable via `.env`.

### C. Business values (SRS Appendix C, TBD items)

**Q12. Credit prices and plans.** Keep the frontend placeholders?
- Action costs: search existing = 0, find new creators = 12, reveal contact = 5, refresh data = 10.
- Plan allowances: Explorer 2,500 / Growth 12,000 / Scale 35,000 credits per month.
- Trial: length and hard credit cap? **Recommendation: 14 days, 200 credits.**
- Top-up packs: what sizes and prices, and do they expire? (TBD-008 assumes 12 months.)

> Answer: Accepted. Keep the frontend action costs (0 / 12 / 5 / 10) and plan allowances (2,500 / 12,000 / 35,000), stored in a DB config table so they can change without a deploy. Trial: 14 days, hard cap 200 credits. Top-up packs: 1,000 / 5,000 / 15,000 credits, expiring 12 months after purchase; prices are placeholders scaled from plan prices until real numbers are given.

**Q13. Campaign pipeline stages.** Recommendation:
- The frontend's 4 stages (Identified → Contacted → Negotiating → Confirmed) as defaults, customizable per campaign.
- A "Declined" terminal stage.
- The separate content status (none / content pending / posted / completed / declined).

> Answer: Accepted. Default stages Identified → Contacted → Negotiating → Confirmed, customizable per campaign; Declined is a terminal stage reachable from any stage; content status is tracked separately.

### D. Environment & process

**Q14. Database usage.** Is the Supabase project in `DATABASE_URL` fresh, and may I run migrations on it? Without Docker, tests need a second database. Can you provide a separate Supabase project or branch for tests, or should tests use an isolated schema in the same project? Please also provide the correct `DIRECT_URL`.

> Answer: The project is fresh; migrations may be run on it. Tests use a second free Supabase project via `TEST_DATABASE_URL` for now. Docker will be installed later; tests then move to a local Postgres (Supabase CLI local stack) and the test project becomes optional. **Pending (user):** paste the transaction-pooler URL (port 6543) into `DATABASE_URL`, the session-pooler URL (port 5432) into `DIRECT_URL`, and create the test project for `TEST_DATABASE_URL`.

**Q15. Seed data.** Recommendation: dev/test fixtures only (the frontend's mock creators); production starts empty and fills through live discovery and add-by-URL.

> Answer: Accepted. Frontend mock creators are dev/test fixtures only; production starts empty.

**Q16. Git.** May I run `git init` in `D:\projects\MUSHIN`, with `.env` gitignored? The spec and plan documents get committed as we go.

> Answer: Accepted. `git init` with a root `.gitignore` (`.env*` except `.env.example`, `node_modules/`, build output). Baseline commit includes `frontend/`, `docs/` and `reference_files/`. Commit after each completed build step; no pushing until asked.

**Q17. Deployment.** Is deploying part of this work, or is local running enough for now (e.g. for the FYP demo)? If deploying: Railway (per the diagrams) or Vercel (per the SRS) for the API?

> Answer:

---

## 5. Next Steps

1. You answer the questions above.
2. I propose 2–3 backend approaches (framework, ORM, project layout) with trade-offs and a recommendation.
3. I present the design section by section (architecture, data model, modules, data flow, error handling, testing) for your approval.
4. I write the spec to `docs/superpowers/specs/` for your review.
5. I write the step-by-step implementation plan for your approval.
6. Implementation, one task at a time: plan → implement → test → debug → verify, before moving to the next.
