-- Financial records cannot be deleted with their workspace (audit BIL-05, 2026-10-16). Billing records are kept for
-- accounting when a customer deletes a workspace (0035, erase_workspace marks the workspace deleted and keeps them), but
-- their foreign keys still cascaded: any hard DELETE of a workspace row (manual SQL, a future cleanup job, a staff
-- tool) would have destroyed the ledger, lots, payments, refunds and subscription history silently. Now:
--   * every financial table refers to its workspace with ON DELETE RESTRICT;
--   * a workspace row is never hard-deleted (until the owner sets a retention period, OD-013, and a reviewed purge
--     replaces this trigger). erase_workspace is unaffected: it updates the row.

do $$
declare t text;
begin
  foreach t in array array['credit_ledger', 'credit_lots', 'credit_reservations', 'payments', 'payment_adjustments', 'subscriptions',
                           'checkouts', 'entitlement_usage'] loop
    execute format('alter table wp.%I drop constraint %I', t, t || '_workspace_id_fkey');
    execute format('alter table wp.%I add constraint %I foreign key (workspace_id) references wp.workspaces (id) on delete restrict not valid', t, t || '_workspace_id_fkey');
    execute format('alter table wp.%I validate constraint %I', t, t || '_workspace_id_fkey');
  end loop;
end $$;

create function platform.refuse_workspace_delete() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'workspaces are never hard-deleted: use platform.erase_workspace, which keeps the financial records (audit BIL-05)'
    using errcode = 'restrict_violation';
end
$$;
create trigger workspaces_no_delete before delete on wp.workspaces for each row execute function platform.refuse_workspace_delete();
