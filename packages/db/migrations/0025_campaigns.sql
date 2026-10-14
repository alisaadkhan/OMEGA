-- Minimal campaign pipeline and manual outreach log (CRM-001; canonical frontend spec pages 10–11).
-- Stages: identified → contacted → negotiating → confirmed. "Declined" is an outcome, not a stage, and content delivery
-- is a separate lifecycle. Tasks/reminders, sequences, mailbox sync and automated sending are out of scope (deferred).
create table wp.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  platform text check (platform in ('instagram', 'tiktok', 'youtube', 'mixed')),
  client text not null default '' check (length(client) <= 120),
  objective text not null default '' check (length(objective) <= 1000),
  notes text not null default '' check (length(notes) <= 4000),
  budget_minor bigint check (budget_minor is null or budget_minor >= 0),
  currency text not null default 'PKR' check (currency = 'PKR'),
  start_date date,
  end_date date,
  created_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create index campaigns_workspace_updated_idx on wp.campaigns (workspace_id, updated_at desc);
create trigger campaigns_updated_at before update on wp.campaigns for each row execute function platform.set_updated_at();

create table wp.campaign_creators (
  campaign_id uuid not null references wp.campaigns (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  stage text not null default 'identified' check (stage in ('identified', 'contacted', 'negotiating', 'confirmed')),
  outcome text not null default 'open' check (outcome in ('open', 'declined')),
  content_status text not null default 'none' check (content_status in ('none', 'content_pending', 'posted', 'completed')),
  priority text not null default 'med' check (priority in ('low', 'med', 'high')),
  fee_minor bigint check (fee_minor is null or fee_minor >= 0),
  fee_kind text not null default 'estimated' check (fee_kind in ('estimated', 'quoted', 'agreed')),
  due_date date,
  note text not null default '' check (length(note) <= 2000),
  -- Optimistic concurrency: an edit based on an older version is refused instead of silently overwriting.
  version integer not null default 1,
  added_by uuid not null references wp.users (id),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, creator_id)
);
create index campaign_creators_workspace_creator_idx on wp.campaign_creators (workspace_id, creator_id);
create trigger campaign_creators_updated_at before update on wp.campaign_creators for each row execute function platform.set_updated_at();

-- Manual outreach log: what a person did outside MUSHIN and what happened. Append-only (no update/delete grant).
create table wp.outreach_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  creator_id uuid not null,
  channel text not null check (channel in ('email', 'phone', 'whatsapp', 'instagram', 'tiktok', 'youtube', 'other')),
  outcome text not null check (outcome in ('attempted', 'replied', 'no_response', 'declined', 'agreed')),
  note text not null default '' check (length(note) <= 2000),
  occurred_at timestamptz not null default now(),
  logged_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, creator_id) references wp.campaign_creators (campaign_id, creator_id) on delete cascade
);
create index outreach_events_campaign_creator_idx on wp.outreach_events (campaign_id, creator_id, occurred_at desc);
create index outreach_events_workspace_occurred_idx on wp.outreach_events (workspace_id, occurred_at desc);

alter table wp.campaigns enable row level security;
alter table wp.campaigns force row level security;
create policy campaigns_tenant on wp.campaigns
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
alter table wp.campaign_creators enable row level security;
alter table wp.campaign_creators force row level security;
create policy campaign_creators_tenant on wp.campaign_creators
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
alter table wp.outreach_events enable row level security;
alter table wp.outreach_events force row level security;
create policy outreach_events_tenant on wp.outreach_events
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());

grant select, insert, update, delete on wp.campaigns, wp.campaign_creators to mushin_app;
grant select, insert on wp.outreach_events to mushin_app;

-- Teammates of the current workspace (name, email, role) for "logged by", assignment and the team page. wp.users is
-- self-only under RLS; this returns members of the caller's own workspace and nothing else.
create function platform.workspace_people()
  returns table (id uuid, display_name text, email text, role text, joined_at timestamptz)
  language sql stable security definer set search_path = pg_catalog as $$
  select u.id, coalesce(u.display_name, split_part(u.email, '@', 1)), u.email, m.role, m.created_at
    from wp.workspace_members m join wp.users u on u.id = m.user_id
   where m.workspace_id = platform.current_workspace_id() and u.status = 'active';
$$;
revoke all on function platform.workspace_people() from public;
grant execute on function platform.workspace_people() to mushin_app;

-- Erasure also removes the creator from every workspace's campaigns (and so their outreach log).
create or replace function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
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
