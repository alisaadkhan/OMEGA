-- Support categories and customer priority (master directive §6.1, owner directive 2026-11-04). Customers choose one of
-- Billing & Credits, Creator Data Issue, Live Discovery Issue, Account & Team, Feature Request (plus Data removal and
-- Other, kept for privacy requests and anything else); earlier rows keep their category (search and the rest stay valid).
-- Priority becomes low / medium / high / urgent, chosen by the customer on creation (default medium) and changeable by
-- staff; "normal" rows become "medium". The staff queue still lists urgent first.
alter table wp.support_tickets drop constraint if exists support_tickets_category_check;
alter table wp.support_tickets add constraint support_tickets_category_check
  check (category in ('billing', 'creator_data', 'discovery', 'account', 'feature_request', 'data_removal', 'other', 'search'));
alter table wp.support_tickets drop constraint if exists support_tickets_priority_check;
update wp.support_tickets set priority = 'medium' where priority = 'normal';
alter table wp.support_tickets alter column priority set default 'medium';
alter table wp.support_tickets add constraint support_tickets_priority_check check (priority in ('low', 'medium', 'high', 'urgent'));

create or replace function platform.staff_tickets(p_status text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.rank, t."lastMessageAt" desc), '[]'::jsonb) from (
    select k.id, k.workspace_id "workspaceId", w.name "workspaceName", k.subject, k.category, k.status, k.priority,
      k.created_at "createdAt", k.last_message_at "lastMessageAt",
      (select count(*) from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal') messages,
      (select m.author_kind from wp.support_messages m where m.ticket_id = k.id and m.author_kind <> 'internal' order by m.created_at desc limit 1) "lastAuthor",
      k.assigned_staff_id "assignedStaffId", (select s.name from staff.staff_users s where s.id = k.assigned_staff_id) "assignedStaffName",
      case k.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end rank
    from wp.support_tickets k join wp.workspaces w on w.id = k.workspace_id
    where p_status is null or k.status = p_status
    order by case k.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, k.last_message_at desc limit 200) t
$$;
