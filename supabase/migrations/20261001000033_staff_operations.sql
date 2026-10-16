-- Internal staff operations (STAFF-001..004; staff spec §1–4; master pack DOC-029 as recorded in
-- docs/readiness/supabase-migration-map.md §6). Identity stays keyed by staff.staff_users.id so the same tables move to
-- a Supabase Auth staff membership later.

-- ── Roles: Support → Admin → Super Admin (platform owners). Super Admin is created only by the bootstrap command. ──
alter table staff.staff_users drop constraint staff_users_role_check;
alter table staff.staff_users add constraint staff_users_role_check check (role in ('support', 'admin', 'super_admin'));
alter table staff.staff_users drop constraint staff_users_status_check;
alter table staff.staff_users add constraint staff_users_status_check check (status in ('active', 'disabled', 'suspended'));

-- ── WebAuthn hardware keys (Admin and Super Admin step-up; TOTP is never treated as equivalent) ──
create table staff.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  credential_id text not null unique,
  public_key text not null,
  sign_count bigint not null default 0,
  transports text[] not null default '{}',
  aaguid text,
  nickname text not null check (length(btrim(nickname)) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index webauthn_credentials_staff_idx on staff.webauthn_credentials (staff_id) where revoked_at is null;

-- One challenge per ceremony, single use, five minutes.
create table staff.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  kind text not null check (kind in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index webauthn_challenges_staff_idx on staff.webauthn_challenges (staff_id, created_at desc);

-- ── Two-person approvals for high-impact actions ──
-- A request names the exact action and payload; another staff member decides. Super Admin co-sign actions (role
-- escalation, staff suspension, suspending a paying customer) need a Super Admin approver. The requester can never
-- approve their own request (also enforced here). Executed requests are never edited again.
create table staff.approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('credits.grant', 'staff.role.change', 'staff.suspend', 'provider.cap.change', 'workspace.suspend')),
  target_type text not null,
  target_id text not null,
  payload jsonb not null,
  reason text not null check (char_length(btrim(reason)) between 12 and 1000),
  requires_super_admin boolean not null,
  requested_by uuid not null references staff.staff_users (id),
  decided_by uuid references staff.staff_users (id),
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  result jsonb,
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz,
  check (decided_by is null or decided_by <> requested_by),
  check (status = 'pending' or status = 'expired' or (decided_by is not null and decided_at is not null))
);
create index approvals_status_idx on staff.approvals (status, created_at desc);

-- ── Provider controls: an Admin can pause a provider; the worker's guards refuse its calls while paused ──
create table platform.provider_controls (
  provider text primary key check (provider in ('apify', 'serper', 'llm', 'youtube')),
  paused boolean not null default false,
  reason text,
  changed_by uuid references staff.staff_users (id),
  changed_at timestamptz not null default now(),
  check (not paused or char_length(btrim(coalesce(reason, ''))) between 12 and 500)
);
insert into platform.provider_controls (provider) values ('apify'), ('serper'), ('llm'), ('youtube');

-- ── Support: assignment and internal notes (never visible to customers) ──
alter table wp.support_tickets add column assigned_staff_id uuid references staff.staff_users (id);
alter table wp.support_messages drop constraint support_messages_author_kind_check;
alter table wp.support_messages add constraint support_messages_author_kind_check check (author_kind in ('customer', 'staff', 'internal'));
alter table wp.support_messages drop constraint support_messages_check1;
alter table wp.support_messages add constraint support_messages_staff_author check ((author_kind in ('staff', 'internal')) = (author_staff_id is not null));
-- Customers (the API's tenant role) never see internal notes, whatever the query.
create policy support_messages_no_internal on wp.support_messages as restrictive for select to mushin_app using (author_kind <> 'internal');

-- ── Consented, read-only, time-boxed support access ("impersonation", DOC-029) ──
-- Staff ask with a purpose; an owner or admin of the workspace grants or declines; access lasts at most 60 minutes
-- from the grant, is read-only, and either side can end it. Every view during the session is audited.
create table wp.support_access_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  staff_id uuid not null references staff.staff_users (id),
  staff_name text not null,
  purpose text not null check (char_length(btrim(purpose)) between 12 and 500),
  status text not null default 'requested' check (status in ('requested', 'granted', 'declined', 'ended', 'expired')),
  decided_by uuid references wp.users (id),
  decided_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'granted' or (decided_by is not null and expires_at is not null and expires_at <= decided_at + interval '60 minutes'))
);
create index support_access_requests_ws_idx on wp.support_access_requests (workspace_id, created_at desc);
alter table wp.support_access_requests enable row level security;
alter table wp.support_access_requests force row level security;
create policy support_access_tenant on wp.support_access_requests
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select on wp.support_access_requests to mushin_app;
grant update (status, decided_by, decided_at, expires_at, ended_at) on wp.support_access_requests to mushin_app;
grant select, insert, update on wp.support_access_requests to mushin_worker;
-- Staff create and read requests across workspaces through the API's system role; customers stay limited to their own
-- workspace by the tenant policy above.
create policy support_access_staff on wp.support_access_requests to mushin_worker using (true) with check (true);

-- ── Lookups: owner email masked for every staff role (staff spec: redacted lookup) ──
create or replace function platform.staff_workspaces(p_query text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select w.id, w.name, w.created_at "createdAt",
      left(split_part(o.email, '@', 1), 1) || '***@' || split_part(o.email, '@', 2) "ownerEmail",
      (select count(*) from wp.workspace_members m where m.workspace_id = w.id) members,
      (select s.status from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1) "subscriptionStatus",
      (select count(*) from wp.discovery_jobs j where j.workspace_id = w.id and j.created_at > now() - interval '30 days') "jobs30d",
      (select count(*) from wp.support_tickets k where k.workspace_id = w.id and k.status in ('open', 'waiting_on_customer')) "openTickets"
    from wp.workspaces w join wp.users o on o.id = w.owner_user_id
    -- An exact email still finds the workspace; partial matches use the name or id only, so the lookup cannot be used
    -- to enumerate addresses letter by letter.
    where p_query = '' or w.name ilike '%' || p_query || '%' or lower(o.email) = lower(p_query) or w.id::text = p_query
    order by w.created_at desc limit 50) t
$$;

-- Tickets list and thread carry the assignee; the thread includes internal notes (staff only, marked as such).
create or replace function platform.staff_tickets(p_status text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."lastMessageAt" desc), '[]'::jsonb) from (
    select k.id, k.workspace_id "workspaceId", w.name "workspaceName", k.subject, k.category, k.status,
      k.created_at "createdAt", k.last_message_at "lastMessageAt",
      (select count(*) from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal') messages,
      (select m.author_kind from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal' order by m.created_at desc limit 1) "lastAuthor",
      k.assigned_staff_id "assignedStaffId", (select s.name from staff.staff_users s where s.id = k.assigned_staff_id) "assignedStaffName"
    from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id
    where p_status is null or k.status = p_status
    order by k.last_message_at desc limit 200) t
$$;

create or replace function platform.staff_ticket(p_id uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'id', k.id, 'workspaceId', k.workspace_id, 'workspaceName', w.name, 'subject', k.subject, 'category', k.category,
    'status', k.status, 'createdAt', k.created_at, 'lastMessageAt', k.last_message_at,
    'assignedStaffId', k.assigned_staff_id, 'assignedStaffName', (select s.name from staff.staff_users s where s.id = k.assigned_staff_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'authorKind', m.author_kind,
        'authorName', case when m.author_kind in ('staff', 'internal') then coalesce(s.name, 'MUSHIN support') else coalesce(u.display_name, split_part(u.email, '@', 1)) end,
        'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from wp.support_messages m left join wp.users u on u.id = m.author_user_id left join staff.staff_users s on s.id = m.author_staff_id
      where m.ticket_id = k.id), '[]'::jsonb))
  from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id where k.id = p_id
$$;

-- An internal note: visible to staff only; it does not change the customer-facing last-message time.
create function platform.staff_ticket_note(p_id uuid, p_staff_id uuid, p_body text) returns boolean
  language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from wp.support_tickets where id = p_id;
  if v_workspace is null then return false; end if;
  insert into wp.support_messages (ticket_id, workspace_id, author_kind, author_staff_id, body) values (p_id, v_workspace, 'internal', p_staff_id, p_body);
  return true;
end
$$;

-- Assign (or unassign with null) a ticket to an active staff member.
create function platform.staff_ticket_assign(p_id uuid, p_assignee uuid) returns boolean
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_assignee is not null and not exists (select 1 from staff.staff_users where id = p_assignee and status = 'active') then
    raise exception 'assignee is not an active staff member' using errcode = '22023';
  end if;
  update wp.support_tickets set assigned_staff_id = p_assignee where id = p_id;
  return found;
end
$$;

-- The audit history with filters and keyset paging (newest first).
create function platform.staff_audit_search(p_action text, p_staff_id uuid, p_workspace_id uuid, p_since timestamptz, p_until timestamptz,
                                            p_before timestamptz, p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
    select a.id, a.action, a.target_type "targetType", a.target_id "targetId", a.workspace_id "workspaceId", a.metadata,
      a.ip, a.request_id "requestId", a.created_at "createdAt", s.name "staffName", s.role "staffRole"
    from staff.audit_log a left join staff.staff_users s on s.id = a.staff_id
    where (p_action is null or a.action like p_action || '%')
      and (p_staff_id is null or a.staff_id = p_staff_id)
      and (p_workspace_id is null or a.workspace_id = p_workspace_id)
      and (p_since is null or a.created_at >= p_since)
      and (p_until is null or a.created_at < p_until)
      and (p_before is null or a.created_at < p_before)
    order by a.created_at desc limit least(greatest(p_limit, 1), 500)) t
$$;
create index audit_log_created_idx on staff.audit_log (created_at desc);
create index audit_log_workspace_idx on staff.audit_log (workspace_id, created_at desc) where workspace_id is not null;

-- Operational alerts computed from the database: unknown stays unknown, nothing defaults to green.
create function platform.staff_alerts() returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'outboxPending', (select count(*) from platform.outbox where published_at is null),
    'outboxOldestSeconds', (select extract(epoch from now() - min(created_at))::int from platform.outbox where published_at is null),
    'stuckJobs', (select count(*) from wp.discovery_jobs where status in ('queued', 'running') and created_at < now() - interval '30 minutes'),
    'failedJobs1h', (select count(*) from wp.discovery_jobs where status = 'failed' and finished_at > now() - interval '1 hour'),
    'providerErrors1h', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
      select provider, count(*) n from platform.provider_calls where status = 'error' and created_at > now() - interval '1 hour' group by 1) e),
    'providerCalls1h', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
      select provider, count(*) n from platform.provider_calls where created_at > now() - interval '1 hour' group by 1) c),
    'monthSpendUsd', (select coalesce(jsonb_object_agg(provider, s), '{}'::jsonb) from (
      select provider, round(sum(cost_usd)::numeric, 4) s from platform.provider_calls where created_at >= date_trunc('month', now()) group by 1) m),
    'pausedProviders', (select coalesce(jsonb_agg(provider order by provider), '[]'::jsonb) from platform.provider_controls where paused),
    'pendingApprovals', (select count(*) from staff.approvals where status = 'pending' and expires_at > now()),
    'pendingRemovals', (select count(*) from gcp.removal_requests where status = 'received'),
    'oldestRemovalDays', (select extract(day from now() - min(created_at))::int from gcp.removal_requests where status = 'received')
  )
$$;

do $$
declare f text;
begin
  foreach f in array array['staff_ticket_note(uuid, uuid, text)', 'staff_ticket_assign(uuid, uuid)',
                           'staff_audit_search(text, uuid, uuid, timestamptz, timestamptz, timestamptz, integer)', 'staff_alerts()'] loop
    execute format('revoke all on function platform.%s from public', f);
    execute format('grant execute on function platform.%s to mushin_worker', f);
  end loop;
end $$;

grant select, insert, update on staff.webauthn_credentials, staff.webauthn_challenges, staff.approvals to mushin_worker;
grant select, insert, update on platform.provider_controls to mushin_worker;
grant update (assigned_staff_id) on wp.support_tickets to mushin_worker;

-- What staff see during granted support access: names, counts and statuses only. No ledger amounts, budgets or fees,
-- no contact values, no notes, no campaign objectives. The API checks the grant (staff member, status, expiry) first.
create function platform.support_access_view(p_workspace uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'name', w.name, 'createdAt', w.created_at,
        'members', (select count(*) from wp.workspace_members m where m.workspace_id = w.id),
        'subscriptionStatus', (select s.status from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1),
        'planId', (select s.plan_id from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1))
      from wp.workspaces w where w.id = p_workspace),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'updatedAt', l.updated_at,
        'creators', (select count(*) from wp.list_members lm where lm.list_id = l.id)) order by l.updated_at desc)
      from (select * from wp.lists where workspace_id = p_workspace order by updated_at desc limit 50) l), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'updatedAt', c.updated_at,
        'creators', (select count(*) from wp.campaign_creators cc where cc.campaign_id = c.id)) order by c.updated_at desc)
      from (select * from wp.campaigns where workspace_id = p_workspace order by updated_at desc limit 50) c), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'outcome', j.outcome,
        'errorCode', j.error_code, 'createdAt', j.created_at) order by j.created_at desc)
      from (select * from wp.discovery_jobs where workspace_id = p_workspace order by created_at desc limit 20) j), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'status', t.status, 'lastMessageAt', t.last_message_at) order by t.last_message_at desc)
      from (select * from wp.support_tickets where workspace_id = p_workspace order by last_message_at desc limit 20) t), '[]'::jsonb)
  )
$$;
revoke all on function platform.support_access_view(uuid) from public;

-- The workspace a job belongs to, so staff job actions can run inside that workspace's context.
create function platform.staff_job_workspace(p_id uuid) returns uuid
  language sql stable security definer set search_path = pg_catalog as $$ select workspace_id from wp.discovery_jobs where id = p_id $$;
revoke all on function platform.staff_job_workspace(uuid) from public;
grant execute on function platform.staff_job_workspace(uuid) to mushin_worker;
grant execute on function platform.support_access_view(uuid) to mushin_worker;
