# MUSHIN 2.0 — Professional Product Redesign: Implementation Plan

## Context

This plan implements the full MUSHIN Professional Product Redesign Specification across the frontend codebase. The goal is to make MUSHIN feel like a trustworthy business tool by: fixing fabricated/hardcoded data presented as real, replacing internal-engineering terminology with customer language, wiring all campaign views to a single state source, and ensuring every AI-derived value is labeled as estimated with evidence available.

**Phase 0 is already complete.** All eight foundation files exist:
- `src/app/lib/copy.ts` — canonical COPY / METRIC_HELP constants
- `src/app/lib/credits.ts` — CREDIT_COST, useCredits, spendCredits, CURRENT_PLAN
- `src/app/lib/campaignStore.ts` — useCampaigns, STAGES, helpers
- `src/app/components/shared/ScoreWithEvidence.tsx`
- `src/app/components/shared/FreshnessLabel.tsx`
- `src/app/components/shared/CreditConfirm.tsx`
- `src/app/components/shared/AiEstimatedLabel.tsx`
- `src/app/components/shared/MetricTip.tsx`

The work below is Phases 1–4. Execute in order; later phases depend on earlier foundations.

---

## Phase 1 — Critical (trust, consistency, hardcoded data)

### `src/app/components/dashboard/Dashboard.tsx`
- **Remove** the `setInterval` (lines 20–23) that auto-decrements `credits` every 4.2 s. This fabricates live activity. Credits should only change when a real action is confirmed via `CreditConfirm`.

### `src/app/components/dashboard/Billing.tsx`
- Add `import { PLANS, Plan } from "../../lib/plans"; import { CURRENT_PLAN } from "../../lib/credits"; import { COPY } from "../../lib/copy";`
- Replace `cap = 100000` → `cap = CURRENT_PLAN.credits` (gives 12,000 for Growth)
- Replace hardcoded plan name `"Growth"` → `CURRENT_PLAN.name`
- Replace hardcoded monthly price `"Rs. 24,500"` → `Rs. ${CURRENT_PLAN.monthly.toLocaleString()}`
- In `OP_META` labels: `"Fast search"` → `COPY.searchExisting`; `"Live discovery"` → `COPY.findNew`; `"Profile update"` → `COPY.refreshData`

### `src/app/components/dashboard/Overview.tsx`
- Add `import { useCampaigns } from "../../lib/campaignStore"; import { CURRENT_PLAN } from "../../lib/credits"; import { COPY } from "../../lib/copy";`
- Remove local static `campaigns` array; replace with `const campaigns = useCampaigns();` — derive campaign summary cards from live store data
- In `SubscriptionCard`: hardcoded price `"Rs. 24,500"` → `Rs. ${CURRENT_PLAN.monthly.toLocaleString()}`; plan name `"Growth · Monthly"` → `${CURRENT_PLAN.name} · Monthly`
- In `SubscriptionCard` feature bullets: `"Bot detection & IQ scoring"` → `COPY.suspiciousActivity`; `"Priority enrichment"` → `COPY.priorityRefresh`
- In `CreditBalanceCard`: `max = 100000` → `max = CURRENT_PLAN.credits`
- Activity feed item: `"5 creators verified in 'Bridal Lahore Q3'"` → `"5 creators reviewed in 'Bridal Lahore Q3'"`

### `src/app/components/dashboard/Campaigns.tsx`
- Add `import { useCampaigns, setCampaigns, Campaign, CampaignCreator, PipelineStage, STAGES, STATUS_LABEL, FEE_LABEL, feeKindFor, progressLabel, progressRatio, formatDate } from "../../lib/campaignStore";`
- Remove local type declarations (`Status`, `Platform`, `PipelineStage`, `CampaignCreator`, `Campaign`) and seed data array
- Replace local `useState(seed)` with `const campaigns = useCampaigns();` — mutations call `setCampaigns(prev => ...)`
- Pipeline kanban: replace local 8-stage array with `STAGES` (identified/contacted/negotiating/confirmed) — 4 canonical columns only
- **Fix "Contacted" stat** (line 215): count only creators whose `stage` is `"contacted"` or later, not all creators in all campaigns
- **Fix ROAS/Response averages**: exclude campaigns with `status === "draft"` from the average denominators
- Use `progressLabel(campaign)` and `progressRatio(campaign)` from campaignStore for campaign cards
- Use `FEE_LABEL[feeKindFor(stage)]` to label fee fields per creator pipeline stage
- Remove "Accepted", "Content", "Posted", "Rejected" stage references entirely

### `src/app/components/dashboard/SearchModule.tsx` — terminology + debug
- Add `import { COPY, METRIC_HELP } from "../../lib/copy"; import { CREDIT_COST } from "../../lib/credits"; import { CreditConfirm } from "../shared/CreditConfirm"; import { MetricTip } from "../shared/MetricTip";`
- Button label: `"Fast search"` → `COPY.searchExisting`; `"Live search"` → `COPY.findNew`
- Loading banner text: `"Live search · querying platforms…"` → `COPY.findNew + " · querying platforms…"`; `"Fast search · streaming…"` → `COPY.searchExisting + " · streaming…"`
- Sort label: `"Relevance (MUSHIN IQ)"` → `"Relevance (Creator Fit score)"`
- **Remove Simulate error UI**: delete `triggerError` state, the `<label>` checkbox block (lines 668–674), and the `if (triggerError)` branch inside `runSearch`
- **Replace live-warn modal** with `<CreditConfirm>`: add `creditConfirmOpen` state; "Find New Creators" button → `setCreditConfirmOpen(true)`; remove `showLiveWarn` state and its modal block; add `<CreditConfirm open={creditConfirmOpen} onOpenChange={setCreditConfirmOpen} action={COPY.findNew} cost={CREDIT_COST.findNew} onConfirm={() => runSearch("live")} />`
- Loading progress stage label `"Enriching"` → `"Refreshing creator data"`

### `src/app/components/dashboard/Sidebar.tsx`
- Change group label `"Discover"` → remove the label entirely (or use `"Workspace"`)
- Add Inbox to nav: `{ id: "inbox", label: "Inbox", icon: Mail }` (import `Mail` from lucide-react) — insert after Campaigns
- Move Analytics from Topbar profile-dropdown into the sidebar nav: `{ id: "analytics", label: "Analytics", icon: BarChart3 }` (import `BarChart3`)
- The DashView type already includes `"inbox"` and `"analytics"` — no type changes needed

---

## Phase 2 — Creator Profile, Lists, Search Cards

### `src/app/components/dashboard/CreatorProfilePanel.tsx`
- Add imports: `ScoreWithEvidence`, `FreshnessLabel`, `CreditConfirm`, `AiEstimatedLabel`, `MetricTip` from shared; `COPY`, `METRIC_HELP` from lib/copy; `CREDIT_COST` from lib/credits
- **Section title** (line ~337): `"Audience demographics"` → `COPY.audienceDetails` ("Audience Details")
- **Audience subtitle**: replace bare date string with `<AiEstimatedLabel />` inline + `<FreshnessLabel>` for the date
- **Age/Gender SourceBadge**: replace `<SourceBadge kind="estimated" />` and `<SourceBadge kind={...} />` with `<AiEstimatedLabel />` on each row
- **Remove hardcoded sub-scores**: "Content consistency: 82" and "Brand safety: 94" (lines 281–283) are identical for every creator — remove these two tiles entirely; they present fake per-creator data
- **Remove hardcoded Est. CPE**: "Est. CPE: Rs. 42" (line 296) is identical for every creator — remove this tile
- **Engagement integrity chart**: the SVG path is a static decorative curve identical for all creators — replace the entire `<svg>` block with an `<Unavailable>` state: `"Engagement history unavailable — appears once platform data is connected."`
- **ScoreWithEvidence for main scores**: wrap the Creator Fit score and Authenticity score renders with `<ScoreWithEvidence value={...} label={...} definition={METRIC_HELP.creatorFit / .authenticity} evidence={intel.recommendation.pros / .watchOuts} />`
- **FreshnessLabel in header**: replace `<FreshnessBadge>` with `<FreshnessLabel state={...} updated={intel.lastUpdated} onRefresh={() => setRefreshConfirmOpen(true)} refreshCost={CREDIT_COST.refreshData} />`; add `refreshConfirmOpen` state + `<CreditConfirm>` for refresh action
- **Reveal contact via CreditConfirm**: the "Reveal contact information" button sets `revealConfirmOpen(true)`; add `<CreditConfirm open={revealConfirmOpen} onOpenChange={setRevealConfirmOpen} action={COPY.revealContact} cost={CREDIT_COST.revealContact} onConfirm={() => setRevealed(true)} />`
- Add `<MetricTip metric="engagement">` wrapper around the engagement rate label

### `src/app/components/dashboard/Lists.tsx`
- Remove "Fake %" stat tile (line 623): hardcoded `"5.4%"` — delete entire tile
- Remove "Est. cost" stat tile (line 625): hardcoded `"Rs. 4.2L"` — delete
- Remove "Avg ER" stat tile (line 622): hardcoded `"6.1%"` — delete
- Remove per-creator `"Auth"` MiniMetric column from list detail table — the raw auth integer belongs only in the full profile panel with context
- Keep `avgAuth` data field; remove all JSX that renders "Avg auth" as a displayed metric

### `src/app/components/dashboard/SearchModule.tsx` — result cards (Phase 2 continuation)
- Creator card score badge: replace `IQ {creator.score}` → `Fit {creator.score}` (or use `ScoreWithEvidence` component inline in compact mode)
- Creator card metric label: `"Auth."` → `"Auth. Signals"` with a `<MetricTip metric="authenticity">` wrapper

---

## Phase 3 — Analytics, Landing Terminology, FeatureTabs

### `src/app/components/dashboard/Analytics.tsx`
- Add `import { useCampaigns, stageCounts, totalCreators as totalC } from "../../lib/campaignStore";`
- Replace all static hardcoded chart arrays with live data derived from `useCampaigns()`:
  - `creatorsByStage` → `stageCounts(campaigns).map(s => ({ stage: s.label, count: s.count }))`
  - `campaignStatus` → derived from `campaigns.filter(c => c.status === ...)` per status
  - `budget` → `campaigns.map(c => ({ campaign: c.name.slice(0,12), planned: c.budget, committed: c.spent }))`
  - Stat tiles: `totalCreators`, `totalCampaigns`, `totalPlanned`, `totalCommitted` — derived from live campaigns
- Fix stage label: `"Shortlisted"` → `"Identified"` (match campaignStore STAGES)
- StatTile sub-text: `"Confirmed ÷ shortlisted"` → `"Confirmed ÷ total in pipeline"`
- Date range selector: either (a) wire it to filter the derived data, or (b) hide the selector with a `<Unavailable>` note "Date filtering available once outreach tracking is connected" — option (b) is honest and requires zero extra code
- Add `<Legend />` to the creators-by-stage BarChart

### `src/app/components/landing/Features.tsx`
- Feature card 2 title: `"AI bot detection"` → `"Suspicious Activity Signals"`; desc: remove "fake followers" → `"Surface unusual follower growth, engagement patterns, and anomalies worth reviewing — signals to investigate, not verdicts."`
- Feature card 3 title: `"Creator IQ score"` → `"Creator Fit Score"`; desc: `"A proprietary score for influence quality…"` → `"A score for how closely a creator matches your campaign. Each score includes a reasoning panel so you can see what contributed."`
- Feature card 4 title: `"AI enrichment & insights"` → `"Refresh creator data"`; desc: `"Audience demographics…"` → `"Audience Details (AI-estimated), growth history, niche analysis, and summaries — labeled by confidence level."`

### `src/app/components/landing/FeatureTabs.tsx`
- Tab labels: `"Discover"` → `"Search"`, `"Analyze"` → `"Signals"`, `"Manage"` → `"Campaigns"`, `"Email"` → `"Outreach"`
- Discover tab headline: `"Search Pakistan's entire creator graph…"` → `"Find Pakistan-based creators across Instagram, TikTok & YouTube with precise filters."`
- Analyze tab body: `"Detect bot followers, engagement pods, and suspicious spikes. The Mushin IQ score distills creator quality into one trustworthy number."` → `"Review Suspicious Activity Signals — unusual follower patterns and engagement anomalies worth investigating before you commit budget."`
- `AnalyzePreview`: Replace `<CheckCircle2 /> Authentic` badge → `<ShieldCheck /> Signals reviewed`
- `AnalyzePreview`: `"Creator IQ"` text → `"Creator Fit"`; SVG ring label `"IQ SCORE"` → `"FIT SCORE"`
- `DiscoverPreview`: `"Sorted by IQ"` → `"Sorted by Creator Fit"`; `"IQ {c.iq}"` → `"Fit {c.iq}"`
- `ManagePreview` kanban stages: `["Sourced", "Outreached", "Negotiating", "Live"]` → `["Identified", "Contacted", "Negotiating", "Confirmed"]`

### `src/app/components/landing/FAQ.tsx`
- Line 26: `"Credits are spent on searches, enrichments, and workspace events."` → `"Credits are used for searches, data refreshes, and contact reveals."`

---

## Phase 4 — Inbox (already largely complete)

Audit confirmed `Inbox.tsx` already implements:
- Connected mailbox banner (Gmail/Outlook identity)
- From/Via/To fields in the drawer
- Opted-out creator blocking

**No changes needed for Phase 4 core requirements.** Deferred enhancements (sequence step editing, bulk-consent controls) are out of scope for this release.

---

## Strings to change at a glance

| File | Old | New |
|---|---|---|
| `Dashboard.tsx` | `setInterval` credit decrement | Remove entirely |
| `Billing.tsx` | `cap = 100000` | `CURRENT_PLAN.credits` |
| `Billing.tsx` | `"Fast search"` / `"Live discovery"` | `COPY.searchExisting` / `COPY.findNew` |
| `Overview.tsx` | `"Rs. 24,500"` | `CURRENT_PLAN.monthly` |
| `Overview.tsx` | `"Bot detection & IQ scoring"` | `COPY.suspiciousActivity` |
| `Overview.tsx` | `"Priority enrichment"` | `COPY.priorityRefresh` |
| `Overview.tsx` | `"5 creators verified"` | `"5 creators reviewed"` |
| `Campaigns.tsx` | Local seed + 8 pipeline stages | `useCampaigns()` + 4 STAGES |
| `SearchModule.tsx` | `"Fast search"` button | `COPY.searchExisting` |
| `SearchModule.tsx` | `"Live search"` button / modal | `COPY.findNew` + `<CreditConfirm>` |
| `SearchModule.tsx` | Simulate error checkbox | Remove |
| `SearchModule.tsx` | `"MUSHIN IQ"` sort label | `"Creator Fit score"` |
| `Sidebar.tsx` | `"Discover"` group header | Remove label / add Inbox + Analytics items |
| `CreatorProfilePanel.tsx` | `"Audience demographics"` | `COPY.audienceDetails` |
| `CreatorProfilePanel.tsx` | `SourceBadge` on audience fields | `<AiEstimatedLabel />` |
| `CreatorProfilePanel.tsx` | Hardcoded 82 / 94 sub-scores | Remove both tiles |
| `CreatorProfilePanel.tsx` | `"Est. CPE: Rs. 42"` | Remove tile |
| `CreatorProfilePanel.tsx` | Static decorative SVG chart | `<Unavailable>` state |
| `CreatorProfilePanel.tsx` | Bare score renders | `<ScoreWithEvidence>` |
| `Lists.tsx` | `"Fake %"`, `"Est. cost"`, `"Avg ER"` tiles | Remove all three |
| `Lists.tsx` | `"Auth"` per-creator column | Remove |
| `Analytics.tsx` | Static chart arrays | `useCampaigns()` derived data |
| `Analytics.tsx` | `"Shortlisted"` stage label | `"Identified"` |
| `Analytics.tsx` | `"Confirmed ÷ shortlisted"` | `"Confirmed ÷ total in pipeline"` |
| `Features.tsx` | `"AI bot detection"` | `"Suspicious Activity Signals"` |
| `Features.tsx` | `"Creator IQ score"` | `"Creator Fit Score"` |
| `Features.tsx` | `"AI enrichment & insights"` | `"Refresh creator data"` |
| `FeatureTabs.tsx` | Tab labels Discover/Analyze/Manage/Email | Search/Signals/Campaigns/Outreach |
| `FeatureTabs.tsx` | `"entire creator graph"` | `"Find Pakistan-based creators…"` |
| `FeatureTabs.tsx` | `"Detect bot followers… IQ score"` | Suspicious Activity Signals copy |
| `FeatureTabs.tsx` | `CheckCircle2 "Authentic"` | `ShieldCheck "Signals reviewed"` |
| `FeatureTabs.tsx` | `"IQ SCORE"` / `"IQ {c.iq}"` | `"FIT SCORE"` / `"Fit {c.iq}"` |
| `FeatureTabs.tsx` | Stages Sourced/Outreached/Live | Identified/Contacted/Confirmed |
| `FAQ.tsx` | `"enrichments"` | `"data refreshes"` |

---

## Verification

After implementation:

1. **TypeScript**: `npx tsc --noEmit` — must be clean (no new errors)
2. **Forbidden-string grep** (must return empty):
   ```
   grep -rn "Simulate error\|Fast search\|Live search\|Live discovery\|enrichment\|Audience demographics\|IQ score\|IQ {c\|MUSHIN IQ\|Bot detection\|Fake %\|Avg auth\|Discover\b.*group\|entire creator graph" src/app/components/
   ```
3. **Campaign count consistency**: Open Campaigns → note creator count for "Eid Sale 2026" → open Overview → confirm same count → open Analytics → confirm derived data matches
4. **Credit confirm flow**: In SearchModule, click "Find New Creators" → CreditConfirm dialog must appear with cost before any search runs
5. **Billing plan match**: Billing.tsx credit cap and plan name must match Growth plan in plans.ts (12,000 credits, Rs. 12,900/mo)
6. **Audience section**: Open any creator profile → "Audience Details" section header → each row has AiEstimatedLabel badge
7. **No fabricated progress**: Open Overview → credit balance must be static (no auto-decrement)
8. **Spec §26 task walkthrough**: manually complete the 10 first-time-user tasks listed in the spec
