-- Database best-practices audit (2026-11-17, Supabase Postgres guide: schema-foreign-key-indexes, query-missing-indexes).
-- Foreign keys PostgreSQL checks or joins on without an index:
--   * creator_id: erasing or merging a creator (gcp.creators) checks every row that points at it; without an index each
--     check reads the whole table. Also "is this creator in any list/campaign" lookups.
--   * workspace_id: deleting an account's workspace (platform.delete_account / erase_workspace).
--   * owner_user_id: finding the workspaces a person owns (account deletion).
--   * staff and payment links: staff workload, session revocation, ledger and payment joins.
-- Foreign keys to small lookup tables (plans, packs) and to the people who created a row are left out: those parents are
-- never deleted (users are soft-deleted) and the tables are tiny.
create index if not exists list_members_creator_idx on wp.list_members (creator_id);
create index if not exists campaign_creators_creator_idx on wp.campaign_creators (creator_id);
create index if not exists contact_reveals_creator_idx on wp.contact_reveals (creator_id);
create index if not exists audience_views_creator_idx on wp.audience_views (creator_id);
create index if not exists audience_jobs_creator_idx on wp.audience_jobs (creator_id);
create index if not exists discovery_jobs_creator_idx on wp.discovery_jobs (creator_id) where creator_id is not null;
create index if not exists discovery_results_workspace_idx on wp.discovery_results (workspace_id);
create index if not exists discovery_candidates_workspace_idx on wp.discovery_candidates (workspace_id);
create index if not exists workspaces_owner_user_idx on wp.workspaces (owner_user_id);
create index if not exists staff_sessions_staff_idx on staff.staff_sessions (staff_id);
create index if not exists support_tickets_assigned_staff_idx on wp.support_tickets (assigned_staff_id) where assigned_staff_id is not null;
create index if not exists credit_ledger_reservation_idx on wp.credit_ledger (reservation_id) where reservation_id is not null;
create index if not exists discovery_jobs_reservation_idx on wp.discovery_jobs (reservation_id) where reservation_id is not null;
create index if not exists payments_checkout_idx on wp.payments (checkout_id) where checkout_id is not null;
create index if not exists credit_lots_payment_idx on wp.credit_lots (payment_id) where payment_id is not null;
create index if not exists creators_merged_into_idx on gcp.creators (merged_into_id) where merged_into_id is not null;

-- Two identical indexes on (import_id, row_no): the unique one serves every lookup the plain one did.
drop index if exists wp.creator_import_rows_import;
