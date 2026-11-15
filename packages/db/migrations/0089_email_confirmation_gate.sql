-- Mandatory email verification (owner directive 2026-11-15, "authentication flows" §1): the API refuses every customer
-- request from an account whose email the Auth server has not confirmed. Confirmation is read from the Auth server's
-- own record (never from the token: user_metadata is user-editable, audit SEC-03) and remembered here together with the
-- address it was confirmed for, so later requests need no Auth call and a changed address is checked again.
-- No backfill: every existing account is checked once, on its next request.
alter table wp.users add column email_confirmed_at timestamptz;
alter table wp.users add column email_confirmed_for text check (email_confirmed_for is null or length(email_confirmed_for) between 3 and 320);
alter table wp.users add constraint users_email_confirmed_pair check ((email_confirmed_at is null) = (email_confirmed_for is null));
