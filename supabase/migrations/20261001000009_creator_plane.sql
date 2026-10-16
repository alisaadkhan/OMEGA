-- Global Creator Plane (SRS §6.1): creator data shared by every workspace. No workspace_id anywhere in this schema.
create schema if not exists gcp;
revoke all on schema gcp from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema gcp from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema gcp from authenticated;
  end if;
end $$;
grant usage on schema gcp to mushin_app, mushin_worker;

create table gcp.creators (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(display_name) between 1 and 200),
  primary_handle text not null check (length(primary_handle) between 1 and 100),
  primary_platform text not null check (primary_platform in ('instagram', 'tiktok', 'youtube')),
  avatar_url text,
  city text check (city is null or length(city) <= 80),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  niches text[] not null default '{}',
  tags text[] not null default '{}',
  -- Alternative spellings of the name (transliteration, SRS §6.2).
  name_variants text[] not null default '{}',
  verified boolean not null default false,
  authenticity_score smallint check (authenticity_score between 0 and 100),
  fake_follower_pct double precision check (fake_follower_pct between 0 and 100),
  ai_summary text check (ai_summary is null or length(ai_summary) <= 600),
  ai_summary_model text,
  ai_summary_at timestamptz,
  ai_summary_source_hash text,
  ai_summary_failed_at timestamptz,
  is_minor boolean not null default false,
  minor_override_by_staff_id uuid references staff.staff_users (id),
  minor_override_reason text,
  status text not null default 'active' check (status in ('active', 'merged', 'removal_requested', 'erased')),
  merged_into_id uuid references gcp.creators (id),
  last_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minor_override_by_staff_id is null or minor_override_reason is not null),
  check ((status = 'merged') = (merged_into_id is not null))
);

create table gcp.creator_profiles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null check (length(handle) between 1 and 100),
  canonical_url text not null check (length(canonical_url) <= 500),
  followers integer not null default 0 check (followers >= 0),
  following integer check (following >= 0),
  posts integer check (posts >= 0),
  engagement_rate double precision check (engagement_rate between 0 and 100),
  avg_likes integer check (avg_likes >= 0),
  avg_comments integer check (avg_comments >= 0),
  avg_views integer check (avg_views >= 0),
  bio text check (bio is null or length(bio) <= 2000),
  followers_updated_at timestamptz,
  engagement_updated_at timestamptz,
  audience_updated_at timestamptz,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, canonical_url)
);
create index creator_profiles_creator_idx on gcp.creator_profiles (creator_id);

create table gcp.creator_contacts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  value_encrypted text not null,
  value_hash text not null,
  masked text not null,
  trust text not null default 'unverified' check (trust in ('verified', 'likely', 'unverified')),
  source text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  unique (creator_id, kind, value_hash)
);

-- Append-only assessment history; a score always comes with its evidence (SRS REQ-01.02, §5.5).
create table gcp.enrichment_snapshots (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  verdict text not null,
  authenticity_score smallint check (authenticity_score between 0 and 100),
  evidence_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_breakdown) = 'array'),
  audience jsonb,
  model_version text not null,
  confidence double precision check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  check (authenticity_score is null or jsonb_array_length(evidence_breakdown) > 0)
);
create index enrichment_snapshots_creator_idx on gcp.enrichment_snapshots (creator_id, created_at desc);

-- Config.
create table platform.niches (
  id text primary key check (id ~ '^[a-z_]+$'),
  label text not null unique,
  sort_order integer not null,
  active boolean not null default true
);
insert into platform.niches (id, label, sort_order) values
  ('bridal', 'Bridal', 1), ('fashion', 'Fashion', 2), ('beauty', 'Beauty', 3), ('tech', 'Tech', 4), ('food', 'Food', 5),
  ('travel', 'Travel', 6), ('comedy', 'Comedy', 7), ('finance', 'Finance', 8), ('wellness', 'Wellness', 9), ('lifestyle', 'Lifestyle', 10);

create table platform.search_settings (
  id boolean primary key default true check (id),
  weight_text integer not null default 35 check (weight_text >= 0),
  weight_filters integer not null default 25 check (weight_filters >= 0),
  weight_engagement integer not null default 15 check (weight_engagement >= 0),
  weight_authenticity integer not null default 15 check (weight_authenticity >= 0),
  weight_freshness integer not null default 10 check (weight_freshness >= 0),
  label_best integer not null default 80,
  label_strong integer not null default 65,
  label_possible integer not null default 50,
  fresh_current_days integer not null default 7 check (fresh_current_days > 0),
  fresh_aging_days integer not null default 30 check (fresh_aging_days > 0),
  candidate_pool integer not null default 200 check (candidate_pool between 10 and 1000),
  page_size integer not null default 24 check (page_size between 1 and 100),
  few_results integer not null default 8 check (few_results >= 0),
  updated_at timestamptz not null default now(),
  check (label_best > label_strong and label_strong > label_possible),
  check (fresh_aging_days > fresh_current_days)
);
insert into platform.search_settings default values;

-- One summary request per creator and data version: concurrent profile opens collapse into one AI call.
create table platform.summary_requests (
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  source_hash text not null,
  requested_at timestamptz not null default now(),
  primary key (creator_id, source_hash)
);

-- Workspace plane.
create table wp.contact_reveals (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id),
  revealed_by uuid not null references wp.users (id),
  ledger_reservation_id uuid,
  created_at timestamptz not null default now(),
  primary key (workspace_id, creator_id)
);

create table wp.audience_views (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id),
  month date not null check (extract(day from month) = 1),
  viewed_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, creator_id, month)
);

create table wp.saved_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  query_text text not null default '' check (length(query_text) <= 300),
  filters jsonb not null check (jsonb_typeof(filters) = 'object'),
  created_by uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_searches_workspace_idx on wp.saved_searches (workspace_id, created_at desc);

alter table wp.contact_reveals enable row level security;
alter table wp.contact_reveals force row level security;
create policy contact_reveals_tenant on wp.contact_reveals
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

alter table wp.audience_views enable row level security;
alter table wp.audience_views force row level security;
create policy audience_views_tenant on wp.audience_views
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

alter table wp.saved_searches enable row level security;
alter table wp.saved_searches force row level security;
create policy saved_searches_tenant on wp.saved_searches
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

-- Possible minors can never be revealed unless MUSHIN staff overrode the flag (SRS §5.2, §5.5; architecture §5.12).
create or replace function platform.guard_minor_reveal() returns trigger
  language plpgsql as $$
begin
  if exists (select 1 from gcp.creators c where c.id = new.creator_id and c.is_minor and c.minor_override_by_staff_id is null) then
    raise exception 'creator is flagged as a possible minor; contact reveal is blocked' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger contact_reveals_minor_guard before insert on wp.contact_reveals for each row execute function platform.guard_minor_reveal();

-- The only way the API role reaches contact values: rows this workspace has revealed.
create or replace function gcp.revealed_contacts(p_creator_id uuid)
  returns table (id uuid, kind text, value_encrypted text, trust text)
  language sql stable security definer set search_path = pg_catalog as $$
  select c.id, c.kind, c.value_encrypted, c.trust
  from gcp.creator_contacts c
  where c.creator_id = p_creator_id
    and exists (
      select 1 from wp.contact_reveals r
      where r.workspace_id = platform.current_workspace_id() and r.creator_id = p_creator_id
    )
$$;
revoke all on function gcp.revealed_contacts(uuid) from public;
grant execute on function gcp.revealed_contacts(uuid) to mushin_app;

create trigger creators_updated_at before update on gcp.creators for each row execute function platform.set_updated_at();
create trigger creator_profiles_updated_at before update on gcp.creator_profiles for each row execute function platform.set_updated_at();
create trigger saved_searches_updated_at before update on wp.saved_searches for each row execute function platform.set_updated_at();
create trigger search_settings_updated_at before update on platform.search_settings for each row execute function platform.set_updated_at();

-- Grants. The API role reads creator data but never contact values; only the worker writes gcp.
grant select on gcp.creators, gcp.creator_profiles, gcp.enrichment_snapshots to mushin_app;
grant select (id, creator_id, kind, masked, trust, source, first_seen_at, last_seen_at, last_verified_at) on gcp.creator_contacts to mushin_app;
grant select, insert, update on gcp.creators, gcp.creator_profiles, gcp.creator_contacts to mushin_worker;
grant select, insert on gcp.enrichment_snapshots to mushin_worker;
grant select on platform.niches, platform.search_settings to mushin_app, mushin_worker;
grant select, insert, update on platform.summary_requests to mushin_app, mushin_worker;
grant select, insert on wp.contact_reveals to mushin_app;
grant update (ledger_reservation_id) on wp.contact_reveals to mushin_app;
grant select, insert on wp.audience_views to mushin_app;
grant select, insert, update, delete on wp.saved_searches to mushin_app;
grant select on wp.contact_reveals, wp.audience_views, wp.saved_searches to mushin_worker;
