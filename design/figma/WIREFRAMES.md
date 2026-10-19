# Wireframes (layout guidance)

Text wireframes of every screen as built. Boxes are regions, top to bottom; `[ ]` is a control, `( )` a chip/badge,
`{ }` data from the server. Desktop first (1280–1440), then the changes at 768 and 390. The real screens are the
reference: open them locally (RUNBOOK §1) while building frames.

## 02 Landing (`#/`)

```
[Navbar: Logo · Platform · Pricing · FAQ ············ Sign in · (primary) Start free trial]
Hero: headline · one-line promise · [Start free trial] [See pricing]  (illustration labelled fictional)
FeatureTabs: tabs (Search · Signals · Campaigns · Outreach) → text + [Explore …] → #/signup
Features grid (6 real capabilities)  ·  Metrics (copy states the server rules)
Pricing: 3 plan cards {name, Rs/month, monthly credits, included rows only} + Live Discovery rule footnote
FAQ (accordion) · "Sign in and ask Support" link
CTA band
Footer: brand blurb · Product (Features, Pricing, FAQ) · Account (Sign in, Create an account, Reset password) ·
        Creators (Creator data notice, Remove my data) · bottom: Privacy · Terms · Credits & refunds · Creator data ·
        Remove my data · Staff
```
768: navbar collapses to menu; pricing cards stack 1-col below 768. 390: everything single column; no sideways scroll.

## 03 Authentication (`#/login`, `#/signup`, `#/forgot`, `#/reset-password`, `#/confirmed`, `#/invite/<t>`)

```
AuthShell: centred card (max 420) · Logo · Title · Subtitle
  form fields (label above) · error line (role=alert) · [primary full-width action]
  footer link (switch to sign in / sign up / request a new link)
```
Variants: sign-up adds the unticked consent checkbox with Terms/Privacy links; reset-password has two password fields and
a "Saving…" state; confirmed has three outcomes (signed in → [Continue], other browser → [Sign in], expired → email field
+ [Send a new confirmation link]); invitation shows workspace, role, inviter, expiry, then [Accept].

## 04 App shell (`#/dashboard`)

```
┌ Sidebar 240 ┐┌ Topbar: [☰ mobile] Omnibar(add by link) ····· JobTray · Credits {n | —} · Bell · Account ┐
│ Workspace   ││ Banners (stacked, full width): service status · billing status · support access · workspace │
│  Dashboard  ││ ─────────────────────────────────────────────────────────────────────────────────────────── │
│  Search     ││ Content (max ~1280, padding 32/16)                                                          │
│  Lists      ││                                                                                              │
│  Campaigns  ││                                                                                              │
│  Analytics  ││                                                                                              │
│ Account     ││                                                                                              │
│  Credits…   ││                                                                                              │
└─────────────┘└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
768: sidebar becomes a slide-over opened by ☰. 390: credit meter hidden from the top bar (shown on Dashboard and
Billing); Omnibar hidden.

## 05 Dashboard
Welcome line · grid of cards (credit balance with bar and renewal text; subscription; recent lists; campaigns; activity)
· each card has its own loading skeleton, empty state and error. Balance unknown → "Your balance could not be loaded".

## 06 Search and Find New Creators
```
Search bar {query, dir=auto} [Search Existing Creators · 50 cr]   [Find new creators]
Filters row: platform buttons · city/country/language · followers range · niches · has contact · selected summary
Results header: "{n} creators match" · how the search was read (where the contract provides it)
Result cards (list): avatar · name · @handle (ltr) · platform · (eligibility) · followers + freshness · city + source ·
                     niches · match reasons · contact availability · [Save] [Add to campaign]
Pagination: [Load more] (cursor) · stale cursor → "Results changed — search again"
Empty: "No creators match" + suggestions + [Find new creators (quoted first)]
```
Find New Creators dialog: brief (topic, place/language, platform, size 5/10/15) → missing-requirement messages → quote
panel {maximum, TikTok minimum, expiry, rule in words} → [Confirm] → JobTray + results panel with server stage and
counters → terminal outcome card (each outcome its own copy and credit result).

## 07 Creator profile (panel; full screen on mobile)
Header (avatar, name, handles per platform with eligibility each) · metrics grid (value, source, freshness; Unknown where
unknown) · authenticity evidence ("Not enough data" when thin) · AI summary labelled as AI · bio · contact availability
+ [Reveal · 5 cr] → revealed value with who/when · actions [Save] [Add to campaign] [Update info · 50 cr].

## 08–12
- Compare: up to N columns, same evidence rules; 0–1 item states.
- Lists: index (name, count, favourite) → detail table (creator, note, added, eligibility note) with bulk "Add to campaign".
- Campaigns: index with open-campaign limit indicator → detail: header (name, budget, dates), stage columns or table,
  fee in PKR, declined outcome, outreach log per creator (dialog).
- Outreach: dialog per creator: channel, outcome, note → appended entries; email (when entitled) clearly "test mode".
- Analytics: persisted metrics only; empty state for a new workspace.

## 13 Credits & billing
Balance card (available, held, top-ups never expire, monthly credits end at renewal) · plan cards with [Choose] (role
permitting) · top-up packs · ledger table (Owner/Admin) · invoices when Paddle is live · test checkout opens a page marked
"Test mode: no real payment".

## 14 Settings
Tabs: Profile · Workspace & team (members, roles, invitations with copy link/expiry, revoke, remove, transfer ownership) ·
Privacy & data (export with included/excluded lists and truncation notice; delete workspace with typed name and blockers;
delete account with typed email, what is retained, sign-in removal outcome) · Support access (approve/deny/revoke).

## 15 Support · Activity
Tickets list → thread with reply box; 20-open cap message. Activity: event list from real events; empty state.

## 18 Public, legal, status
Legal: narrow reading column, title, version, amber draft banner, sections, links to the other three documents.
Remove my data: form (profile links, email, reason, confirm) → "hidden now" confirmation. Not found and page error:
centred card with icon, title, one sentence, two actions.

## 16, 19–23 Staff console (`#/admin`)
```
┌ Staff nav (role-filtered): Overview · Jobs · Workspaces · Workspace access · Support queue ·
│  Providers · Removal requests · Approvals · Staff · Audit log · Security     [Exit staff console]
└ Step-up bar (amber "Admin actions need your security key" [Confirm with security key] | emerald "confirmed, 5 min")
  Content: Overview = alerts card [Send test alert] + eligibility coverage + counts; other views = filter row + table +
  row actions that require a reason (dialog) and, for Admin actions, a confirmed key.
```
Security view: keys table · enrolment code field (first key only) · name · [Add security key].
