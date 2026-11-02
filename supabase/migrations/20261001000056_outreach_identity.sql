-- Outreach workflow (owner instruction 2026-10-26).
--   * A workspace may email an address its own person typed in for a creator. It is stored for that workspace only
--     (never in the shared creator contacts), encrypted like other contacts, labelled user-provided and unverified,
--     and it never replaces the creator's own contact. Suppressions still apply to it (by hash).
--   * Each send records whether its address was a revealed creator contact or a workspace-provided one.
--   * Erasing a creator also removes the addresses workspaces typed in for them.
create table wp.workspace_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null,
  kind text not null default 'email' check (kind = 'email'),
  value_encrypted text not null,
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  masked text not null check (length(masked) between 3 and 200),
  source text not null default 'user_provided' check (source = 'user_provided'),
  status text not null default 'unverified' check (status = 'unverified'),
  created_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  unique (workspace_id, creator_id, value_hash)
);
create index workspace_contacts_creator_idx on wp.workspace_contacts (creator_id);
alter table wp.workspace_contacts enable row level security;
alter table wp.workspace_contacts force row level security;
create policy workspace_contacts_tenant on wp.workspace_contacts
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.workspace_contacts to mushin_app;

alter table wp.outreach_emails
  add column contact_source text not null default 'creator_contact' check (contact_source in ('creator_contact', 'workspace_contact'));

create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.workspace_contacts where creator_id = p_creator_id;
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
