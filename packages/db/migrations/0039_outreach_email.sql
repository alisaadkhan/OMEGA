-- Outreach email (owner decision 2026-10-16): one email at a time, sent only on a person's explicit confirmation, to a
-- creator contact this workspace has revealed. Plan allowance per billing period: Starter 0, Growth 500, Scale 2,000.
--   * The send row is the quota record: a row counts unless it failed. It is written (status requested) under a
--     per-workspace lock before the provider is called, so concurrent sends cannot pass the allowance, and the same
--     idempotency key never sends or counts twice. A provider refusal marks it failed, which frees the slot.
--   * Status moves only on evidence: accepted = the provider took it; delivered, bounced, complained = signed provider
--     webhooks. "Accepted" is never shown as delivered.
--   * Bounced and complained addresses, and people who unsubscribe, are suppressed for every workspace (stored as a
--     hash of the address only).

create table wp.outreach_emails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  campaign_id uuid not null references wp.campaigns (id) on delete cascade,
  creator_id uuid not null,
  contact_id uuid not null,
  requested_by uuid not null references wp.users (id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  recipient_masked text not null,
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 10000),
  mode text not null check (mode in ('test', 'resend')),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'delivered', 'bounced', 'complained', 'failed')),
  provider_message_id text unique,
  failure_reason text,
  period_start timestamptz not null,
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index outreach_emails_quota_idx on wp.outreach_emails (workspace_id, period_start) where status <> 'failed';
create index outreach_emails_campaign_idx on wp.outreach_emails (workspace_id, campaign_id, created_at desc);
create index outreach_emails_user_rate_idx on wp.outreach_emails (requested_by, created_at desc);
create trigger outreach_emails_updated_at before update on wp.outreach_emails for each row execute function platform.set_updated_at();
alter table wp.outreach_emails enable row level security;
alter table wp.outreach_emails force row level security;
create policy outreach_emails_tenant on wp.outreach_emails
  using (workspace_id = platform.current_workspace_id()) with check (workspace_id = platform.current_workspace_id());
grant select, insert on wp.outreach_emails to mushin_app;
grant update (status, provider_message_id, failure_reason, status_at) on wp.outreach_emails to mushin_app;
grant select, update on wp.outreach_emails to mushin_worker;

-- Addresses MUSHIN will not email again, from any workspace.
create table platform.email_suppressions (
  recipient_hash text primary key check (recipient_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('bounced', 'complained', 'unsubscribed')),
  created_at timestamptz not null default now()
);
grant select on platform.email_suppressions to mushin_app;
grant select, insert on platform.email_suppressions to mushin_worker;

-- Provider webhook deliveries already applied (replay protection on the provider's message id).
create table platform.email_webhook_events (
  provider_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
grant select, insert on platform.email_webhook_events to mushin_worker;

-- The revealed email contact to send to: only an email this workspace revealed, of an active, unprotected creator.
create function gcp.revealed_email(p_creator_id uuid, p_contact_id uuid)
  returns table (id uuid, value_encrypted text, value_hash text, masked text, status text)
  language sql stable security definer set search_path = pg_catalog as $$
  select c.id, c.value_encrypted, c.value_hash, c.masked, c.status
  from gcp.creator_contacts c
  join gcp.creators cr on cr.id = c.creator_id
  where c.id = p_contact_id and c.creator_id = p_creator_id and c.kind = 'email'
    and cr.status = 'active'
    and not (cr.is_minor and cr.minor_override_by_staff_id is null)
    and exists (select 1 from wp.contact_reveals r where r.workspace_id = platform.current_workspace_id() and r.creator_id = p_creator_id)
$$;
revoke all on function gcp.revealed_email(uuid, uuid) from public;
grant execute on function gcp.revealed_email(uuid, uuid) to mushin_app;

-- Which workspace a provider message belongs to (provider webhooks carry no workspace): worker only.
create function platform.outreach_email_owner(p_message_id text) returns uuid
  language sql stable security definer set search_path = pg_catalog as $$
  select workspace_id from wp.outreach_emails where provider_message_id = p_message_id
$$;
revoke all on function platform.outreach_email_owner(text) from public;
grant execute on function platform.outreach_email_owner(text) to mushin_worker;

-- Unsubscribe link (public, token-checked by the API): suppress the address.
create function platform.suppress_email(p_recipient_hash text, p_reason text) returns void
  language sql security definer set search_path = pg_catalog as $$
  insert into platform.email_suppressions (recipient_hash, reason) values (p_recipient_hash, p_reason)
  on conflict (recipient_hash) do nothing
$$;
revoke all on function platform.suppress_email(text, text) from public;
grant execute on function platform.suppress_email(text, text) to mushin_worker;
