# Design gaps

What is missing, undecided or known to differ, with the next step. Fixed items are kept briefly at the end so the history
is visible.

## Open

| # | Gap | Why | Next step |
|---|---|---|---|
| G-01 | **No Figma file** | No Figma access in this environment | Build it with FIGMA_BUILD_GUIDE.md; never present these specs as Figma frames |
| G-02 | Manual screen-reader and keyboard-only review (UX-05) | Needs a person with NVDA / VoiceOver | Run K §8's list (sign-up, search + profile + reveal, Find New to a terminal state, billing, invitation, delete workspace) and record results |
| G-03 | Live Discovery terminal states with real providers | Paid providers are blank in every local run; only refund paths are exercised | Owner authorises the pilot envelope (D-09); then design-check each outcome against real runs |
| G-04 | Live Discovery public wording | Owner decision D-04 | Keep current copy (states the server rule) or adopt the mandate's §5 wording |
| G-05 | Empty catalogue searches charged | Owner decision D-05 | If made free, update the search cost chip, the no-results state and the tests |
| G-06 | Who may buy plans | Owner decision D-06 (Admins can today) | Restrict plan/top-up buttons to Owners if decided |
| G-07 | Contact strings inside bios | D-11 and the Search freeze (SEC-08) | Design the redacted bio ("contact details hidden — reveal") once approved |
| G-08 | "How we read your search" and "Not applied" chips (SRCH-06) | Search output contract is frozen until ratings | Design now, ship after ratings |
| G-09 | Keyset pagination / "Results changed — search again" (SRCH-08) | Search frozen | Same |
| G-10 | Email confirmation "expired link" state verified only by code, not by a real email | Local Supabase runs with confirmations off; hosted SMTP not set up | Test in a hosted staging project with SMTP |
| G-11 | Page error boundary not exercised by an automated check | Needs a deliberately broken page | Add a test-only trigger behind a development flag, or accept as a justified exception |
| G-12 | Compare view has no E2E check | Not covered by the journeys | Add a journey step (open two profiles, compare) |
| G-13 | Annual billing and its saving label (D-17) | Annual billing not offered (OD-002); "save 20%" must never appear (plans-claims.test) | Design per-plan actual saving when approved |
| G-14 | Legal text | Drafts; counsel review pending | Replace drafts; keep version + date; remove the draft banner only after counsel approves |
| G-15 | Billing screen does not itself say "test mode" | The test checkout page does ("Test mode: no real payment"); the screen before it does not | Optionally add a "Payments are in test mode" note when the server reports the mock provider |
| G-16 | Urdu / RTL samples | Inputs use `dir="auto"`, but no Urdu fixture creators exist | Add fictional Urdu-script fixture content and design frames |

## Fixed while writing this handoff (2026-10-19)

- Unknown routes showed the landing page → **Page not found** screen (UX-06).
- No page-error safety net, no offline/degraded indication → error boundary, offline and degraded banners (UX-07).
- No email-confirmation result screen → `#/confirmed` with three outcomes (UX-08).
- Credit balance showed **0 while loading or on error** → shows "—" while loading and "could not be loaded" on error.
- Dead links: footer columns (22 links to pages that do not exist), "Talk to our team", "Explore …", navbar "Docs" →
  replaced with real destinations or removed.
- Unused components with false claims removed: `ErrorPage.tsx` ("our engineers were paged", a status page that does
  not exist), `shared/*` duplicates (including an "AI-estimated audience" label the owner's rules forbid),
  `figma/ImageWithFallback.tsx`.
- Terms dialog closed before the acceptance was stored → stays open with "Saving…" until stored.
- Live/positive state token added (`--live`, teal-700) and used for running Live Discovery jobs.
