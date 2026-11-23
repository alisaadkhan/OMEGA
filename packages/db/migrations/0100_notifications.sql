-- Customer notifications (owner, 23 Nov: "complete all notifications, including emails of tickets and other features,
-- not campaign created or list created"). One row per person and event: the bell reads them, and each is also emailed
-- unless the person turned account emails off. Rows are made by the database itself, so they appear even where no
-- background worker runs (production): support replies and ticket resolutions by trigger, and every existing notify.*
-- event (credits, trial, payment, live search) as it is written to the outbox. The API sends the waiting emails.
create table if not exists wp.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  -- An in-app route only (never an outside address): "#/dashboard/...".
  link text check (link is null or link ~ '^#/dashboard(/[a-z0-9_-]+)*$'),
  source_key text not null check (char_length(source_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  email_attempts smallint not null default 0,
  emailed_at timestamptz,
  unique (user_id, source_key)
);
create index if not exists notifications_user_idx on wp.notifications (user_id, created_at desc);
create index if not exists notifications_workspace_idx on wp.notifications (workspace_id);
create index if not exists notifications_email_idx on wp.notifications (created_at) where email_status in ('pending', 'sending');
alter table wp.notifications enable row level security;
alter table wp.notifications force row level security;
drop policy if exists notifications_own on wp.notifications;
create policy notifications_own on wp.notifications
  using (user_id = platform.current_user_id() and workspace_id = platform.current_workspace_id());
grant select on wp.notifications to mushin_app;
grant update (read_at) on wp.notifications to mushin_app;

-- One notification for one person; email skipped when they turned account emails off or are not active.
create or replace function platform.notify_user(p_user uuid, p_workspace uuid, p_kind text, p_title text, p_body text, p_link text, p_source text)
  returns void language sql volatile security definer set search_path = pg_catalog as $$
  insert into wp.notifications (workspace_id, user_id, kind, title, body, link, source_key, email_status)
  select p_workspace, u.id, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 1000), p_link, p_source,
    case when u.status = 'active' and u.deleted_at is null and coalesce(u.preferences ->> 'emailNotifications', 'true') <> 'false' then 'pending' else 'skipped' end
  from wp.users u where u.id = p_user
  on conflict (user_id, source_key) do nothing
$$;

-- Account-wide events go to the account's owners and admins, as the billing emails always have.
create or replace function platform.notify_account(p_workspace uuid, p_kind text, p_title text, p_body text, p_link text, p_source text)
  returns void language sql volatile security definer set search_path = pg_catalog as $$
  select platform.notify_user(m.user_id, p_workspace, p_kind, p_title, p_body, p_link, p_source)
  from wp.workspace_members m join wp.users u on u.id = m.user_id
  where m.workspace_id = p_workspace and m.role in ('owner', 'admin') and u.status = 'active' and u.deleted_at is null
$$;

-- Support: a staff reply notifies the person who opened the request (internal notes never do).
create or replace function platform.notify_support_message() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  t record;
begin
  if new.author_kind <> 'staff' then return new; end if;
  select k.created_by, k.subject into t from wp.support_tickets k where k.id = new.ticket_id;
  if t is null then return new; end if;
  perform platform.notify_user(t.created_by, new.workspace_id, 'ticket_reply', 'Support replied: ' || t.subject,
    left(regexp_replace(new.body, '\s+', ' ', 'g'), 300), '#/dashboard/support', 'support_message:' || new.id);
  return new;
end
$$;
drop trigger if exists support_messages_notify on wp.support_messages;
create trigger support_messages_notify after insert on wp.support_messages for each row execute function platform.notify_support_message();

-- A request staff resolve or close notifies its author; one the customer closes themselves does not.
create or replace function platform.notify_support_status() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.status = old.status or new.status not in ('resolved', 'closed') then return new; end if;
  if platform.current_user_id() is not null then return new; end if;
  perform platform.notify_user(new.created_by, new.workspace_id, 'ticket_' || new.status,
    case when new.status = 'resolved' then 'Your support request was resolved: ' else 'Your support request was closed: ' end || new.subject,
    case when new.status = 'resolved' then 'If anything is still wrong, reply to it and it opens again.' else 'Start a new request any time from Support.' end,
    '#/dashboard/support', 'support_status:' || new.id || ':' || new.status || ':' || extract(epoch from now())::bigint);
  return new;
end
$$;
drop trigger if exists support_tickets_notify on wp.support_tickets;
create trigger support_tickets_notify after update of status on wp.support_tickets for each row execute function platform.notify_support_status();

-- Every notify.* event the billing engine and live search already write becomes a notification as it is written.
create or replace function platform.notify_from_outbox() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  left_n text := coalesce(new.payload ->> 'available', '');
  ends text := case when new.payload ->> 'trialEndsAt' is not null
    then to_char((new.payload ->> 'trialEndsAt')::timestamptz at time zone 'Asia/Karachi', 'FMDD Mon YYYY') end;
  failed boolean := new.payload ->> 'status' = 'failed';
  src text := 'outbox:' || new.id;
begin
  if new.workspace_id is null or new.event_type not like 'notify.%' then return new; end if;
  case new.event_type
    when 'notify.credits_low' then perform platform.notify_account(new.workspace_id, 'credits_low', 'Your credits are running low',
      case when left_n <> '' then left_n || ' credits are left. ' else '' end || 'Top up or change plan to keep searching.', '#/dashboard/billing', src);
    when 'notify.credits_very_low' then perform platform.notify_account(new.workspace_id, 'credits_very_low', 'Your credits are almost used up',
      case when left_n <> '' then left_n || ' credits are left. ' else '' end || 'Searches and contact unlocks stop when they run out.', '#/dashboard/billing', src);
    when 'notify.trial_ending' then perform platform.notify_account(new.workspace_id, 'trial_ending', 'Your free trial ends soon',
      'Your free trial ends' || coalesce(' on ' || ends, ' soon') || '. Choose a plan to keep your shortlists, campaigns and credits.', '#/dashboard/billing', src);
    when 'notify.trial_expired' then perform platform.notify_account(new.workspace_id, 'trial_expired', 'Your free trial has ended',
      'Your shortlists and campaigns are kept. Choose a plan to continue.', '#/dashboard/billing', src);
    when 'notify.subscription_canceled' then perform platform.notify_account(new.workspace_id, 'subscription_canceled', 'Your subscription was canceled',
      'Your shortlists and campaigns are kept. You can subscribe again at any time.', '#/dashboard/billing', src);
    when 'notify.payment_failed' then perform platform.notify_account(new.workspace_id, 'payment_failed', 'Your payment did not go through',
      'Please check your payment method.', '#/dashboard/billing', src);
    when 'notify.discovery_job_finished' then perform platform.notify_account(new.workspace_id,
      case when failed then 'live_search_failed' else 'live_search_done' end,
      case when failed then 'Your live search could not finish' else 'Your live search has finished' end,
      case when failed then 'Any credits it held were returned.' else 'The new creators are ready to review.' end, '#/dashboard/search', src);
    else null;
  end case;
  return new;
end
$$;
drop trigger if exists outbox_notify on platform.outbox;
create trigger outbox_notify after insert on platform.outbox for each row execute function platform.notify_from_outbox();

-- Email delivery for the API: claim a batch of waiting emails (one sender at a time per row), then record each outcome.
-- A claim older than 15 minutes is claimable again; after five failed attempts an email is given up.
create or replace function platform.notification_emails_claim(p_limit integer)
  returns table (id uuid, email text, name text, title text, body text, link text)
  language sql volatile security definer set search_path = pg_catalog as $$
  with picked as (
    select n.id from wp.notifications n
    where (n.email_status = 'pending' or (n.email_status = 'sending' and n.emailed_at < now() - interval '15 minutes'))
      and n.created_at > now() - interval '7 days'
    order by n.created_at limit greatest(1, least(p_limit, 100)) for update skip locked),
  claimed as (
    update wp.notifications n set email_status = 'sending', email_attempts = n.email_attempts + 1, emailed_at = now()
    from picked where n.id = picked.id returning n.*)
  select c.id, u.email, u.display_name, c.title, c.body, c.link from claimed c join wp.users u on u.id = c.user_id
$$;
create or replace function platform.notification_email_done(p_id uuid, p_ok boolean, p_retry boolean)
  returns void language sql volatile security definer set search_path = pg_catalog as $$
  update wp.notifications set
    email_status = case when p_ok then 'sent' when p_retry and email_attempts < 5 then 'pending' else 'failed' end,
    emailed_at = now()
  where id = p_id and email_status = 'sending'
$$;

revoke all on function platform.notify_user(uuid, uuid, text, text, text, text, text) from public;
revoke all on function platform.notify_account(uuid, text, text, text, text, text) from public;
revoke all on function platform.notification_emails_claim(integer) from public;
revoke all on function platform.notification_email_done(uuid, boolean, boolean) from public;
grant execute on function platform.notification_emails_claim(integer) to mushin_worker;
grant execute on function platform.notification_email_done(uuid, boolean, boolean) to mushin_worker;
grant execute on function platform.notify_user(uuid, uuid, text, text, text, text, text) to mushin_worker;
grant execute on function platform.notify_account(uuid, text, text, text, text, text) to mushin_worker;
