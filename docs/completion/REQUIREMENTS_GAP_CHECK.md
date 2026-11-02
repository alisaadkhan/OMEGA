# Requirements gap check: 2026-10-27

What a real customer needs from first visit to account deletion, checked against the code and the browser suite
(run 15: journey 108/108, break-it 40/40, after restart 54/54). "Done" means a test exercises it.

## Account lifecycle

| Step | State | Evidence / note |
|---|---|---|
| Sign up (new email) | done | neutral confirmation; browser AUTH-1..4 |
| Sign up (email already registered) | **fixed** (BUG-22) | same neutral answer, Sign in / Reset password offered; no enumeration |
| Duplicate workspace on retried first request | done | provisioning lock + recheck; 6 concurrent first requests → one workspace (`identity.int`) |
| Email confirmation, expired/used link, resend | done | journey `auth` checks |
| Sign in, session expiry message | done | journey |
| Forgot password | **fixed** | the page said "We've sent a recovery link" even when no account uses the address (Supabase sends nothing then); now "If … has a MUSHIN account, we've sent it a recovery link" |
| Change password (signed in) | **gap: owner action** | the current password is not asked. A UI check would not stop a stolen session (the Auth API can be called directly). Fix: turn on Supabase **Secure password change** (requires a recent sign-in) in the dashboard. SF-19 |
| Change email address | **gap: decision** | no way to change the sign-in email. Options below |
| Sign out, sign out other devices | done | journey; sidebar Sign out added |
| Delete account / workspace, export | done | journey privacy checks; erasure covers new tables (BUG-15) |

## Team and invitations

| Case | State |
|---|---|
| Invite, accept, expired, revoked, wrong address, address not confirmed | done (`team.int`, journey) |
| Addresses compared case-insensitively | done (invite lower-cased; acceptance uses the Auth server's confirmed address) |
| Re-invite after expiry | done (expired invite replaced; a live one must be revoked first) |
| Invitation **email** | not sent by design: the link is shown once to the inviter (no email provider authorised for this). Decision needed if invitations should be emailed |
| Removed member loses access at once | done (journey: 403 on the next request) |

## Billing

| Case | State |
|---|---|
| Plans, checkout (mock), double-click Pay, credit lots | done (journey, PAY-1/2) |
| Concurrent searches never overcharge, never negative | done (CRD-1..3) |
| **Search with zero results** | **conflict, unchanged**: charged 50 credits under the current rule (`search-charge.ts`; the integration test relies on it) |

Options for zero-result searches (owner decides; nothing changed):

1. Keep charging; say before confirming that a search with no results still costs its price.
2. Charge nothing when a search returns no results (small change in `chargeCatalogSearch`: charge after the search
   only when `total > 0`; tests updated). Risk: probing many empty queries for free.
3. Charge a reduced price for zero results (needs a new price key and UI copy).

Options for changing the sign-in email:

1. Not offered (current): the person creates a new account and the owner re-invites it.
2. Supabase `updateUser({ email })` with "Secure email change" (confirmation on both addresses), plus updating the
   workspace member's stored email. Needs approval: it is a new authentication flow.

## Brand

- On-screen text now says MUSHIN everywhere. **Outreach emails still say "<workspace> via Roster"** and come from the
  configured Roster sender address: the sending identity is the owner's call (`apps/api/src/modules/outreach/compose.ts`).

## Not done (blocked or deferred)

| Item | Why |
|---|---|
| Live Gemini smoke test (GEM-06) | needs the key and approval for a paid call |
| Semantic niche accuracy vs human labels (NIC-16) | needs two raters on `review-mushin_catalog_v3.csv` |
| Azure staging worker (AZ-01) | needs `az` CLI, `az login`, staging env file; Docker not running |
| Creator claims (CLM-01) | needs a live profile fetch (paid/gated) and consent wording from counsel |
| YouTube content evidence, Live Discovery YouTube | gated off pending the policy decision |
| Meilisearch | stopped for low memory; not restarted (owner instruction) |
| Context7 docs plugin | needs authentication |
| Frontend: campaign sub-screens (timeline, analytics, settings, terms drawer), support desk split view, notifications page, creator quick-view and save-to-shortlist panels | paused by owner ("forget front end for now"); these pages already use the new tokens, fonts and card style |
