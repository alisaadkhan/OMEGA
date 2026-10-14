-- Lists and saved creators (CRM-001; canonical frontend spec page 09). Workspace-private: every row carries the
-- workspace and the tenant policy enforces it. Members reference global creators; hidden creators are filtered when
-- read (they reappear if unhidden), and erasure deletes the membership outright.
create table wp.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  favorite boolean not null default false,
  created_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index lists_workspace_name_idx on wp.lists (workspace_id, lower(btrim(name)));
create index lists_workspace_updated_idx on wp.lists (workspace_id, updated_at desc);
create trigger lists_updated_at before update on wp.lists for each row execute function platform.set_updated_at();

create table wp.list_members (
  list_id uuid not null references wp.lists (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  note text not null default '' check (length(note) <= 1000),
  added_by uuid not null references wp.users (id),
  added_at timestamptz not null default now(),
  primary key (list_id, creator_id)
);
create index list_members_workspace_creator_idx on wp.list_members (workspace_id, creator_id);
create index list_members_list_added_idx on wp.list_members (list_id, added_at desc);

alter table wp.lists enable row level security;
alter table wp.lists force row level security;
create policy lists_tenant on wp.lists
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

alter table wp.list_members enable row level security;
alter table wp.list_members force row level security;
create policy list_members_tenant on wp.list_members
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

grant select, insert, update, delete on wp.lists, wp.list_members to mushin_app;

-- Erasure also removes the creator from every workspace's lists.
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.audience_jobs where creator_id = p_creator_id;
  delete from gcp.audience_estimates where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
  delete from wp.discovery_candidates where creator_id = p_creator_id or canonical_url = any (p_canonical_urls);
  delete from wp.list_members where creator_id = p_creator_id;
  update wp.discovery_jobs
     set input_url = null, handle = 'erased', canonical_url = 'erased:' || id::text
   where kind <> 'live' and (creator_id = p_creator_id or canonical_url = any (p_canonical_urls));
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid, text[]) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid, text[]) to mushin_worker;
