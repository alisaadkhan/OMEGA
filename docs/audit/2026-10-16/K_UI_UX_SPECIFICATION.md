# K — UI/UX specification (designer / Figma workflow)

Scope: every existing page in `frontend/` at `1398cee`, the pages the product is missing, shared components, responsive
layouts, interactions and all states. Page-group numbering follows the pack's Figma map (00–23) so existing frames can be
reused. **Status** per page: *Exists* (built), *Exists – change* (built, needs the listed change), *New*.

## 1. Design principles (binding)

1. **Evidence is the hero.** Every number shows where it came from and when (`FreshnessLabel`, source chip). Unknown is
   shown as "Unknown", never 0. Stale is shown as stale.
2. **Price before action.** Any credit-spending control shows its exact credit cost (or quoted maximum and minimum) on the
   control itself and again in a confirm step. Copy states the real rule (BIL-01).
3. **No pretend features.** Unavailable capability = disabled control + "Not available yet — <reason>". No fabricated
   activity, testimonials, logos, demographics or progress.
4. **Honest outcomes.** Empty, insufficient, partial, failed, cancelled and stopped-by-limit outcomes each have their own
   message, credit outcome and next step.
5. **Workspace is always visible.** The active workspace name sits in the top bar; switching is explicit and
   cross-tab-safe (SEC-04/UX-03).
6. **Pakistan-first language.** Inputs accept English, Roman Urdu and Urdu script (`dir="auto"`); handles and URLs are
   isolated with `dir="ltr"`; numbers use 10k / 1.2M and lakh-aware parsing is accepted in inputs.

Visual system (keep current): white / slate-50 surfaces, slate-900 text, slate-200 borders, navy primary (`#0f2747`-ish
existing token), indigo-600 accent, Inter/system sans, 4-pt spacing grid, 8 px radius, restrained motion (≤ 200 ms;
honour `prefers-reduced-motion`). Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI glyphs (fixes A-1…A-4 already applied).

## 2. Breakpoints and layout

| Name | Width | Shell | Grids |
|---|---|---|---|
| Mobile | 360–599 | Top bar + bottom sheet nav; filters in a full-screen sheet; result cards single column | 4 col, 16 px gutter |
| Tablet | 600–1023 | Collapsible left nav (icons); filter drawer | 8 col |
| Laptop | 1024–1439 | Left nav 240 px; results + right profile drawer (480 px) | 12 col |
| Desktop | ≥ 1440 | Same, max content width 1280 | 12 col |

Validation frames per page: 390 × 844, 768 × 1024, 1280 × 800, 1440 × 900. Tap targets ≥ 44 × 44 on touch.

## 3. Global components

| Component | Purpose | States / rules |
|---|---|---|
| AppShell (Topbar, Sidebar) | Navigation, workspace switcher, credit meter, notifications, account | Credit meter: loading skeleton (never "Healthy" while loading), normal/amber/red, "No plan"; switcher lists `/v1/me/workspaces` |
| WorkspaceSwitcher | Change active workspace | Confirm dialog when unsaved changes; after switch: toast "Now working in <name>"; other tabs show banner "Workspace changed in another tab — reload" and block writes |
| CreditCost chip | Shows cost on any paid button | "50 credits" / "Free (repeat)" / "Up to 150 · at least 100"; disabled with reason when balance insufficient |
| CreditConfirm dialog | Final confirm for paid actions | Shows balance before/after; price version; "Your credits are returned if …" exact rule |
| ScoreWithEvidence | Score + factor breakdown | "Not enough data" when insufficient; no colour-only meaning |
| FreshnessLabel | Observed-at + status | Fresh / Ageing / Stale / Unknown with dates |
| EligibilityBadge | elig-1 state | Eligible · Below 10k · Count too old (refresh) · Activity unverified (info) |
| ContactAvailability | Reveal entry point | Available (email/phone, unverified) · Domain checked · Invalid · None; reveal cost; revealed value with copy button and "revealed by <name> on <date>" |
| MatchReasons | Why it matched | Chips: name, handle, niche, city, tag, bio; plus "Not applied: …" chip for ignored clauses (SRCH-06) |
| JobTray | Running Live Discovery jobs | Stage text from server; counters; cancel; never a fake percentage |
| StatusBanner | System/degraded state | Provider paused · Search temporarily unavailable · Maintenance; links to status page |
| EmptyState, ErrorState, PermissionDenied, RateLimited, OfflineBanner | Standard states | See §6 |
| Toast | Server-confirmed success only | Never shown before the API confirms |

## 4. Page specifications

Each row lists **purpose · primary actions · data · states that must be designed**. All pages also need the global
states in §6.

### 02 Marketing site — Exists – change
- Hero, FeatureTabs, Metrics (copy fix BIL-01), Pricing (Starter/Growth/Scale from `/v1/billing/plans`; feature rows only
  for shipped capabilities; footnote with the Live Discovery rule), FAQ, Footer with **Terms, Privacy, Refunds, Creator
  data & removal** links. Remove the unused fake testimonial/logo components (SEC-15).
- New frames: cookie/analytics notice only if analytics is added (none today).

### New: Legal pages (Terms, Privacy Policy, Refund policy, Creator data notice) — New (UX-01)
- Static, readable without sign-in, version + effective date at top, table of contents, print-friendly; Urdu summary
  optional. Signup checkbox/notice links here and records the version.

### 03 Authentication and first run — Exists – change
| Screen | Status | Required states |
|---|---|---|
| Sign up | Exists | field validation; "check your email" after submit; email already registered; rate limited; links to legal pages |
| Email confirmation result | **New** | success → continue; link expired → resend; already confirmed |
| Sign in | Exists | wrong credentials (generic); unconfirmed email (resend); account deleted ("This account was deleted"); locked/rate limited |
| Forgot password | Exists | always-same confirmation message |
| **Set new password** (`#/reset-password`) | **New** (UX-02) | token valid → new password + confirm + strength; expired link; success → signed in |
| Invite accept (`#/invite/<token>`) | Exists – change | preview (workspace, role, inviter, expiry); signed in as other email → "This invitation is for a***@x.com"; unconfirmed email; expired/revoked; success → switches workspace |
| First-run (trial) | Exists – change | show trial credits and what 1 search / 1 live run costs; one-step "search your first creator" |

### 04 App shell — Exists – change
Workspace switcher + cross-tab banner (UX-03); credit meter skeleton; support entry; "Support access active" banner
(exists).

### 05 Overview — Exists
Cards from real data; empty first-use; loading skeletons; error per card (not whole page).

### 06 Search (Brain 1) and Find New Creators (Brain 2) — Exists – change (core)
**Search bar & filters:** query input (`dir=auto`), platform, city (gazetteer autocomplete), country, follower range
(accepts 10k/1 lakh), engagement, niches, verified, has contact, fresh only. Cost chip "50 credits · repeats in 30 min
free" (or the approved BIL-02 rule). "How we read your search" strip showing understood text, filters taken from the
text, and **Not applied** clauses.
**Results:** card = avatar, name, handle (ltr), platform icon, eligibility badge, followers with freshness, city with
source ("from bio"), niches, fit score with evidence, match-reason chips, contact availability, Save / Add to campaign /
Compare. Sorting by relevance only (deterministic). Pagination "Load more" with stale-cursor recovery ("Results changed —
search again").
**States:** idle with examples (English/Roman Urdu/Urdu); loading skeleton cards; **no results** ("No eligible creators
match. Try: remove the city / widen followers / Find new creators (quoted first)") with the credit outcome shown;
few results; conflicting range (inline error, no charge); insufficient credits (balance + buy CTA for Owner, "ask your
owner" for Member); no plan (top-up only); rate limited (retry time, query kept); provider/search unavailable (PostgreSQL
fallback message); stale cursor; creator became ineligible.
**Find New Creators dialog:** brief builder (topic, city/country/language, platform, size 5/10/15); live validation
message from `missingRequirements` ("Add a topic", "Add a city, country or language"); estimate panel: maximum, minimum
if TikTok, base fee, per creator, expiry countdown; confirm. **Progress (JobTray + panel):** stages from server
(searching → filtering → fetching → archiving → assessing → saving), counters (search results seen, profile candidates,
passed snippet check, extracted, qualified, delivered new/known), cancel. **Terminal states (each its own frame):**
succeeded (charged X, returned Y); completed_empty (0 charged); insufficient (0 charged, suggestions); partial
(charged for delivered only); failed (0 charged, retry later); cancelled (charged for delivered); stopped by cost cap or
deadline ("Stopped early to protect your credits; you were charged only for what was delivered"); some candidates not
checked (SRCH-09); estimate expired; estimate already used; brief changed.

### 07 Creator profile drawer — Exists – change
Header (identity, platforms, eligibility per profile), metrics with freshness and source, authenticity signals with
"Not enough data", AI summary labelled "AI summary — generated from public profile text" with model/date or
"unavailable", bio **with contact strings redacted** (SEC-08), contact availability + reveal (cost, confirm, revealed
value, audit line), refresh ("Update info · 50 credits", up-to-date state with next allowed time), Save / Campaign,
removal-hidden state ("This creator is not available"), minor-protected state.

### 08 Compare — Exists
Up to N creators side by side; same evidence/freshness rules; empty and single-item states.

### 09 Lists — Exists
List index, list detail, add/remove, rename, delete confirm; member below minimum labelled "Kept — no longer meets the
10k minimum"; export disabled "Not available yet".

### 10 Campaigns — Exists
Index with open-campaign limit indicator ("2 of 3 open on Starter"); detail pipeline stages; fee in PKR; content status;
optimistic-concurrency conflict ("Someone else changed this — reload"); limit reached → upgrade prompt (Owner) or ask
owner (others).

### 11 Outreach (manual log) — Exists
Append-only log entries; explicit note "MUSHIN does not send emails"; no delivered/opened states.

### 12 Analytics — Exists
Only persisted metrics; empty state for new workspaces; no revenue/ROI claims.

### 13 Credits & Billing — Exists – change
Balance (available, held, top-ups never expire, monthly credits expire at renewal date), plan card, change plan
(Owner — or Owner/Admin per D-06), top-up packs, ledger (Owner/Admin; Member sees summary only with "Ask an owner for
details"), invoices (when Paddle live), mock checkout banner in non-production, payment failed / past due / canceled
banners with exact consequence ("Monthly credits stop; your top-ups remain").

### 14 Settings — Exists – change
Profile; password change; Workspace & team (members, roles, invitations with copy link and expiry, revoke, remove,
leave, transfer ownership); Privacy (export download with "includes / excludes" list and row-limit notice; delete
workspace with typed name and blockers list; delete account with typed email and blockers, what is retained, and the
sign-in identity outcome); Support access requests (approve/deny/revoke with duration).

### 15 Activity, notifications, support — Exists
Activity from real events only; notification centre with read state; support tickets (create, thread, status), 20-open
cap message.

### Public: Remove my data — Exists
Form, confirmation ("hidden now; reviewed within N days" — N to be decided), already-requested state.

### 16, 19–23 Staff console — Exists – change
| Area | Required |
|---|---|
| Staff sign-in | password → TOTP; lockout message; session ended; **security-key step-up dialog** with clear "why" text and failure states; first-key enrolment needing approval/code (SEC-07) |
| Overview & alerts | counts with thresholds and "why flagged"; eligibility coverage card; unknown values shown as Unknown |
| Job inspector | funnel + candidate trail with reason codes; retry/cancel with reason (Admin + step-up) |
| Workspace lookup | redacted by default; consented access banner with expiry |
| Support queue | assign, reply, internal note visually distinct from public reply |
| Providers | pause/resume with reason; never "healthy" without data |
| Approvals | request form (exact payload preview), decide (cannot self-approve), status timeline, executed/failed result |
| Audit log | filters; immutable look; export (Super Admin) |
| Removal requests | review with evidence; approve needs step-up |
| Super Admin | staff list, role-change/suspend via approvals only; bootstrap is CLI-only (show "managed outside the console") |

### 17 Future / not available — Exists
Inbox and audience details shown as "Planned" with reason; never interactive.

### New: Error, maintenance and status pages
404 (hash route unknown), maintenance (API 503 with retry), "MUSHIN is partly unavailable" status banner states.

## 5. Interaction rules

- Paid action flow: button with cost chip → confirm dialog → server response → toast with the **actual** charge.
- Double-submit prevention: buttons disabled while pending; idempotency keys sent for paid/mutating calls.
- Polling: 2 s while running, exponential back-off after 1 min, stop at terminal state; resume on tab focus.
- Navigation keeps search query, filters and scroll position when opening and closing the profile drawer.
- Destructive actions: typed confirmation for workspace/account deletion; plain confirm for list/campaign deletion.
- Keyboard: every action reachable; focus trapped in dialogs; Esc closes; visible focus ring; live regions announce job
  stage changes and toasts.

## 6. Global state catalogue (design one frame per state per page family)

| State | Trigger | UI | Recovery |
|---|---|---|---|
| Loading | request pending | skeletons matching final layout | — |
| Empty / first use | no data | explanation + first action | CTA |
| No results | search returned 0 | reason + suggestions + credit outcome | edit search / find new |
| Validation error | 400/422 | inline field messages from `field`/`missingRequirements` | fix field |
| Success | 2xx confirmed | toast / inline confirmation | — |
| Warning | soft limits, stale data, ineligible creator | amber inline banner | refresh / learn more |
| Confirmation | paid or destructive | dialog with exact consequence | cancel |
| Permission denied | 403 | "Only an owner or admin can …" | ask owner |
| Workspace access lost | 403 workspace_access_denied | full-page notice, switcher | choose workspace |
| Insufficient credits | 402/409 INSUFFICIENT_CREDITS | balance + required | buy / ask owner |
| No plan | ENTITLEMENT_REQUIRED | what is lost / kept | choose plan |
| Rate limited | 429 + Retry-After | countdown, input preserved | auto-enable |
| Provider unavailable / paused | 503 PROVIDER_UNAVAILABLE | specific message; credits returned note | try later |
| Partial result | job partial | what was delivered and charged | — |
| Session expired | 401 | modal sign-in, keeps page | sign in |
| Offline | fetch failure | top banner "You're offline" | auto retry |
| Server error | 500 | generic message with request id | retry / contact support |
| Stale data | freshness | stale label + refresh cost | refresh |

## 7. Content and microcopy rules

Plain English (Grade 8), short sentences, numbers with units ("50 credits", "Rs 4,900/month"), consistent terms
("Find new creators" = Brain 2; "Search" = Brain 1; "credits returned", never "refunded" for credits; "delivered",
"qualified", "candidates" used exactly as in §4). Error messages say what happened, why, and what to do.

## 8. Accessibility acceptance (UX-05)

WCAG 2.2 AA: 1.4.3 contrast, 1.4.11 non-text contrast, 2.1.1 keyboard, 2.4.7 focus visible, 2.4.11 focus not obscured,
2.5.8 target size, 3.3.1/3.3.3 error identification and suggestion, 4.1.3 status messages. Manual passes with NVDA
(Windows) and VoiceOver (iOS) on: sign-up, search + profile + reveal, Find New Creators through a terminal state,
billing, team invitation, delete workspace.

## 9. Hand-off checklist for designers

- [ ] Every page in §4 has frames for 390/768/1280/1440 and every relevant state in §6.
- [ ] All paid controls show cost chips matching server constants.
- [ ] All copy reviewed against BIL-01 and the "no pretend features" rule.
- [ ] Legal pages and set-new-password screens added.
- [ ] Staff console step-up and approvals flows designed with failure states.
- [ ] Urdu/RTL samples included in search, profile bio and lists.
