# Progress (living log, newest last)

| ID | Task | Workstream | Priority | Status | Evidence |
|---|---|---|---|---|---|
| T-001 | Baseline: typecheck, lint, unit, frontend, npm audit | QA | P0 | COMPLETED | NIGHTLY_BASELINE.md |
| T-002 | Key rotation missed `staff.staff_users.totp_pending_encrypted` (a rotation would leave a pending authenticator undecryptable) | Security | P1 | COMPLETED | commit 2de201f; key-rotation.int 3/3 |
| T-003 | Shared test database polluted by the staff pricing test (Growth 13,000, reveal 7) causing false billing failures | QA reliability | P1 | COMPLETED | commit 2de201f; ops+billing int 91/91 together |
| T-004 | Migration-number assertion failed at 0100 | QA | P2 | COMPLETED | commit 2de201f |
| T-005 | Lint error | Code quality | P3 | COMPLETED | commit 2de201f; `eslint .` clean |
| T-006 | Bio-link crawler accepted special-purpose address ranges (SSRF hardening) | Security | P2 | COMPLETED | commit d5a967a |
| T-007 | `.catalog-storage/` (raw payloads, contact cache) ignored only locally, not by the repo | Privacy | P2 | COMPLETED | commit d5a967a |
| T-008 | YouTube evaluation data past the 12 Nov deletion deadline (`mushin_eval_disposable`) | Compliance | P1 | AWAITING APPROVAL | APPROVAL_REQUIRED AP-08 |
| T-009 | Crawler DNS rebinding (check and connect resolve separately) | Security | P3 | ACCEPTED RISK | operator-only script; documented in NIGHTLY_DECISIONS.md |
| T-010 | Full integration suite on a fresh database: 42 failures found | QA | P0 | COMPLETED | 39 = acceptance briefs under 3 words (owner rule 22 Nov), 1 privacy gap, 2 follow-ons; 6 search tests need Meilisearch (not running: stopped for low memory) |
| T-011 | Account erasure did not erase the new notifications (personal data left after "delete my account") | Privacy | P1 | COMPLETED | commit 51c1cce; privacy.int passes |
| T-012 | Acceptance suites updated to 3+ word live briefs | QA | P2 | COMPLETED | commit 51c1cce; acceptance 158+36 pass |
| T-013 | Production security headers and CORS | Security | P1 | COMPLETED (VERIFIED) | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy on page and API; foreign origin gets no CORS allow |
| T-014 | Meilisearch-backed search tests (6) | QA | P2 | BLOCKED | local Meilisearch stopped by the host for low memory; restart only when the machine has memory |
| T-015 | Production auth boundaries: customer, staff and cron endpoints without or with a forged token | Security | P0 | COMPLETED (VERIFIED) | /v1/me, support, featured: 401; /admin/v1/* (overview, subscriptions, catalogue, audit): 401; forged staff token 401; cron without secret 404; public showcase and plans 200 |
| T-016 | Live landing page in a real browser at 390 px: overflow, console, showcase images | UX | P2 | COMPLETED (VERIFIED) | no page overflow, 0 console errors/warnings, 24 creators x2 loop, 0 broken images; evidence/landing-mobile.png |
| T-017 | Reach out on a creator in no campaign creates "Untitled N" and opens its Outreach page (owner, 24 Nov) | Product | P1 | COMPLETED | commit 6b689f0; unit test |
| T-018 | YouTube evaluation data purge (owner approved 24 Nov) | Compliance | P1 | COMPLETED | purge --verify clean; retention test passes; unit 777/777 |
| T-019 | Non-qualifying creators to Trash (owner 24 Nov: "if not, no need for them"): 1,364 (444 under 10k, 720 brand/organisation, 172 outside Pakistan, 28 inactive/gone); restorable 45 days; searchable unchanged at 888 | Data | P1 | COMPLETED (local) | trash-unqualified --apply |
| T-020 | Live contact fix (owner approved 24 Nov): 111 phones to +92, 6 repeats, 3 typo emails; 94 creators re-projected; re-check finds nothing left | Data | P1 | COMPLETED (live) | commit 888172c |
| T-021 | e2e browser suites could not start: Chrome 158 has no --headless=old (playwright-core 1.48) | QA | P1 | COMPLETED | commit 888172c |
| T-022 | Live sync carried only removals/merges, not staff Trash, Hide or bans | Data | P1 | COMPLETED | live-sync.ts step 5 |
| T-023 | YouTube refresh of qualifying creators (YouTube API on for the run, owner 24 Nov) | Data | P1 | IN PROGRESS | build refresh-yt-1124 |
| T-024 | Staff browser suite (every admin page, role, security rule, a11y): 7 failures fixed: AA contrast on Overview hints, missing page heading, outdated option-b expectations | QA / a11y | P1 | COMPLETED | 57/57 pass; commit 6651e01 |
| T-025 | Customer browser suite (sign-up to outreach, support, billing, security, a11y): 3 failures fixed: React effect returning a value, 3-word brief, removed activity feed | QA | P1 | COMPLETED | 118/118 + 55/55 pass; commit ab6d756 |
| T-026 | e2e runners left stub/Vite/API/worker processes holding ports on Windows (bash kill does not stop the node child) | QA tooling | P2 | COMPLETED | taskkill /T on the Windows pid; commit ab6d756 |
| T-023 | YouTube refresh of qualifying creators (owner 24 Nov): 618 of 619 refreshed through the YouTube API (free); about $0.05 AI; searchable 882 | Data | P1 | COMPLETED (local) | build refresh-yt-1124 report |
| T-027 | Live catalogue sync (owner approved 24 Nov): 175 creators added, 3,359 trashed, 272 banned links, 4 merges, ~1,700 refreshed; search projection rebuilt; 1,167 photos; 1,422 posting rates; 95 contacts (83 creators); every live email checked | Data | P1 | COMPLETED (live) | load-staging, sync-avatars, sync-posting, sync-contacts, check-emails |
| T-028 | Live state after the sync: 882 searchable (IG 246, TikTok 17, YouTube 619), 343 with a contact; 1,194 active, 3,359 in Trash (restorable 45 days) | Data | P1 | VERIFIED | live query 24 Nov |
| T-029 | Live migration 0100 applied on owner instruction; 11 commits pushed (184ad7f..b12d136) | Release | P0 | COMPLETED (live) | migrate output "applied 0100_notifications.sql"; AP-01/AP-02 done |
| T-030 | Creator Checks problem categories (owner 25 Nov): Doesn't qualify split per problem with live counts, one problem at a time, problems named on each card | Feature | P1 | COMPLETED | int 5/5; staff e2e 57/57; commit 07c860b |
| T-031 | Meilisearch-backed tests re-run (T-014): interpretation test outdated (followUp/understood fields) and fixed | QA | P1 | COMPLETED | 4 search files 31/31 |
| T-032 | Budget gate race: spend and reservations read in two statements let a 6th 0.1 call through a 0.5 cap; now one snapshot | Spend safety | P0 | COMPLETED | race test failed 2/3 before, 0/10 after; commit 55935bd |
| T-033 | Full integration suite: 802 pass; only profile.int "refresh price" fails, in files another session is editing (uncommitted) | QA | P1 | REPORTED | left to that session |
| T-034 | Local load check on the disposable e2e stack (200 requests, concurrency 10): search p95 273 ms (target 800); lists 59, campaigns 36, creator 98, billing 83 ms (target 300); all 200 OK | Performance | P2 | COMPLETED | E2E_LOADCHECK=1 npm run e2e:customer |
| T-035 | Search quality probe, 20 briefs, top 10 on the local catalogue: no zero-result brief; about 93% on topic after manual check (fitness = Wellness, real estate correct); weak: "pubg" (platform account Walee, an entertainment creator, GTA/tech channels), "cooking" (1 off-topic) | Search | P2 | MEASURED | relevance-probe.ts --json |
| T-036 | Dependency hygiene: no unused package in any workspace (Geist font via CSS, @types are type-only, dependency-cruiser via npm script) | Hygiene | P3 | COMPLETED | import scan |
| T-037 | Repo hygiene: no tracked file over 1 MB; 1 TODO; no secrets tracked (.env.example only); 5 source files over 500 lines (SearchModule.tsx 1,408; creators/repository.ts 698; enrichment/repository.ts 671; live-runner.ts 608; creators/service.ts 513), splitting is a refactor for later; untracked owner bundles and logo files left untouched | Hygiene | P3 | REPORTED | git ls-files scan |
