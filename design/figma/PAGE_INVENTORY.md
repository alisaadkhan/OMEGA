# Page inventory

Every route and screen in the frontend at the time of writing (`frontend/src/app/App.tsx` hash router; dashboard and staff
views are in-app views, not separate URLs). Page-group IDs follow the audit's Figma map
(`docs/audit/2026-10-16/K_UI_UX_SPECIFICATION.md`); IDs 00, 01 and 18 are assigned here (see FIGMA_BUILD_GUIDE.md).
Status words: mandate v3 §11 (**Implemented**, **Locally verified**). E2E references are check areas in
`scripts/e2e-customer/journey.mjs` (customer) and `scripts/e2e-staff/journey.mjs` (staff). Global states for every page:
PRODUCT_UI_SPEC.md §6.

## 02 Marketing (public)

| Screen | Route | Role | Purpose · main actions | Data | States | Source | Status · check |
|---|---|---|---|---|---|---|---|
| Landing | `#/` | Visitor | Explain MUSHIN; sign up; see plans | `/v1/billing/plans` (plans and prices from the server) | loading prices, catalogue unavailable | `components/landing/*` (Navbar, Hero, FeatureTabs, Features, Metrics, Pricing, FAQ, CTA, Footer) | Locally verified · `plans`, `pricing`, `phone`, `a11y`, `states` (no `href="#"`) |

## 03 Authentication and first run

| Screen | Route | Role | Purpose · actions | States | Source | Status · check |
|---|---|---|---|---|---|---|
| Sign in | `#/login` | Visitor | email + password | wrong credentials (generic), deleted account, rate limited | `auth/Login.tsx` | Locally verified · `auth`, `phone`, `a11y` |
| Sign up | `#/signup` | Visitor | name, email, password, unticked Terms consent | validation, "check your email", already registered | `auth/Signup.tsx` | Locally verified · `legal`, `phone`, `a11y` |
| Email confirmation result | `#/confirmed` | Visitor | land from the confirmation email | checking, confirmed + signed in, confirmed in another browser (sign in), expired/used link + resend | `auth/EmailConfirmed.tsx` | Locally verified (other-browser state) · `auth`; expired state needs real Auth email (DESIGN_GAPS) |
| Forgot password | `#/forgot` | Visitor | request reset link | always-same confirmation, error | `auth/ForgotPassword.tsx` | Locally verified · `phone`; recovery-check (local Supabase) |
| Set new password | `#/reset-password` | Visitor with recovery link | new password + repeat | checking, form, mismatch, saving, expired/used link with reason | `auth/ResetPassword.tsx` | Locally verified · recovery-check 10/10 |
| Invitation | `#/invite/<token>` | Invitee | preview and accept | wrong email, unconfirmed email, expired, revoked, used, signed out | `auth/InviteAccept.tsx` | Locally verified · `team` |
| First workspace | (inside dashboard) | New user | name the workspace | | `auth/WorkspaceOnboarding.tsx` | Implemented |
| Terms acceptance | dialog over the dashboard | Signed-in user without current acceptance | tick + accept | disabled until ticked, saving, error | `dashboard/LegalGate.tsx` | Locally verified · `legal`, `a11y` |

## 04 App shell

| Element | Source | States | Status · check |
|---|---|---|---|
| Sidebar (Workspace: Dashboard, Search, Lists, Campaigns, Analytics; Account: Credits & billing, Settings, Support, Activity) | `dashboard/Sidebar.tsx` | active, collapsed (mobile) | Locally verified · `phone`, `dashboard` |
| Top bar (workspace switcher, credit meter, notifications, account) | `dashboard/Topbar.tsx`, `NotificationCenter.tsx` | loading meter, no plan, low balance | Locally verified · `dashboard`, `isolation` |
| Workspace switch notice (removed / other tab) | `dashboard/Dashboard.tsx`, `api/workspace.ts` | access lost → notice | Locally verified · `isolation` |
| Billing status banner | `dashboard/BillingStatusBanner.tsx` | past due, canceled, trial ending | Implemented |
| Support access banner | `dashboard/SupportAccessSettings.tsx` | active consented access | Locally verified · `team`/`privacy` |
| Service status banner | `public/StatusScreens.tsx` (`ServiceStatusBanner`) | offline, degraded (503), unreachable | Locally verified · `states` |
| Job tray | `dashboard/JobTray.tsx` | running live run, stages from server | Locally verified · `discovery` |
| Omnibar (add by link) | `dashboard/Omnibar.tsx`, `AddByLinkDialog.tsx` | | Implemented |

## 05–15 Customer application (`#/dashboard`)

| ID | View | Role | Purpose · actions | Data (API) | States | Source | Status · check |
|---|---|---|---|---|---|---|---|
| 05 | Dashboard | Member+ | overview cards from real data | `/v1/analytics/summary`, billing summary | empty first use, per-card error | `Overview.tsx`, `OverviewCards.tsx` | Locally verified · `dashboard` |
| 06 | Search (Brain 1) | Member+ | query + filters, cost chip, results, open profile | `POST /v1/search` | idle, loading, results, no results (+ offer Find New), invalid input, insufficient credits, no plan, rate limited | `SearchModule.tsx` | Locally verified · `search`, `eligibility`, `pricing` (relevance **not accepted**) |
| 06 | Find New Creators (Brain 2) | Member+ | brief, quote, confirm, progress, results | `/v1/discovery/estimates`, `/v1/discovery/jobs/*` | missing requirements, quote, expired quote, one run at a time (409), insufficient, running stages, terminal outcomes | `FindNewDialog.tsx`, `JobTray.tsx` | Locally verified with providers blank (refund path) · `discovery`; live provider path not verified |
| 07 | Creator profile | Member+ | evidence, freshness, eligibility, contacts, reveal, save, add to campaign | `/v1/creators/:id`, reveal | below minimum, unknown values, AI summary label, removal hidden | `CreatorProfilePanel.tsx`, `dashboard/states.tsx` (FreshnessBadge, SourceBadge, ContactTrustBadge) | Locally verified · `profile`, `eligibility` |
| 08 | Compare | Member+ | side-by-side | `/v1/creators/:id` | 0–1 items | `Compare.tsx` | Implemented |
| 09 | Lists | Member+ | create, open, note, favourite, remove | `/v1/lists/**` | empty, duplicate name, creator below minimum kept | `Lists.tsx`, `SaveToListMenu.tsx` | Locally verified · `lists` |
| 10 | Campaigns | Member+ | create, stages, fees, declined, limit | `/v1/campaigns/**` | limit reached (Starter 3 open), conflict | `Campaigns.tsx`, `CampaignDetail.tsx`, `AddToCampaignMenu.tsx` | Locally verified · `campaigns`, `plans` |
| 11 | Outreach (manual log; email in test mode on Scale/Growth) | Member+ | log contact, outcome | `/v1/campaigns/:id/creators/:creatorId/outreach`, `…/emails`, `/v1/outreach/usage` | "MUSHIN does not send email" (log), quota, test mode label | `CampaignOutreach.tsx`, `SendEmail.tsx` | Locally verified · `campaigns`, `plans` |
| 12 | Analytics | Member+ | persisted metrics only | `/v1/analytics/summary` | empty | `Analytics.tsx` | Locally verified · `dashboard` |
| 13 | Credits & billing | Owner/Admin buy; Member reads | balance, plans, top-ups, ledger, mock checkout | `/v1/billing/**` | mock-checkout label, past due, canceled, annual not offered | `Billing.tsx` | Locally verified · `billing`, `plans` |
| 14 | Settings | Member+ (team actions Owner/Admin) | profile, team, invitations, privacy (export, delete workspace/account), support access | `/v1/me/**`, `/v1/workspace/**` | blockers, typed confirmation, export truncated warning, sign-in removal outcome | `Settings.tsx`, `TeamSettings.tsx`, `SupportAccessSettings.tsx` | Locally verified · `settings`, `team`, `privacy` |
| 15 | Support | Member+ | tickets and thread | `/v1/support/**` | 20-open cap | `Support.tsx` | Locally verified · `support` |
| 15 | Activity | Member+ | real events only | `/v1/activity` | empty | `ActivityLog.tsx` | Locally verified · `activity` |
| 17 | Inbox | — | not available | — | "Planned" with reason, not interactive | `Inbox.tsx` | Implemented |
| 17 | Audience details | — | off unless an approved source | — | unavailable with reason | `AudienceEstimate.tsx` | Implemented |

## 18 Public pages, legal and status (assigned here)

| Screen | Route | Purpose | States | Source | Status · check |
|---|---|---|---|---|---|
| Terms / Privacy / Refunds / Creator data notice | `#/terms`, `#/privacy`, `#/refunds`, `#/creator-data` | draft legal text with version and **Draft, not yet reviewed by a lawyer** banner | — | `public/LegalPage.tsx` | Locally verified · `legal`, `phone`, `a11y` (counsel review pending) |
| Remove my data | `#/remove-my-data` | creator removal request | submitted (hidden at once), validation | `public/RemoveMyData.tsx` | Locally verified · `phone`, `a11y` |
| Page not found | any unknown `#/…` | way home / sign in | — | `public/StatusScreens.tsx` (`NotFound`) | Locally verified · `states`, `phone`, `a11y` |
| Page error | render failure anywhere | reload / home, nothing lost | — | `public/StatusScreens.tsx` (`AppErrorBoundary`) | Implemented (not triggerable without a bug; DESIGN_GAPS) |

## 16, 19–23 Staff console (`#/admin/login`, `#/admin`)

| ID | View | Roles | Purpose · actions | States | Source | Status · check |
|---|---|---|---|---|---|---|
| 16 | Staff sign-in | Staff | password → TOTP | lockout (generic), session ended | `admin/AdminLogin.tsx` | Locally verified · `staff` (sign-in per role) |
| 16 | Overview & alerts | All | alerts with thresholds, eligibility coverage, test alert (Admin) | Unknown values, no alerts | `admin/OpsControls.tsx` (OpsAlerts), `OpsViews.tsx` | Locally verified · `eligibility`, `a11y` |
| 19 | Jobs | All (retry/cancel Admin + key) | inspector, retry, cancel with reason | key needed | `admin/OpsViews.tsx`, `OpsControls.tsx` | Implemented · `a11y` |
| 19 | Workspaces | All | redacted lookup | | `admin/OpsViews.tsx` | Implemented · `a11y` |
| 20 | Workspace access | All | consented, read-only access requests | requested, granted, expired | `admin/SupportAccessStaff.tsx` | Locally verified (API tests) · `a11y` |
| 20 | Support queue | All | assign, reply, internal note | | `admin/SupportQueue.tsx` | Implemented · `a11y` |
| 21 | Providers | Admin + key | pause/resume with reason | key needed | `admin/OpsControls.tsx` | Locally verified (staffops.int) |
| 21 | Removal requests | Admin + key | approve/reject | | `admin/RemovalRequests.tsx` | Locally verified (erasure.int) |
| 22 | Approvals | Admin; Super Admin co-sign | request, decide (no self-approval) | pending, executed, failed | `admin/StaffAdmin.tsx` | Locally verified (staffops.int) |
| 22 | Staff | Admin (list), Super Admin (create Support) | directory | | `admin/StaffAdmin.tsx` | Locally verified · `staff` |
| 23 | Audit log | Admin | filters | | `admin/OpsControls.tsx` (AuditSearch) | Locally verified · `audit` |
| 23 | Security | All (keys: Admin/Super Admin) | keys, enrolment code for first key, step-up (5 min) | no key, key needed, confirmed | `admin/StaffSecurity.tsx`, `staff-ui.tsx` | Locally verified · `security` (virtual authenticator) |
