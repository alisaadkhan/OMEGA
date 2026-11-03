-- Continuous catalogue reassessment (owner master directive 2026-11-03, Phase 5). When the deterministic assessment
-- rules change (a new version string in code), the worker re-derives account type, content performance and profile
-- country for every active creator from stored provider answers, in small batches it can resume after a restart. No
-- provider or AI call is made, nothing is deleted and staff decisions are never replaced. One row per rules version.
create table platform.reassessment_runs (
  version text primary key check (char_length(version) between 1 and 80),
  cursor_id uuid,
  processed integer not null default 0 check (processed >= 0),
  changed integer not null default 0 check (changed >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table platform.reassessment_runs enable row level security;
create policy reassessment_runs_system on platform.reassessment_runs for all to mushin_worker using (true) with check (true);
grant select, insert, update on platform.reassessment_runs to mushin_worker;
