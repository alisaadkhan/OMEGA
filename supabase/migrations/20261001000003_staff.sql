create table staff.staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null check (length(name) between 1 and 120),
  password_hash text not null,
  totp_secret_encrypted text not null,
  role text not null check (role in ('admin', 'support')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  failed_login_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  -- RFC 6238 time step of the last accepted TOTP code; equal or older steps are refused (replay protection).
  last_totp_step bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index staff_users_email_key on staff.staff_users (lower(email));
create trigger staff_users_updated_at before update on staff.staff_users for each row execute function platform.set_updated_at();

create table staff.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  family_id uuid not null,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_sessions_family_idx on staff.staff_sessions (family_id);

-- Append-only: app roles get SELECT/INSERT only.
create table staff.audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff.staff_users (id),
  action text not null,
  target_type text,
  target_id text,
  workspace_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_log_staff_idx on staff.audit_log (staff_id, created_at desc);

grant select, insert, update on staff.staff_users, staff.staff_sessions to mushin_worker;
grant select, insert on staff.audit_log to mushin_worker;
