# MUSHIN — Supabase-First Recovery, Full-System Completion & Deployment-Readiness Mandate (v4)

Received 2026-10-19 (session 3), with the Critical Release-Guard Addendum. Governs work after mandate v3
(`MUSHIN_COMPLETION_MANDATE_V3.md`); where they conflict, v4 and its addendum win. Status words: **PASS**, **FAIL**,
**BLOCKED**, **NOT TESTED**, **NOT ACCEPTED**. Verification levels: local · isolated integration · real hosted service ·
production-like rehearsal · authorised production.

## Summary of the mandate (phases)

0. **Source of truth:** read `docs/completion/`, inspect HEAD and the working tree, keep other people's changes, and
   keep a checklist and blocker register. Never reset, clean or discard work. Never expose secrets.
1. **Supabase first:**
   - diagnose DNS, network, project-mixing, JWKS/issuer, credential, TLS and migration problems separately;
   - identify the intended project (ask if ambiguous) and repair the configuration without weakening JWT validation;
   - prove connectivity stage by stage (DNS, HTTPS, JWKS, DB, read-only schema, API start, a genuine token accepted,
     forged/expired/wrong-issuer tokens refused, isolation, health);
   - only read-only remote inspection; no remote schema change without authorisation.
2. **Complete the application:**
   - identity and workspaces;
   - catalogue Search (frozen ranking and dataset; NOT ACCEPTED until two raters and an adjudicator pass the gate);
   - Live Discovery (fixtures only, no paid calls);
   - profiles and contact integrity (nothing invented);
   - lists, campaigns, outreach (no real email);
   - credits and billing (one ledger; Paddle not verified until sandbox);
   - staff operations;
   - every remaining surface (no button without an action).
3. **Founder-assisted 14-day trial:**
   - "Call us for a free 14-day trial" with the owner's configured number (never invented);
   - a callback form: validated server-side, abuse-protected, persisted with an audit trail;
   - activation approved by owner or staff only, idempotent, no duplicate trials or grants;
   - expiry enforced on the server, never auto-billed, reminders only through an authorised channel;
   - an unbiased, access-controlled feedback form.
   - Trial credit amount, reset, reminder timing and extension policy come from existing decisions or are owner
     decisions.
4. **Security, reliability and UX review:** using official documentation, recording the sources.
5. **Verification:** the 18 test layers, plus the trial acceptance tests (callback, approval permissions, idempotency,
   server-side expiry, credit invariants, no duplicate reminders, no automatic billing, data kept at expiry, tenant-safe
   feedback).
6. **Deployment readiness:** without deploying. No deploy, production data change, risky remote migration, real email,
   charge, paid provider call, public change, deletion or credential revocation without explicit authorisation.
7. **Documentation:** update the existing `docs/completion/` files; split blockers into engineering, owner and
   external.
8. **Release gate:** PASS/FAIL/BLOCKED/NOT TESTED/NOT ACCEPTED. Never "100% ready" while a material blocker remains.

## Addendum (overrides conflicting text)

- **A. Supabase's role first.**
  - Map the frontend, API, worker, database, Auth, queue and providers.
  - Establish whether Supabase hosts the primary database or only Auth.
  - Until that is resolved, do not repoint the application database, copy records, change ownership, reset, or push
    migrations to a hosted project.
  - Connecting Auth does not authorise moving the database.
- **B. Recoverability and reproducibility.**
  - Need a clean install from the lockfile, reproducible builds, and separate API and worker starts.
  - Migrations must be tested on a disposable database, with upgrade and rollback procedures.
  - Run an authorised restoration exercise in isolation. A documented backup is not evidence that restore works.
- **C. Formal Supabase security review.** Covers:
  - JWKS and issuer;
  - project and environment separation;
  - least privilege, RLS and grants (positive and negative tests), Security Advisor;
  - TLS and network restrictions;
  - administrator MFA;
  - Auth email and recovery;
  - pooling and limits;
  - no privileged keys in the frontend;
  - backup retention and a real restore test.
- **D. Hard release gates 1–11.** Each gate needs evidence and an environment:
  1. architecture and configuration;
  2. Auth and the database connection;
  3. schema, permissions and isolation;
  4. critical workflows end to end;
  5. credit and billing invariants;
  6. Search acceptance with human ratings;
  7. trial criteria;
  8. security and recovery;
  9. builds, migrations, worker, monitoring and rollback;
  10. provider, legal and business approvals;
  11. authorised deployment plus smoke tests.
- **E. Search is a separate gate.** Never fabricate contacts, ratings, traffic, provider success, feedback or
  performance.
- **F. Final release matrix and verdict.** The verdict is one of: not ready · ready for isolated testing · ready for a
  controlled trial with restrictions · production-verified. Choose the highest state the evidence supports.

The full text was supplied in the session-3 prompt; this file records its binding requirements for later sessions.
