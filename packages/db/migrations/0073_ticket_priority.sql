-- Ticket priority (master directive, support system): staff mark a ticket low, normal, high or urgent; the staff queue
-- lists urgent first, then by latest message. Customers never see it. Set through platform.staff_ticket_set_priority.
alter table wp.support_tickets add column priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));

create or replace function platform.staff_tickets(p_status text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.rank, t."lastMessageAt" desc), '[]'::jsonb) from (
    select k.id, k.workspace_id "workspaceId", w.name "workspaceName", k.subject, k.category, k.status, k.priority,
      k.created_at "createdAt", k.last_message_at "lastMessageAt",
      (select count(*) from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal') messages,
      (select m.author_kind from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal' order by m.created_at desc limit 1) "lastAuthor",
      k.assigned_staff_id "assignedStaffId", (select s.name from staff.staff_users s where s.id = k.assigned_staff_id) "assignedStaffName",
      case k.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end rank
    from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id
    where p_status is null or k.status = p_status
    order by case k.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, k.last_message_at desc limit 200) t
$$;

create or replace function platform.staff_ticket(p_id uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'id', k.id, 'workspaceId', k.workspace_id, 'workspaceName', w.name, 'subject', k.subject, 'category', k.category,
    'status', k.status, 'priority', k.priority, 'createdAt', k.created_at, 'lastMessageAt', k.last_message_at,
    'assignedStaffId', k.assigned_staff_id, 'assignedStaffName', (select s.name from staff.staff_users s where s.id = k.assigned_staff_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'authorKind', m.author_kind,
        'authorName', case when m.author_kind in ('staff', 'internal') then coalesce(s.name, 'MUSHIN support') else coalesce(u.display_name, split_part(u.email, '@', 1)) end,
        'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from wp.support_messages m left join wp.users u on u.id = m.author_user_id left join staff.staff_users s on s.id = m.author_staff_id
      where m.ticket_id = k.id), '[]'::jsonb))
  from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id where k.id = p_id
$$;

create function platform.staff_ticket_set_priority(p_id uuid, p_priority text) returns boolean
  language sql security definer set search_path = pg_catalog as $$
  with u as (update wp.support_tickets set priority = p_priority, updated_at = now() where id = p_id returning 1)
  select exists (select 1 from u)
$$;

revoke all on function platform.staff_tickets(text) from public;
revoke all on function platform.staff_ticket(uuid) from public;
revoke all on function platform.staff_ticket_set_priority(uuid, text) from public;
grant execute on function platform.staff_tickets(text) to mushin_worker;
grant execute on function platform.staff_ticket(uuid) to mushin_worker;
grant execute on function platform.staff_ticket_set_priority(uuid, text) to mushin_worker;
