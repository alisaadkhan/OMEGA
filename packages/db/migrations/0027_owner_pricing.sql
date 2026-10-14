-- Owner-approved credit prices (14 October 2026). Customer credits are prices, not provider cost; provider cost stays in
-- platform.provider_calls. Prices already quoted keep working: an estimate stores the prices it was quoted at.
--   search_existing  50  one logical catalogue search (same user, text and filters within 30 minutes is one search)
--   find_new         50  the base of a Live Discovery run, charged only when the run delivers at least one creator
--   live_creator     10  each new qualified creator a Live Discovery run delivers (sizes 5, 10, 15 → maxima 100, 150, 200)
--   reveal_contact    5  unchanged
--   refresh_data     50  explicit refresh of a creator (also the add-by-link price)
--   refresh_tiktok   50  the same for TikTok (no separate TikTok price any more)
-- Audience estimates have no approved price; the feature stays disabled and its row is left unchanged.

alter table platform.credit_action_costs drop constraint credit_action_costs_action_check;
alter table platform.credit_action_costs add constraint credit_action_costs_action_check
  check (action in ('search_existing', 'find_new', 'live_creator', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));
alter table wp.credit_reservations drop constraint credit_reservations_action_check;
alter table wp.credit_reservations add constraint credit_reservations_action_check
  check (action in ('search_existing', 'find_new', 'live_creator', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));
alter table wp.credit_ledger drop constraint credit_ledger_action_check;
alter table wp.credit_ledger add constraint credit_ledger_action_check
  check (action in ('search_existing', 'find_new', 'live_creator', 'reveal_contact', 'refresh_data', 'refresh_tiktok', 'audience_estimate'));

update platform.credit_action_costs set credits = 50 where action in ('search_existing', 'find_new', 'refresh_data', 'refresh_tiktok');
insert into platform.credit_action_costs (action, credits) values ('live_creator', 10);

-- A live run may reserve only the quoted maximum for one of the offered sizes.
drop policy credit_reservations_app_insert on wp.credit_reservations;
create policy credit_reservations_app_insert on wp.credit_reservations as restrictive for insert to mushin_app
  with check (
    status = 'held'
    and confirmed_cost = amount
    and (
      amount = (select c.credits from platform.credit_action_costs c where c.action = credit_reservations.action)
      or (
        action = 'find_new'
        and amount in (
          select f.credits + n * p.credits
          from platform.credit_action_costs f
          cross join platform.credit_action_costs p
          cross join unnest(array[5, 10, 15]) as n
          where f.action = 'find_new' and p.action = 'live_creator'
        )
      )
    )
  );

-- Live run sizes are now 5, 10 or 15 new creators. 20 stays valid for runs quoted before this change; the API no longer
-- offers it.
alter table wp.discovery_jobs drop constraint discovery_jobs_max_new_check;
alter table wp.discovery_jobs add constraint discovery_jobs_max_new_check check (max_new in (5, 10, 15, 20));
alter table wp.discovery_estimates drop constraint discovery_estimates_max_new_check;
alter table wp.discovery_estimates add constraint discovery_estimates_max_new_check check (max_new in (5, 10, 15, 20));

-- Public plan name (the persisted id stays 'explorer').
update platform.plans set name = 'Starter' where id = 'explorer';

-- One charge per logical catalogue search: repeats, further pages and refetches of the same search by the same user
-- inside the window find this row and are free.
create table wp.catalog_search_charges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references wp.workspaces (id) on delete cascade,
  user_id uuid not null references wp.users (id) on delete cascade,
  search_hash text not null check (search_hash ~ '^[0-9a-f]{64}$'),
  reservation_id uuid references wp.credit_reservations (id),
  credits integer not null check (credits >= 0),
  charged_at timestamptz not null default now()
);
create index catalog_search_charges_lookup_idx on wp.catalog_search_charges (workspace_id, user_id, search_hash, charged_at desc);

alter table wp.catalog_search_charges enable row level security;
alter table wp.catalog_search_charges force row level security;
create policy catalog_search_charges_tenant on wp.catalog_search_charges
  using (workspace_id = platform.current_workspace_id())
  with check (workspace_id = platform.current_workspace_id());

grant select, insert on wp.catalog_search_charges to mushin_app;
