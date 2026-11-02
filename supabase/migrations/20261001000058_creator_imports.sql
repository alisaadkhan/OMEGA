-- Brand / agency creator imports (owner instruction 2026-10-26). A workspace uploads its own creator list (CSV). Rows are
-- matched to catalogue profiles by canonical URL and checked for duplicates; nothing in the shared catalogue is changed:
-- an imported niche or country is that workspace's own declaration (weaker than catalogue evidence, never copied over
-- it), and an imported email becomes a workspace-only contact. Profiles not in the catalogue are listed, never fetched
-- (fetching costs credits and is started by a person).
create table wp.creator_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  created_by uuid not null references wp.users (id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  source text not null check (length(source) between 1 and 200),
  reviewed_on date,
  file_name text check (file_name is null or length(file_name) <= 200),
  rows_total integer not null default 0,
  rows_matched integer not null default 0,
  rows_not_in_catalogue integer not null default 0,
  rows_invalid integer not null default 0,
  rows_duplicate integer not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create table wp.creator_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references wp.creator_imports (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  row_no integer not null check (row_no >= 1),
  input_url text not null check (length(input_url) <= 300),
  canonical_url text,
  platform text check (platform is null or platform in ('instagram', 'tiktok', 'youtube')),
  creator_id uuid,
  status text not null check (status in ('matched', 'not_in_catalogue', 'invalid', 'duplicate')),
  problem text check (problem is null or length(problem) <= 200),
  declared_niche text check (declared_niche is null or length(declared_niche) <= 60),
  declared_country char(2) check (declared_country is null or declared_country ~ '^[A-Z]{2}$'),
  contact_id uuid,
  unique (import_id, row_no)
);
create index creator_import_rows_import on wp.creator_import_rows (import_id, row_no);
create index creator_import_rows_creator on wp.creator_import_rows (creator_id) where creator_id is not null;
alter table wp.creator_imports enable row level security;
alter table wp.creator_imports force row level security;
create policy creator_imports_tenant on wp.creator_imports
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
alter table wp.creator_import_rows enable row level security;
alter table wp.creator_import_rows force row level security;
create policy creator_import_rows_tenant on wp.creator_import_rows
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.creator_imports, wp.creator_import_rows to mushin_app;

alter table wp.workspace_contacts drop constraint workspace_contacts_source_check;
alter table wp.workspace_contacts add constraint workspace_contacts_source_check check (source in ('user_provided', 'imported'));
alter table wp.workspace_contacts drop constraint workspace_contacts_status_check;
alter table wp.workspace_contacts add constraint workspace_contacts_status_check check (status = 'unverified');

-- Erasure reaches imported rows too: the link to the creator and the URL go, the row count stays.
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.workspace_contacts where creator_id = p_creator_id;
  update wp.creator_import_rows set creator_id = null, input_url = 'erased', canonical_url = null, declared_niche = null,
         declared_country = null, contact_id = null
   where creator_id = p_creator_id or canonical_url = any (p_canonical_urls);
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.audience_jobs where creator_id = p_creator_id;
  delete from gcp.audience_estimates where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
  delete from wp.discovery_candidates where creator_id = p_creator_id or canonical_url = any (p_canonical_urls);
  delete from wp.list_members where creator_id = p_creator_id;
  delete from wp.campaign_creators where creator_id = p_creator_id;
  update wp.discovery_jobs
     set input_url = null, handle = 'erased', canonical_url = 'erased:' || id::text
   where kind <> 'live' and (creator_id = p_creator_id or canonical_url = any (p_canonical_urls));
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid, text[]) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid, text[]) to mushin_worker;
