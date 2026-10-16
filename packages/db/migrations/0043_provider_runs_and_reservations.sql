-- Provider safety (audit SRCH-04 and SRCH-05, 2026-10-17).
--
-- SRCH-04: a paid Apify run was known only in the worker's memory while it ran. A crash, deploy or timeout left the run
-- charging on Apify with no record, and the job's retry started a second paid run. Now each run has a row keyed by its
-- job and exact input, written before the provider is called and given Apify's run id the moment it is known. A retry
-- of the same batch resumes that run instead of starting another, its cost is recorded once, and a reconciler settles
-- runs left open by a crash (aborting any past their deadline).
--
-- SRCH-05: the monthly spend caps (Apify USD, Serper searches) counted in-flight work in each process's memory, so two
-- workers could each pass just under the cap. Now in-flight work is a reservation row, checked and written under one
-- lock per provider, so the cap holds for any number of processes. A reservation is a lease: if its process dies, it
-- expires instead of blocking the budget forever.

create table platform.provider_reservations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apify', 'serper')),
  amount numeric(14, 6) not null check (amount > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  check (expires_at > created_at)
);
create index provider_reservations_open_idx on platform.provider_reservations (provider, expires_at) where released_at is null;
grant select, insert, update on platform.provider_reservations to mushin_worker;

create table platform.provider_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apify')),
  run_key text not null unique check (length(run_key) between 8 and 300),
  actor text not null,
  external_run_id text,
  status text not null default 'starting' check (status in ('starting', 'running', 'succeeded', 'failed', 'aborted', 'unknown')),
  job_id uuid,
  workspace_id uuid,
  cost_usd numeric(14, 6),
  cost_recorded boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status in ('starting', 'running')) = (finished_at is null))
);
create index provider_runs_open_idx on platform.provider_runs (started_at) where status in ('starting', 'running');
create index provider_runs_job_idx on platform.provider_runs (job_id);
create trigger provider_runs_updated_at before update on platform.provider_runs for each row execute function platform.set_updated_at();
grant select, insert, update on platform.provider_runs to mushin_worker;
