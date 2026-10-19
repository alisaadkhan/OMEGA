# MUSHIN design handoff

Specification files for building MUSHIN's design file. **No Figma file was created**: this environment has no Figma
access, so these are Markdown/CSV specifications only, written from the shipped product (`frontend/`) and the audit's UI
specification (`docs/audit/2026-10-16/K_UI_UX_SPECIFICATION.md`). They describe the existing MUSHIN look and behaviour;
they are not a redesign.

## Files

| File | What it holds |
|---|---|
| PRODUCT_UI_SPEC.md | principles, colour/type/spacing/radius tokens as built, responsive rules, global states, accessibility |
| PAGE_INVENTORY.md | every route and in-app view: role, purpose, data, states, source files, status, automated check |
| COMPONENT_SPEC.md | components as built, with variants, states, rules and source files |
| WIREFRAMES.md | text wireframes per screen with responsive changes |
| INTERACTION_FLOWS.md | end-to-end flows with the server decision at each step and every exit |
| FIGMA_BUILD_GUIDE.md | page structure (audit IDs 02–23 kept; 00, 01, 18 assigned), step-by-step build, prototype links |
| FIGMA_IMPLEMENTATION_MAP.csv | each screen/component → spec section, real source files, status, automated check (paths validated) |
| DESIGN_GAPS.md | missing design, owner decisions, known differences; fixes made while writing |

## How to use

1. Run the app locally (`docs/completion/RUNBOOK.md` §1) and keep it open beside Figma.
2. Follow FIGMA_BUILD_GUIDE.md: tokens and components first, then pages, then states and responsive versions.
3. Use only fictional content (the "Fixture …" creators in `scripts/e2e-fixtures/catalogue.ts`).
4. When the product changes, update PAGE_INVENTORY.md and FIGMA_IMPLEMENTATION_MAP.csv in the same commit.

## Status (2026-10-19)

Status words follow mandate v3 §11. Everything listed is **Implemented**; most screens are **Locally verified** by the
customer and staff browser suites (`npm run e2e:customer`, `npm run e2e:staff`). Nothing is Integration verified against
real providers, hosted Supabase, Paddle or Resend, and Search relevance is **not accepted** (human ratings pending).
