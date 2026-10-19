# Figma build guide

**No Figma file exists.** This repository had no Figma access when these files were written; nothing here was created in
Figma and no link is implied. This guide tells a designer how to build the file from the shipped product and the specs
in this folder.

## 1. Page structure (reconciled numbering)

The audit's map (`K_UI_UX_SPECIFICATION.md`) numbers the product pages 02–23 and existing frames may already use it, so
those IDs are kept. The mandate's suggested sections are placed into the unused IDs 00, 01 and 18.

| Figma page | Contents | Mandate section it covers |
|---|---|---|
| 00 Cover & principles | product name, date, status "built from the shipped app", PRODUCT_UI_SPEC §1 principles | 00 Cover and design principles |
| 01 Foundations & components | colour, type, spacing, radius, elevation tokens (§2–4 of PRODUCT_UI_SPEC); every component in COMPONENT_SPEC with variants and states | 01 Foundations, 02 Shared components |
| 02 Marketing | landing (all sections), pricing | — |
| 03 Authentication & first run | sign in, sign up, confirmation result (3 outcomes), forgot, set new password (form, saving, expired), invitation (6 states), first workspace, Terms dialog | 03 Authentication and onboarding |
| 04 App shell | sidebar, top bar, banners (service, billing, support access, workspace), job tray | 04 Main application shell |
| 05 Dashboard | cards with loading/empty/error/unknown balance | |
| 06 Search & Find New Creators | search idle/loading/results/no results/insufficient/no plan/rate limited; Find New brief, quote, running, every terminal outcome | 05 Creator discovery |
| 07 Creator profile · 08 Compare · 09 Lists | | 06 Creator profiles and lists |
| 10 Campaigns · 11 Outreach | | 07 Campaigns and outreach |
| 12 Analytics | | |
| 13 Credits & billing | balance, plans, top-ups, ledger, test checkout page, past due / canceled | 08 Credits and billing |
| 14 Settings · 15 Support & activity | | 09 Workspace settings |
| 16, 19–23 Staff console | sign-in, step-up, each view, approvals, security keys + enrolment code | 10 Support and administration |
| 17 Not available | Inbox, audience details: "Not available yet — <reason>" | |
| 18 States, responsive & edge cases | global state catalogue (PRODUCT_UI_SPEC §6) × page families; 390/768/1280/1440 versions; long names, long bios, missing images, large numbers, wide tables, Urdu/RTL samples; legal pages, remove my data, not found, page error | 11 Responsive layouts, 12 Edge cases and component states |

## 2. Steps

1. **Tokens** (page 01): create colour styles from PRODUCT_UI_SPEC §2 (slate scale, indigo, emerald, amber, red, live
   teal `#0f766e` / `#f0fdfa`), text styles from §3 (12/14/15/18/20/26 px; 400/500/600/700), effects (shadow-sm,
   shadow-xl), radius variables (6, 12, 16, full). Use Figma variables with a light mode only (the app has no dark mode
   in use).
2. **Components** (page 01): build each COMPONENT_SPEC row as a component set with variants for every state listed
   (default, hover, focus, disabled, pending, error). Use auto layout everywhere: buttons (horizontal, padding 12/16,
   gap 8), cards (vertical, padding 16–24, gap 12), tables (vertical rows, fixed header).
3. **Frames**: for each page, one desktop frame (1440 × 900) per screen, then 1280, 768 and 390 versions on page 18 or
   beside it. Name frames `<id> <screen> / <state> / <width>`, e.g. `06 Search / no results / 390`.
4. **Content**: use the synthetic fixture creators (`scripts/e2e-fixtures/catalogue.ts`, all named "Fixture …") or
   clearly fictional names. Never real creators, real handles, real emails or YouTube data.
5. **Prototype**: connect the flows in INTERACTION_FLOWS.md (sign-up → confirmation → dashboard; search → profile →
   reveal; brief → quote → running → outcome; staff action → step-up → action). Dialogs as overlays; banners as
   component swaps.
6. **Check against the app**: compare each frame with the running app (RUNBOOK §1) and the implementation map
   (FIGMA_IMPLEMENTATION_MAP.csv). Where the design should differ from the build, record it in DESIGN_GAPS.md rather than
   silently diverging.
7. **Hand-off checklist**: K §9 (frames at four widths and all states; cost chips match server values; copy follows the
   no-pretend rule; legal and set-new-password screens; staff step-up/approvals with failure states; Urdu/RTL samples).
