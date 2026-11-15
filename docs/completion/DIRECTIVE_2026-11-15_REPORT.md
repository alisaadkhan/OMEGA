# MUSHIN — Directive of 15 November 2026: what was done, what was found

Directive: "Final pilot corrections, engagement rate standardization, celebrity AI filter & full-catalogue
re-verification go-ahead". Everything ran on the local catalogue `mushin_catalog_v4` after a backup
(`.catalog-storage/backups/mushin_catalog_v4-before-reverify-2026-11-15.dump`, git-ignored). Nothing was pushed and
staging/production were not touched. No paid provider credit was used (Groq free tier, Wikipedia public API).

Commits (branch `feat/internal-completion-and-search-acceptance`, unpushed): `3371d30`, `1269ee4`, `6b047e1`, `44fe286`,
`a344874`, `f3b3ee4`, `b867329`, `b5478ca`, `11f88a8`, `3068c60`, `721dd3f`, `d61e264`, `254eb5e`, `83bd0f4`.

Order of a full run on any catalogue: evidence backfill → reassessment → AI review (and the reassessment may be rerun
at any time now without undoing the AI review).

Per-channel YouTube figures (subscribers, engagement) are left out of this file on purpose: YouTube API data may be
kept 30 days at most (Developer Policies III.E.4.b), and a committed file keeps it for ever. They were shown in chat only.

## 1. In short

- **Engagement rate** is now one number on every platform: the median per follower over the latest 10 non-pinned posts
  with visible likes (at least 3), with collab outliers above 5× followers left out. The stored rate and the median
  agree on every profile that could be measured (§4).
- **Main niche**: ties and "variety" always get a main niche now, including niches kept from earlier evidence (441
  creators fixed in the full run). Ducky Bhai: Comedy.
- **Celebrities**: an AI review with a Wikipedia check moves television/film actors, singers, sportspeople, anchors
  and politicians to "public figure" (excluded); digital creators stay. The first full run showed the check was
  missing and the smaller model got actors wrong; both were fixed before the final pass.
- **Not finished**: the AI re-review stopped when both Groq models reached their free daily limit; about 365
  accounts wait for it (§6). A few known mislabels remain for staff (§6).
- **Incident, recovered**: rerunning the whole-catalogue reassessment after the AI review erased the AI account types
  (a script bug, now fixed); they were restored from a snapshot and the key Wikipedia decisions re-applied (§3 #10).

## 2. Directive sections

| Section | What was done | Where |
|---|---|---|
| §1 ER per follower | `followerEngagement()`: likes + comments per follower, median of up to 10 latest non-pinned posts with likes > 0, at least 3 posts; a post above 5× followers (collab) or with hidden likes is left out; above 100% is not stored (the column allows 0–100). Stored ER and the median use the same function. Per-view ratios stay only inside authenticity signals. | `signals.ts`, `eligibility-v3.ts`, `reassessment.ts` |
| §2.1 Ties / variety | Vlog words count for Lifestyle; a tie or variety picks a main niche (AI pick, else the first non-Lifestyle, else the first), confidence low; an earlier "variety" record is replaced when today's reading resolves it; kept earlier niches get a main niche. | `niche-evidence.ts`, `semantic-niche.ts`, `enrichment/repository.ts` |
| §2.2 Emoji-only 100K+ | The AI review estimates a niche where the evidence gives none; it is stored as `post_estimated` with 0 posts and always shown as "AI estimate". A later backfill no longer erases it. | `ai-review.ts`, `enrichment/repository.ts` |
| §2.3 Celebrity filter | gpt-oss-120b with a Wikipedia check (name-matched articles only, given to the model as data). Traditional celebrity → `CELEBRITY_PUBLIC_FIGURE` (excluded at medium confidence); digital creators → `INDIVIDUAL_CREATOR`. Never over a staff decision or a confident rule. | `enrichment/ai-review.ts`, `scripts/catalog/ai-review.ts` |
| §2.4 Promotion | Under 100K: an own-content niche, a creator cue or a collab route makes an UNKNOWN account an individual creator (low). 100K+ is left to the AI review (famous people post fashion too). | `reassessment.ts` |
| §2.5 YouTube tick at 100K | **Not done** (see §5). | — |
| Decision 1 | Full re-verification run after the pilot: reassessment, evidence backfill, AI review. | `scripts/catalog/*` |
| Decision 2 | AI + Wikipedia check: done (Wikipedia step added after the first run, §3). | as §2.3 |
| Decision 3 | Instagram keeps "No view counts"; stored Reel views are kept on reprocess; no paid Reels scraper. | `reassessment.ts` |
| Decision 4 | Eval data purged with the official script (`--confirm`, then `--verify` clean); `mushin_eval_disposable` and `mushin_frz_elig2_disposable` dropped. `mushin_catalog_v2_eval_disposable` (51 MB) left for the owner. | — |
| Decision 5 | Live sync and push: **waiting** for the owner's answers in §7. | — |

## 3. Problems found during the full run (all fixed and tested)

| # | Problem | Effect | Fix |
|---|---|---|---|
| 1 | The AI review had no Wikipedia step (Decision 2) | gpt-oss-20b (the fallback when 120b is rate-limited) labelled TV actors "fashion influencers": Durefishan Saleem, Wahaj Ali, Ushna Shah, Komal Meer, Madiha Imam, Saboor Aly | Wikipedia check; re-review of earlier AI decisions; `--models` keeps the review on 120b (`44fe286`) |
| 2 | Wikipedia matching too loose at first | A drama article matched because the actress is in its cast; a 1894 singer matched "Rajab Ali" | Article must be titled with the name or open with it in full; one-word names are not looked up |
| 3 | A failed Wikipedia lookup looked like "no article" | Silent loss of evidence | Failures are counted and retried; lookups are paced (Wikipedia answers 429 to bursts) |
| 4 | An unsure re-review left the weaker model's decision in place | Medium-confidence guesses stayed | The earlier AI decision is withdrawn to UNKNOWN |
| 5 | Ollama answers 402 Payment Required; Groq removed llama-3.3-70b | 462 of 474 creators failed in the first run | Retry with waits; stop after 4 failures in a row |
| 6 | Groq free tier: gpt-oss-120b 200K tokens a day (~70 reviews) | The 120b-only pass stopped after 42 accounts | `--wikipedia-only` pass (smaller model decides from the article); the rest waits (§6) |
| 7 | Kept earlier niches kept an empty main niche | 56 searchable creators had niches but no main niche | Main niche from those same niches (`a344874`) |
| 8 | A backfill rerun would erase AI-estimated niches | 183 creators would lose their niche (Jannat Mirza among them) | AI estimates stay unless the creator's own content names a main niche (`f3b3ee4`) |
| 9 | A read answer with nothing to measure per follower kept an older per-view rate | 4 YouTube channels with 0 or 6 subscribers showed a rate | Both rates cleared; reassessment version `reassess-2026-11-15b` (`b867329`) |
| 10 | **The whole-catalogue reassessment script overwrote every AI account type** with the rules' answer (it wrote types before the worker's own reassessment, which keeps AI decisions), and reset ~1,000 promoted creators on every run | Rerunning it after the AI review erased all 287 AI decisions in the local catalogue | Restored from the snapshot taken before the Wikipedia re-review; the script now writes only owner-named staff types; two consecutive runs change nothing (`83bd0f4`). The Wikipedia pass was then redone |
| 11 | Wikipedia throttled one-at-a-time lookups (429 on most requests, then one answer per ~50 s) | A pass would have taken hours | Exact titles fetched 20 to a request before the reviews (`d61e264`), Retry-After honoured, full-text search optional (`--titles-only`) |
| 12 | A shortened name ("Street Food" from "Street Food Tour", "Kamal Hussain" redirected to a Bangladeshi politician) reached unrelated articles | The model ignored them, but they were offered as evidence | A shortened title counts only for an article about a person (`254eb5e`) |
| 13 | Earlier in the pilot: ER above 100% stopped the reassessment; a variety record blocked a resolving reading; the backfill used no follower count; Instagram ticks were wrong in the database | — | Fixed in `3371d30`/`1269ee4` |

## 4. Final catalogue counts (local `mushin_catalog_v4`, 15 Nov 2026 ~11:10 PKT)

| Measure | Count |
|---|---|
| Creators | 3,380 active, 44 merged |
| Searchable (eligible) | **582**: Instagram 237, TikTok 15, YouTube 330 |
| Excluded by account type (excluded type at high/medium confidence) | 513: business/store 190, **public figure 151**, brand 114, media 34, fan page 17, company 7 |
| Searchable creators that carry an excluded type | **0** |
| Account types (active) | individual creator 2,358 (rules 1,953, platform category 215, AI 179, staff 11); unknown 509; excluded types as above |
| AI decisions | 292 (individual 179, public figure 57, brand 55, unknown 1); 25 made with the Wikipedia check (23 with an article); the rest are from before the check and wait for the rerun (§6) |
| Profiles with an engagement rate | 3,126; **rate ≠ median: 1** (a YouTube channel whose data is past 30 days with no answer to re-read; the retention job, which has not run on this local copy, clears it); above 100%: 0 |
| Searchable creators' main niche | set 500 of 582; unknown 77; niches without a main niche 5 (YouTube channels needing a fresh API read); AI estimates 47 |
| Verified ticks (from the platform's own answer) | Instagram 502 of 980 profiles, TikTok 8 of 65, YouTube 0 of 2,379 (the API has no such field) |

The reassessment's own report counts account types by the rules alone (e.g. "1,876 unknown"); the figures above are
what the database holds after the AI review.

### Pilot table (Instagram and TikTok figures only; YouTube per-channel figures were shown in chat)

| Account | Account type (source) | Main niche | Searchable | Instagram / TikTok ER, tick |
|---|---|---|---|---|
| Ducky Bhai | creator (staff) | Comedy | yes | Instagram ✓ 6.34% |
| Jannat Mirza | creator (staff) | Fashion, AI estimate | yes | TikTok ✓ 0.31% |
| ReviewsPK | creator (AI) | Tech | yes | — (YouTube) |
| TasteByKamal (Kamal Hussain Sadiq) | creator (AI) | Food | yes | Instagram ✓ 0.43%, TikTok 0.62% |
| AJ FF | creator (rules) | Gaming | yes | — (YouTube) |
| Food Creations by Marryam | creator (platform category) | Food | yes | Instagram 0.29% |
| Sajal Aly | public figure (AI, Wikipedia) | — | no (excluded) | Instagram ✓ 0.49% |
| Farhan Saeed | public figure (AI) | — | no (excluded) | Instagram ✓ — |
| Hania Aamir, Mahira Khan, Ayeza Khan | public figure (AI, Wikipedia) | — | no (excluded) | ✓ |
| Maya Ali, Sarah Khan (Mrs.Falak) | public figure (AI) | — | no (excluded) | ✓ |
| Durefishan Saleem, Saboor Aly, Wahaj Ali, Ushna Shah, Komal Meer, Madiha Imam | public figure (AI, Wikipedia; were "creators" before) | — | no (excluded) | ✓ |
| Ghana Ali | public figure (rules) | — | no (excluded) | ✓ |
| SAMAA TV | brand (rules) | — | no (excluded) | — (YouTube) |

## 5. Where this differs from the directive, and why

- **§2.5 YouTube tick for 100K+ — declined.** The YouTube Data API has no verification field, and a tick drawn from a
  follower count would be an invented badge ("Do not invent … verification badges"). YouTube shows no tick; Instagram
  and TikTok ticks come from the platform's own answer.
- **NON_CREATOR_CELEBRITY is stored as `CELEBRITY_PUBLIC_FIGURE`**, the existing excluded type; no new type or migration.
- **AI niches are always labelled "AI estimate"** with 0 posts assessed, whatever basis the model claims.
- **Collab outliers** are judged on likes + comments (the same quantity the rate uses).
- **Vlog words count for Lifestyle; "video/shorts/reels" do not** (they describe a format, not a subject).
- **The safety filter on the eval purge was not bypassed**: the official script ran normally after the owner's go-ahead.

## 6. Not finished, and known limits

- **The AI re-review is not complete.** Both Groq models reached their free daily limit (200K tokens each) today.
  Left: about 80 accounts that have a Wikipedia article and about 285 without one (first-time reviews and earlier
  decisions by the smaller model). Rerun `scripts/catalog/ai-review.ts --db mushin_catalog_v4 --rereview-ai
  --wikipedia-only --titles-only --models openai/gpt-oss-120b,openai/gpt-oss-20b`, then the same without
  `--wikipedia-only` and with `--models openai/gpt-oss-120b`; each skips what is done. Free tier: about 70 reviews a
  day per model; or Groq's paid Dev tier (well under US$1 for the rest) on the owner's approval.
- **18 decisions were re-applied from recorded output** after the accidental wipe (§3 #10): the gpt-oss-120b
  Wikipedia dry run on the pilot sample and the last applied Wikipedia pass, through the same guards (never over staff
  or a confident rule). Earlier Wikipedia-backed decisions from the interrupted runs were not recorded and wait for
  the rerun above.
- **Known mislabels for staff review** (no usable Wikipedia article, so the model's own knowledge decided): Rajab Butt
  (`rajab.butt94`, likely a digital creator, shown as a public figure: excluded), Haroon Kadwani and Naimal Khawar
  (likely actors, shown as creators; not searchable today for other reasons). Falak Shabir (likely a singer) is now
  "unknown" (the stronger model was unsure) and stays searchable. Staff decisions are never overwritten.
- **Borderline by design**: journalists and anchors with their own YouTube channels (e.g. Imran Riaz Khan) are
  treated as public figures when Wikipedia describes them as journalists; staff can override.
- **94 YouTube channels** have niches but no main niche and no YouTube answer inside the 30-day window: they need a
  fresh YouTube API read, not a guess. One channel still shows a rate from data past 30 days; the retention job
  (0063/0078), which has not run on this local copy, clears it.
- Locally, the search, creators-API, worker-side and acceptance-corpus integration suites need Meilisearch and were
  not run (CI runs them). Everything else passes: typecheck, lint, 718 unit tests, all creators integration tests, and
  the customer browser suite (110 / 55 / 54 after restart).

## 7. Before the push and the live sync (owner decisions)

1. **YouTube API data in unpushed commits** (`docs/completion/inventory/2026-11-14-pilot2-results.json` and earlier
   evidence files): pushing publishes them to GitHub permanently. Recommended: remove them from the unpushed history
   before the push; two already-pushed evidence files reach 30 days on 19 November.
2. **`mushin_catalog_v2_eval_disposable`** (51 MB): drop it?
3. **LLM chain**: Ollama needs credits (402) and Groq's llama-3.3-70b is gone; the chain is effectively 120b → 20b.
   Top up Ollama, pick a replacement model, or accept.
4. **Groq tier** for the remaining 120b reviews (§6): wait (~70/day) or approve the Dev tier.
5. **Migration 0088** (one index from the Postgres review): include in the live sync?
6. Live sync itself: migrations 0074–0087 to staging (pooler), then the catalogue sync, then push (Vercel deploys).
