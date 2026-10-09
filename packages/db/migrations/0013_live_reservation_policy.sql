-- Sub-project 4B: a live discovery run reserves 12 + size × a per-creator price (spec D1–D2).
-- The API role may still reserve only amounts the price table defines: an action's exact price, or for
-- find_new one of the run maxima (5, 10 or 20 new creators at the Instagram/YouTube or TikTok price).
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
          cross join unnest(array[5, 10, 20]) as n
          where f.action = 'find_new' and p.action in ('refresh_data', 'refresh_tiktok')
        )
      )
    )
  );
