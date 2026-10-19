# Interaction flows

Each flow lists the steps, the server decision at each step, and every exit. Server responses are authoritative; the UI
never predicts a charge or a permission.

## 1. Sign-up and first use
1. `#/signup`: name, email, password, consent (unticked) → Supabase sign-up (PKCE).
2. Confirmation required → "Check your inbox". Link → `#/confirmed`:
   - same browser → signed in → [Continue] → dashboard;
   - other browser → "Your email is confirmed" → [Sign in];
   - expired/used → reason + [Send a new confirmation link].
3. First dashboard load provisions the workspace and starts the 14-day, 200-credit trial (once per person, server rule).
4. If the current Terms version is not recorded → Terms dialog (must tick; closes only after the server stored it).

## 2. Sign-in, session expiry, sign-out
Sign in → dashboard. Expired session: the API answers 401 → one refresh attempt by the Supabase client → refused → signed
out → `#/login` (no retry loop; E2E `auth`). Sign-out clears the session and query cache.

## 3. Password recovery
`#/forgot` → same confirmation whether or not the account exists → email link → `#/reset-password` (code exchanged) → new
password ×2 → "Saving…" → dashboard. Used/expired link → reason + [Request a new link]. Verified with real Auth on the
local Supabase stack (recovery-check 10/10).

## 4. Workspace switching and invitations
- Switcher selects per tab (sessionStorage). Every request sends `X-Workspace-Id`; a workspace the person no longer
  belongs to → 403 `workspace_access_denied` → selection cleared, notice shown.
- Invitation `#/invite/<token>`: preview → accept (server checks the Auth server's confirmed email, not user metadata) →
  switch to that workspace. Wrong email, expired, revoked, used each have their own message.

## 5. Catalogue search (Brain 1)
Query + filters → [Search · 50 cr] → server charges once per logical search (repeat within 30 minutes free; empty results
currently charged, decision D-05) → results or "No creators match" with [Find new creators]. Insufficient credits / no
plan / rate limited → specific messages; input kept. Relevance is **not accepted** (human ratings pending).

## 6. Find New Creators (Brain 2)
Brief → `POST /v1/discovery/estimates` (missing requirements returned as messages) → quote (maximum, TikTok minimum,
expiry) → [Confirm] → `POST /v1/discovery/jobs` holds the maximum → one run per workspace (second brief → 409 with the
running job) → worker stages shown from the server → terminal outcome: delivered (50 + 10 per new creator, never above the
quote), nothing delivered (0), failed (0), cancelled (charged for delivered), stopped by deadline/cost cap. Paid
providers are blank in all local testing: only the refund paths are exercised.

## 7. Creator profile and contact reveal
Open profile → evidence with source and freshness; ineligible creators explained → [Reveal · 5 cr] (permission and
availability checked by the server; denied or unavailable costs 0) → value shown with who/when.

## 8. Lists and campaigns
Save to list (create inline) → list detail (note, favourite, remove) → select all → [Add to campaign] → campaign detail:
stage, fee (PKR), declined; open-campaign limit per plan (Starter 3) → limit reached message. Concurrent edits use
versions; a stale edit gets "changed by someone else — reload".

## 9. Outreach
Per creator: log channel and outcome (manual; MUSHIN sends nothing) or, when the plan and server switch allow, email in
test mode (recorded, never delivered locally).

## 10. Credits and billing
Plans and prices from `/v1/billing/plans` → [Choose] (Owner/Admin; D-06 may restrict to Owner) → checkout (test page in
development: "Test mode: no real payment") → webhook applied by the worker → billing shows "activating…" until the plan
is active. Top-ups never expire; monthly credits end at renewal.

## 11. Data rights
Export (Owner/Admin) → JSON download; tables cut at 50,000 rows are named and warned. Delete workspace (typed name; blocked
by a paid subscription or running work). Delete account (typed email) → sign-in identity removed at Supabase Auth, outcome
reported. Billing records retained.

## 12. Staff console
Password → TOTP → console. Admin actions → step-up with the security key (5 minutes, checked server-side) → action with a
reason → audited. First key needs the one-time enrolment code from the CLI. Approvals: request → another person decides
(no self-approval; Super Admin co-sign where required) → executed/failed shown. Test alert → webhook (or server log).

## 13. Failures and recovery (all flows)
Offline → banner; actions fail without charge. Service degraded (`/health/ready` 503) → banner. Server error → message
with request id. Page error → "This page could not be shown" + reload. Unknown address → "Page not found".
