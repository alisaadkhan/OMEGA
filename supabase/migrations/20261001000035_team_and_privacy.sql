-- Team membership and customer privacy self-service (2026-10-15; readiness report H7, H8).
--   * Invitations: an owner or admin invites by email; the invited person accepts while signed in with that same,
--     verified email (a forwarded link is useless to anyone else). Links expire after 7 days and can be revoked.
--   * Workspace deletion: the workspace's content is erased and it becomes unreachable. Billing records (subscriptions,
--     checkouts, payments, credit lots, ledger, reservations, schedule, entitlement usage) are KEPT until the owner sets
--     a retention period (open decision); the staff audit log is kept too.
--   * Account deletion: memberships end, owned workspaces with no other member are deleted as above, and the profile
--     is scrubbed. The sign-in identity itself lives in the identity provider and is removed there.

alter table wp.workspaces add column status text not null default 'active' check (status in ('active', 'deleted'));
alter table wp.workspaces add column deleted_at timestamptz;

create table wp.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254 and email like '%_@_%'),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references wp.users (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references wp.users (id),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index workspace_invitations_one_pending on wp.workspace_invitations (workspace_id, email) where status = 'pending';
alter table wp.workspace_invitations enable row level security;
alter table wp.workspace_invitations force row level security;
create policy workspace_invitations_tenant on wp.workspace_invitations
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert, update (status) on wp.workspace_invitations to mushin_app;
grant select on wp.workspace_invitations to mushin_worker;

-- What an invitation link shows before accepting (no other workspace data).
create function platform.invitation_preview(p_token_hash text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('workspaceName', w.name, 'role', i.role, 'email', i.email, 'invitedBy', coalesce(u.display_name, 'A teammate'),
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' when w.status <> 'active' then 'revoked' else i.status end, 'expiresAt', i.expires_at)
  from wp.workspace_invitations i join wp.workspaces w on w.id = i.workspace_id left join wp.users u on u.id = i.invited_by
  where i.token_hash = p_token_hash
$$;

-- Accepts an invitation for this user if it is pending, unexpired, for an active workspace and for this user's email.
-- Returns the workspace id and role, or null with no change.
create function platform.accept_invitation(p_token_hash text, p_user uuid, p_email text, p_name text) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare i wp.workspace_invitations%rowtype;
begin
  select * into i from wp.workspace_invitations where token_hash = p_token_hash for update;
  if not found or i.status <> 'pending' or i.expires_at <= now() or i.email <> lower(p_email) then return null; end if;
  if not exists (select 1 from wp.workspaces where id = i.workspace_id and status = 'active') then return null; end if;
  insert into wp.users (id, email, display_name) values (p_user, lower(p_email), p_name) on conflict (id) do nothing;
  if exists (select 1 from wp.users where id = p_user and status <> 'active') then return null; end if;
  insert into wp.workspace_members (workspace_id, user_id, role) values (i.workspace_id, p_user, i.role) on conflict (workspace_id, user_id) do nothing;
  update wp.workspace_invitations set status = 'accepted', accepted_by = p_user, accepted_at = now() where id = i.id;
  return jsonb_build_object('workspaceId', i.workspace_id, 'role', (select role from wp.workspace_members where workspace_id = i.workspace_id and user_id = p_user));
end
$$;

-- Erases a workspace's content and closes it. Billing records and the staff audit log are kept (see header).
create function platform.erase_workspace(p_workspace uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare counts jsonb := '{}'::jsonb; n bigint; t text;
begin
  foreach t in array array['outreach_events', 'campaign_creators', 'campaigns', 'list_members', 'lists', 'saved_searches',
                           'support_messages', 'support_tickets', 'support_access_requests', 'contact_reveals', 'audience_views',
                           'audience_jobs', 'discovery_candidates', 'discovery_results', 'discovery_jobs', 'discovery_estimates',
                           'catalog_search_charges', 'workspace_invitations', 'workspace_members'] loop
    execute format('delete from wp.%I where workspace_id = $1', t) using p_workspace;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;
  delete from platform.idempotency_keys where workspace_id = p_workspace;
  delete from platform.outbox where workspace_id = p_workspace and published_at is null;
  update wp.workspaces set status = 'deleted', deleted_at = now(), name = 'Deleted workspace' where id = p_workspace;
  return counts;
end
$$;

-- Deletes a customer account: ends memberships, erases owned workspaces that have no other member, scrubs the profile.
-- Refused (returns the reason) while the user owns a workspace that still has other members: ownership moves first.
create function platform.delete_account(p_user uuid) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare w record; erased uuid[] := '{}';
begin
  if exists (select 1 from wp.workspaces ws where ws.owner_user_id = p_user and ws.status = 'active'
             and exists (select 1 from wp.workspace_members m where m.workspace_id = ws.id and m.user_id <> p_user)) then
    return jsonb_build_object('deleted', false, 'reason', 'owner_of_shared_workspace');
  end if;
  -- Money first: a workspace this person owns may not still be paying.
  if exists (select 1 from wp.workspaces ws where ws.owner_user_id = p_user and ws.status = 'active'
             and (select s.status from wp.subscriptions s where s.workspace_id = ws.id order by s.created_at desc limit 1) in ('active', 'past_due')) then
    return jsonb_build_object('deleted', false, 'reason', 'subscription_active');
  end if;
  for w in select id from wp.workspaces where owner_user_id = p_user and status = 'active' loop
    perform platform.erase_workspace(w.id);
    erased := erased || w.id;
  end loop;
  delete from wp.workspace_members where user_id = p_user;
  update wp.users set email = 'deleted+' || p_user::text || '@invalid', display_name = null, avatar_url = null, preferences = '{}'::jsonb,
    status = 'deleted', deleted_at = now() where id = p_user;
  return jsonb_build_object('deleted', true, 'erasedWorkspaces', to_jsonb(erased));
end
$$;

do $$
declare f text;
begin
  foreach f in array array['invitation_preview(text)', 'accept_invitation(text, uuid, text, text)', 'erase_workspace(uuid)', 'delete_account(uuid)'] loop
    execute format('revoke all on function platform.%s from public', f);
    execute format('grant execute on function platform.%s to mushin_worker', f);
  end loop;
end $$;

-- The workspaces this user belongs to (for the workspace switcher); row-level security shows only the current one.
create function platform.my_workspaces(p_user uuid) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'role', m.role) order by m.created_at), '[]'::jsonb)
  from wp.workspace_members m join wp.workspaces w on w.id = m.workspace_id
  where m.user_id = p_user and w.status = 'active'
$$;
revoke all on function platform.my_workspaces(uuid) from public;
grant execute on function platform.my_workspaces(uuid) to mushin_worker;

-- Removing a member (owner/admin, or leaving yourself) happens in the tenant context; RLS keeps it to this workspace.
grant delete on wp.workspace_members to mushin_app;
grant update (owner_user_id) on wp.workspaces to mushin_app;
