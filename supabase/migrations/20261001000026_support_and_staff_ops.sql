-- Customer support tickets (canonical spec page 15) and the staff operations views (pages 20, 21, 23).
-- Customers use the tables through the tenant policy. Staff never read tenant tables directly: the security-definer
-- functions below return curated, redacted projections (no contact values, no raw provider payloads), and every staff
-- write goes through a function that also records who did it. The API checks staff permissions and audits.

create table wp.support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  created_by uuid not null references wp.users (id),
  subject text not null check (length(btrim(subject)) between 1 and 160),
  category text not null check (category in ('search', 'discovery', 'billing', 'account', 'data_removal', 'other')),
  status text not null default 'open' check (status in ('open', 'waiting_on_customer', 'resolved', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_workspace_idx on wp.support_tickets (workspace_id, last_message_at desc);
create index support_tickets_status_idx on wp.support_tickets (status, last_message_at desc);
create trigger support_tickets_updated_at before update on wp.support_tickets for each row execute function platform.set_updated_at();

create table wp.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references wp.support_tickets (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  author_kind text not null check (author_kind in ('customer', 'staff')),
  author_user_id uuid references wp.users (id),
  author_staff_id uuid references staff.staff_users (id),
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  check ((author_kind = 'customer') = (author_user_id is not null)),
  check ((author_kind = 'staff') = (author_staff_id is not null))
);
create index support_messages_ticket_idx on wp.support_messages (ticket_id, created_at);

alter table wp.support_tickets enable row level security;
alter table wp.support_tickets force row level security;
create policy support_tickets_tenant on wp.support_tickets
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
alter table wp.support_messages enable row level security;
alter table wp.support_messages force row level security;
create policy support_messages_tenant on wp.support_messages
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
-- Customers open tickets, add messages and may close or reopen; messages are never edited or deleted.
grant select, insert on wp.support_tickets, wp.support_messages to mushin_app;
grant update (status, last_message_at) on wp.support_tickets to mushin_app;

-- ── Staff views (security definer; execute granted to the API's system role only) ─────────────────────────────

create function platform.staff_overview() returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'workspaces', (select count(*) from wp.workspaces),
    'users', (select count(*) from wp.users where status = 'active'),
    'openTickets', (select count(*) from wp.support_tickets where status in ('open', 'waiting_on_customer')),
    'pendingRemovals', (select count(*) from gcp.removal_requests where status = 'received'),
    'openJobs', (select count(*) from wp.discovery_jobs where status in ('queued', 'running')),
    'stuckJobs', (select count(*) from wp.discovery_jobs where status in ('queued', 'running') and created_at < now() - interval '30 minutes'),
    'jobs24h', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(outcome, status) k, count(*) n from wp.discovery_jobs where created_at > now() - interval '24 hours' group by 1) t)
  )
$$;

create function platform.staff_jobs(p_status text, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
    select j.id, j.workspace_id "workspaceId", w.name "workspaceName", j.kind, j.status, j.outcome, j.step, j.attempts,
      j.platform, j.handle, j.search->>'text' "brief", j.max_new "maxNew", j.found_count "found", j.new_count "new",
      j.cost "maxCost", j.credits_charged "creditsCharged", j.error_code "errorCode", j.error_message "errorMessage",
      j.cancel_requested_at is not null "cancelRequested", j.created_at "createdAt", j.started_at "startedAt", j.finished_at "finishedAt"
    from wp.discovery_jobs j join wp.workspaces w on w.id = j.workspace_id
    where p_status is null
       or (p_status = 'open' and j.status in ('queued', 'running'))
       or (p_status = 'failed' and j.status = 'failed')
       or (p_status = 'stuck' and j.status in ('queued', 'running') and j.created_at < now() - interval '30 minutes')
    order by j.created_at desc
    limit least(greatest(p_limit, 1), 200)) t
$$;

-- One job's funnel and decision counts by stage (no candidate URLs or profile data).
create function platform.staff_job(p_id uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'progress', j.progress,
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('stage', d.stage, 'decision', d.decision, 'reason', d.reason, 'count', d.n) order by d.n desc)
      from (select stage, decision, reason, count(*) n from wp.discovery_candidates where job_id = j.id group by 1, 2, 3) d), '[]'::jsonb),
    'providerCalls', coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider, 'operation', c.operation, 'status', c.status, 'errorCode', c.error_code, 'calls', c.n, 'costUsd', c.cost))
      from (select provider, operation, status, error_code, count(*) n, sum(cost_usd) cost from platform.provider_calls where job_id = j.id::text group by 1, 2, 3, 4) c), '[]'::jsonb)
  ) from wp.discovery_jobs j where j.id = p_id
$$;

create function platform.staff_workspaces(p_query text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select w.id, w.name, w.created_at "createdAt", o.email "ownerEmail",
      (select count(*) from wp.workspace_members m where m.workspace_id = w.id) members,
      (select s.status from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1) "subscriptionStatus",
      (select count(*) from wp.discovery_jobs j where j.workspace_id = w.id and j.created_at > now() - interval '30 days') "jobs30d",
      (select count(*) from wp.support_tickets k where k.workspace_id = w.id and k.status in ('open', 'waiting_on_customer')) "openTickets"
    from wp.workspaces w join wp.users o on o.id = w.owner_user_id
    where p_query = '' or w.name ilike '%' || p_query || '%' or o.email ilike '%' || p_query || '%' or w.id::text = p_query
    order by w.created_at desc limit 50) t
$$;

create function platform.staff_tickets(p_status text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."lastMessageAt" desc), '[]'::jsonb) from (
    select k.id, k.workspace_id "workspaceId", w.name "workspaceName", k.subject, k.category, k.status,
      k.created_at "createdAt", k.last_message_at "lastMessageAt",
      (select count(*) from wp.support_messages m where m.ticket_id = k.id) messages,
      (select m.author_kind from wp.support_messages m where m.ticket_id = k.id order by m.created_at desc limit 1) "lastAuthor"
    from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id
    where p_status is null or k.status = p_status
    order by k.last_message_at desc limit 200) t
$$;

create function platform.staff_ticket(p_id uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'id', k.id, 'workspaceId', k.workspace_id, 'workspaceName', w.name, 'subject', k.subject, 'category', k.category,
    'status', k.status, 'createdAt', k.created_at, 'lastMessageAt', k.last_message_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'authorKind', m.author_kind,
        'authorName', case when m.author_kind = 'staff' then coalesce(s.name, 'MUSHIN support') else coalesce(u.display_name, split_part(u.email, '@', 1)) end,
        'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from wp.support_messages m left join wp.users u on u.id = m.author_user_id left join staff.staff_users s on s.id = m.author_staff_id
      where m.ticket_id = k.id), '[]'::jsonb))
  from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id where k.id = p_id
$$;

-- A staff reply (optional body) and/or status change; returns false when the ticket does not exist.
create function platform.staff_ticket_update(p_id uuid, p_staff_id uuid, p_body text, p_status text) returns boolean
  language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from wp.support_tickets where id = p_id for update;
  if v_workspace is null then return false; end if;
  if p_body is not null and length(btrim(p_body)) > 0 then
    insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_staff_id, body) values (p_id, v_workspace, 'staff', p_staff_id, p_body);
    update wp.support_tickets set last_message_at = now() where id = p_id;
  end if;
  if p_status is not null then
    update wp.support_tickets set status = p_status where id = p_id;
  end if;
  return true;
end
$$;

-- The audit history is read-only and append-only.
create function platform.staff_audit(p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
    select a.id, a.action, a.target_type "targetType", a.target_id "targetId", a.workspace_id "workspaceId", a.metadata,
      a.ip, a.request_id "requestId", a.created_at "createdAt", s.name "staffName", s.role "staffRole"
    from staff.audit_log a left join staff.staff_users s on s.id = a.staff_id
    order by a.created_at desc limit least(greatest(p_limit, 1), 500)) t
$$;

do $$
declare f text;
begin
  foreach f in array array['staff_overview()', 'staff_jobs(text, integer)', 'staff_job(uuid)', 'staff_workspaces(text)', 'staff_tickets(text)',
                           'staff_ticket(uuid)', 'staff_ticket_update(uuid, uuid, text, text)', 'staff_audit(integer)'] loop
    execute format('revoke all on function platform.%s from public', f);
    execute format('grant execute on function platform.%s to mushin_worker', f);
  end loop;
end $$;
