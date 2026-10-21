# MUSHIN: UI specification for Figma

A brief for designing every MUSHIN screen in Figma. Which pages exist, are planned or should be built, and their
requirements, are in `FRONTEND_REQUIREMENTS.md` (the page register); this file is the visual and copy detail.

 It is written from the shipped React code (`frontend/src/app`),
2026-10-21, so the frames match what exists. Anything not built is marked **Planned**. Design it only as a disabled or
"not available yet" state, never as a working feature.

## How to use this file

1. Build the **design system** page first (§1): tokens, components, and the global states in §2.
2. Make one Figma page per **module** (§3–§8). Each module lists its frames. Every frame needs the states named in its
   "States" line.
3. Name frames `Module / Screen / State`, for example `Search / Results / Empty` or
   `Billing / Plans / Past due banner`.
4. Design each screen at **1440** (desktop) and **390** (mobile). Add **768** where the layout changes (sidebar
   collapses, tables become cards).
5. Use the copy given here. It is the product's real wording, and it is deliberately honest (never "sent" when only
   recorded, never "healthy" before data loads).

---

## 1. Design system

### 1.1 Tokens (from `frontend/src/app/design/tokens.ts`)

| Group | Values |
|---|---|
| Font | Inter (UI); monospace for codes and ids |
| Type sizes (px) | 11 · 12 · 13 (base) · 14 · 16 · 18 · 22 · 28 · 32 · 40 (display) |
| Weights | 400, 500, 600, 700 |
| Line heights | 1.1 · 1.25 · 1.5 (body) · 1.65 |
| Tracking | display −0.03em; eyebrow labels +0.14em uppercase |
| Spacing (4 px grid) | 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 |
| Radius | 4 · 6 · 8 · 12 (cards) · 16 (dialogs, panels) · full (pills) |
| Elevation | sm (rows), md (dropdowns), lg (popovers), xl (dialogs), 2xl (hero) |
| Motion | 80 instant · 150 fast · 220 base · 320 slow · 500 hero; respect reduced motion |
| Z layers | sticky 20, dropdown 30, drawer 40, modal 50, toast 60 |
| Breakpoints | 640 · 768 · 1024 · 1280 · 1440 |
| Accessibility | WCAG 2.2 AA contrast; 44 px minimum touch target; focus ring 3 px indigo at 25% |

**Colours** (use as roles, not hex):

| Role | Value | Use |
|---|---|---|
| Surface | white; muted slate-50 | Page and card backgrounds |
| Border | slate-200; strong slate-300 | Dividers, inputs |
| Text | primary slate-900, secondary slate-600, muted slate-500, placeholder slate-400 | |
| Primary button | slate-900 (hover slate-800), white text | Main action on every screen |
| Accent | indigo-600 (hover indigo-700), soft indigo-50 | Links, selected nav, focus |
| Success | emerald-500, soft emerald-50 | Done, current data |
| Warning | amber-500, soft amber-50 | Aging data, trial ending, degraded service |
| Danger | red-500, soft red-50 | Errors, destructive actions, stale data |
| Platforms | Instagram pink→orange gradient; TikTok slate-900; YouTube red-500 | Platform chips and icons |

The staff console uses a dark header (slate-950) to separate it visually from the customer app.

### 1.2 Components (each with default, hover, focus, active, disabled, loading, success and error states)

- **Buttons:** primary (slate-900), secondary (outline), ghost, destructive (red), icon-only (with tooltip).
  Loading = spinner plus the same label. Disabled shows *why* in a tooltip (e.g. "Sales contact is not available yet").
- **Inputs:** text, email, password (show/hide), number, textarea, select, combobox (Command), OTP (6 boxes for staff
  TOTP), date picker, switch, checkbox, radio, slider (follower ranges). Field error text sits under the field in red.
- **Navigation:**
  - sidebar (groups "Workspace" and "Account"; collapsed icon rail on tablet; sheet on mobile);
  - topbar (omnibar search, credits pill, job tray, notification bell, user menu);
  - tabs, breadcrumbs, pagination ("Load older" for feeds).
- **Containers:** card, table (sortable header, row hover, selected row), grid of creator cards, dialog, alert dialog
  (confirm), side sheet (creator profile), drawer (mobile), popover, dropdown menu, accordion, tooltip.
- **Feedback:** toast (success, error with request id, info); inline alert; banner (full width, top of page);
  progress bar; skeleton.
- **Badges** (`states.tsx`):
  - **Freshness:** Current (emerald) · Aging (amber) · Stale (rose) · Unavailable (slate), with the "Last updated …" tooltip.
  - **Audience source:** Verified · Estimated · Public signal · Stale · Unavailable.
  - **Contact trust:** Unverified · Contactable · Verified via outreach · Stale — update needed · Invalid — do not use ·
    Creator confirmed.
  - **Platform** chip; **plan** badge; **role** badge (Owner, Admin, Member; staff: Super Admin, Admin, Support).
  - **Status** pills: job, campaign, ticket and subscription statuses.
- **Data display:** credit meter (amber and red thresholds), animated number, stat card, bar and donut charts
  (Recharts), creator card, creator row, compare columns.
- **"Unavailable" value:** a muted "Unavailable" with the tooltip "No reliable value available". Use it wherever a metric
  is unknown; never show 0 or a guess.

---

## 2. Global states and error pages (design these once; every module reuses them)

| Frame | When | Content (real copy) | Actions |
|---|---|---|---|
| **Page not found** | Unknown `#/…` address | Compass icon. "Page not found" / "This address does not match a page in MUSHIN. The link may be mistyped or out of date." | Go to the home page (primary) · Sign in |
| **Page error (error boundary)** | A bug while drawing a page | Warning icon. "This page could not be shown" / "Something went wrong while drawing this page. Nothing you saved was lost. Reload to try again; if it happens again, contact support and say which page you were on." | Reload (primary) · Go to the home page |
| **App loading** | Lazy load of the dashboard or console | Centred "Loading…" | — |
| **Offline banner** | Browser offline | Dark full-width bar, wifi-off icon: "You are offline. Changes you make now are not saved; MUSHIN reconnects by itself." | — |
| **Service degraded banner** | API readiness check fails | Amber bar: "MUSHIN is partly unavailable right now: some actions may fail. Nothing is charged for an action that fails." | — |
| **Server unreachable banner** | API cannot be reached | Amber bar: "MUSHIN's server cannot be reached right now. Try again in a few minutes." | — |
| **Section loading** | Any list or card fetching | Skeleton lines (`LoadingBlock`); never placeholder numbers | — |
| **Empty state** | No data yet | Dashed card, icon tile, title, one-line body, optional primary action (examples per module) | One action |
| **Error state (in a section)** | A request failed | Inline card: what failed, the API message, the request id (small, monospace, copyable) | Retry |
| **Access lost** | 403 for the workspace | Toast/inline: "You no longer have access to that workspace." | Switch workspace or reload |
| **Workspace mismatch** | 409 from a stale tab | "This request reached a different workspace than the one on screen. Reload the page." | Reload |
| **Session expired** | 401 | Sends the user to Sign in; after signing in, back to where they were | — |
| **Confirm dialog** | Any destructive or charged action | Title, consequence sentence, cost line when credits are spent, typed confirmation for deletions | Cancel · Confirm (destructive red when deleting) |
| **Toasts** | After an action | Success only after the server confirms. Errors show the server message and request id | Dismiss |

### 2.1 API error → UI message mapping (every module)

| Code (HTTP) | Show | Pattern |
|---|---|---|
| VALIDATION_FAILED (400) | Field-level messages under the inputs | Inline |
| QUERY_TOO_BROAD (422) | "Add a creator topic and a city, country or language before starting live discovery." Highlight the missing fields | Inline in the brief form |
| UNAUTHENTICATED (401) | Redirect to Sign in | Route |
| INSUFFICIENT_CREDITS (402) | "Not enough credits" with the balance and the cost | Dialog with "Buy credits" / "Choose a plan" |
| FORBIDDEN (403) | "You don't have permission for this." (role-based) | Toast; hide the control for that role where possible |
| ENTITLEMENT_REQUIRED (403) | The plan limit reached, with an upgrade path | Inline upsell card |
| NOT_FOUND (404) | "… not found" for that object | Inline empty state |
| CONFLICT (409) | The server's sentence (e.g. a closed ticket, the open-request limit) | Toast |
| IDEMPOTENCY_KEY_REUSED (422) | "This action was already submitted." | Toast |
| RATE_LIMITED (429) | "Too many requests. Try again in a minute." | Toast |
| PROVIDER_UNAVAILABLE (503) | The server's message (e.g. "Search is temporarily unavailable.") with Retry | Inline error state |
| INTERNAL (500) | "Something went wrong. Nothing was charged." plus the request id | Inline error state |

---

## 3. Public site (signed out)

### 3.1 Landing page (`#/`): sections in order, with the shipped copy

All creators, handles and figures in the product illustrations are fictional. The page says so: "Product
illustrations. Creators, handles and figures shown are fictional examples."

**1. Navbar** (sticky; transparent over the hero, white with a border after scrolling)
- Logo; anchor links **Platform**, **Pricing**, **FAQ**; **Sign in**.
- Primary button: "Create your account" when signed out, "Open dashboard" when signed in.
- Mobile: a hamburger opens a sheet with the same links.

**2. Hero**
- Eyebrow pill (green dot): "Pakistan-first creator intelligence".
- Headline: "The intelligence layer for" / gradient line "modern creator campaigns".
- Sub-copy: "Mushin finds creators across Instagram, TikTok, and YouTube, shows how well each one fits your brief and
  how fresh the data is, and keeps your lists, campaigns and outreach log in one place."
- Buttons: **Call us for a free 14-day trial** (primary, goes to `#/free-trial`) · **Create your account** (secondary).
- Trust ticks: "No credit card required" · "14 days, 2,500 credits" · "Nothing charged when it ends".
- Product illustration: an app window with a sidebar (Overview, Search, Lists, Campaigns, Credits, Support), creator
  cards and a pipeline strip (Shortlisted, Contacted, Confirmed).

**3. Feature tabs** (four tabs; each shows a text panel and an animated illustration)

| Tab | Body copy | Illustration |
|---|---|---|
| Search | "Search in English, Roman Urdu or Urdu, and filter by platform, city, niche, follower band and engagement to find Karachi, Lahore and Islamabad creators fast." | Filter chips (Instagram, Bridal, 100K–1M, ER 5%+, Karachi + Lahore); rows Language "Urdu · Roman Urdu", Contact "Available", Data "Fresh only"; "3,214 creators match", "Sorted by Creator Fit"; 4 creator rows |
| Signals | "Review Suspicious Activity Signals — unusual follower patterns and engagement anomalies worth investigating before you commit budget." | "Engagement integrity" chart, "Last 90 days · daily" |
| Campaigns | "Lists, campaign stages, agreed fees and a shared activity feed keep the whole team on the same page." | Pipeline columns Identified, Contacted, Negotiating, Confirmed |
| Outreach | "Use outreach templates, log every contact and its outcome, and keep the history next to the creators you discover and qualify." | Inbox mock-up ("To: ayesha@brandx.pk") |

States: tab default, hover, selected; on mobile the tabs become a horizontal scroller.

**4. Features grid** (six cards: icon, title, description)

| Title | Description |
|---|---|
| Creator discovery | "Search MUSHIN's catalogue of Instagram, TikTok and YouTube creators in English, Roman Urdu or Urdu, with platform, city, follower and engagement filters. Find new creators from a brief, with the price quoted before you confirm." |
| Suspicious Activity Signals | "Unusual follower growth or engagement patterns worth reviewing, each shown with the evidence behind it. Signals to investigate, not verdicts." |
| Creator Fit | "How closely a creator matches your search or brief, with the reasons shown alongside the score." |
| Fresh, sourced data | "Follower counts, engagement and summaries carry the date they were observed, so stale numbers are marked, not hidden." |
| Campaign tracking | "Lists, campaign stages, agreed fees and a manual outreach log in one place." |
| Workspace roles | "Owner, admin and member roles decide who can buy credits, see the ledger and manage the workspace." |

**5. Principles strip** (`Metrics`; four items, no numbers)

| Title | Body |
|---|---|
| See the price before you spend | "Every search shows its credit price first. Live discovery is quoted before you confirm: a base fee when it delivers creators, plus each new creator, never more than the quote; nothing when it delivers none." |
| Live discovery on demand | "Reach the open web when you need fresh creators, with the credit cost shown up front." |
| Honest data, always | "Every figure is labeled by freshness and confidence. Estimates are never dressed up as facts." |
| Decisions, not dashboards | "Compare creators on the criteria that matter and see the trade-offs — no universal “winner.”" |

**6. Pricing** (read from the API)
- Note: "Prices in Pakistani Rupees, per month". A monthly/yearly toggle; yearly is shown disabled or "coming soon",
  because annual billing is not sold yet.
- Three plan cards (Starter, Growth, Scale): name, "Rs. X / mo", "Billed monthly", monthly credits, and feature rows
  (each "included", "· coming soon" or "· test mode"). Primary button per card.
- Enterprise strip: "Custom", "Role-based access", "Volume pricing", and a **disabled** "Talk to sales (coming soon)"
  button with the tooltip "Sales contact is not available yet".
- Footnotes: "14-day free trial · no card" · "Cancel anytime" · "Monthly credits reset each billing period and do not
  roll over" · "Top-up credits never expire".
- States: loading (three skeleton cards) · error ("Plans could not be loaded." + **Try again**) · normal. Design a
  "highlighted plan" variant.
- Prices come from the database (current values in `docs/README.md`); do not treat the numbers in the design as final.

**7. FAQ** (accordion: one open at a time, chevron rotates)

| Question | Answer |
|---|---|
| What does Mushin actually do? | "Mushin helps brands and agencies in Pakistan find creators on Instagram, TikTok, and YouTube, see how well each one fits a brief (the Creator Fit score), review suspicious-activity signals, and keep lists, campaigns and an outreach log in one workspace." |
| How is the Creator Fit score calculated? | "The Creator Fit score combines audience trust, engagement health, posting consistency, niche alignment, and campaign suitability into one number from 0 to 100. Each score includes a reasoning panel so you can see exactly what contributed — we don't hide the logic behind the number." |
| Which platforms are supported? | "Instagram, TikTok, and YouTube. Every figure shows the date it was observed and is marked when it is aging or stale; you can refresh a creator's data on demand." |
| How does bot and fake-follower detection work? | "Mushin looks at public engagement and follower patterns and flags what looks unusual, with the evidence behind each signal. These are signals to investigate before you commit budget, not verdicts." |
| Can multiple teammates collaborate in one workspace? | "Yes. Invite teammates as owner, admin or member; lists, campaigns and the activity feed are shared across the workspace." |
| How is Mushin priced? | "Each plan includes monthly credits, and you can buy top-up credits that never expire. Credits pay for searches, finding new creators, data refreshes and contact reveals, and every action shows its price before you confirm." |
| How does Mushin handle security and data? | "Mushin uses role-based access within each workspace, keeps workspaces separate from each other, and lets you export your workspace or delete it at any time. Creator profiles are built from public information and labeled by freshness and confidence; estimates are never presented as verified facts." |

**8. CTA band** (dark, animated gradient orbs)
- "Discover, verify, and orchestrate creator campaigns on a single intelligence layer."
- Buttons: **Call us for a free 14-day trial** · **Create your account**.

**9. Footer**
- **Product:** Features, Pricing, FAQ.
- **Account:** Sign in, Create an account, Reset password.
- **Creators:** Creator data notice, Remove my data.
- **Legal row:** Privacy, Terms, Credits & refunds, Creator data, Remove my data, and a small **Staff** link to `#/admin/login`.

Landing states: signed out vs signed in (navbar button) · reduced motion (no orb animation, no tab tweens) · mobile
(stacked hero, single-column grids).

### 3.2 Free trial request (`#/free-trial`)

"Discover Pakistani creators in minutes — no card required." This is a callback request form (name, email, phone,
company, message, consent). It is founder-approved, never automatic.

Frames: form · submitting · submitted ("we will call you") · validation errors · rate-limited · error.

Show the phone number from configuration as plain text.

### 3.3 Remove my data (`#/remove-my-data`)

For creators. Profile links (one or more), email, reason, confirmation checkbox, hidden bot trap.

Frames: form · invalid link error (not a profile link) · submitted (the same neutral message whether or not MUSHIN has
the creator: never reveal existence) · error.

### 3.4 Legal pages (`#/terms`, `#/privacy`, `#/refunds`, `#/creator-data`)

Long-form document layout: title, date, table of contents, sections (e.g. "What MUSHIN is", "What MUSHIN does not
promise", "Acceptable use", "Refunds", "When an action costs nothing", "Removal", "What we keep about you", "Who
processes it for us", "Your rights", "If you are a creator", "Data from YouTube").

A **"Draft, not yet reviewed by a lawyer"** banner stays until counsel approves the text. Back button.

---

## 4. Customer authentication

All of these use the **Auth shell**: a centred card, logo, title, sub-title, the form, and a footer link.

| Frame | Address | Content | States |
|---|---|---|---|
| Sign in | `#/login` | "Welcome back" / "Sign in to continue to your Mushin workspace." Email, password, Forgot password, Create account | default · submitting · wrong email or password · unconfirmed email · locked or rate-limited · network error |
| Create account | `#/signup` | "Create your account". Name, email, password (strength hint), terms consent | default · submitting · email in use · weak password · "Check your email" confirmation sent |
| Email confirmed | `#/confirmed` | "Your email is confirmed" / "Your account is ready." | success (Continue) · "This confirmation link no longer works" (expired or used; resend) · "Checking your link" / "One moment…" |
| Forgot password | `#/forgot` | Email field | default · sent (same message whether or not the account exists) · error |
| Reset password | `#/reset-password` | "Set a new password" / "Choose a new password for your MUSHIN account." | default · saved → dashboard · "This link no longer works" (Get a new link) · weak password |
| Accept invitation | `#/invite/<token>` | The workspace name, the inviter, the role | signed out (Sign in / Create account, then return) · signed in as another email (mismatch) · accepted → dashboard · "Invitation not available" (expired, revoked or used) |
| Workspace onboarding | first sign-in | Name the workspace | default · saving · error |
| Legal gate | first use, or after terms change | "Before you continue". Terms of Service and Privacy Policy links, accept checkbox | default · accepting · error |

---

## 5. Customer app (dashboard)

### 5.1 App shell

- **Sidebar** "Workspace" group: Dashboard, Search, Lists, Campaigns, Analytics.
- **Sidebar** "Account" group: Credits & billing.
- **Footer menu:** Settings, Support, Activity, Inbox, Sign out.
- **Topbar:**
  - omnibar: type a name or paste a profile link; results dropdown; "Add a creator by profile link" when MUSHIN does not have the creator;
  - credits pill: balance plus a meter, amber when low, red when very low;
  - **job tray:** running and finished jobs with their step text;
  - **notification bell** with the recent-activity dropdown;
  - user menu with the workspace switcher.
- **Page-top banners** stack above the content:
  - billing status;
  - support access granted ("MUSHIN support can see this workspace until …", Manage);
  - offline or degraded.

**Billing status banner variants** (`lib/billing-status.ts`):
- trialing: "N days left";
- trial ending soon (amber);
- past due (red, "Update payment method");
- "Your free trial has ended." (Choose a plan);
- "Your subscription has ended." (Choose a plan);
- nothing while loading.

**Roles:** Owner, Admin and Member see the same pages, but Owner/Admin-only controls are hidden for Members (billing purchases, team management, support access, workspace deletion). Design both views wherever controls differ.

### 5.2 Dashboard (overview)

- Greeting; credit balance card (meter, plan, renewal date).
- Quick actions: Search, Find new creators, New list, New campaign.
- "Recent activity" (5–10 events, "See all").
- Overview cards: saved creators, active campaigns, outreach outcomes.
- "Start something new" empty-workspace block.
- **Trial feedback** card near the trial end: "Tell us how the trial went". Choose a plan (Starter, Growth, Scale, No answer) plus a comment.

States: loading skeletons · brand-new workspace (empty state with actions) · normal · trial ending.

### 5.3 Search (Brain 1: the catalogue) and Find new creators (Brain 2: live discovery)

**Search page:**
- Query box (natural language, Urdu and Roman Urdu accepted). The **cost line** "Searching costs N credits" comes before
  running.
- "Refine your search" filters:
  - Platform;
  - Followers range;
  - Engagement minimum;
  - City;
  - Niche;
  - Language;
  - "Verified only" ("Show only platform-verified accounts");
  - "Contact available" ("Only creators with a usable contact on file");
  - "Fresh data only" ("Hide creators whose core data is aging or stale").
- **"Understood as"** chips: how MUSHIN read the query (topic, city, platform, range); each is removable.
- **Results:** Grid and Table toggles; total count; creator cards. A card shows the avatar, name, handle, platform chip, city, niches, followers, engagement, a freshness badge, a contact-available icon, "Matched:" terms and a **"Why this creator"** popover. Pagination: "Load more".
- **Saved searches:** save, list, delete.
- **Row actions:** open the profile; Save to a list; Add to a campaign; compare (select 2–4).

Search states:
- idle (suggested searches);
- "Searching your catalog" (skeleton grid);
- results;
- **no results**: an empty state offering "Find new creators" with the brief prefilled;
- insufficient credits (dialog);
- provider unavailable ("Search is temporarily unavailable." plus Retry);
- validation error;
- filters that conflict.

**Find new creators dialog** (Live Discovery, paid):
1. **Brief:** topic, city, country or language (required), platforms ("Platforms searched"), size (5, 10, 20…).
2. **Quote:** "A run that delivers at least one creator costs 50 credits plus 10 for each new creator… never more than the quote you confirm. If it delivers no creator, it costs nothing." "Creators MUSHIN already knows" are free.
3. **Confirm:** reserves credits.
4. **Running:** the job tray and a progress view, with the live step labels "Searching Google…", "Picking relevant profiles…", "Fetching public profile…", "Saving a copy of the data…", "Reading the data…", "Assessing authenticity and audience…", "Saving…". There is a Stop control; "Stopping after the current step… Creators already found are kept."
5. **Finished:** results added to Search.

Find new creators states:
- QUERY_TOO_BROAD (missing topic or location), highlighting the fields;
- insufficient credits;
- queued ("Waiting to start…");
- running;
- succeeded: "Found N creators (M new) · X credits used, Y returned";
- partial: "Some creators were saved. X credits used; remaining credits returned.";
- empty: "No eligible creators were delivered. Your credits were returned.";
- insufficient: "Too few eligible profiles were found to continue. Your credits were returned.";
- failed (credits returned);
- one live run at a time: a second start is refused with an explanation.

**Add a creator by profile link** dialog: paste a link; shows the cost (refresh cost); then a queued job. States:
- invalid link;
- already in MUSHIN (opens the profile);
- creator removed at their request (cannot add);
- private account;
- not found;
- added.

### 5.4 Creator profile (side sheet, from anywhere)

- Header: avatar, name, verified mark, platform profiles with links, city/country, niches; freshness badge with "Last updated".
- Metrics: followers, engagement, average likes, comments and views. Show "Unavailable" when unknown.
- **AI summary** (labelled AI, with a date).
- "Audience Details": age and gender, country. The source badge is Verified, Estimated or Public signal. "Optional · experimental estimate on request" costs 5 credits, with a confirm step. Off states: not available, or "estimate unavailable".
- "Contact & trust": masked contacts with trust badges. **Reveal contact details** costs 5 credits, with a confirm step. After revealing: the values, with Copy. "Already revealed — no credits used". "Revealed contacts removed from this workspace" (the remove action).
- Refresh data (50 credits, confirm, job).
- Save to a list; Add to a campaign; Compare.
- Evidence and provenance: why the city, country and niches are shown, or "unknown". Design an "Unknown" pattern rather than leaving fields blank.

States: loading · normal · hidden creator (removed, or a possible minor under review: "This creator is not available") ·
reveal error · insufficient credits · refresh running.

### 5.5 Compare (2–4 creators)

Columns per creator: metrics, "Data freshness", "Contact", audience source, and a "Best-fit note".

States: fewer than two selected (prompt) · loading · one creator unavailable.

### 5.6 Lists

- **Lists index:** list cards with name, description, member count and avatar preview. Create a list.
- **List detail:** members (grid or table), a note per creator ("Edit note"), Remove, Export (CSV, see §5.11), Rename, Delete.

Empty states:
- "No lists yet" (Create list / Go to Search);
- "No creators on this list yet" (Go to Search).

Toasts: "Created …", "Saved … to …", "Already on …", "Deleted …".

### 5.7 Campaigns

- **Campaigns index:** status filters (draft, active, paused, archived), cards with budget, dates and creator count. "No campaigns yet".
- **Create or edit campaign:** name, client, objective, platform, budget (PKR), start and end dates, notes, status. The Starter plan has a campaign limit, shown as an ENTITLEMENT_REQUIRED upsell.
- **Campaign detail:**
  - header with status actions (Pause, Restore, Archive, Delete, with confirms);
  - creators in pipeline stages;
  - per creator: fee ("Edit fee"), "Mark declined", "Remove from campaign";
  - "No creators in this campaign yet".
- **Outreach** (per creator):
  - templates ("Template copied" / "Paste it into your email or DM, then log it below");
  - **log outreach**: channel, outcome (attempted, replied, no response, declined, agreed), note, time;
  - **Send an email through MUSHIN** (`SendEmail`), whose three modes must each be designed (§5.7.1);
  - sent history with "· test mode" labels.

#### 5.7.1 Email modes

| Mode | Show |
|---|---|
| off | "Sending email through MUSHIN is not available yet. Use a template below in your own email, then log what happened." |
| test | An amber note: "Test mode: this email is recorded but not delivered to anyone." The toast says "recorded in test mode: not delivered" |
| resend | Normal; the toast says "accepted by the email service"; "The email service refused this email" with the reason; a monthly usage meter |

### 5.8 Analytics

- "Last 30 days" summary;
- "Creators by pipeline stage";
- "Outreach outcomes";
- "Fees marked agreed / budget";
- "Performance".

Every chart is "From your workspace's records". States: loading, empty (no campaigns yet), normal. **Planned** items show
"Planned: not available yet", never invented numbers.

### 5.9 Inbox, bell and activity

- **Inbox: Planned.** A single "Planned: not available yet" empty state: "MUSHIN doesn't connect to your mailbox or
  send messages. Use a template from a campaign creator's Outreach panel in your own email or DM, then log what
  happened there." One button: **Go to campaigns**. Do not design a working mail inbox.
- **Notification bell** (topbar): the "Recent activity" dropdown with an unread dot. States: loading · "No recorded
  activity yet." · "Couldn't load activity." + **Retry** · list (newest first, "See all" → Activity).
- **Activity log** (`Activity`): the full feed, newest first, with "Load older" paging. Event lines include:
  - "created the list …";
  - "saved … to …";
  - "created the campaign …";
  - "added … to …";
  - "logged that … agreed (…)";
  - "finished a Find New Creators run for …: N found, M new";
  - "revealed contact details for …".

  Empty: "No recorded activity yet".

### 5.10 Credits & billing

- **"Credit balance":** meter; "Monthly and top-up credits" split (monthly credits end at renewal, top-ups never expire).
- **"Current plan" / "Subscription":** status badge (trialing, active, past due, canceled, expired); renewal date; Change or Cancel.
- **Plans:** Starter, Growth, Scale cards with a monthly/yearly toggle. Yearly prices are stored but annual billing is not sold yet, so design the yearly toggle as disabled or "coming soon".
- **"Credit top-ups":** 1,000 / 5,000 / 15,000 packs.
- **Checkout:** hand-off to Paddle and the return states: success "Payment received, credits arriving" (wait up to 90 s); cancelled; failed. Today it is a **test-mode** checkout: show the "test mode" label.
- **"Credit history":** "Every credit added, reserved, spent, released and expired"; ledger rows with type, amount, balance, time and reason; "Load older".
- "Invoices", "Payment methods": **Planned** or available only through the payment provider. Label honestly.

Billing states: loading (no "Healthy" or "Inactive" text before data) · trial · past due · expired · insufficient credits
from elsewhere.

### 5.11 Exports

An "Export" button on lists and search results gives a CSV, "The file stays available for 24 hours".

States: exporting · "Exported N rows" · "CSV export is not available yet" (plan or feature off) · error.

Workspace export is under Settings → Privacy & data.

### 5.12 Settings (tabs)

| Tab | Content | States |
|---|---|---|
| Profile | Name, email (read-only), avatar initials | saving · "Profile saved" |
| Workspace & team | Rename the workspace; "Team" members with role (Owner, Admin, Member); Make owner; Remove; "Invite by email", Create invitation, Copy link, Revoke | Members cannot manage the team; invitation pending, expired or revoked |
| Password & sessions | Change password; "Sign out on your other devices" | weak password · "Password changed" |
| Notifications | An information card, no toggles: "MUSHIN doesn't send notification emails yet. Finished Find New Creators runs, list and campaign changes and outreach appear in the bell and the Activity log." | static (see §5.14 for the planned emails) |
| Support access | Grant MUSHIN support time-limited read access to the workspace; staff requests show their **purpose**; Grant, End, Decline | "Access granted until …" · "Access ended" |
| Privacy & data | "Export this workspace" (Download export); "Delete this workspace" (type the name to confirm); "Delete my account" (type your email); "What was kept, and why:" after deletion; "Ask Support about your data" | Owner-only; confirm dialogs; done states |

### 5.13 Support

- Ticket list with status: open, waiting on customer, resolved, closed.
- New request: subject, category, message.
- Ticket thread: customer and "MUSHIN support" messages, Reply, Close, "Reopen".

Empty state: "No support requests". Errors:
- 20 open requests: "Your workspace has 20 open requests. Close one, or reply on an existing request.";
- reply on a closed ticket: "This request is closed. Reopen it to reply.".

### 5.14 Notifications (what exists, what is planned)

| Channel | Status | Design |
|---|---|---|
| Toasts | Built | Every message in Appendix A |
| Bell and Activity feed | Built | §5.9 |
| Page banners (billing, support access, offline, degraded) | Built | §2, §5.1 |
| Job tray (live runs, refreshes, add-by-link) | Built | §7 |
| Outreach email to creators | Built (off by default; test and Resend modes) | §5.7.1 |
| **Notification emails to customers** | **Planned**: the server raises the events but delivers nothing yet | Design as email templates marked Planned |

Planned notification emails, one template each: credits low · credits very low · trial ending · trial expired ·
subscription canceled · payment failed · Find New Creators run finished · removal request processed (to the
creator). Each needs a subject, a one-paragraph body, one button back to the app and the footer.

The Settings tab must keep saying that emails are not sent yet until they are built.

---

## 6. Staff console ("MUSHIN · OPS", `#/admin`)

**Yes, it exists.** It is a separate staff app with its own sign-in, never the customer login. There are three roles:

| Role | Who | What they can do |
|---|---|---|
| **Support** | Day-to-day customer support | Read-only operational views (redacted personal data); support queue (take tickets, reply, internal notes); request workspace access with a stated purpose; view trial requests and mark them called; manage their own security keys |
| **Admin** | Operations | Everything Support can, plus Providers, Removal requests, Approvals, Staff directory, Audit log, test alerts, job re-dispatch and stop, assigning any ticket |
| **Super Admin** | Founders | Everything Admin can, plus: **approve or reject trials** (with a security-key step-up), the trial **Feedback** tab and its CSV download, **add staff members**, request staff role changes (Make admin / Make support) and suspensions, and decide approvals marked "Super Admin co-sign" |

Four-eyes rule: a sensitive request (credit grant, staff role change, suspension) is created by one person and decided
by a different person; Super-Admin-only requests can be decided only by another Super Admin. The API enforces this
whatever the screen shows, so design the "you cannot decide this" states too.

**Staff sign-in** (`#/admin/login`): email and password, then a 6-digit authenticator code. Security key (WebAuthn)
step-up is used for sensitive actions. First-time staff enrolment uses an enrolment code
("XXXX-XXXX-XXXX-XXXX-XXXX") and a QR code.

Sign-in states: wrong credentials · wrong code · locked · enrolment needed.

**Shell:** a dark header with "MUSHIN · OPS", a role badge (Super Admin, Admin, Support), name and email, and Sign out;
section navigation on the left. Sections show per role:

| Section | Roles | Content | Key states |
|---|---|---|---|
| Overview | all | "Operations overview": queue backlog, failed jobs, provider status, alerts | loading · alert present |
| Jobs | all | Discovery and refresh jobs, filters, detail with step trail; Re-dispatch, Stop | "Job re-dispatched" · "A stop was already requested" · "Stop requested" |
| Workspaces | all | Search workspaces; plan, status, members, credits | Support sees redacted read-only views |
| Workspace access | all | Request access with a purpose, which the owner approves | "Access requested" · granted · expired · "Access is not available" |
| Support queue | all | Tickets; assign (Support takes their own, Admins assign anyone); reply; internal notes (never shown to the customer); status | "Internal note added" · "Ticket updated" |
| Trial requests | all (decide: Super Admin) | Tabs **Requests** and **Feedback** (Feedback: Super Admin only). A request card shows name, email, phone, company and message, plus "Mark as called". A Super Admin enters the "Account email" ("Email they signed up with") and clicks **Approve trial** (starts the 14-day, 2,500-credit trial; security-key step-up), or rejects with a required note ("Note (required to reject)"). Feedback: "Answers from trial workspaces, newest first. Only real customer answers are stored here." with **Download CSV** | "No requests here." · "Trial started — <dates>" · "Request rejected" · "Enter the email the person signed up with" · "Couldn't approve" · step-up prompt · "No feedback yet." (CSV disabled) |
| Providers | Admin+ | Pause or resume a provider (LLM, Apify, Serper); budgets; spend; send a test alert | "… paused" / "… resumed" |
| Removal requests | Admin+ | Creator removal requests; approve (erases the creator) or reject | "Approved. The creator is being erased." |
| Approvals | Admin+ | Four-eyes queue. "Request a credit grant": workspace id, 1–100,000 credits, expiry 1–365 days, a reason. Each request shows its requester, action, payload, reason, and a "Super Admin co-sign" badge where required | "Sent for approval — Another staff member must approve it." · "Your request: another staff member must decide it." · "Only a Super Admin can decide this request." · "Approved and carried out" · "Approved, but it could not be carried out" · empty |
| Staff | Admin+ (changes: Super Admin) | Directory: name, email, role, status, keys. A Super Admin can **Add a staff member** (Name, Email → **Create account**; new staff are always Support; one-time sign-in details plus an enrolment code shown once, confirmed with "I have handed these over"), **Make admin / Make support** and **Suspend** (each sent for approval with a reason) | "Sent for approval — A different Super Admin must approve it." · the hand-over screen · error |
| Audit log | Admin+ | Filter by action, staff, workspace and date; up to 500 rows | empty · filtered |
| Security | all | Security keys: register, remove ("Security key confirmed for 5 minutes" after a step-up) | "Security key registered" / "removed" |

---

## 7. Cross-cutting patterns to draw once

- **Credit-spending confirm:** the action, the cost in credits, the balance before and after, and "Nothing is charged
  if it fails". Used by search, Find new, refresh, reveal, audience estimate and email.
- **Job tray item:** title ("Adding …" becomes "Added …", "Refreshing …" becomes "Refreshed …"), the status text, a
  progress indicator, and Stop where allowed.
- **Request id footer** on every error state: small, monospace, copyable.
- **Typed confirmation** for irreversible deletions (workspace name or email).
- **Role-hidden controls:** design the Member view without Owner/Admin controls, rather than with disabled copies.
- **Honest unknowns:** "Unavailable", "Unknown" and "Planned: not available yet" are designed states, not blanks.

## 8. Frame checklist (one row per frame to deliver)

| Area | Frames |
|---|---|
| **System** | Tokens, components, badges, toasts, banners (offline, degraded, unreachable, billing ×5, support access), Page not found, Page error, App loading, Empty state, Section error, Confirm, Insufficient-credits dialog, Upsell card |
| **Public** | Landing (signed out / in, pricing loading / error), Free trial (4), Remove my data (4), Legal page (1 template, 4 documents) |
| **Auth** | Sign in (6), Create account (5), Email confirmed (3), Forgot (3), Reset (4), Invitation (5), Onboarding (3), Legal gate (3) |
| **Dashboard** | Shell (desktop, tablet, mobile; Owner and Member), Overview (4), Search (8), Find new (10), Add by link (6), Creator profile (6), Compare (3), Lists (5), Campaigns (8), Email modes (3), Analytics (3), Inbox (Planned, 1), Bell (4), Activity (3), Billing (8), Exports (4), Settings (6 tabs plus states), Support (5) |
| **Notifications** | Toast set (Appendix A), 8 notification email templates (Planned) |
| **Staff** | Sign-in (5), Shell per role (Support, Admin, Super Admin), 12 sections with the states above, the "cannot decide" four-eyes states, the staff hand-over screen |

---

## Appendix A. Every message in the shipped UI, by screen

Extracted from the code on 2026-10-21: toasts (success, error, info), empty states, unavailable hints and errors.
`${…}` is a value filled in at run time; "conditional" rows choose between the wordings shown. Use these strings
verbatim in the frames. If a design needs a new message, add it to the code and to this list together.

### admin/OpsControls.tsx
- toast.error: Test alert not sent
- toast.success (conditional): paused ? `${provider} paused` : `${provider} resumed`
- hint: Only a job queued or running for more than 10 minutes can be retried

### admin/RemovalRequests.tsx
- toast.success: Approved. The creator is being erased.
- toast.error: Couldn't approve
- toast.info: Rejected. The creator is visible again.
- toast.error: Couldn't reject

### admin/StaffAdmin.tsx
- toast.success: Sent for approval — Another staff member must approve it.
- toast.success: Sent for approval — A different Super Admin must approve it.

### admin/StaffSecurity.tsx
- toast.success: Security key registered
- toast.error: Confirm with an existing security key first, then add the new one.
- toast.error: Enrolment code not accepted
- toast.error: The key was not registered
- toast.success: Security key removed
- toast.error: The key was not removed

### admin/SupportAccessStaff.tsx
- toast.success: Access requested — The workspace owner sees your request and purpose.
- toast.error: Access not requested
- error: Access is not available
- hint: Access is not available

### admin/SupportQueue.tsx
- toast.success: Internal note added
- toast.error: Couldn't add the note
- toast.error: Couldn't take the ticket
- toast.error: Couldn't assign the ticket
- toast.success: Ticket updated
- toast.error: Couldn't update the ticket
- hint: Reply to the customer (optional when only changing status)

### admin/TrialRequests.tsx
- toast.error: Enter the email the person signed up with
- toast.success: Trial started — ${formatTrialDate(res.trialStartedAt)} to ${formatTrialDate(res.trialEndsAt)}
- toast.error: Couldn't approve
- toast.error: Couldn't update
- toast.success: Request rejected
- toast.error: Couldn't reject

### admin/staff-ui.tsx
- toast.error: This browser cannot use security keys
- toast.success: Security key confirmed for 5 minutes
- toast.error: Security key not confirmed
- toast.error: Couldn't ${label.toLowerCase()}

### auth/InviteAccept.tsx
- error: Invitation not available
- hint: Invitation not available

### dashboard/ActivityLog.tsx
- empty: No recorded activity yet — Activity appears here as your team saves creators, runs campaigns and finds new creators.

### dashboard/AddByLinkDialog.tsx
- toast.info: Adding @${a.handle}… — Follow its progress from the Jobs button in the top bar.

### dashboard/AddToCampaignMenu.tsx
- toast.error: Couldn't add to the campaign
- toast.success (conditional): r.added > 0 ? `Added to ${name}` : `Already in ${name}`, r.added > 0 && r.alreadyInCampaign > 0 ? `${r.alreadyInCampaign} were already in it.` : undefined

### dashboard/AudienceEstimate.tsx
- toast.error: Couldn't start the estimate

### dashboard/CampaignDetail.tsx
- toast.success: Deleted ${c.name}
- toast.error: Couldn't delete the campaign
- toast.error: Couldn't save the campaign
- toast.success: Restored ${c.name}
- toast.error: Couldn't restore the campaign
- toast.success: Archived ${c.name}. It no longer counts towards your plan's campaign limit.
- toast.error: Couldn't archive the campaign
- toast.warning: Updated by someone else — We loaded their change. Check it, then try again.
- toast.error: Couldn't save the change
- toast.error: Couldn't remove the creator
- empty: No creators in this campaign yet — Add creators from Search, a list or a creator's profile with Add to campaign.

### dashboard/CampaignOutreach.tsx
- toast.success: Template copied — Paste it into your email or DM, then log it below.
- toast.error: Couldn't copy — Your browser blocked clipboard access. Select the text and copy it instead.
- toast.success: Outreach logged
- toast.error: Couldn't log the outreach

### dashboard/Campaigns.tsx
- toast.success: Created ${c.name}
- toast.error: Couldn't create the campaign
- empty: No campaigns yet — Create a campaign, then add creators from Search, a list or a creator's profile.

### dashboard/CreatorProfilePanel.tsx
- toast.info: Already up to date — Updated ${relative(r.updatedAt)}. No credits used.
- toast.error: Couldn't refresh this creator
- toast.success: Revealed contacts removed from this workspace
- toast.error: Couldn't remove the contacts
- toast.error: Couldn't reveal contact details
- toast.success (conditional): r.charged ? `Contact details revealed · ${p.revealCost} credits used` : "Already revealed — no credits used"

### dashboard/ExportButton.tsx
- toast.success: Exported ${made.rowCount} ${made.rowCount === 1 ? "row" : "rows"} — The file stays available for 24 hours.
- toast.error: Not exported

### dashboard/FindNewDialog.tsx
- toast.info: Finding new creators… — Results appear here as they are found. Follow progress from the Jobs button.
- toast.error: Couldn't start Find New Creators

### dashboard/Inbox.tsx
- empty: Planned: not available yet — MUSHIN doesn't connect to your mailbox or send messages. Use a template from a campaign creator's Outreach panel in your own email or DM, then log what happened there.
- hint: Planned: not available yet

### dashboard/JobTray.tsx
- toast.success: ${jobTitle(j).replace(/^Adding/, "Added").replace(/^Refreshing/, "Refreshed")}
- toast.error: Couldn't finish: ${jobTitle(j)}
- toast.error: Couldn't stop this search

### dashboard/Lists.tsx
- toast.error: Couldn't update the list
- toast.success: Created ${l.name}
- toast.error: Couldn't create the list
- toast.error: Couldn't save the note
- toast.success: Deleted ${l.name}
- toast.error: Couldn't delete the list
- toast.info: Removed ${r.removed} creator${r.removed === 1 ? "" : "s"} from ${l.name}
- toast.error: Couldn't remove creators
- toast.error: Couldn't rename the list
- empty: No lists yet — Create a list, then save creators to it from Search or a creator's profile.
- empty: No creators on this list yet — Open a creator from Search and use Save to add them here.
- hint: CSV export is not available yet

### dashboard/Omnibar.tsx
- toast.info: Adding @${addable.handle}… — Follow its progress from the Jobs button in the top bar.
- toast.error: Couldn't add this creator

### dashboard/SaveToListMenu.tsx
- toast.info: Removed from ${listName}
- toast.error (conditional): what, err instanceof Error ? err.message : undefined
- toast.success (conditional): r.added > 0 ? `Saved ${who}to ${listName}` : `Already on ${listName}`, r.alreadyOnList > 0 && r.added > 0 ? `${r.alreadyOnList} were already on it.` : undefined

### dashboard/SearchModule.tsx
- toast.info: Applied MUSHIN's reading of your search. Edit the chips anytime.
- toast.success: Saved search "${name}".
- toast.error: Couldn't save the search
- toast.warning: Select at least 2 creators to compare.
- toast.error: Couldn't stop this search
- toast.info: Added to comparison — pick at least one more creator, then choose Compare.

### dashboard/SendEmail.tsx
- toast.error: Email not sent

### dashboard/Settings.tsx
- toast.success: Profile saved
- toast.error: Couldn't save your profile
- toast.success: Workspace renamed
- toast.error: Couldn't rename the workspace
- toast.error: Couldn't change your password
- toast.success: Password changed
- toast.error: Couldn't sign out other sessions
- toast.success: Signed out on your other devices

### dashboard/Support.tsx
- toast.success: Request sent — We'll reply here.
- toast.error: Couldn't send the request
- toast.error: Couldn't update the request
- toast.error: Couldn't send the reply
- empty: No support requests — Start one with New request.

### dashboard/SupportAccessSettings.tsx
- toast.error: That didn't work

### dashboard/TeamSettings.tsx
- toast.error: Couldn't ${what}
- toast.error: Couldn't create the invitation
- toast.success: Link copied
- toast.error: Export downloaded, but incomplete — Cut at the row limit: ${data.truncated.join(", ")}. Ask Support for a complete copy.
- toast.success: Export downloaded
- toast.error: Couldn't export the workspace
- toast.error: Not deleted

### landing/Pricing.tsx
- hint: Sales contact is not available yet

