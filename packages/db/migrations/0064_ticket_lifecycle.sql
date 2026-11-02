-- Support ticket lifecycle (research-informed plan, Phase 11; owner backlog 2026-10-29): an "In progress" state, the
-- timestamps staff performance needs, and an append-only history they are computed from. Recorded by triggers, so the
-- customer service, the staff functions and any later writer are all covered.
--   first_response_at  first reply by staff (internal notes are not replies)
--   resolved_at        when the ticket last became resolved or closed; cleared when it is reopened
--   reopened_count     times a resolved or closed ticket became active again; last_reopened_at the latest
-- Nothing existing is backfilled: history starts with this migration and the metrics say so.

alter table wp.support_tickets drop constraint support_tickets_status_check;
alter table wp.support_tickets add constraint support_tickets_status_check
  check (status in ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'));
alter table wp.support_tickets
  add column first_response_at timestamptz,
  add column resolved_at timestamptz,
  add column reopened_count integer not null default 0 check (reopened_count >= 0),
  add column last_reopened_at timestamptz;

create table wp.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references wp.support_tickets (id) on delete cascade,
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  kind text not null check (kind in ('created', 'status', 'first_response', 'assigned', 'reopened')),
  from_status text,
  to_status text,
  assignee_staff_id uuid references staff.staff_users (id) on delete set null,
  at timestamptz not null default now()
);
create index support_ticket_events_ticket_idx on wp.support_ticket_events (ticket_id, at);
create index support_ticket_events_at_idx on wp.support_ticket_events (at);
-- Foreign keys are indexed: workspace erasure deletes by workspace, staff removal sets the assignee to null.
create index support_ticket_events_workspace_idx on wp.support_ticket_events (workspace_id);
create index support_ticket_events_assignee_idx on wp.support_ticket_events (assignee_staff_id) where assignee_staff_id is not null;
-- Written only by the triggers below (security definer) and read only through staff functions; like every wp table it
-- has forced row-level security with the tenant policy (rls.int guard). No app role is granted access to it.
alter table wp.support_ticket_events enable row level security;
alter table wp.support_ticket_events force row level security;
create policy support_ticket_events_tenant on wp.support_ticket_events
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
revoke all on wp.support_ticket_events from public;

create function platform.support_ticket_before_update() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
      new.resolved_at := now();
    elsif old.status in ('resolved', 'closed') and new.status not in ('resolved', 'closed') then
      new.resolved_at := null;
      new.reopened_count := old.reopened_count + 1;
      new.last_reopened_at := now();
    end if;
  end if;
  return new;
end
$$;
create trigger support_tickets_lifecycle before update on wp.support_tickets
  for each row execute function platform.support_ticket_before_update();

create function platform.support_ticket_record() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    insert into wp.support_ticket_events (ticket_id, workspace_id, kind, to_status) values (new.id, new.workspace_id, 'created', new.status);
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into wp.support_ticket_events (ticket_id, workspace_id, kind, from_status, to_status) values (new.id, new.workspace_id, 'status', old.status, new.status);
    if old.status in ('resolved', 'closed') and new.status not in ('resolved', 'closed') then
      insert into wp.support_ticket_events (ticket_id, workspace_id, kind, from_status, to_status) values (new.id, new.workspace_id, 'reopened', old.status, new.status);
    end if;
  end if;
  if new.assigned_staff_id is distinct from old.assigned_staff_id then
    insert into wp.support_ticket_events (ticket_id, workspace_id, kind, assignee_staff_id) values (new.id, new.workspace_id, 'assigned', new.assigned_staff_id);
  end if;
  return null;
end
$$;
create trigger support_tickets_history after insert or update on wp.support_tickets
  for each row execute function platform.support_ticket_record();

create function platform.support_message_first_response() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.author_kind = 'staff' then
    update wp.support_tickets set first_response_at = new.created_at where id = new.ticket_id and first_response_at is null;
    if found then
      insert into wp.support_ticket_events (ticket_id, workspace_id, kind, at) values (new.ticket_id, new.workspace_id, 'first_response', new.created_at);
    end if;
  end if;
  return null;
end
$$;
create trigger support_messages_first_response after insert on wp.support_messages
  for each row execute function platform.support_message_first_response();

-- Staff performance over the last p_days days (Super Admin). Definitions:
--   workload      active tickets (open, in progress, waiting on customer) assigned to the person now
--   resolved      tickets that became resolved or closed in the window, by the person assigned at that time
--   firstResponseMinutes / resolutionMinutes  medians over tickets created in the window (resolution: created to the
--                 first resolved/closed event); tickets without the event are left out, and counted in "pending"
--   reopened      reopen events in the window
--   backlog       all active tickets, assigned or not
-- Only history recorded since 0064 counts.
create function platform.staff_support_performance(p_days integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  with win as (select now() - make_interval(days => greatest(least(p_days, 365), 1)) since),
  t as (select k.* from wp.support_tickets k, win where k.created_at >= win.since),
  first_resolved as (
    select e.ticket_id, min(e.at) at from wp.support_ticket_events e
    where e.kind = 'status' and e.to_status in ('resolved', 'closed') group by e.ticket_id),
  people as (
    select s.id, s.name from staff.staff_users s where s.status = 'active'
    union all select null::uuid, 'Unassigned')
  select jsonb_build_object(
    'days', greatest(least(p_days, 365), 1),
    'historySince', (select min(at) from wp.support_ticket_events),
    'backlog', (select count(*) from wp.support_tickets where status in ('open', 'in_progress', 'waiting_on_customer')),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'staffId', p.id, 'name', p.name,
        'workload', (select count(*) from wp.support_tickets k where k.assigned_staff_id is not distinct from p.id and k.status in ('open', 'in_progress', 'waiting_on_customer')),
        'resolved', (select count(*) from wp.support_ticket_events e, win where e.kind = 'status' and e.to_status in ('resolved', 'closed') and e.at >= win.since
                       and (select k.assigned_staff_id from wp.support_tickets k where k.id = e.ticket_id) is not distinct from p.id),
        'firstResponseMinutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (t.first_response_at - t.created_at)) / 60))::numeric, 1)
                                 from t where t.assigned_staff_id is not distinct from p.id and t.first_response_at is not null),
        'resolutionMinutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (r.at - t.created_at)) / 60))::numeric, 1)
                              from t join first_resolved r on r.ticket_id = t.id where t.assigned_staff_id is not distinct from p.id),
        'pending', (select count(*) from t where t.assigned_staff_id is not distinct from p.id and t.first_response_at is null),
        'reopened', (select count(*) from wp.support_ticket_events e, win where e.kind = 'reopened' and e.at >= win.since
                       and (select k.assigned_staff_id from wp.support_tickets k where k.id = e.ticket_id) is not distinct from p.id)
      ) order by p.name) from people p), '[]'::jsonb)
  );
$$;
revoke all on function platform.staff_support_performance(integer) from public;
grant execute on function platform.staff_support_performance(integer) to mushin_worker;
