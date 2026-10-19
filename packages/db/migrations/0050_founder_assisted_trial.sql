-- Founder-assisted trial (mandate v4 Phase 3; owner decisions 2026-10-19).
-- - A trial starts only when a Super Admin approves it, after a call or a callback request. Sign-up no longer starts one
--   (API setting TRIAL_ACTIVATION, default "approval").
-- - An approved trial is 14 days with 2,500 credits on the existing ledger (one balance; trial lots expire with the trial).
-- - The once-per-person rule (0036) and once-per-workspace subscription row still prevent duplicate trials.
-- - Callback requests come from anonymous visitors, so only the API's system role can read or change them.
-- - Feedback belongs to a workspace (tenant policy). Staff read it through a curated function.

update platform.billing_settings set trial_credits = 2500;

create table platform.trial_requests (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 120),
  business_name text not null check (length(btrim(business_name)) between 1 and 160),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{6,19}$'),
  callback_window text not null check (callback_window in ('morning', 'afternoon', 'evening', 'anytime')),
  use_case text check (use_case is null or length(use_case) <= 1000),
  -- The exact consent wording shown, and when it was given: contact is only by the channel the person entered.
  consent_text text not null check (length(consent_text) between 1 and 500),
  consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'approved', 'rejected')),
  contacted_by uuid references staff.staff_users (id),
  contacted_at timestamptz,
  workspace_id uuid references wp.workspaces (id) on delete set null,
  decided_by uuid references staff.staff_users (id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null),
  check ((status in ('approved', 'rejected')) = (decided_at is not null and decided_by is not null)),
  check (status <> 'approved' or workspace_id is not null)
);
create index trial_requests_queue on platform.trial_requests (status, created_at desc);
-- One approved request per workspace: a second approval for the same workspace is refused by the database too.
create unique index trial_requests_one_approval on platform.trial_requests (workspace_id) where status = 'approved';
create trigger trial_requests_updated_at before update on platform.trial_requests for each row execute function platform.set_updated_at();
grant select, insert, update on platform.trial_requests to mushin_worker;

create table wp.trial_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id),
  search_quality smallint check (search_quality between 1 and 5),
  contact_accuracy smallint check (contact_accuracy between 1 and 5),
  ease_of_use smallint check (ease_of_use between 1 and 5),
  saved_time text check (saved_time in ('yes', 'no', 'not_sure')),
  would_pay text check (would_pay in ('yes', 'maybe', 'no')),
  preferred_plan text references platform.plans (id),
  missing_features text check (missing_features is null or length(missing_features) <= 2000),
  comments text check (comments is null or length(comments) <= 4000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(search_quality, contact_accuracy, ease_of_use, saved_time, would_pay, preferred_plan, missing_features, comments) > 0)
);
create index trial_feedback_workspace on wp.trial_feedback (workspace_id, created_at desc);
alter table wp.trial_feedback enable row level security;
alter table wp.trial_feedback force row level security;
create policy trial_feedback_tenant on wp.trial_feedback
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.trial_feedback to mushin_app;

-- Staff: who owns the account with this email, its own workspaces, and whether a trial was already given. No contact
-- data beyond the email the staff member typed.
create function platform.staff_trial_candidate(p_email text) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'userId', u.id,
    'status', u.status,
    'trialGrantedAt', u.trial_granted_at,
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name,
        'subscriptionCreatedAt', (select s.created_at from wp.subscriptions s where s.workspace_id = w.id)) order by w.created_at)
      from wp.workspaces w where w.owner_user_id = u.id and w.status = 'active'), '[]'::jsonb))
  from wp.users u where lower(u.email) = lower(btrim(p_email)) and u.status <> 'deleted'
  limit 1
$$;

-- Staff: feedback across workspaces, newest first, with the workspace name (owner export).
create function platform.staff_trial_feedback(p_limit integer) returns jsonb
  language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."createdAt" desc), '[]'::jsonb) from (
    select f.id, f.workspace_id "workspaceId", w.name "workspaceName", f.search_quality "searchQuality",
      f.contact_accuracy "contactAccuracy", f.ease_of_use "easeOfUse", f.saved_time "savedTime", f.would_pay "wouldPay",
      f.preferred_plan "preferredPlan", f.missing_features "missingFeatures", f.comments, f.created_at "createdAt"
    from wp.trial_feedback f join wp.workspaces w on w.id = f.workspace_id
    order by f.created_at desc limit least(greatest(p_limit, 1), 1000)) t
$$;

revoke all on function platform.staff_trial_candidate(text) from public;
revoke all on function platform.staff_trial_feedback(integer) from public;
grant execute on function platform.staff_trial_candidate(text) to mushin_worker;
grant execute on function platform.staff_trial_feedback(integer) to mushin_worker;
