# Findings register

Every defect found by the audit, newest last. Severity: P0 critical · P1 high · P2 medium · P3 low.

| ID | Finding | Severity | Root cause | Status | Evidence |
|---|---|---|---|---|---|
| F-01 | Catalogue budget gate could let one extra paid call past the cap under concurrency | P1 | spend and reservations read in two statements (two snapshots) | FIXED | race test 2/3 fail before, 0/10 after; 55935bd |
| F-02 | Linked accounts and bio links changed order between reads | P3 | ties on first_seen_at | FIXED | profile int; c1ee50b |
| F-03 | A creator link with broken percent-encoding threw (search, profile, campaign list) | P2 | decodeURIComponent unguarded | FIXED | creator-links test; ece98ea |
| F-04 | Search filter recording failed silently when niches were chosen | P2 | drizzle expands an array parameter into a value list; error swallowed by try/catch | FIXED | EV-05; 8fde9e9 |
| F-05 | Phone-link host regex treated dots as "any character" (brit.co withheld as t.co) | P2 | "\." in a plain string is "." | FIXED | phone-links test fails on old code; 30a4862 |
| F-06 | e2e suites failed falsely when files changed mid-run | P3 | Vite HMR duplicated React context modules | FIXED | ba1b128 |
| F-07 | Staff list showed full emails to any non-support role (fail-open) | P2 | role !== "support" | FIXED (staff session) | allowlist admin/super_admin |
| F-08 | live-order.test.ts fails typecheck in its committed form | P3 | fixture predates card fields | OPEN — owner's local copy fixes it; repository rule forbids committing it | AP register |
| F-09 | First-load bundle 293 KB gzip | P3 | framework + auth + validation in the entry chunk | ACCEPTED for now | T-052 |
