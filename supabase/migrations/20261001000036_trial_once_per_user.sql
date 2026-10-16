-- The free trial is granted once per person, not once per workspace (2026-10-16 review of 0035). Deleting a workspace
-- or leaving every workspace removes a person's memberships, and the next sign-in provisions a new workspace; without
-- this mark that workspace received a second trial and its credits, repeatably.
alter table wp.users add column trial_granted_at timestamptz;

-- Every existing person was given a workspace with a trial when they first signed in, except people who only ever
-- joined through an invitation (they own no workspace and never had a trial of their own).
update wp.users u set trial_granted_at = u.created_at
  where exists (select 1 from wp.workspaces w where w.owner_user_id = u.id);
