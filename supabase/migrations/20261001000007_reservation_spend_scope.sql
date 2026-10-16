-- A hold placed without a plan (canceled or expired) may be spent only from paid top-up lots (spec D14), even when
-- other lots are still unexpired, e.g. trial credits after a plan bought during the trial is canceled. The scope is
-- fixed when the hold is placed, so a hold placed while entitled can still finish after the plan ends.
alter table wp.credit_reservations
  add column spend_scope text not null default 'all' check (spend_scope in ('all', 'topup_only'));
