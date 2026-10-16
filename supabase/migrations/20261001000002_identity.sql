create table wp.users (
  id uuid primary key,
  email text not null,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  preferences jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wp.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_user_id uuid not null references wp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wp.workspace_members (
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on wp.workspace_members (user_id);

create trigger users_updated_at before update on wp.users for each row execute function platform.set_updated_at();
create trigger workspaces_updated_at before update on wp.workspaces for each row execute function platform.set_updated_at();
create trigger workspace_members_updated_at before update on wp.workspace_members for each row execute function platform.set_updated_at();

alter table wp.users enable row level security;
alter table wp.users force row level security;
create policy users_self on wp.users
  using (id = platform.current_user_id())
  with check (id = platform.current_user_id());

alter table wp.workspaces enable row level security;
alter table wp.workspaces force row level security;
create policy workspaces_current on wp.workspaces
  using (id = platform.current_workspace_id())
  with check (id = platform.current_workspace_id());

alter table wp.workspace_members enable row level security;
alter table wp.workspace_members force row level security;
create policy workspace_members_tenant on wp.workspace_members
  using (workspace_id = platform.current_workspace_id() or user_id = platform.current_user_id())
  with check (workspace_id = platform.current_workspace_id());

grant select, insert, update on wp.users, wp.workspaces, wp.workspace_members to mushin_app, mushin_worker;
