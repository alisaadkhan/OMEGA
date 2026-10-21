# MUSHIN documentation: where the truth lives

One source per subject. Where an older document disagrees with the source named here, the source wins. Older
documents are kept unchanged as an audit trail, and are marked "superseded" where they state rules that no longer hold.

## Canonical sources

| Subject | Source of truth |
|---|---|
| Current state, newest session first | `completion/PROGRESS.md` |
| Components, configuration, evidence level per component | `completion/TECHNOLOGY_INVENTORY.md` |
| Open defects and gaps | `completion/GAP_REGISTER.md` |
| What blocks release, who acts | `completion/REMAINING_BLOCKERS.md` |
| Decisions taken and decisions waiting for the owner | `completion/DECISION_LOG.md` |
| Release gates | `completion/RELEASE_READINESS.md` |
| Search acceptance (verdict and evidence) | `completion/final-search-acceptance-report.md`, plus `completion/search-v2-evidence/` for the search-v2 catalogue work |
| Running, operating and recovering | `completion/RUNBOOK.md` and `readiness/local-setup.md` |
| Search backends (PostgreSQL default, Meilisearch optional) | `completion/TECHNOLOGY_INVENTORY.md` § Meilisearch; the 2026-10-14 measurements in `readiness/search-backends.md` |
| Frontend pages: built, planned, should be built | `design/FRONTEND_REQUIREMENTS.md` (register) and `design/FIGMA_UI_SPEC.md` (design and copy); wireframes, interaction flows, component specs and the Figma build guide in `../design/figma/` (location set by mandate v3 §8.6) |
| Source requirement documents (SRS, system diagrams, UI product experience specification; design sources: PDS, design-system brief, UI simplicity rule, UI acceptance criteria, ownership and evidence rules, Volume 14 notifications) | `../reference_files/` and `../reference_files/design-sources/` |
| Prices, credits, plans, trial | The database seed is authoritative (`platform.plans`, `platform.credit_action_costs`, `platform.topup_packs`, `platform.billing_settings`). The values below are copied from it |

## Pricing, credits and trial (copied from the database seed, 2026-10-21)

| Plan (id) | Monthly price | Monthly price, billed yearly | Credits per month |
|---|---|---|---|
| Starter (`explorer`) | Rs 4,900 | Rs 3,900 | 2,500 |
| Growth (`growth`) | Rs 12,900 | Rs 10,900 | 12,000 |
| Scale (`scale`) | Rs 24,900 | Rs 19,900 | 35,000 |

Annual billing is not offered yet (owner decision OD-002); the yearly prices are stored, not sold.

| Action | Credits |
|---|---|
| Catalogue search | 50 |
| Live Discovery run start | 50 |
| Each new creator a live run delivers | 10 (a run that delivers no creator costs nothing; never more than the confirmed quote) |
| Contact reveal | 5 |
| Data refresh (any platform) | 50 |
| Audience estimate | 5 |

**Top-ups:**
- 1,000 credits for Rs 2,500;
- 5,000 credits for Rs 9,900;
- 15,000 credits for Rs 24,900.

Top-up credits never expire (owner decision 2026-10-14, enforced by a database constraint since migration 0045).

**Trial:**
- founder-approved only, never automatic;
- 14 days, 2,500 credits on the Starter plan (`platform.billing_settings`), issued through the credit ledger;
- extensions and callback-request retention are owner decisions (TRIAL-01, TRIAL-02).

To change a price or a cost, change the seed through a migration and update this table in the same commit.

## Superseded documents (kept for history)

| Document | What it states that no longer holds |
|---|---|
| `00-requirements-analysis-and-questions.md` | Action costs 0 / 12 / 5 / 10; a 200-credit trial cap |
| `superpowers/specs/2026-10-06-mushin-backend-architecture-design.md` | The same early costs and trial cap |
| `superpowers/specs/2026-10-07-billing-credits-design.md` | Top-ups valid for 12 months (they never expire) |
| `superpowers/plans/` (removed 2026-10-21) | Step-by-step build checklists for subprojects 1–4, all built; recoverable from git history (`git show 9223dc7:docs/superpowers/plans/<file>`) |
| `readiness/README.md` (sections 1–7) and `readiness/progress.md` | The state of 2026-10-14 to 2026-10-17. `completion/PROGRESS.md` is the running record now |
| `audit/2026-10-16/` | The external audit. Its findings are tracked to closure in `completion/GAP_REGISTER.md` |
