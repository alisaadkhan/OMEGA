-- Staff console (owner, 25 Nov). Admins see every customer's full email and can find an account by part of an email
-- ("give credits by email, less complex"); Support keeps the masked list (platform.staff_workspaces). The API calls this
-- only for Admin and Super Admin staff.
create or replace function platform.staff_workspaces_full(p_query text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select w.id, w.name, w.created_at "createdAt", o.email "ownerEmail",
      (select count(*) from wp.workspace_members m where m.workspace_id = w.id) members,
      (select s.status from wp.subscriptions s where s.workspace_id = w.id order by s.created_at desc limit 1) "subscriptionStatus",
      (select count(*) from wp.discovery_jobs j where j.workspace_id = w.id and j.created_at > now() - interval '30 days') "jobs30d",
      (select count(*) from wp.support_tickets k where k.workspace_id = w.id and k.status in ('open', 'waiting_on_customer')) "openTickets"
    from wp.workspaces w join wp.users o on o.id = w.owner_user_id
    where p_query = '' or w.name ilike '%' || p_query || '%' or w.id::text = p_query
      or o.email ilike '%' || p_query || '%'
      or exists (select 1 from wp.workspace_members m join wp.users u on u.id = m.user_id where m.workspace_id = w.id and (u.email ilike '%' || p_query || '%' or u.id::text = p_query))
    order by w.created_at desc limit 100) t
$$;
revoke all on function platform.staff_workspaces_full(text) from public;
grant execute on function platform.staff_workspaces_full(text) to mushin_worker;
