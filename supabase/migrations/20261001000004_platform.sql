create table platform.outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  workspace_id uuid,
  payload jsonb not null default '{}'::jsonb,
  request_id text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index outbox_unpublished_idx on platform.outbox (created_at) where published_at is null;

create or replace function platform.notify_outbox() returns trigger
  language plpgsql as $$ begin perform pg_notify('mushin_outbox', ''); return null; end $$;
create trigger outbox_notify after insert on platform.outbox for each statement execute function platform.notify_outbox();

create table platform.provider_calls (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  model text,
  tokens_in int,
  tokens_out int,
  units numeric(14, 4),
  cost_usd numeric(12, 6) not null default 0,
  latency_ms int not null,
  status text not null check (status in ('ok', 'error')),
  error_code text,
  workspace_id uuid,
  job_id text,
  request_id text,
  created_at timestamptz not null default now()
);
create index provider_calls_provider_time_idx on platform.provider_calls (provider, created_at desc);

create table platform.idempotency_keys (
  workspace_id uuid not null,
  key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

grant insert on platform.outbox to mushin_app;
grant select, insert, update on platform.outbox to mushin_worker;
grant insert on platform.provider_calls to mushin_app, mushin_worker;
grant select, insert, update, delete on platform.idempotency_keys to mushin_worker;
