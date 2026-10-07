# Sub-project 2: Credits & Billing — Design

**Date:** 2026-10-07 · **Status:** draft for review · **Umbrella spec:** `2026-10-06-mushin-backend-architecture-design.md` (§3 row 2, §5.3, §6.6, §7) · **Requirements:** `reference_files/MUSHIN_SRS_Ali_Saad_Khan_14757_Final_v2 (1).pdf` (SRS), `reference_files/MUSHIN_System_Diagrams.pdf`

## 1. Intent

Make credits and billing real: every workspace has a real balance, a 14-day trial, plans and top-ups bought through a hosted checkout (mock Paddle until sandbox keys exist), and a reserve → commit/release engine that other modules use for every credit-spending action. The Billing screen and the top-bar credit meter show live data.

**Done when** a demo user can: sign up and get a 200-credit trial; see the real balance and meter; choose a plan through the hosted (mock) checkout; buy a top-up; see reservations, spends and releases in their history; see invoices; upgrade, schedule a downgrade, cancel; and, after the trial or a cancellation, see what they lost access to.

## 2. Decisions

Every decision was checked against the SRS and the System Diagrams; where those documents speak, they win.

| # | Decision | Source |
|---|---|---|
| D1 | Prices are **shown in PKR and charged in USD**. Paddle cannot charge PKR (not among its 33 currencies). Each plan/pack stores both. | User; SRS silent on currency |
| D2 | Seed prices are **provisional placeholders**, editable without a deploy. Final per-action credit prices stay open (SRS TBD-002) and must satisfy the **3× cost rule** (SRS §5.5), checked in the admin cost view (sub-project 8). | User; SRS §5.5, TBD-002 |
| D3 | When a **trial ends without a plan**: leftover trial credits expire; the user keeps free actions (search existing creators, view lists); credit actions return `ENTITLEMENT_REQUIRED`; the screen lists **exactly what they lost access to** with an upgrade prompt. | SRS REQ-08.04, §4.8.2 |
| D4 | **Upgrades apply now, downgrades and cancellations at period end**, but MUSHIN never changes a subscription itself: it asks the payment provider and updates local state only from its webhooks. | User; SRS §5.5 (Paddle is the source of truth) |
| D5 | Every purchase opens a **hosted checkout page supplied by the payment adapter**, never a MUSHIN screen. Mock mode serves a test-mode page from the mock adapter's own route; real mode uses Paddle (sandbox, then live). | SRS REQ-08.01 |
| D6 | The Billing screen's **spend caps section is hidden** (not an SRS requirement). | User; SRS has only the trial cap |
| D7 | The **billing module (`apps/api/src/modules/billing`) is the only writer of credits**; the worker uses its `index.ts` service API (same pattern as `scripts/create-admin.ts`). | SRS §2.5 (same codebase), §3.4 (no API↔worker HTTP) |
| D8 | The ledger also records **`reserve` and `release`** entries. They never change a lot's balance. | SRS REQ-08.02 |
| D9 | The **ledger is the source of truth** for balances; `credit_lots.remaining` is a maintained projection, verified nightly. | SRS glossary ("Ledger") |
| D10 | **Credit meter** always visible top-right; **amber below 20 %, red below 5 %** of the period's credit base (thresholds in config). | SRS §2.x UI requirements |
| D11 | Billing state is **per workspace** (one personal workspace per user today). The Diagrams ERD links billing to a user; the SRS requires workspace-scoped data, which wins. | SRS §2.5, §4.7; Diagrams note that the ERD is logical |
| D12 | Credit-spending calls carry the **cost the user confirmed**; a mismatch with the current cost fails with `CONFLICT` and charges nothing. | SRS §2.x ("never surprised by a charge"), REQ-02 (explicit confirmation) |
| D13 | Long jobs **renew** their reservation while running; only abandoned reservations are released by the cleanup job. | SRS NFR-P04 (no time limit), §5.x safety |
| D14 | After a cancellation, **paid top-up credits stay spendable until they expire**; the plan's monthly credits and plan features are what is lost. | User; SRS REQ-08.03 ("never silently lost") |
| D15 | **Entitlement checks are cached in Upstash Redis** (≤ 60 s, invalidated on every billing change, database fallback when Redis is down). The credit balance used for spending is never cached. | SRS §2.4 |
| D16 | **Owner and Admin** see subscription, balance and history and may buy or change the plan; **Members** see the balance and meter only. | SRS §4.7.2 |

**Deferred by the SRS itself (S2):** the full credit-usage dashboard and the grace period for failed payments (REQ-08.05). **Open risks outside this design:** Paddle onboarding a Pakistan-registered entity (SRS TBD-003, existential), legal review of top-up expiry (TBD-008).

## 3. Seed configuration (provisional)

Exchange rate used for the USD placeholders: Rs 280 = $1, rounded to whole dollars. Yearly prices are displayed per month and charged per year.

| Plan | Monthly credits | Display monthly / yearly-per-month | Charge monthly / yearly total | Entitlements |
|---|---|---|---|---|
| `explorer` | 2,500 | Rs 4,900 / Rs 3,900 | $18 / $168 | audience views 5/month, outreach emails 0, campaigns 3, export no |
| `growth` | 12,000 | Rs 12,900 / Rs 10,900 | $46 / $468 | audience views unlimited, outreach 500/month, campaigns unlimited, export no |
| `scale` | 35,000 | Rs 24,900 / Rs 19,900 | $89 / $852 | audience views unlimited, outreach 2,000/month, campaigns unlimited, export yes |

| Top-up pack | Display | Charge | Valid |
|---|---|---|---|
| 1,000 credits | Rs 2,500 | $9 | 12 months |
| 5,000 credits | Rs 9,900 | $35 | 12 months |
| 15,000 credits | Rs 24,900 | $89 | 12 months |

Action costs: `search_existing` 0, `find_new` 12, `reveal_contact` 5, `refresh_data` 10.
Billing settings: trial 14 days, 200 credits, trial entitlements = Explorer's; reservation lifetime 15 min; meter amber 20 %, red 5 %; trial-ending notice 3 days before the end. "Unlimited" is stored as `null`.

## 4. Data model (migration `0005_billing.sql`)

All `wp` tables: `workspace_id`, RLS enabled and forced with the standard tenant policy, `created_at`/`updated_at`. Money is integer minor units plus an ISO currency code. Credits are integers.

**Config (`platform`, global; read by `mushin_app`, written only by owners/migrations and later the admin console)**
- `plans`: `id` (`explorer`/`growth`/`scale`), `name`, `monthly_credits`, `display_currency` (`PKR`), `display_monthly_minor`, `display_yearly_monthly_minor`, `charge_currency` (`USD`), `charge_monthly_minor`, `charge_yearly_minor`, `entitlements jsonb` (`audienceViewsPerMonth`, `outreachEmailsPerMonth`, `campaignLimit`, `export`), `paddle_price_ids jsonb` (`{monthly, yearly}`, empty until sandbox), `sort_order`, `active`.
- `topup_packs`: `id`, `credits`, `display_currency`, `display_price_minor`, `charge_currency`, `charge_price_minor`, `validity_months`, `paddle_price_id`, `active`.
- `credit_action_costs`: `action` (PK), `credits`.
- `billing_settings` (single row): `trial_days`, `trial_credits`, `trial_plan_id`, `reservation_ttl_minutes`, `meter_amber_pct`, `meter_red_pct`, `trial_ending_notice_days`.

**State (`wp`)**
- `subscriptions` (unique per workspace): `plan_id`, `billing_interval` (`month`/`year`), `status` (`trialing`/`active`/`past_due`/`canceled`/`expired`), `current_period_start`, `current_period_end`, `trial_ends_at`, `next_credit_grant_at`, `paddle_subscription_id`, `paddle_customer_id`, `cancel_at_period_end`, `scheduled_plan_id`, `scheduled_interval`. Written only by the billing module, and (apart from trial start and trial expiry, which are local) only while applying payment-provider webhooks.
- `credit_lots`: `source` (`trial`/`monthly`/`topup`/`adjustment`), `amount`, `remaining` (projection, `>= 0`), `expires_at`, `payment_id`. Partial index on `(workspace_id, expires_at) where remaining > 0`.
- `credit_ledger` (**append-only**: no `UPDATE`/`DELETE` for any app role): `amount` (signed), `kind` (`grant`/`spend`/`refund`/`expire`/`adjust`/`reserve`/`release`), `action`, `lot_id`, `reservation_id`, `source_ref` (unique per workspace + kind when set), `actor_user_id`, `actor_staff_id`, `note`. `reserve`/`release` rows have no `lot_id` and record the reserved amount as a positive number.
- `credit_reservations`: `amount`, `action`, `confirmed_cost`, `status` (`held`/`committed`/`released`/`expired`), `expires_at`, `ref_type`, `ref_id`, `committed_at`, `released_at`.
- `entitlement_usage`: `key`, `period_start`, `count`; unique (`workspace_id`, `key`, `period_start`).
- `payments`: `paddle_transaction_id` (unique), `kind` (`subscription`/`topup`), `amount_minor`, `currency`, `status`, `invoice_url`, `checkout_id`.
- `checkouts`: `kind` (`subscription`/`topup`), `plan_id`, `billing_interval`, `topup_pack_id`, `amount_minor`, `currency`, `status` (`open`/`paid`/`failed`/`expired`), `provider_checkout_id`, `hosted_url`, `requested_by`.

**`platform.webhook_events`**: `provider`, `provider_event_id` (unique with provider), `event_type`, `payload jsonb`, `received_at`, `processed_at`, `error`.

**Database grants** (only the billing repository issues billing writes; dependency-cruiser keeps other modules out):
- `mushin_app` (API requests, RLS-scoped): `SELECT` on config tables and all `wp` billing tables; `INSERT` on `credit_ledger`, `credit_reservations`, `credit_lots`, `checkouts`, `entitlement_usage`; `UPDATE` on `credit_lots` (`remaining`), `credit_reservations` (status), `entitlement_usage` (`count`), `subscriptions` (trial start only).
- `mushin_worker` (webhooks, jobs): the above plus `INSERT`/`UPDATE` on `subscriptions`, `payments`, `checkouts`, and `platform.webhook_events`.
- **No role** gets `UPDATE` or `DELETE` on `credit_ledger`, or `DELETE` on any billing table.
Mock-only tables are not needed: the mock adapter keeps its state in `checkouts` plus `webhook_events`.

**Invariant (tested, and reconciled nightly):** for every lot, `remaining = Σ amount of its ledger rows`, where the lot's `grant` row is `+amount`, `spend` and `expire` rows are negative, and `refund`/`adjust` rows are signed. `reserve`/`release` rows have no `lot_id`, so they never enter the sum.

## 5. Credit engine (billing service)

Service API (exported from `modules/billing/index.ts`):
- `getBalance(ctx)` → `{ available, reserved, base, meter }` where `available = Σ remaining of unexpired lots − Σ amount of held reservations`, `base` = current plan's monthly credits (trial credits while trialing; smallest top-up pack size when no plan), `meter` = `normal`/`amber`/`red`. One indexed query (SRS NFR-P06).
- `reserve(ctx, { action, confirmedCost, refType, refId })` → `reservationId`.
- `extendReservation(ctx, reservationId)` → pushes `expires_at` forward by the reservation lifetime.
- `commit(ctx, reservationId)`; `release(ctx, reservationId, reason)`.
- `spendInstant(ctx, { action, confirmedCost, refType, refId })` (reserve + commit in one transaction).
- `startTrial(tx, workspaceId)` (called inside identity provisioning, same transaction).
- `checkEntitlement(ctx, key)` / `recordEntitlementUse(ctx, key)` for plan limits (consumers arrive in later sub-projects).
- Internal: `grant`, `expireLots`, `releaseAbandoned`, `reconcile`.

Rules:
1. Every credit operation takes a **per-workspace transaction lock** (`pg_advisory_xact_lock` on the workspace id), so concurrent operations on one workspace are evaluated one at a time even when it has no lots.
2. **Who may spend:** `trialing` or `active`/`past_due` subscriptions may spend any lot; `canceled`/`expired` workspaces may spend only top-up lots (D14). Otherwise `ENTITLEMENT_REQUIRED`.
3. **Reserve:** read the current cost from `credit_action_costs`; if it differs from `confirmedCost` → `CONFLICT` (D12); if `available < cost` → `INSUFFICIENT_CREDITS`; insert a `held` reservation (expires after `reservation_ttl_minutes`) and a `reserve` ledger row.
4. **Commit:** guarded `held → committed` update (a repeat commit changes nothing); consume eligible lots with `expires_at > reservation.created_at` and `remaining > 0`, ordered by `expires_at` ascending; one `spend` row per lot touched. If eligible lots cannot cover the amount (should be impossible) the transaction fails with `INTERNAL` and logs an alert.
5. **Release:** guarded `held → released`; a `release` ledger row; lots untouched.
6. **Grants** insert a lot and a `grant` row; a repeated `source_ref` (e.g. a Paddle transaction id) is a no-op, so a webhook can never grant twice.
7. **Expiry** writes an `expire` row for each expired lot's remainder and zeroes `remaining`, **skipping workspaces with held reservations** (they are retried on the next run).
8. **Trial:** one lot of `trial_credits` expiring at `trial_ends_at`. **Top-ups are blocked while trialing** (`ENTITLEMENT_REQUIRED`), so the trial can never exceed its cap (REQ-08.04).
9. **Monthly allowance** lots expire at the end of their credit period (no rollover); top-up lots expire `validity_months` after purchase.
10. Inside each commit/spend transaction, compare the meter state before and after the spend; when it moves from `normal` to `amber`, or from any state to `red`, write `billing.credits_low` / `billing.credits_very_low` to the outbox. No extra state is needed: a later spend that stays in the same band emits nothing, and a new grant that lifts the balance lets the next crossing emit again.

## 6. Subscriptions, checkout and webhooks

**Payment adapter** (`packages/integrations`, interface `Payments`; every call wrapped in `instrumented()`):
`createCheckout({ checkoutId, workspaceId, customerEmail, item })` → `{ providerCheckoutId, url }`; `changePlan({ subscriptionId, priceRef, effective: "now" })`; `cancelAtPeriodEnd({ subscriptionId })`; `verifyWebhook(rawBody, headers)` → parsed event or rejection; `getSubscription(id)`.
Implementations: **`MockPayments`** (default; logged at startup) and **`PaddlePayments`** (enabled when `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` and `PADDLE_WEBHOOK_SECRET` are set; `PADDLE_ENVIRONMENT=sandbox|production`). Both sign and verify webhooks with Paddle's scheme (`Paddle-Signature: ts=…;h1=HMAC-SHA256(secret, ts + ":" + rawBody)`), with a 5-minute timestamp tolerance. The mock uses `MOCK_PADDLE_WEBHOOK_SECRET` (generated by `npm run env:secrets`).

**Checkout flow (D5):** `POST /v1/billing/checkout` (Owner/Admin, `Idempotency-Key` required) validates the item (plan + interval, or top-up pack), creates a `checkouts` row (`open`), asks the adapter for a hosted URL, and returns `{ checkoutId, url }`. The frontend navigates to `url`. In mock mode that is `GET /mock-paddle/checkout/:id` on the API (registered only in mock mode): a minimal test-mode page showing the item and USD amount with **Pay** and **Simulate failed payment**. Pay/fail make the mock emit the events Paddle would (`transaction.completed` + `subscription.created`/`subscription.activated`, or `transaction.payment_failed`), signed, to `POST /webhooks/paddle`, then redirect back to the app (`#/billing?checkout=success|failed`).

**Webhook intake (SRS §3.4):** `POST /webhooks/paddle` reads the raw body, verifies the signature (invalid/stale → `401`, logged, nothing stored), inserts `webhook_events` (duplicate → `200`, no-op), writes an outbox event `billing.webhook_received`, returns `200`. Exempt from the IP rate-limit bucket (Paddle retries).

**Processing (worker, `billing` queue, concurrency 1, in order):**

| Event | Effect |
|---|---|
| `transaction.completed` | `payments` row (with invoice URL); top-up → grant a top-up lot (`source_ref` = transaction id); checkout → `paid` |
| `transaction.payment_failed` | checkout → `failed`; emit `billing.payment_failed` |
| `subscription.created` / `activated` | subscription → `active` with plan, interval, period; grant the period's monthly lot; set `next_credit_grant_at` |
| `subscription.updated` (plan change) | upgrade: start a new credit period, expire unused monthly credits, grant the new plan's monthly lot; renewal: grant the new period's lot |
| `subscription.past_due` | status `past_due` (grace handling is S2) |
| `subscription.canceled` | status `canceled`; emit `billing.subscription_canceled` |
| other | stored, marked processed, ignored |

Every applied event invalidates the workspace's cached entitlements (D15). Processing failures retry 5 times, then go to the dead-letter queue.

**Plan changes (D4):** `POST /v1/billing/subscription/change { planId, interval }` (Owner/Admin, `Idempotency-Key`). Higher monthly credits = upgrade → `changePlan(now)`; the change applies when its webhook arrives. Lower = downgrade → store `scheduled_plan_id`/`scheduled_interval`; the daily job calls `changePlan` at the period boundary. `POST /v1/billing/subscription/cancel` → `cancelAtPeriodEnd`; the provider sends `subscription.canceled` when it takes effect. During a trial, choosing a plan is a normal checkout.

## 7. Scheduled jobs (worker, pg-boss cron)

| Job | Schedule | Work |
|---|---|---|
| Release abandoned reservations | every minute | `held` reservations past `expires_at` → `expired`, with a `release` row |
| Expire lots | hourly | rule 7 above |
| End trials | hourly | `trialing` past `trial_ends_at` → `expired`; emit `billing.trial_expired` |
| Trial-ending notice | hourly | emit `billing.trial_ending` once, `trial_ending_notice_days` before the end |
| Monthly grants & scheduled downgrades | daily | yearly plans: grant the next month's lot at `next_credit_grant_at`; apply due `scheduled_plan_id` via `changePlan` |
| Ledger reconciliation | nightly | recompute every lot from the ledger; log an error (admin alert) on any mismatch |
| Mock renewals | daily, mock mode only | at period end the mock emits renewal events, as Paddle would |

Notification events (`billing.credits_low`, `billing.credits_very_low`, `billing.trial_ending`, `billing.trial_expired`, `billing.subscription_canceled`, `billing.payment_failed`) are routed to the `notify` queue; their handlers (in-app notifications, emails) arrive in sub-project 7 and are no-ops until then.

## 8. API

Customer (`/v1/billing`, customer guard; contracts in `packages/contracts/src/billing.ts`):

| Route | Who | Returns |
|---|---|---|
| `GET summary` | any member | plan, interval, status, period, trial days left, balance (`available`, `reserved`, `base`), meter, scheduled change, `lostAccess[]` when no plan |
| `GET plans` | any member | plans, top-up packs, action costs (display and charge prices) |
| `GET ledger?cursor` | Owner/Admin | ledger history, newest first, paginated |
| `GET invoices` | Owner/Admin | payments with provider invoice links |
| `POST checkout` | Owner/Admin, idempotent | `{ checkoutId, url }` |
| `POST subscription/change` | Owner/Admin, idempotent | `202` with the requested change |
| `POST subscription/cancel` | Owner/Admin, idempotent | `202` |

Public: `POST /webhooks/paddle` (signature-authenticated). Mock only: `GET /mock-paddle/checkout/:id`, `POST /mock-paddle/checkout/:id/pay|fail`.
Admin read API for sub-project 8: `getWorkspaceBilling(workspaceId)` (subscription, balance, history).

Identity change: `resolveTenant`'s provisioning transaction calls `billing.startTrial` (umbrella spec §6.2).

## 9. Frontend (wiring only)

- **Top bar:** real balance from `GET summary`, amber/red meter states.
- **Billing screen:** balance tiles, current plan card, usage log (from the ledger), invoices (from payments), Upgrade/Change plan and Buy credits buttons (open the hosted checkout; on return show success/failure), Cancel subscription; **spend caps section hidden**. Payment methods section untouched until sub-project 7 removes it.
- **Trial banner** (days left) and **"You no longer have access to…" panel** when no plan.
- Credit actions on other screens become real in sub-projects 3–4; until then their demo buttons **no longer change the displayed balance**.
- `lib/credits.ts` and `lib/plans.ts` stop being the source of truth; plans and costs come from `GET plans`.

## 10. Errors

| Situation | Response |
|---|---|
| Not enough credits | `INSUFFICIENT_CREDITS` 402 `{ required, available }` |
| No active plan / top-up during trial / feature not in plan | `ENTITLEMENT_REQUIRED` 403 `{ reason, lostAccess? }` |
| Cost changed since confirmation | `CONFLICT` 409 `{ confirmedCost, currentCost }`, nothing charged |
| Member attempts a purchase or plan change | `FORBIDDEN` 403 |
| Payment provider unreachable | `PROVIDER_UNAVAILABLE` 503, no checkout created |
| Webhook with bad or stale signature | `401`, logged, not stored |
| Webhook processing failure | retried 5×, then dead-letter queue (event already stored) |
| Payment failed at checkout | checkout `failed`, user sees the reason, no credits granted |

## 11. Testing (SRS Testability: unit, integration, security)

- **Unit:** lot ordering and multi-lot splits; meter thresholds and base; upgrade/downgrade classification; webhook signature (valid, tampered, stale, wrong secret); `lostAccess` list; cost-confirmation mismatch; config/contract schemas.
- **Integration:** reserve/commit/release/spendInstant; double commit is a no-op; **20 concurrent reserves never overspend**; invariant holds after random operation sequences; expiry skips held workspaces; renewed reservations survive cleanup, abandoned ones are released; trial granted inside provisioning; **mock checkout end to end** (pay → webhook → worker → active + credits); duplicate webhook grants once; failed payment; upgrade, downgrade at the boundary, cancel; top-up credits spendable after cancel; top-ups blocked during trial; reconciliation detects tampering; notification events written to the outbox; Redis invalidation and database fallback.
- **Security:** cross-tenant reads of balance, ledger, checkouts and invoices fail; RLS catalog guard covers the new `wp` tables; Member gets `403` on purchases; `mushin_app` gets `permission denied` on ledger `UPDATE`/`DELETE`; forged/unsigned webhooks rejected.

Database tests require `TEST_DATABASE_URL` (pending, as for sub-project 1).

## 12. Environment additions

`PADDLE_CLIENT_TOKEN` (new; `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT` exist), `MOCK_PADDLE_WEBHOOK_SECRET` (generated), `PUBLIC_API_URL` (base URL the mock uses for hosted pages and webhook delivery; default `http://localhost:4000`). Upstash credentials must be replaced (the current database no longer exists); until then entitlement caching falls back to the database.

## 13. Out of scope

Grace period for failed payments and the full usage dashboard (S2, REQ-08.05); staff credit adjustments and refunds UI (sub-project 8, which must audit them per SRS REQ-10.x); notification delivery (sub-project 7); removing EasyPaisa/JazzCash (sub-project 7); real credit-spending actions in search/discovery (sub-projects 3–4); customer spend caps.
