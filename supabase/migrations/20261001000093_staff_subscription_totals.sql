-- Staff Subscriptions page (owner, 22 Nov): how many accounts are on each plan and the payments the payment provider
-- recorded. Workspace rows are row-level protected, so totals across accounts come from one security-definer function
-- returning counts and payment rows only (no customer emails), like the other platform.staff_* reads.
create or replace function platform.staff_subscription_totals() returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'accounts', (select count(*) from wp.workspaces w where w.status = 'active'),
    'withoutPlan', (select count(*) from wp.workspaces w where w.status = 'active'
                      and not exists (select 1 from wp.subscriptions s where s.workspace_id = w.id and s.plan_id is not null and s.status in ('trialing', 'active', 'past_due'))),
    'plans', (select coalesce(jsonb_agg(row_to_json(p) order by p."sortOrder"), '[]'::jsonb) from (
      select pl.id, pl.name, pl.monthly_credits "monthlyCredits", pl.display_currency "displayCurrency",
        pl.display_monthly_minor "displayMonthlyMinor", pl.sort_order "sortOrder",
        count(s.workspace_id) filter (where s.status in ('trialing', 'active', 'past_due')) accounts,
        count(s.workspace_id) filter (where s.status in ('active', 'past_due') and coalesce(s.paddle_subscription_id, '') not like 'comp:%' and s.paddle_subscription_id is not null) paying,
        count(s.workspace_id) filter (where s.status in ('active', 'past_due') and s.paddle_subscription_id like 'comp:%') complimentary,
        count(s.workspace_id) filter (where s.status = 'trialing') trialing
      from platform.plans pl
      left join wp.subscriptions s on s.plan_id = pl.id and exists (select 1 from wp.workspaces w where w.id = s.workspace_id and w.status = 'active')
      where pl.active group by pl.id) p),
    'payments', (select coalesce(jsonb_agg(row_to_json(t) order by t."createdAt" desc), '[]'::jsonb) from (
      select pm.id, pm.workspace_id "workspaceId", w.name "workspaceName", pm.kind, pm.amount_minor "amountMinor", pm.currency,
        pm.status, pm.refunded_minor "refundedMinor", pm.created_at "createdAt"
      from wp.payments pm join wp.workspaces w on w.id = pm.workspace_id
      order by pm.created_at desc limit 100) t),
    'at', now())
$$;

-- The people in one account, for the Users page drill-down (admins only; the API audits each viewing). A person's row
-- is otherwise visible only to that person.
create or replace function platform.staff_workspace_members(p_workspace uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."joinedAt"), '[]'::jsonb) from (
    select u.display_name "name", u.email, m.role, m.created_at "joinedAt"
    from wp.workspace_members m join wp.users u on u.id = m.user_id
    where m.workspace_id = p_workspace and u.status <> 'deleted') t
$$;

revoke all on function platform.staff_subscription_totals() from public;
grant execute on function platform.staff_subscription_totals() to mushin_worker;
revoke all on function platform.staff_workspace_members(uuid) from public;
grant execute on function platform.staff_workspace_members(uuid) to mushin_worker;
