-- Staff two-factor sign-in becomes a per-person setting (owner, 22 Nov): each staff member turns the authenticator
-- code on or off in Settings and sets it up there. Existing accounts keep it on. A new secret waits in
-- totp_pending_encrypted until the person proves it with a code; only then does it replace the active one.
alter table staff.staff_users add column if not exists totp_enabled boolean not null default true;
alter table staff.staff_users add column if not exists totp_pending_encrypted text;
