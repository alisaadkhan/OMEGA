-- Additive Live Discovery progress and domain outcomes. Generic job status remains
-- queued/running/completed/failed for compatibility with existing job consumers.
alter table wp.discovery_jobs
  add column progress jsonb not null default '{"serpResultsSeen":0,"profileCandidates":0,"afterDedupe":0,"snippetGatePass":0,"ambiguousCandidates":0,"extractedProfiles":0,"validIndividualCreators":0,"qualifiedCreators":0,"persistedResults":0,"billableCreators":0}'::jsonb;

alter table wp.discovery_jobs
  drop constraint if exists discovery_jobs_outcome_check;

alter table wp.discovery_jobs
  add constraint discovery_jobs_outcome_check check (
    outcome is null or outcome in ('created', 'refreshed', 'reused', 'succeeded', 'completed_empty', 'insufficient', 'partial', 'failed', 'canceled', 'expired')
  );

alter table wp.discovery_jobs
  add constraint discovery_jobs_progress_shape check (
    jsonb_typeof(progress) = 'object'
  );
