-- Audit SEC-07 (2026-10-17): a staff member's FIRST security key needs a one-time enrolment code, issued out of band
-- (printed by the account-creation or code CLI to the operator, never sent by the app). A phished password + TOTP for an
-- Admin who has no key yet is then not enough to enrol the attacker's key and gain hardware-key privileges.
-- Only the SHA-256 of the code is stored; a code works once, until it expires, for its staff member only.
create table staff.enrolment_codes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  issued_by text not null check (length(issued_by) between 1 and 200),
  reason text not null check (length(reason) between 1 and 500),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index enrolment_codes_open on staff.enrolment_codes (staff_id) where used_at is null and revoked_at is null;
grant select, insert, update on staff.enrolment_codes to mushin_worker;
