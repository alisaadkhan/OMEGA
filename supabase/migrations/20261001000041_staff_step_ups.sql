-- Server-verified hardware-key step-up (audit SEC-02, 2026-10-16). A staff access token used to prove the WebAuthn
-- step-up only by an `amr: hwk` claim, so anyone holding STAFF_JWT_SECRET could forge it. Now each verified assertion
-- writes a row here; the token carries only the row id, and every hardware-key action checks that the row exists, is
-- this staff member's, has not expired, and its key has not been revoked. A forged claim proves nothing.

create table staff.step_ups (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff.staff_users (id),
  credential_id uuid not null references staff.webauthn_credentials (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index step_ups_staff_idx on staff.step_ups (staff_id, expires_at desc);
grant select, insert, update on staff.step_ups to mushin_worker;

-- Credential containment (audit H §3): end every staff session and step-up at once, so nothing minted with an old
-- signing secret or refresh token keeps working. Run with database credentials after rotating STAFF_JWT_SECRET.
create function staff.revoke_all_sessions(p_reason text) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare sessions bigint; steps bigint;
begin
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'a reason of at least 8 characters is required'; end if;
  update staff.staff_sessions set revoked_at = now() where revoked_at is null;
  get diagnostics sessions = row_count;
  update staff.step_ups set revoked_at = now() where revoked_at is null;
  get diagnostics steps = row_count;
  insert into staff.audit_log (staff_id, action, metadata) values (null, 'staff.sessions.revoked_all', jsonb_build_object('reason', trim(p_reason), 'sessions', sessions, 'stepUps', steps));
  return jsonb_build_object('sessions', sessions, 'stepUps', steps);
end
$$;
revoke all on function staff.revoke_all_sessions(text) from public;
