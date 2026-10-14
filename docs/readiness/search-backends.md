# Catalog search backends: local Meilisearch and PostgreSQL (2026-10-14)

PostgreSQL stays the system of record and the **default** catalog backend (`CATALOG_SEARCH_BACKEND=postgres`). Meilisearch is an optional, self-hosted alternative that the worker keeps in step with PostgreSQL. The canonical pack (`01_DECISIONS` §A "Search index") allows Meilisearch only after it shows a measured gain on the same data. This document records that measurement.

## Local Meilisearch

| Item | Value |
|---|---|
| Version | Meilisearch 1.55.0, official Windows binary from GitHub releases (Docker is not installed on this machine) |
| Location | `MEILI_HOME` (default `%USERPROFILE%\meilisearch`): binary, `data/` (persistent index), `dumps/`, `master.key` |
| Network | `127.0.0.1:7700` only (verified: the listening socket is loopback; unauthenticated `/keys` returns 401) |
| Mode | `--env production` (master key required, no public search preview), `--no-analytics` |
| Master key | 32 random bytes, created on first start, stored in `master.key` (owner-only ACL), passed via `MEILI_MASTER_KEY` so it never appears in the process list or logs (log checked: 0 occurrences) |
| App keys | `npm run meili:env` reads the server's default admin and search keys and writes `.env.meilisearch` (git-ignored by `.env.*`). Values are never printed. The API, the worker, `search:reindex` and the tests load it after `.env`, so it wins |

### Commands

```
npm run meili:start     # foreground; run in its own terminal
npm run meili:env       # once per new master key: writes .env.meilisearch
npm run meili:health    # health + creator index size
npm run search:reindex  # rebuild projections from PostgreSQL (repairs drift; safe to repeat)
```

Switch back to PostgreSQL by deleting `.env.meilisearch` (or setting `CATALOG_SEARCH_BACKEND=postgres` in it). Nothing else changes: the PostgreSQL projection is written on every sync in both modes.

### Recovery

- **Meilisearch down while it is the backend:** catalog search and lookup answer from the PostgreSQL projection and log `Meilisearch unavailable: catalog search answered from the PostgreSQL projection` (`creators/service.ts`, test `search.int.test.ts › answers from the PostgreSQL projection while Meilisearch is unavailable`). `/health/ready` reports `search: down` (HTTP 503) so the outage is visible; it is not hidden as healthy.
- **Index lost, emptied or drifted:** `npm run search:reindex`, or wait for the worker's nightly `creator.reindex_all` (03:45). Both compare every visible creator's `updated_epoch` and upsert or remove only what differs (`worker-side.int.test.ts › repairs drift`).
- **Sync failed during an outage:** the `creator.changed` job fails and pg-boss retries it; the nightly reconcile catches anything left.

## Cloud test host replaced

Before this change `.env` pointed `MEILISEARCH_TEST_HOST` at a **Meilisearch Cloud** project (`*.sgp.meilisearch.io`). Integration tests wrote to it and, on this network, were skipped whenever its DNS failed. Tests now use the local server through `.env.meilisearch`. **Action for the owner:** remove or rotate the Cloud test key in `.env` if that project is no longer wanted. It was never printed here.

## Comparison method

`scripts/search-compare.ts <sizes…>` (test database only; it empties application tables, guarded like the integration tests):

1. Generates N creators shaped like the catalog (Pakistani names, 5 cities, 6 niches, 3 platforms, bios), plus 6 probe creators with known answers.
2. Syncs everything through the real indexer (both projections, as the worker does).
3. Runs every check through the **real search service** for each backend: index query, RLS hydration and fit ranking, i.e. what the user sees.
4. Runs `ANALYZE` (production statistics), then times 6 query shapes × 15 repeats per backend.

What it is not: a human-labelled relevance panel (QA-001). Probes test mechanics (typos, variants, scripts, filters, lifecycle), not real-world ranking quality. Generated bios are uniform, so ranking among thousands of equal "food" matches says nothing about quality.

## Results (final, after the PostgreSQL fixes below)

Both backends: malformed requests (page 0, negative followers, unknown platform, 5,000-character text) are rejected by the shared request schema before any backend runs.

**100,000 creators** (initial sync of 100,006 creators into both projections: 35 s)

| Check | PostgreSQL | Meilisearch |
|---|---|---|
| exact name / stored variant / Urdu-script variant | #1 / #1 / #1 | #1 / #1 / #1 |
| typo "Ayesah Siddiqui" / partial "Siddiq" | #1 / #1 | #1 / #1 |
| exact handle / bio words / bio phrase (2 probes) | #1 / #1 / 2 of 2 in top 5 | #1 / #1 / 2 of 2 in top 5 |
| filters: tiktok+Karachi · Food+10k–100k+ER≥4 · verified+youtube | 6,667 · 986 · 1,961; 0 violating | identical totals; 0 violating; identical page-1 order |
| browse: total, page 1 ∩ page 2, repeat | 100,006; disjoint; stable | same |
| possible minor hidden / rename / removal requested | excluded / new found, old gone / excluded | same |
| latency, all 90 warm searches | p50 15 · **p95 89** · max 91 ms | p50 16 · **p95 28** · max 32 ms |
| — common word "food" (17 % of corpus) | p95 91 ms | p95 19 ms |
| — filter-only (platform; niche + followers) | p95 70 / 59 ms | p95 25 / 32 ms |
| — rare name, partial word, text + country | p95 10 / 12 / 15 ms | p95 20 / 18 / 25 ms |

**Overall p95, all queries** (same harness): 1,000 creators: PostgreSQL 19 ms, Meilisearch 27 ms. 10,000: 10 ms vs 27 ms. 100,000: 89 ms vs 28 ms. The SRS proposal is p95 ≤ 800 ms at 100k (`03A` §6); both pass on this machine (local database, warm, single user, no concurrency).

## Defects found and fixed by the comparison (PostgreSQL path)

| Before | Cause | Fix | After |
|---|---|---|---|
| Typo "Ayesah Siddiqui" and partial "Siddiq" not found (Meilisearch: #1) | `search_text % query` compares the query with the whole document; long bios dilute similarity below 0.3 | Trigram **word** similarity (`query <% search_text`, same GIN index) | Both #1 at 1k, 10k, 100k |
| Common word at 100k: p50 1,008 ms, p95 1,027 ms (fails the 800 ms target) | Similarity recomputed for every one of ~16,700 matches | Two phases: whole words by full-text search; typo/partial matching only fills the candidate pool when words leave room | p95 91 ms |

Meilisearch needed no code change. Its added value is lower latency on broad queries at 100k (p95 19 vs 91 ms), and typo tolerance that is built in rather than tuned.

## Verified through the real UI (2026-10-14)

The full stack ran locally (Vite → API → worker → PostgreSQL :54330 / Meilisearch :7700) on 21 real creators copied from the earlier live-discovery runs. The same 11-check browser journey passed in **both** modes: text, partial handle, platform filter, empty state, profile vs stored data, no contact values, and a quote → failed run → full refund with paid providers blank. UI searches render in about 0.5 s.

One defect found and fixed, and the fallback proven, in this run:
- **Meilisearch newly enabled → no results.** The index was empty until the nightly reconcile, so search for "food" returned 0 instead of 9. The worker now reconciles both projections at start-up (`4695878`); the next restart filled 20 documents, and search returned the same 9.
- **Fallback proven live.** With Meilisearch killed mid-session, `/health/ready` reported `search: down` (503) and search still returned all 9 results from PostgreSQL. After restarting Meilisearch, the index still held its 20 documents (persistent storage) and readiness returned to `ok`.

## Recommendation

Keep **PostgreSQL as the default**. It now matches Meilisearch on every probe, meets the latency target with a large margin at 100k, and needs no extra service. Meilisearch is ready as a tested, one-switch alternative with automatic PostgreSQL fallback. Revisit only when the human-labelled panel (QA-001) or a measured production load (corpus well above 100k, concurrent users) shows a gain, as the canonical decision requires. Not measured here: concurrency, cold caches, the remote Supabase database, or Urdu-script typo tolerance.
