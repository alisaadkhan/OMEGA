-- Fixes platform.guard_app_billing_write (0005):
-- * PL/pgSQL resolves every NEW/OLD field in an IF expression, so "tg_table_name = 'x' and new.count < old.count"
--   failed with "record new has no field count" on the other tables. Each table's check is now its own branch.
-- * The lifetime cap compared against now() (transaction start) while the app sets expires_at from its own clock,
--   so committing a hold placed in the same transaction always failed. The cap now applies only when expires_at
--   changes, measured from clock_timestamp() with one minute of slack for app/database clock skew.
create or replace function platform.guard_app_billing_write() returns trigger
  language plpgsql as $$
begin
  if current_user <> 'mushin_app' then
    return new;
  end if;
  if tg_table_name = 'credit_lots' then
    if new.remaining > old.remaining then
      raise exception 'the API role may only lower a credit lot''s remaining credits' using errcode = '42501';
    end if;
  elsif tg_table_name = 'credit_reservations' then
    if old.status <> 'held' then
      raise exception 'only a held reservation can change' using errcode = '42501';
    end if;
    if new.expires_at is distinct from old.expires_at
       and new.expires_at > clock_timestamp() + interval '1 minute'
         + make_interval(mins => (select reservation_ttl_minutes from platform.billing_settings)) then
      raise exception 'a reservation can be extended by at most one reservation lifetime' using errcode = '42501';
    end if;
  elsif tg_table_name = 'entitlement_usage' then
    if new.count < old.count then
      raise exception 'the API role may only increase usage counters' using errcode = '42501';
    end if;
  elsif tg_table_name = 'billing_schedule' then
    if new.due_at > old.due_at then
      raise exception 'the API role may only move due work earlier' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
