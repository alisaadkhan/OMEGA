# Product UI specification

Foundations as built (measured from `frontend/src/app/components/**` and `frontend/src/styles/theme.css`, 2026-10-19),
plus the binding principles of the audit's UI spec (`docs/audit/2026-10-16/K_UI_UX_SPECIFICATION.md` §1). This describes
the existing MUSHIN look; it is not a redesign.

## 1. Principles (binding)

1. **Evidence first.** Every number shows its source and age; unknown is "Unknown", never 0; stale is labelled stale.
2. **Price before action.** A credit-spending control shows its cost on the control and again in a confirm step; copy
   states the server rule. Numbers come from the server (`/v1/billing/plans`, quotes), never from UI constants.
3. **No pretend features.** An unavailable capability is a disabled control with "Not available yet — <reason>". No
   fabricated testimonials, logos, metrics, demographics, progress percentages or links to pages that do not exist.
4. **Honest outcomes.** Empty, insufficient, partial, failed, cancelled and stopped-by-limit each have their own message,
   credit outcome and next step.
5. **The workspace is always visible**; switching is explicit and per tab.
6. **Pakistan-first language.** Free-text inputs use `dir="auto"` (English, Roman Urdu, Urdu); handles, URLs and ids use
   `dir="ltr"`.

## 2. Colour

Tailwind palette classes are the tokens in use (counts are occurrences in components).

| Role | Token (Tailwind) | Hex | Use |
|---|---|---|---|
| Text, strong | `slate-900` (176) | #0f172a | headings, primary text |
| Text, body | `slate-700` / `slate-600` | #334155 / #475569 | paragraphs, labels |
| Text, muted | `slate-500` (321) | #64748b | captions, metadata (meets 4.5:1 on white) |
| Surface | `white`, `slate-50` (104), `slate-100` | #fff / #f8fafc / #f1f5f9 | page, panels, chips |
| Border | `slate-200` (250), `slate-100` | #e2e8f0 | cards, inputs, dividers |
| Primary action | `bg-slate-900` (82), hover `slate-800` | #0f172a | the one primary button per area (navy-black) |
| Accent | `indigo-600/700` text, `indigo-50` surface | #4f46e5 / #4338ca / #eef2ff | links, selected states, focus |
| Success | `emerald-700` on `emerald-50` | #047857 / #ecfdf5 | confirmed, saved, eligible |
| Warning | `amber-800/900` on `amber-50`, border `amber-200` | | soft limits, drafts, degraded |
| Error | `red-600/700` | #dc2626 / #b91c1c | validation, failures, destructive |
| **Live (new, positive/live states only)** | `--live` `#0f766e` (teal-700) on `--live-surface` `#f0fdfa` | | a running Live Discovery run, "live" status dots. Contrast 5.5:1 on white. Never decorative |

Base tokens in `theme.css` (`--background`, `--foreground`, `--primary` #030213, `--destructive` #d4183d,
`--radius` 0.625rem) back the shadcn primitives in `components/ui/`. Colour is never the only signal: every status also
has text or an icon.

## 3. Typography

- Family: Inter, falling back to `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto` (self-hosted latin
  subset, 400/500/600/700; no third-party font requests).
- Scale in use: page titles 20–26 px / 700; section titles 15–18 px / 600; body `text-sm` (14 px); dense UI and metadata
  `text-xs` (12 px, the most common size); numbers use `tabular-nums`.
- Weights: 400 body, 500 labels, 600 buttons and headings, 700 page titles.
- Line height ~1.5 for body, 1.6–1.65 for long text (legal pages, FAQ).

## 4. Spacing, radius, elevation

- 4-pt grid (Tailwind spacing). Page gutters 16 px (mobile) / 24–32 px (desktop); cards pad 16 px (`p-4`) to 24–32 px.
- Radius: `rounded-md` (6 px) for buttons and inputs (most common), `rounded-xl` (12 px) for cards, `rounded-2xl` for
  dialogs and auth cards, `rounded-full` for chips, avatars and badges.
- Elevation: borders first; `shadow-sm` on cards, `shadow-xl` only for dialogs.
- Motion: ≤ 300 ms fades between routes; honour `prefers-reduced-motion`; no motion conveys meaning.

## 5. Layout and responsive rules

| Breakpoint | Width | Shell |
|---|---|---|
| Mobile | 360–599 | top bar; sidebar becomes a menu; single-column cards; filters stack |
| Tablet | 600–1023 | collapsible sidebar |
| Laptop | 1024–1439 | sidebar ~240 px + content; profile opens as a side panel |
| Desktop | ≥ 1440 | same, content max width ~1280 |

Validation frames: 390 × 844, 768 × 1024, 1280 × 800, 1440 × 900. No horizontal page scroll at 390 px (E2E `phone`
checks). Touch targets ≥ 44 px for primary controls, ≥ 24 px minimum (WCAG 2.5.8) for dense inline links.

## 6. Global states (every page family)

| State | UI | Source of truth |
|---|---|---|
| Loading | skeletons shaped like the result (`dashboard/states.tsx` LoadingBlock) | — |
| Empty / first use | explanation + first action (`EmptyState`) | |
| No results | reason, suggestions, credit outcome | server response |
| Validation | inline message per field (`field`, `missingRequirements`) | 400 |
| Permission denied | "Only an owner or admin can …" | 403 |
| Workspace access lost | notice; selection cleared | 403 `workspace_access_denied` |
| Insufficient credits / no plan | balance and required credits; plan choice | server error details |
| Rate limited | retry time; input kept | 429 + Retry-After |
| Session expired | sign-in page; no retry loop | 401 |
| Offline | top banner "You are offline…" | browser `offline` event |
| Service degraded | amber banner "MUSHIN is partly unavailable…" | `/health/ready` 503 |
| Server error | message with request id where the API returned one (`ErrorState`) | 5xx |
| Page error | "This page could not be shown" + reload/home | render error boundary |
| Unknown route | "Page not found" + home / sign in | router |
| Unavailable capability | disabled control, "Not available yet — <reason>" | capability flags |

## 7. Accessibility

WCAG 2.2 AA target: contrast (text 4.5:1, UI 3:1), keyboard reachable actions, visible focus, focus trapped in dialogs
with Esc to close, labelled inputs, `role="status"`/`role="alert"` for live messages, non-colour status cues. Automated:
axe (serious/critical) on every customer page, dialogs and staff sections in E2E. Manual screen-reader pass: not yet
done (DESIGN_GAPS).

## 8. Component conventions

See COMPONENT_SPEC.md. One primary (slate-900) button per area; secondary is bordered slate; destructive is red and
always confirmed; links are indigo. Toasts confirm only what the server confirmed.
