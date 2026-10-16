-- Per-candidate decision trail for Live Discovery: every search-result link a run saw, the stage it reached and why it
-- stopped there (normalization, duplicate, cheap gate, relevance review, selection, extraction, verification, Fit,
-- delivery). One row per job and source link; retries update the row instead of adding another.
create table wp.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  job_id uuid not null references wp.discovery_jobs (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  -- The profile link when the result resolved to one; otherwise the original result link (a post, video or page).
  candidate_key text not null check (length(candidate_key) between 1 and 500),
  source_url text not null check (length(source_url) between 1 and 500),
  canonical_url text check (canonical_url is null or length(canonical_url) <= 500),
  handle text check (handle is null or length(handle) <= 100),
  query text check (query is null or length(query) <= 300),
  round smallint check (round is null or round between 1 and 9),
  position smallint check (position is null or position between 1 and 100),
  occurrences smallint not null default 1 check (occurrences >= 1),
  stage text not null check (stage in ('normalization', 'dedupe', 'cheap_gate', 'relevance', 'selection', 'extraction', 'verification', 'fit', 'delivery')),
  decision text not null check (decision in ('pending', 'delivered', 'rejected', 'duplicate', 'skipped', 'not_extracted', 'unreviewed', 'unverified', 'failed')),
  reason text check (reason is null or reason ~ '^[a-z0-9_]{1,64}$'),
  -- Redacted title/snippet excerpts, Fit score and evidence lines; never contacts or raw provider payloads.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  creator_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_key)
);
create index discovery_candidates_job_idx on wp.discovery_candidates (job_id, stage, decision);
create index discovery_candidates_creator_idx on wp.discovery_candidates (creator_id) where creator_id is not null;
create index discovery_candidates_url_idx on wp.discovery_candidates (canonical_url) where canonical_url is not null;
alter table wp.discovery_candidates enable row level security;
alter table wp.discovery_candidates force row level security;
create policy discovery_candidates_tenant on wp.discovery_candidates
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());
grant select on wp.discovery_candidates to mushin_app;
grant select, insert, update on wp.discovery_candidates to mushin_worker;

-- Erasure also removes every candidate row that names the creator or one of its profile links, in every workspace.
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
  delete from wp.discovery_candidates where creator_id = p_creator_id or canonical_url = any (p_canonical_urls);
  update wp.discovery_jobs
     set input_url = null, handle = 'erased', canonical_url = 'erased:' || id::text
   where kind <> 'live' and (creator_id = p_creator_id or canonical_url = any (p_canonical_urls));
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid, text[]) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid, text[]) to mushin_worker;
