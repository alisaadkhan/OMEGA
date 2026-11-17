-- Owner directive 2026-11-17 ("every button functional with back end"):
-- 1. Two-step sign-in. Supabase Auth holds the authenticator (TOTP factor); this flag mirrors it so the API can refuse a
--    session that has not passed the second step (token aal1) for a person who turned it on. The API sets it only from
--    the Auth server's own factor list (POST /v1/me/two-step/sync), never from the client's word.
-- 2. Post-day reminders per campaign: when on, a creator whose post is due today (or overdue and not yet posted) appears
--    in the bell and the Activity log.
alter table wp.users add column mfa_enabled boolean not null default false;
alter table wp.campaigns add column notify_post_due boolean not null default false;
