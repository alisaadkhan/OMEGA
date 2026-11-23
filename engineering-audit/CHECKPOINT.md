# Checkpoint (end of session 24 Nov 2026)

Resume from here. Records: NIGHTLY_BASELINE.md, NIGHTLY_PROGRESS.md (task log), NIGHTLY_DECISIONS.md,
APPROVAL_REQUIRED.md (owner actions AP-01..AP-08).

## State
- Branch `feat/redesign-2026-11-16`. Local commits not on GitHub: 0f52c35 (notifications, support conversations,
  Data Sources history), 2de201f, d5a967a, 51c1cce (audit fixes). Production = github tip 184ad7f.
- Live DB has migrations through 0099. 0100 (notifications + erase fix) must be applied before pushing 0f52c35 (AP-01/02).
- Tests at checkpoint: typecheck pass; eslint clean; unit 776/777 (only the YouTube eval retention test, AP-08);
  frontend 98/98; integration: acceptance + privacy + notifications + ops + billing pass on a fresh database;
  6 Meilisearch-backed search tests not run (local Meilisearch stopped for low memory).

## Next executable tasks, in order
1. Re-run the full integration suite once Meilisearch can run (T-014).
2. Customer e2e suites (`npm run e2e:customer`, `e2e:staff`) against the local stack when memory allows; screenshot
   the new Overview, ticket conversation and bell.
3. Search quality: run the existing search evaluation scripts on the local catalogue; record precision per query set.
4. Dependency hygiene: list unused packages per workspace (verify imports before removing anything).
5. Repository hygiene report (root bundles, tmp/, dumps/ belong to the owner: report, never delete).
6. Load test plan with k6 against a local API only (never production).
