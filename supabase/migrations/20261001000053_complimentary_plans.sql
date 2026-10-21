-- Complimentary plans (owner instruction 2026-10-21). A comp plan is an ordinary subscription row with a `comp:`
-- reference instead of a payment provider's, set to end at its period end; monthly credits come from the existing
-- monthly_grants job. No provider will send the end-of-period event, so the comp_period_end job ends it.
alter table platform.billing_schedule drop constraint billing_schedule_job_check;
alter table platform.billing_schedule add constraint billing_schedule_job_check
  check (job in ('release_abandoned', 'expire_lots', 'end_trials', 'trial_notices', 'monthly_grants',
                 'scheduled_changes', 'reconcile', 'mock_renewals', 'comp_period_end'));
