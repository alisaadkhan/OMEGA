-- Contact availability in Search (2026-10-15). A contact found on a public profile is a lead, not a working address:
-- it stays "unverified" until there is evidence. `trust` keeps saying where it came from (business field or bio);
-- `status` says what has been established about it:
--   unverified  nothing checked yet (the default; shown as "Email available · Unverified")
--   domain_ok   the address is well formed and its domain publishes mail servers (MX, or an address record as the
--               implicit mail host). This does NOT prove the inbox exists or that mail will be delivered, so it is
--               still shown as unverified.
--   invalid     a check established the address cannot work: malformed, a reserved example domain, a domain that does
--               not exist, or a domain that declares it accepts no mail (null MX, RFC 7505).
--   verified    reserved for real delivery or confirmation evidence; nothing sets it yet.
-- Checks run only when a workspace that revealed the contact first logs email outreach to the creator in a campaign.
-- No test email is ever sent.
alter table gcp.creator_contacts
  add column status text not null default 'unverified' check (status in ('unverified', 'domain_ok', 'invalid', 'verified')),
  add column checked_at timestamptz,
  add column check_detail text;

-- Every check, kept as evidence: what was checked, the answer and who asked. Deleted with the contact (erasure).
create table gcp.contact_checks (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references gcp.creator_contacts (id) on delete cascade,
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  requested_by_workspace_id uuid,
  method text not null check (method in ('format_domain_mx')),
  result text not null check (result in ('domain_ok', 'invalid', 'check_failed')),
  detail text not null,
  checked_at timestamptz not null default now()
);
create index contact_checks_contact_idx on gcp.contact_checks (contact_id, checked_at desc);

grant select (status, checked_at, check_detail) on gcp.creator_contacts to mushin_app;
grant select, insert on gcp.contact_checks to mushin_worker;
