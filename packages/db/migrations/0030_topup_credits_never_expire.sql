-- Owner decision 2026-10-14: purchased top-up credits never expire; monthly subscription credits expire at renewal and
-- do not roll over (unchanged: each renewal ends the monthly lots and grants a new allowance).
-- A lot's expiry rule follows from its source and is enforced here:
--   topup       never expires (expires_at is null)
--   monthly     expires at the end of its credit month (renewal)
--   trial       expires when the trial ends
--   adjustment  expires at the date staff set
-- Spending takes the soonest-expiring lots first, so never-expiring top-ups are spent last.
alter table wp.credit_lots alter column expires_at drop not null;

-- Top-ups still holding credits stop expiring. Top-ups already expired under the old 12-month rule stay expired (their
-- ledger already records it); none existed in production at the time of this change.
update wp.credit_lots set expires_at = null where source = 'topup' and remaining > 0 and expires_at > now();

alter table wp.credit_lots add constraint credit_lots_expiry_rule
  check (expires_at is not null or source = 'topup');

-- New top-ups are granted without an expiry; the pack's validity is no longer used.
alter table platform.topup_packs alter column validity_months drop not null;
alter table platform.topup_packs alter column validity_months drop default;
update platform.topup_packs set validity_months = null;
