# MUSHIN Redesign Spec: Rollout Plan (remaining work)

## Context
The Professional Product Redesign Specification asks for a trustworthy, plain-language product: one vocabulary, visible credit costs, evidence behind every score, AI-estimated labels, freshness everywhere, and one consistent source of truth for plans and campaigns. Pricing (spec 20) is done and `src/app/lib/plans.ts` now holds the canonical plans. Three read-only audits found the rest of the app still violates the spec in many places. This plan covers everything else, in priority order (spec section 28: data consistency, claims, score evidence, estimated labels, credit visibility, terminology, sender identity come first).

Constraints: do not fabricate backend data (spec 30: use explicit "unavailable" states). Workspace was deliberately removed, so do not re-add the workspace switcher. Keep the dark visual language (`#0A0A0F`, `#7C5CFF`).

## Phase 0: Shared foundations (everything else depends on these)
New files under `src/app/lib/` and `src/app/components/shared/`:
- `lib/copy.ts`: canonical terminology constants (Search Existing Creators, Find New Creators, Refresh Creator Data, Audience Details, Creator Fit, Authenticity Signals, Suspicious Activity Signals, Add to List, In List, Priority Data Refresh). Import these instead of typing strings.
- `lib/credits.ts`: cost constants (search existing, find new, reveal contact, refresh), shared credit balance (replace the random-decrementing balance in `Dashboard.tsx:17-23`), plan credit cap read from `plans.ts` (replace hard-coded 100,000 in `Overview.tsx:223`, `Billing.tsx:76`).
- `lib/campaignStore.ts`: single campaign data source plus selectors (`creatorCount`, `stageCounts`, `confirmedOf`). Seed from the current `Campaigns.tsx` seed (lines 76-154).
- Components: `ScoreWithEvidence` (value + "Why this score?" popover, plus missing-data state), `FreshnessLabel` (extend `states.tsx` `FreshnessBadge` with refreshing, failed, "Data updated N days ago", unavailable), `CreditConfirm` (dialog: action + cost + Confirm/Cancel + insufficient-credits state, built on Radix Dialog), `AiEstimatedLabel`, `MetricTip` (tooltip definition). Reuse `states.tsx` `EmptyState`, `ErrorState`, `Spinner`; delete the shadowing local `EmptyState` in `Lists.tsx:488`.

## Phase 1: Critical (trust, consistency, claims)
1. **Campaign state consistency (spec 16).** Make `Campaigns.tsx`, `Overview.tsx:44-48`, `Analytics.tsx:28-46` and `NotificationCenter.tsx:32` read from `campaignStore`. Fix the known 7 / 0 / 24 / 18 / 12 / 108 mismatches. Normalize statuses to Draft / Active / Paused / Completed (remove "Live", "In review").
2. **Plan/billing consistency (spec 20).** `Billing.tsx`: plan name, price and credits from `PLANS`; invoices generated from plans (current Rs.139,600 is about 10x Growth). `Overview.tsx:295`, `NotificationCenter.tsx:35`, `AdminConsole.tsx:441`: replace Rs.24,500 with canonical Growth price. Fix the "12% remaining" vs "Healthy" credit contradiction.
3. **Landing claims (spec 21/22).** `components/landing/`: Hero rewrite to "Find, vet, and manage creators in one place."; FeatureTabs, Features, Metrics, FAQ, CTA and Footer copy per the audit table (remove "entire creator graph", bot detection, Creator IQ, AI-drafted outreach, SSO and audit-log claims, "Authentic" badges, unsupported footer links Status/Security/DPA). Mark sample numbers in FeatureTabs as "Sample". Remove unmounted dead files `Testimonial.tsx`, `Testimonials.tsx`, `TrustGrid.tsx`, `LogoCloud.tsx` (contain fabricated events and logos).
4. **Remove debug controls.** Delete the visible "Simulate error" checkbox at `SearchModule.tsx:665-673` and the random partial-failure in `runSearch`.

## Phase 2: High (search, profile, lists)
- **SearchModule.tsx:** rename modes to Search Existing Creators / Find New Creators with one-line explanations; placeholder + example "Pakistani fashion creators in Lahore"; make interpreted chips editable (remove X, edit value) without rewriting the query; replace live modal with `CreditConfirm`, CTA "Find new creators: X credits"; progress stages in plain language (drop "Enriching"); after 30s offer "Leave and notify me"; completion summary "N new creators found"; insufficient-credits state. Result cards and table: replace ER / Auth. / IQ with Followers, Engagement, Creator Fit, Authenticity Signals; add platform label, freshness, "Why this creator?" (reuse `fitSentence` in `data.ts:182`), real "Add to List" (toggle to "In List") and "Add to Campaign". Rename "MUSHIN score/IQ" sort and filters to Creator Fit; "Verified only" becomes "Platform-verified"; bulk "Save" becomes "Add to List".
- **CreatorProfilePanel.tsx:** Quick Summary (use `intel.recommendation`), "Creator Fit" replaces "MUSHIN Intelligence Score"/ScoreRing text; "Audience Details" with `AiEstimatedLabel` on age/gender/location; "Fake engagement detection" becomes "Authenticity Signals" using `ScoreWithEvidence` and neutral wording ("Some unusual growth patterns detected"), remove bare `{fake}%`; contact reveal through `CreditConfirm` with processing / unavailable / insufficient states, remove "Verified:" wording; freshness via `FreshnessLabel` plus Refresh with cost shown first (`runUpdate` states map to refreshing/failed); remove header "Save" for "Add to List"/"Add to Campaign" with real handlers; remove verified SVG unless a verifier source exists.
- **Compare.tsx:** rows become Creator Fit, Authenticity Signals (with evidence), Engagement; add Add to List / Add to Campaign.
- **Lists.tsx:** remove Avg auth, Est. reach, Fake %, Est. cost, "Verified bridal-fashion" seed copy; list card shows name, creator count, campaign, last updated; detail view becomes a table (Creator, Platform(s), Followers, Engagement, Authenticity Signals, Campaign, Added) with horizontal scroll and sticky creator column; empty state "No creators in this list yet" + "Add creators"; credit-spending bulk actions show total cost first.
- **data.ts:** remove "fake %" / "authenticity" reason wording; add evidence list and freshness status types (`unavailable` when no timestamp).

## Phase 3: Campaign detail and navigation
- **Campaigns.tsx:** progress = "X of N confirmed" (derived); dates with year; stages Identified / Contacted / Negotiating / Confirmed (map prospect/accepted; keep content stages as a secondary "content status", and Rejected as an outcome); Creators tab shows labels not raw enums; fee labelled Quoted / Agreed / Estimated derived from stage; timeline built from real state only (drop "report auto-generated"); ROAS/Response removed or shown with `MetricTip` definitions; empty campaign shows "No creators added to this campaign yet" + "Add creator".
- **Analytics.tsx:** make the date range actually filter (or remove it); axis units and legends; `MetricTip` definitions; fix "Confirmation rate" label; same stage vocabulary.
- **Sidebar / Topbar:** nav becomes exactly Search, Lists, Campaigns, Inbox, Analytics, Settings (Billing under Settings; Dashboard reachable via logo). Profile dropdown keeps Activity log and Support.
- **Overview.tsx:** primary actions "Start a Search", "Create a List", "Create a Campaign"; remove "events", "Enrichments", "creators verified", "Priority enrichment" (to "Priority data refresh"), "Search + enrichment pool". Same enrichment wording fixes in `Billing.tsx`, `ActivityLog.tsx`, `NotificationCenter.tsx`.

## Phase 4: Inbox (net-new, spec 18)
Add `Inbox.tsx` plus `inbox` in `DashView`. Connected mailbox banner "Sending from your connected Gmail account: x"; From / Via / To / Subject / Campaign / Status; sequence builder showing Initial / Follow-up 1 / Follow-up 2 with "stops on reply"; `optedOut` flag blocks enrollment with plain message. Add Gmail/Outlook connect card to `Settings.tsx` IntegrationsTab. Replace chat-style `MessagesTab` in `Campaigns.tsx:773-835`. Mock data only; no sending backend.

## Open product questions (assumptions I will use unless told otherwise)
1. Post-confirmation stages (Content pending, Posted, Completed, Rejected): keep as secondary status, not pipeline columns.
2. Sidebar drops "Dashboard" and "Credits & billing" to match the six-item spec.
3. Cost constants (search, find new = 12, reveal = 5, refresh = 10) are placeholders in `credits.ts`.
4. "14-day free trial", "rollover credits" and "Data Export" on Pricing stay until approved.

## Verification
- `npx tsc --noEmit` clean; start dev server and click through each screen at desktop and about 768px width.
- Grep gate: no `Simulate error`, `Fast search`, `Live search`, `Fake %`, `AVG AUTH`, `IQ`, `enrichment`, `SOC 2`, `uptime`, `events processed` in `src/app`.
- Manually run spec section 26 tasks: plain-language search; Find New Creators shows cost before confirm; contact reveal shows cost; Add to List toggles to In List; campaign counts identical on Overview / Creators / Pipeline / Timeline / Analytics; Billing and Pricing show same Growth price and credits; Inbox shows sender; opted-out creator cannot be enrolled.
