-- One testing-credit lot per workspace and month, enforced by the database (execution review 2026-10-28).
-- 0061 kept one testing *grant* per month through the unique (workspace, kind, source_ref) ledger index, and the engine
-- writes lot and grant in one transaction. But the API role's insert policy allows a testing lot on its own, and nothing
-- in the database stopped a second testing lot for the same month. Trial lots already have this guarantee
-- (credit_lots_one_trial_key); testing lots now get the same.
-- The month is stored explicitly (period, 'YYYY-MM', Asia/Karachi): expires_at cannot be the key, because ending an
-- allowance early (endLotsOfSource) moves expires_at, which could then equal another month's natural expiry.

alter table wp.credit_lots add column period text;

-- Existing testing lots take their month from their grant's reference ('testing:<workspace>:<YYYY-MM>').
update wp.credit_lots l
set period = right(g.source_ref, 7)
from wp.credit_ledger g
where g.lot_id = l.id and g.kind = 'grant' and l.source = 'testing' and g.source_ref like 'testing:%';

-- Preflight: stop with an explanation rather than deleting anything. A testing lot without a grant, or two testing lots
-- for one workspace and month, must be investigated by a person (reconcile reports the same mismatch).
do $$
declare orphans bigint; dupes bigint;
begin
  select count(*) into orphans from wp.credit_lots where source = 'testing' and period is null;
  if orphans > 0 then
    raise exception '0062 preflight: % testing credit lot(s) have no testing grant in the ledger; investigate before migrating', orphans;
  end if;
  select count(*) into dupes from (select 1 from wp.credit_lots where source = 'testing' group by workspace_id, period having count(*) > 1) d;
  if dupes > 0 then
    raise exception '0062 preflight: % workspace-month(s) hold more than one testing credit lot; investigate before migrating', dupes;
  end if;
end $$;

alter table wp.credit_lots add constraint credit_lots_period_rule
  check ((source = 'testing') = (period is not null) and (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));
create unique index credit_lots_one_testing_per_month_key on wp.credit_lots (workspace_id, period) where source = 'testing';
