# YouTube evaluation data: inventory and deletion plan

Owner decision 2026-10-16: keep the 2026-11-12 deadline; inventory every copy first; keep what the rating round needs
until the evaluation is finished; then purge every copy, including old temporary copies, and verify the deletion.
Taken on 2026-10-16 (Pakistan time) by listing names and sizes only; no file content was opened.

## What must be deleted by 2026-11-12

| # | Location | Size | What it holds | Needed until evaluation ends? |
|---|---|---|---|---|
| 1 | `MUSHIN/eval-data/packets/` (`blind-b1-elig1`, `blind-b2-elig1`, superseded `blind-b1`, `blind-b2`) | 1.0 MB | Blind rating sheets, keys, behaviour sheets | **Yes** (scoring joins ratings to keys here) |
| 2 | `MUSHIN/eval-data/kits/` | 0.3 MB | Kits sent to rater A, rater B, adjudicator | **Yes** until the kits are handed out; then only `kits-manifest.csv` matters |
| 3 | `MUSHIN/eval-data/kits-pre-elig1/` | 0.5 MB | Superseded kits (before the 10k rule) | No |
| 4 | `MUSHIN/eval-data/recordings/` | 32.1 MB | Recorded provider responses used to replay Brain 2 | **Yes** (the freeze check replays them) |
| 5 | `MUSHIN/eval-data/runs/` | 2.6 MB | Run outputs behind the packets | Yes (freeze check) |
| 6 | `MUSHIN/eval-data/logs/` | 0.1 MB | Test and E2E logs (no creator rows expected; deleted with the rest) | No |
| 7 | Database `mushin_eval_disposable` (localhost:54330) | 21 MB | Corpus v2: 455 creators, 328 YouTube profiles | **Yes** (Brain 1 freeze check) |
| 8 | `%TEMP%\claude\D--New-folder--2--New-folder--2-\221a1bc7-4258-4942-846e-39d458426f9b\scratchpad\` | 36.2 MB | Earlier session: `search-eval/` (first corpus manifests, earlier blind packets, experiments `exp1`–`exp5`, rater CSVs), plus `e2e/` and `ui/` screenshots, logs, a database dump `mushin_local.dump`, and environment-file copies (`a.env`, `b.env`, `local-env.sh`) | No |
| 9 | `%TEMP%\claude\D--New-folder--2--New-folder--2-\7331cfc4-ad00-446b-90ca-cbf310763d8b\scratchpad\` | 219.2 MB | Earlier session: `eval/` (raw SERP, posts, LLM replays, `yt-native40.json`), an old PostgreSQL data directory `pgdata/` (180 MB), screenshots, logs, an environment-file copy | No |
| 10 | Copies held by rater A, rater B and the adjudicator | n/a | Their kit files and returned sheets, including e-mail attachments | Until they return their sheets |

`eval-data/reports/` holds only aggregate gate reports (no creator rows) and is kept. Rows 8 and 9 are whole temporary
folders of finished sessions: they also contain database dumps and copies of environment files with credentials,
which is a second reason to delete them.

## Checked and not in scope

- **Git history:** only the scripts (`scripts/search-eval/*.ts`) were ever committed; `eval-data/` is git-ignored.
- **Meilisearch indexes:** only `dev_creators` (20 documents) and `e2e_creators` (20); no evaluation index exists.
- **Other databases:** `mushin_local`, `mushin_e2e`, `mushin_e2e_template` and `mushin_e2e_team_template` each hold the
  product's own local catalogue (21 creators, 18 YouTube profiles), not evaluation data. They fall under the product's
  normal YouTube refresh rule (refresh or delete within 30 days), not this purge. `mushin_test*` databases hold test
  fixtures only (0–3 profiles).
- **Other temporary session folders** under `%TEMP%\claude\D--New-folder--2--New-folder--2-\` are empty or hold only
  this session's small working files.

## How to purge and verify

After the adjudicated reports are copied to `eval-data/reports/` and the owner has decided on Search:

    set PG_BIN=D:\New folder (2)\New folder (2)\tmp\pg-test-runtime\pgsql-portable\bin
    node --import tsx scripts/search-eval/purge-eval-data.ts --also "<row 8 folder>" --also "<row 9 folder>"            (dry run)
    node --import tsx scripts/search-eval/purge-eval-data.ts --also "<row 8 folder>" --also "<row 9 folder>" --confirm
    node --import tsx scripts/search-eval/purge-eval-data.ts --also "<row 8 folder>" --also "<row 9 folder>" --verify

`--verify` exits 1 while anything listed or the database still exists. On this machine `npm run verify` also fails after
2026-11-12 (Pakistan time) while `eval-data/` holds anything but `reports/`. Ask each rater and the adjudicator to
confirm in writing that every copy is deleted, and record the dates below.

| Step | Date | By |
|---|---|---|
| Purge `--confirm` run | | |
| `--verify` result "verified" | | |
| Rater A deletion confirmed | | |
| Rater B deletion confirmed | | |
| Adjudicator deletion confirmed | | |
