-- Audit SEC-10 (2026-10-17): the staff audit log was append-only through grants only; the database owner (whose
-- credentials were exposed, SEC-01) could edit or delete entries without trace. Each row now carries the SHA-256 of
-- its content chained to the previous row's hash, set by a trigger under a lock, in a gap-free order (`seq`).
-- platform.verify_staff_audit_chain() recomputes the chain; any edited, deleted or reordered row breaks it from that
-- point. The latest hash (the head) is exported daily to separate storage, so even a rewritten chain is detectable.

alter table staff.audit_log add column seq bigint, add column prev_hash text, add column row_hash text;

create function platform.staff_audit_row_hash(p_prev text, r staff.audit_log) returns text
  language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(p_prev, ''), r.seq::text, r.id::text, coalesce(r.staff_id::text, ''), r.action, coalesce(r.target_type, ''),
    coalesce(r.target_id, ''), coalesce(r.workspace_id::text, ''), r.metadata::text, coalesce(r.ip, ''),
    coalesce(r.request_id, ''), to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8')), 'hex')
$$;

-- Existing rows, in the order they were written.
do $$
declare r staff.audit_log; prev text := null; n bigint := 0;
begin
  for r in select * from staff.audit_log order by created_at, id loop
    n := n + 1;
    r.seq := n;
    r.prev_hash := prev;
    r.row_hash := platform.staff_audit_row_hash(prev, r);
    update staff.audit_log set seq = r.seq, prev_hash = r.prev_hash, row_hash = r.row_hash where id = r.id;
    prev := r.row_hash;
  end loop;
end $$;

create function platform.staff_audit_chain() returns trigger
  language plpgsql security definer set search_path = pg_catalog as $$
declare last staff.audit_log;
begin
  -- One writer at a time, so every row links to the row before it.
  perform pg_advisory_xact_lock(7211049);
  select * into last from staff.audit_log order by seq desc limit 1;
  new.seq := coalesce(last.seq, 0) + 1;
  new.prev_hash := last.row_hash;
  new.row_hash := platform.staff_audit_row_hash(new.prev_hash, new);
  return new;
end $$;
create trigger staff_audit_chain before insert on staff.audit_log for each row execute function platform.staff_audit_chain();

alter table staff.audit_log alter column seq set not null, alter column row_hash set not null;
create unique index audit_log_seq on staff.audit_log (seq);

-- Rows checked, the first row whose content or link no longer matches (null when intact), and the head hash.
create function platform.verify_staff_audit_chain() returns table (rows bigint, first_broken_seq bigint, head_hash text)
  language plpgsql stable security definer set search_path = pg_catalog as $$
declare r staff.audit_log; prev text := null; expected_seq bigint := 0; broken bigint := null; n bigint := 0;
begin
  for r in select * from staff.audit_log order by seq loop
    n := n + 1;
    expected_seq := expected_seq + 1;
    if broken is null and (r.seq <> expected_seq or r.prev_hash is distinct from prev or r.row_hash <> platform.staff_audit_row_hash(prev, r)) then
      broken := r.seq;
    end if;
    prev := r.row_hash;
  end loop;
  return query select n, broken, prev;
end $$;
revoke all on function platform.verify_staff_audit_chain() from public;
grant execute on function platform.verify_staff_audit_chain() to mushin_worker;
revoke all on function platform.staff_audit_chain() from public;
