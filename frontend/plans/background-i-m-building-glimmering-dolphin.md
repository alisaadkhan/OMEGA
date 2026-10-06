# MUSHIN — Implement the UI & Product Experience Specification

## Context

MUSHIN is an AI-powered creator-intelligence SaaS (Pakistan-first). A new source-of-truth
document — `src/imports/MUSHIN_UI_Product_Experience_Specification.docx` (v1.0) — consolidates the
SRS, the prior backend-led frontend plan, the Figma reference, and newer product decisions into a
single page-by-page UX contract. The app already exists as a **static mock prototype** (91 TS/TSX
files: landing page, auth, a full dashboard shell with 9 views, and a separate admin portal). The
job is to bring the existing prototype into conformance with the spec — page by page, component by
component, workflow by workflow — **without reinventing the visual system** and **without inventing
fake data or claiming features that don't exist**.

The spec's core philosophy (§1, §29, §30): *Decision-first, no fake data, no hidden uncertainty.*
Every important screen must expose loading / empty / error / partial / stale / unavailable /
permission / credit-blocked states, mark data freshness and trust honestly, and never show fake
counts, accuracy %, reviews, testimonials, or activity.

## Two decisions to confirm (I could not get a clarifying answer through)

1. **Theme.** The *live code* is light (`bg-white`, `slate-*`). Your notes and
   `mushin-design-system.md` describe a *dark* palette (`#07090D`/`#0A0A0F`, accent `#7C5CFF`,
   glass). The spec docx only says "preserve the existing visual system" — it does not mandate a
   color scheme. **Default taken in this plan: preserve the currently-implemented theme** (least
   destructive, reversible) and build every new feature theme-agnostically using existing utility
   patterns. If you actually want dark, that is a separate, larger restyle pass — tell me and I'll
   scope it.
2. **"No fake data" vs. a backend-less prototype.** There is no backend; the spec's "connect to
   real backend where available" resolves to *nowhere available yet*. **Interpretation taken:**
   keep the mock/seed data (so screens remain demonstrable) but (a) label it honestly with the
   spec's state/freshness/trust vocabulary, (b) remove unsupported *claims* (fake accuracy %,
   testimonials, fabricated recent-activity as if real, precise demographic "facts"), and (c) drive
   every new state machine locally so the UI shape is correct the day a backend arrives.

## Guiding constraints (apply everywhere)

- Reuse the existing shared primitives in `src/app/components/ui/*` (Badge, Skeleton, Dialog,
  Tabs, Table, etc.) and the toast/confirm helpers in `src/app/lib/toast.tsx`.
- Preserve the token contract in `src/styles/theme.css` / `index.css` (`--background`,
  `--foreground`, `--border`, `@theme inline`) — do not break `bg-background`/`text-foreground`.
- Never expose provider names (Groq/Apify/Serper) to non-admin users (§1, §20).
- Keep the admin portal (`#/admin/*`) visually and structurally separate (§25).

---

## Recommended sequencing — do **P0 first** (spec §31)

The spec is ~29 screens; land the P0 decision-critical surface first, then P1. P2/P3 (creator-side
product, reputation, protected deals) must stay **Future** — shown only as clearly-labeled
"Coming soon", never as live (§15–17, §29).

### Foundation (do before the screens — small, high-leverage)

- **Shared state primitives** — create one module `src/app/components/dashboard/states.tsx`
  exporting reusable `<LoadingBlock/>` (skeleton), `<EmptyState/>`, `<ErrorState/>` (Retry),
  `<Unavailable/>`, and freshness/trust badge components. Today each screen re-implements
  `EmptyState`/`Skeleton` locally (Overview, Lists, Campaigns, NotificationCenter). Consolidate so
  §23 global states are consistent. Wire `ErrorPage.tsx` presets into the dashboard render path.
- **Shared mock data module** — `src/app/components/dashboard/data.ts`: a single `Creator[]` (with
  new fields below) plus lists/campaigns seeds, replacing the divergent per-file arrays in
  `SearchModule.tsx`, `Lists.tsx`, `Campaigns.tsx`. Extend the `Creator` type
  (in `CreatorProfilePanel.tsx`) with: per-field `freshness` (`current|aging|stale|unavailable`)
  + `lastUpdated`, `audience` demographics each tagged `verified|estimated|public|unavailable|stale`
  + `confidence`, and `contact` objects (email/phone) each with a trust `state`
  (`unverified|contactable|verified|stale|invalid|creator_confirmed`) + `source`/`firstSeen`/
  `lastSeen`/`lastVerified`.

### P0 screens

1. **Workspace onboarding (§5.3) — NEW.** Add route `onboarding` in `App.tsx` and a
   `components/auth/WorkspaceOnboarding.tsx` (reuse `AuthShell`). Signup → onboarding →
   dashboard. Store active workspace in `AuthContext`. Add session-problem handling (§5.4):
   expired → login, missing workspace → onboarding, forbidden → explain.
2. **Dashboard / Overview (§6)** — add inline AI **search entry box** (opens Search), and a
   **data-freshness notice** card driven by creators with `stale` fields. Mark the activity feed as
   prototype data (or gate behind "no real events yet" empty state) per "never show fake activity".
3. **Creator Search (§7)** — in `SearchModule.tsx`:
   - **AI interpretation step**: parse the natural-language query into *editable interpreted chips*
     (platform/city/niche/follower range/engagement/audience) shown **before** applying, distinct
     from manual filters. Make the query actually drive results.
   - Add missing filters: niche, country/province, language, contact availability, freshness.
   - Make **Sort** functional (relevance/followers/engagement/freshness) and **Save search** real
     (local persisted presets).
   - **Live Discovery streaming (§7.3)**: use the already-typed `"streaming"` status — stream
     result cards incrementally with a live "creators found" counter, per-creator enrichment
     progress, and **partial completion** (some succeed / some fail, no fabricated fields).
   - Result card (§7.4): add fit sentence, freshness + last-update, audience "Estimated/Verified/
     Unavailable" markers, contact trust state, and honest authenticity signal (no "perfect fraud
     detection"). Wire the dead bulk actions (Add to list / Compare / Save).
4. **Creator Profile (§8)** — in `CreatorProfilePanel.tsx`:
   - Header: platform out-links, size label, verification, **last-updated in header**.
   - **Update Info button (§8.2)** with full state machine: current / updating (disabled) /
     updated (new timestamp) / no-changes / partial (which fields updated vs unavailable) /
     failed (keep old data, never blank).
   - **Per-field freshness (§8.3)** badges: current/aging/stale/unavailable.
   - **Audience demographics (§8.4)** from data, each with verified/estimated/public/unavailable/
     stale + confidence (e.g. "Age 18–24 41% — Estimated, medium confidence").
   - **Contact trust (§8.5–8.6)**: six states, reveal shows credit cost first, source/date/
     evidence after; honest note that one delivery ≠ creator-confirmed; safety-block explanation.
   - **Intelligence/recommendation (§8.7)**: narrative Campaign-fit + Pros + Watch-outs +
     recommendation reason (real factors), plus Compare link.
5. **Compare Creators (§9) — NEW.** `components/dashboard/Compare.tsx`: 2–5 creators, campaign
   criteria pinned at top, same fields per creator, highlight meaningful diffs, no universal
   "winner", open-profile link. Reachable from Search bulk bar and Profile.
6. **Lists (§10) — upgrade.** List detail: creators as **cards** (spec) with per-creator
   **notes/tags**, add **Move to another list**, add **Rename** on the Lists page.
7. **Global states (§23) + notifications (§24)** — apply the shared primitives across every screen;
   error messages say what to do next; provider/request IDs only in expandable details for support.

### P1 screens

8. **Campaigns (§11)** — add a real **Create Campaign form** (name, client, objective, budget,
   dates, creator criteria) before opening the draft; add per-creator **tasks** and **notes**;
   Campaign Outcome recorded without claiming automated performance unless present.
9. **Analytics (§12) — NEW standalone view.** Add `analytics` to `DashView`
   (`Sidebar.tsx`) + `Dashboard.tsx`. Real-only numbers: campaign count/status, creators by stage,
   budget planned vs committed, outreach results *if present*, else explicit **empty/unavailable**
   states. Use `recharts` (already installed; the shadcn `chart.tsx` wrapper exists) rather than
   hand-drawn SVG, with text summaries for a11y (§28).
10. **Billing & Credits (§13)** — split concerns within "Credits & billing": add a **credit-use
    log tied to the operation** (bridge to `ActivityLog` semantics), a **reserved-credits** concept
    for a running live search, and **reservation release** on failure/partial (§13.2, §22).
    Fix the USD/PKR inconsistency → PKR throughout.
11. **Settings (§14)** — add an **AI Settings** section (only controls that exist; no provider
    exposure) and a **Data & Privacy** creator-erasure request path (distinct from owner-PII).

### Marketing site (§4) — light touch

- Audit `Hero`, `Metrics`, `Testimonials`, `TrustGrid`, `Pricing`, `FeatureTabs` and **remove any
  unsupported numbers / accuracy claims / testimonials** (§4, §29). Keep the four-step
  Discover→Analyze→Compare→Manage flow; ensure all footer links resolve.

### Keep as Future (do NOT build live) — §15–17, §29

Creator-side dashboard, profile-claim, opportunities, messages, deals, reputation, brand
reputation, protected-deal flow. If surfaced in nav at all, show a clear **Coming soon** state.

---

## Critical files

- Routing/shell: `src/app/App.tsx`, `components/dashboard/Dashboard.tsx`,
  `components/dashboard/Sidebar.tsx`, `components/dashboard/Topbar.tsx`.
- New: `components/dashboard/states.tsx`, `components/dashboard/data.ts`,
  `components/dashboard/Compare.tsx`, `components/dashboard/Analytics.tsx`,
  `components/auth/WorkspaceOnboarding.tsx`.
- Heavy edits: `SearchModule.tsx`, `CreatorProfilePanel.tsx`, `Lists.tsx`, `Campaigns.tsx`,
  `Billing.tsx`, `Settings.tsx`, `Overview.tsx`, `auth/AuthContext.tsx`.
- Reuse: `components/ui/*`, `lib/toast.tsx`, `components/dashboard/ErrorPage.tsx`,
  `components/dashboard/ActivityLog.tsx`, `components/dashboard/NotificationCenter.tsx`.

## Verification

- After each screen: run the dev build / typecheck (no TS errors), and click through the flow in
  the running app (use the `run` skill / preview) to confirm the render.
- Flow checks: signup → **onboarding** → dashboard; Search → interpreted chips edit → Fast results
  → Live Discovery streaming + partial; open Profile → Update Info through all six outcomes →
  contact reveal with cost → recommendation; Search → select 2–5 → **Compare**; Lists rename +
  card notes + move; Create Campaign form → tasks/notes; Analytics empty vs populated; Credits
  reservation on live search then release on failure.
- State sweep: for each screen confirm loading / empty / error / partial / stale / unavailable /
  permission / credit-blocked render (§23, §30 checklist).
- Grep sweep: no provider names (Groq/Apify/Serper) reachable by non-admins; no residual fake
  accuracy %/testimonials on marketing.
