# MUSHIN frontend: complete requirements

Every page MUSHIN has, plans or should have, with its status today, what each page must do, its required states, and
what is still missing. Reconciled on 2026-10-21 against the code (branch
`feat/internal-completion-and-search-acceptance`) and the canonical pack
(`MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/frontend/`: page inventory, page-by-page spec, staff spec).

**Companion:** `FIGMA_UI_SPEC.md` holds the visual design detail: tokens, components, real copy and every message.
This document is the requirement and status register; where the two overlap, this one decides *whether* a page should
exist, and the Figma spec decides *how* it looks.

## Status legend

| Status | Meaning |
|---|---|
| **BUILT** | Implemented against the real API, with automated evidence (integration tests and/or browser E2E: customer 162 checks, staff 31, 2026-10-21) |
| **BUILT, GAPS** | Implemented, but a requirement below is still missing |
| **PLANNED** | Visible in the product as an honest "not available yet" or disabled state; the feature itself is not built |
| **SHOULD BUILD** | Required by the spec, not present at all yet |
| **DEFERRED** | Future scope; must not appear as an active feature |
| **BLOCKED** | Built, but verifying it needs an external account or owner action |

The canonical pack's inventory (2026-10-14) describes several areas as "local seed state": lists, campaigns, activity,
notifications, settings. That is out of date. They are persisted, API-backed and tested now; the statuses below reflect
the code.

## 1. Rules for every page (acceptance criteria)

1. Every control navigates, opens a real dialog, calls a real API, or is disabled with its reason shown. No fake
   buttons, no simulated progress, no seeded activity, no invented metrics, contacts, testimonials or balances.
2. Each page designs and implements the states that apply: loading (skeleton), first-use empty, populated, validation
   error, permission denied, stale or unavailable data, partial result, network or server error (with request id and
   Retry), rate limited, and offline.
3. Success is shown only after the server confirms. A setting is never shown as saved before persistence.
4. Credits: every chargeable action shows its price first and asks for confirmation; the server sets prices, the
   client never decrements a balance itself; nothing is charged for a failed action.
5. Unknown stays unknown ("Unavailable", "Unknown"): never 0, never a guess. Estimates are labelled as estimates.
6. Workspace roles (Owner, Admin, Member) and staff roles (Support, Admin, Super Admin) are separate. Customer
   navigation never shows staff routes; the customer app never calls staff APIs.
7. Accessibility: WCAG 2.2 AA contrast, keyboard operation, visible focus, labelled controls, errors linked to
   fields, 44 px touch targets, and reduced motion respected.
8. Responsive: 1440 desktop, 1280 laptop, 768 tablet, 390 mobile.
9. Search query and filter context survive opening a profile and coming back.
10. Public copy promises only built features (enforced by `landing-claims.test.ts` and `plans-claims.test.ts`).

## 2. Page register

### 2.1 Public site

| ID | Page | Route | Status | Must do | Still missing |
|---|---|---|---|---|---|
| PUB-01 | Marketing home | `#/` | BUILT | Hero, feature tabs, features, principles, pricing from the API, FAQ, CTA, footer; illustrations labelled fictional; no unbuilt claims | A separate "How it works" page and a contact page (SHOULD BUILD, P2); the sales contact is PLANNED (disabled button) |
| PUB-02 | Free-trial request | `#/free-trial` | BUILT | Callback request; founder-approved trials only | — |
| PUB-03 | Remove my data (creators) | `#/remove-my-data` | BUILT | Profile links, email, confirmation; the same neutral reply whether or not MUSHIN has the creator; bot trap | A status page for the requester (SHOULD BUILD, P2: today the requester is told by email only after a staff decision) |
| PUB-04 | Legal: Terms, Privacy, Refunds, Creator data | `#/terms` `#/privacy` `#/refunds` `#/creator-data` | BUILT, BLOCKED | Long-form pages with a draft banner | Counsel-approved text (owner) |
| PUB-05 | Page not found | any unknown `#/…` | BUILT | Home and sign-in actions | — |

### 2.2 Customer authentication and first run

| ID | Page | Route | Status | Must do | Still missing |
|---|---|---|---|---|---|
| AUTH-01 | Sign in | `#/login` | BUILT | Idle, validation, submitting, invalid credentials, unconfirmed email, rate limit, network error, success → dashboard or a pending invitation. No SSO button (there is no single sign-on; removed 2026-10-21) and no "Remember me" (sessions always persist) | — |
| AUTH-02 | Create account | `#/signup` | BUILT | Duplicate email, weak password, confirmation-email pending | — |
| AUTH-03 | Email confirmed | `#/confirmed` | BUILT, BLOCKED | Success, expired or used link, checking | Hosted confirmation emails need SMTP (owner) |
| AUTH-04 | Forgot and reset password | `#/forgot`, `#/reset-password` | BUILT, BLOCKED | Generic "sent" message, expired link, success, failure | Hosted recovery emails need SMTP (owner) |
| AUTH-05 | First workspace | first sign-in | BUILT | The server creates the person's own workspace at first sign-in (no onboarding screen); never a fabricated default | A screen to name the workspace at sign-up (optional, P3; it can be renamed in Settings) |
| AUTH-06 | Accept invitation | `#/invite/<token>` | BUILT | Signed out, signed in as another email, accepted, expired, revoked or used | — |
| AUTH-07 | Legal gate | first use, or after terms change | BUILT | Accept the Terms and Privacy Policy | — |
| AUTH-08 | Session expired | any page after token expiry | BUILT | When the session ends without the person signing out (refresh token expired, or the API answers 401), Sign in shows "Your session expired. Sign in again to continue where you left off.", and signing in reopens the dashboard page that was open (built 2026-10-21) | — |

### 2.3 Customer app

| ID | Page | Status | Must do | Still missing |
|---|---|---|---|---|
| APP-01 | App shell: sidebar, topbar, omnibar, credits pill, job tray, bell, user menu, banners | BUILT, GAPS | Desktop, tablet (icon rail), mobile drawer; billing, support-access, offline and degraded banners | A manual mobile and screen-reader pass (UX-05, owner/tester). The workspace switcher is in the account menu and in Team settings (built 2026-10-21) |
| APP-02 | Dashboard overview | BUILT | Real data only: credits, recent activity, quick actions, first-use empty state, trial feedback card | — |
| SRCH-01 | Catalogue Search (Brain 1) | BUILT, GAPS | Text query (English, Roman Urdu, Urdu), "Understood as" chips, filters, results grid and table, "Why this creator", Load more, saved searches, credit cost before running, every error state | A **sort control** (relevance, followers, freshness) (SHOULD BUILD, P1; ranking is relevance-only today). Search relevance is not yet accepted: it needs the human ratings (owner) |
| SRCH-02 | Filters | BUILT | Platform, followers, engagement, city, niche, language, verified only, contact available, fresh data only; removable chips; invalid ranges refused | Filtering by audience country stays unavailable until a verified audience source exists (deliberate) |
| SRCH-03 | Find new creators (Brain 2): brief and quote | BUILT, BLOCKED | Brief gate (topic plus city, country or language), platforms, size, server quote, maximum cost, confirm; refuses a too-broad brief with no charge | Instagram and TikTok extraction blocked by the Apify account limit until 2026-11-01 (owner) |
| SRCH-04 | Live job progress and results | BUILT | Queued, step labels, Stop, completed, partial, empty, insufficient, failed (credits returned), one live run at a time | Funnel counts shown in the UI are coarse (found / new); the spec's full funnel (searched → candidates → extracted → qualified) is in the staff job trail only (SHOULD BUILD for customers, P3) |
| SRCH-05 | Add a creator by profile link | BUILT | Invalid link, already in MUSHIN, removed at the creator's request, private, not found, queued | — |
| CR-01 | Creator profile | BUILT | Metrics with freshness, AI summary, audience (labelled source), contacts (masked), evidence | — ("Where these details come from" shows the evidence for city, country, niches and languages, with the creator's own words; withheld under minor protection; built 2026-10-21) |
| CR-02 | Refresh creator data | BUILT | Cost confirmation, queued, running, completed, failed with the old data kept | — |
| CR-03 | Reveal contact | BUILT | Cost confirmation, insufficient credits, revealed, already revealed (free), remove revealed contacts, error | — |
| CR-04 | Audience estimate (experimental, on request) | BUILT, PLANNED | On request, 5 credits, labelled "Estimated" | Off by policy until a verified audience source exists; design the off state |
| CR-05 | Compare creators | BUILT | 2–5 creators, the same dimensions, missing values shown, no invented winner | — |
| LIST-01 | Lists index | BUILT | Create, rename, delete with confirmation, empty state | — |
| LIST-02 | List detail | BUILT | Members, notes, select all and bulk remove, export, empty state | Tags on list members (spec says "if supported"; not supported) |
| CMP-01 | Campaigns index and create | BUILT | Status filter, create and edit form with validation, plan campaign limit (upsell) | — |
| CMP-02 | Campaign detail and pipeline | BUILT | Stages Identified → Contacted → Negotiating → Confirmed, declined as an outcome, fees, add and remove creators, archive and delete | Tasks and reminders: DEFERRED (design only as "Planned") |
| OUT-01 | Outreach (manual) | BUILT | Templates, copy, mailto, manual outcome log | — |
| OUT-02 | Send an email through MUSHIN | BUILT, BLOCKED | Off, test (records, never delivers, says so), Resend modes; monthly usage | Real sending needs the owner to authorise Resend (owner) |
| OUT-03 | Inbox | PLANNED | A "Planned: not available yet" screen pointing to campaigns | Mailbox connection, reply tracking and sequences: DEFERRED |
| AN-01 | Analytics | BUILT | Persisted data only, period selector, empty and unavailable states, no ROI or reach | — |
| ACT-01 | Activity log | BUILT | Real events, newest first, paging that never skips, a "Show" filter by kind (both 2026-10-21) | A filter by team member (SHOULD BUILD, P3) |
| NOT-01 | Bell / notification panel | BUILT, GAPS | Recent activity, unread dot, error with Retry, empty | Read/unread per event and "Mark all as read" (SHOULD BUILD, P2) |
| NOT-02 | Notification emails | PLANNED | Settings states honestly that emails are not sent | 8 templates (credits low and very low, trial ending, trial expired, subscription canceled, payment failed, run finished, removal processed) plus delivery (SHOULD BUILD, P1 before open launch) |
| BILL-01 | Plans and subscription | BUILT, BLOCKED | Server plan catalogue, status badge, change and cancel, checkout return states, test-mode label | Real Paddle checkout (owner); annual billing PLANNED (owner decision OD-002) |
| BILL-02 | Credits and ledger | BUILT | Balance, monthly vs top-up credits, reserved, spent, released, expired; ledger with keyset paging; top-ups | — |
| BILL-03 | Invoices and payment methods | PLANNED | Labelled honestly | Provided through the payment provider once Paddle is live (owner) |
| EXP-01 | Exports | BUILT | CSV from lists and results, kept 24 hours, plan-gated state | — |
| SET-01 | Settings: profile, password and sessions | BUILT | Save states, "Sign out on your other devices" | — |
| SET-02 | Settings: workspace and team | BUILT | Rename, members, roles, make owner, invitations, workspace switching | — |
| SET-03 | Settings: notifications | PLANNED | An information card; no inactive toggles | Preferences, once NOT-02 exists |
| SET-04 | Settings: support access | BUILT | Grant, end or decline staff access with its purpose and expiry | — |
| SET-05 | Settings: privacy and data | BUILT | Export the workspace, delete the workspace (typed confirmation), delete my account, what was kept and why | — |
| SET-06 | Settings: integrations | N/A | — | No integrations exist; do not design connected/not-connected states until one is built |
| SUP-01 | Support | BUILT | Tickets, create, thread, reply, close and reopen, the 20-open limit, closed-ticket rule | — |

### 2.4 Staff console (`#/admin`): roles Support, Admin, Super Admin

| ID | Page | Roles | Status | Must do | Still missing |
|---|---|---|---|---|---|
| ADM-01 | Staff sign-in, TOTP, security keys, enrolment | all | BUILT | Password, 6-digit code, invalid or expired code, locked, enrolment code, security-key step-up | **IP allow-list** screen and errors (SHOULD BUILD, P2; spec page 19) |
| ADM-02 | Operations overview | all | BUILT | Backlog, failures, provider status, alerts; "not instrumented" where data is absent | — |
| ADM-03 | Jobs (inspector with step trail) | all (actions: Admin+) | BUILT | Filters, detail and trail, re-dispatch, stop | — |
| ADM-04 | Workspaces lookup | all | BUILT | Redacted for Support | — |
| ADM-05 | Workspace access (consent-based) | all | BUILT | Request with a purpose; the owner approves; time-boxed, read-only, audited | — |
| ADM-06 | Support queue | all | BUILT | Take or assign, reply, internal notes, status | — |
| ADM-07 | Trial requests and feedback | all (decide: Super Admin) | BUILT | Approve with step-up, reject with a note, mark called; feedback list and CSV (Super Admin) | — |
| ADM-08 | Providers | Admin+ | BUILT | Pause or resume providers (the kill switch), budgets, spend, test alert | Editing spend and concurrency caps from the UI (SHOULD BUILD, P3; configuration today) |
| ADM-09 | Removal requests | Admin+ | BUILT | Approve (erase) or reject with confirmation | — |
| ADM-10 | Approvals (four-eyes) | Admin+ | BUILT | Credit grants, staff changes, Super Admin co-sign, "cannot decide your own request" | — |
| ADM-11 | Staff directory and management | Admin+ (changes: Super Admin) | BUILT, GAPS | Add staff (always Support), role change and suspend through approval; an approved suspension or role change ends all of that person's sessions at once; `scripts/revoke-staff-sessions.ts` ends everyone's | Revoking one person's sessions *without* suspending them needs a new approval action, a staff-contract extension (P3, with ADM-15); an **MFA compliance** view (SHOULD BUILD, P3) |
| ADM-12 | Audit log | Admin+ | BUILT, GAPS | Filters, up to 500 rows, append-only | Paging past 500 rows with a tie-safe cursor (SHOULD BUILD, P3) |
| ADM-13 | Security keys | all | BUILT | Register and remove, step-up confirmation | — |
| ADM-14 | Reconciliation: credit-ledger discrepancies, billing webhooks, provider health and latency, backups | Admin+ | SHOULD BUILD | Read-only queues; "Not instrumented" where no telemetry exists, never a default green badge | The whole page group (spec page 23; P2, after hosting) |
| ADM-15 | Global governance: feature flags, global caps, incidents | Super Admin | SHOULD BUILD | Disabled until the staff contract and tests exist; MFA and audit for every change | The whole page group (spec page 22; P3) |

### 2.5 Global states (spec page 18): all BUILT unless noted

Page not found · page error boundary · app loading · offline banner · degraded and unreachable banners · section
skeletons · empty states · section errors with request id and Retry · confirm dialogs · insufficient credits ·
entitlement upsell · forbidden · wrong workspace (reload) · rate limited · stale and unknown data · partial discovery ·
failed or cancelled job · toasts.

Still missing:
- **Session expired message** (AUTH-08, P1).
- **Unsaved-changes guard** when leaving a form with edits (SHOULD BUILD, P2).
- **Malformed-response** state: today it is caught by the generic error, which is acceptable; no work needed.

### 2.6 Deferred: never shown as active features

Creator profile claiming and creator dashboards · brand-to-creator marketplace · deals and protected payments ·
reputation and ratings · AI audience demographics as a product · inbox sync, reply tracking, automated sequences ·
campaign tasks and reminders. If any appears in the UI at all, it is a "Planned" label with no active button.

## 3. Prioritised frontend backlog (SHOULD BUILD)

| P | Item | Page | Notes |
|---|---|---|---|
| P1 | Sort control for search results | SRCH-01 | Needs a `sort` field in the search contract; changes ranking output, so do it after the Search ratings (freeze) |
| P1 | Notification emails (8 templates, delivery, preferences) | NOT-02, SET-03 | Server-side delivery first; needs an email provider authorised by the owner |
| P2 | Read/unread and "Mark all as read" in the bell | NOT-01 | Read state needs a table |
| P2 | Unsaved-changes guard | Global | — |
| P2 | IP allow-list screens | ADM-01 | Needs the allow-list in the staff backend first |
| P2 | Reconciliation pages | ADM-14 | After hosting and telemetry |
| P2 | "How it works" and contact pages; status page for a creator's removal request | PUB-01, PUB-03 | Copy approved by the owner |
| P3 | Customer-visible discovery funnel; activity filter by member; UI-editable provider caps; per-person session revoke and MFA compliance; audit paging; global governance | SRCH-04, ACT-01, ADM-08, ADM-11, ADM-12, ADM-15 | — |

**Done on 2026-10-21:**
- session expiry (AUTH-08);
- the evidence panel (CR-01);
- the workspace switcher in the account menu (APP-01);
- activity filter by kind (ACT-01);
- removal of the dead SSO and "Remember me" controls;
- the support open-request limit enforced under concurrency.

**Owner or external, not frontend work:**
- Search ratings;
- SMTP;
- Paddle;
- Resend authorisation;
- the Apify top-up or reset;
- counsel review of the legal text;
- the manual accessibility review;
- annual billing (OD-002).

## 4. Required end-to-end flows (from the canonical spec) and their status

| # | Flow | Status |
|---|---|---|
| 1 | Landing → sign up → email pending → create workspace → overview | BUILT (E2E with an auth stub; hosted email BLOCKED on SMTP) |
| 2 | Overview → Search → edit filters → profile → save to list | BUILT (E2E) |
| 3 | Search → compare 2–5 → profile | BUILT (E2E) |
| 4 | Search → Find new → brief gate → quote → confirm → progress → results → save | BUILT (integration with fixtures; real providers run 2026-10-20) |
| 5 | Invalid brief → helpful error; no quote, no job, no credit change | BUILT (tests) |
| 6 | Profile → reveal → success, or unavailable with no charge | BUILT (tests and E2E) |
| 7 | List → campaign → add creator → change stage → note → outreach log | BUILT (E2E); tasks DEFERRED |
| 8 | Billing → checkout states → ledger | BUILT with mock checkout; real Paddle BLOCKED |
| 9 | Settings → data request → status | BUILT (export and deletion); a public removal-request status page is SHOULD BUILD |
| 10 | Staff sign-in and TOTP → support lookup, ticket, job diagnostics → admin action with reason → audit entry | BUILT (staff E2E 31/31); Super Admin governance pages SHOULD BUILD |

## 5. Definition of done for any page

- It satisfies §1.
- Its states are designed (`FIGMA_UI_SPEC.md`) and implemented.
- It calls only real, contract-typed APIs (`@mushin/contracts`).
- Its unit tests and its E2E check pass.
- It passes the bundle secret scan, typecheck and build.
- This register is updated in the same commit.
