-- Terms and Privacy acceptance (audit UX-01, 2026-10-17). Sign-up said users agree to documents that did not exist and
-- nothing was recorded. Now the API records which version of the published documents each person accepted, and when.
-- The documents are drafts until counsel reviews them (owner decision D-13); a new version asks everyone again.
alter table wp.users add column legal_version text check (legal_version is null or length(legal_version) between 4 and 40);
alter table wp.users add column legal_accepted_at timestamptz;
alter table wp.users add constraint users_legal_acceptance check ((legal_version is null) = (legal_accepted_at is null));
