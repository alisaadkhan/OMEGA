# Component specification

Components as they exist in `frontend/src/app/components/` (2026-10-19). Primitives in `components/ui/` are shadcn/Radix
wrappers (Button, Dialog, AlertDialog, DropdownMenu, Select, Tabs, Tooltip, Sheet, Skeleton…) and are used as the base
for everything below. Dimensions use Tailwind units (1 = 4 px). Every interactive component: visible focus ring
(indigo/slate), keyboard operable, labelled, ≥ 44 px touch target for primary controls.

## Actions

| Component | Variants | States | Rules | Source |
|---|---|---|---|---|
| Button | primary (`bg-slate-900` white text, `rounded-md`, h-9 to h-11), secondary (border slate-200), destructive (red), link (indigo) | default, hover (`slate-800`), focus, disabled (`opacity-50`, with a reason nearby), pending ("Saving…", "Waiting for key…") | one primary per area; pending disables to prevent double submit; destructive always confirmed | `ui/button.tsx` and inline buttons |
| Icon button | ghost, bordered | + tooltip | `aria-label` required | `ui/button.tsx` |
| Paid action button | primary + cost text ("50 credits", "Up to 150 · at least 100") | insufficient → disabled with balance reason | cost comes from the server | `SearchModule.tsx`, `FindNewDialog.tsx`, profile reveal |
| Destructive confirm | AlertDialog with exact consequence; typed confirmation for workspace/account deletion | | | `ui/alert-dialog.tsx`, `TeamSettings.tsx`, `lib/toast` (`useConfirm`) |

## Inputs and filters

| Component | Rules | Source |
|---|---|---|
| Text field (auth) | label above, animated focus ring, error below (`role="alert"`) | `auth/AuthShell.tsx` (FormField) |
| Search input | `dir="auto"`, placeholder "Find Pakistani creators…", enter submits | `SearchModule.tsx` |
| Filters | platform buttons, city/country/language, follower range (accepts 10k / 1.2M), niches, has contact; selected filters summarised | `SearchModule.tsx` |
| Select / dropdown | Radix; keyboard; typeahead | `ui/select.tsx`, `ui/dropdown-menu.tsx` |
| Checkbox consent | unticked by default; links open legal pages | `auth/Signup.tsx`, `LegalGate.tsx` |
| Enrolment code | monospaced, `autocomplete=off`, required for the first key only | `admin/StaffSecurity.tsx` |

## Data display

| Component | Rules | Source |
|---|---|---|
| Creator card | avatar (initials fallback), name, handle `dir=ltr`, platform, eligibility, followers + freshness, city with source, niches, match reasons, contact availability | `SearchModule.tsx` |
| Creator profile panel | header, per-profile eligibility, metrics with freshness/source, AI summary labelled as AI, contact availability + reveal, save / add to campaign | `CreatorProfilePanel.tsx` |
| FreshnessBadge | current / aging / stale / unavailable + date | `dashboard/states.tsx` |
| SourceBadge | verified / estimated / public / unavailable / stale | `dashboard/states.tsx` |
| ContactTrustBadge | availability and check state; never shows a value before reveal | `dashboard/states.tsx` |
| Eligibility label | eligible · below 10k · count too old · activity unverified | `SearchModule.tsx`, `CreatorProfilePanel.tsx` |
| Tables | header row slate-50, `text-xs`, row dividers slate-100, `tabular-nums` for numbers; wide tables scroll inside their card, never the page | lists, billing ledger, staff views |
| Badges / chips | `rounded-full`, `text-[10px]`–`text-xs`; status chips carry text, not colour alone | throughout |
| Charts | only real persisted series; empty state otherwise | `Analytics.tsx`, `ui/chart.tsx` |

## Feedback and status

| Component | Rules | Source |
|---|---|---|
| LoadingBlock / Skeleton | shaped like the result | `dashboard/states.tsx`, `ui/skeleton.tsx` |
| EmptyState | title, one sentence, one action | `dashboard/states.tsx` |
| ErrorState | message, request id when the API gave one, retry | `dashboard/states.tsx` |
| Unavailable | "Not available yet — <reason>", not interactive | `dashboard/states.tsx` |
| Toast | success only after the server confirms; errors with detail | `lib/toast` |
| Banners | billing status (past due/canceled), support access, service status (offline/degraded), workspace notice, step-up bar | `BillingStatusBanner.tsx`, `StatusScreens.tsx`, `staff-ui.tsx` |
| Job tray | running Live Discovery: stage text and counters from the server, cancel; no invented percentage; live state uses the `--live` teal token | `JobTray.tsx` |
| Status screens | Page not found; page error (reload/home) | `public/StatusScreens.tsx` |

## Navigation and layout

| Component | Rules | Source |
|---|---|---|
| Sidebar | groups Workspace / Account; active item indigo/slate; collapses to a menu on mobile | `Sidebar.tsx` |
| Top bar | workspace switcher, credit meter (skeleton while loading, never "healthy" by default), notifications, account | `Topbar.tsx` |
| Auth shell | centred card, logo, title, subtitle, footer link | `auth/AuthShell.tsx` |
| Staff console shell | role-filtered nav, step-up bar, Exit staff console | `dashboard/AdminConsole.tsx` |
| Dialogs | Radix Dialog; focus trapped; Esc closes; title is the accessible name | `ui/dialog.tsx` |
| Drawers / sheets | profile on desktop as a panel; mobile full screen | `ui/sheet.tsx`, `CreatorProfilePanel.tsx` |

## Credit and pricing components

| Component | Rules | Source |
|---|---|---|
| Plan card | name, monthly price, monthly credits, included features only; numbers from `/v1/billing/plans` | `landing/Pricing.tsx`, `Billing.tsx` |
| Credit meter | available, held; top-ups never expire; monthly credits end at renewal | `Topbar.tsx`, `Billing.tsx` |
| Quote panel (Find New) | maximum, minimum when TikTok is in scope, expiry; the server rule in words | `FindNewDialog.tsx` |
| Mock checkout label | visible whenever the mock payment provider is active | `Billing.tsx` |

## Permission-aware controls

Controls the role may not use are hidden or disabled with "Only an owner or admin can …"; the server enforces every rule
regardless (403). Staff admin actions show the step-up bar until a key is confirmed (5 minutes).
