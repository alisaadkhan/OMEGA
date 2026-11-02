-- Rollback for migrations 0065 and 0064 (ticket lifecycle, product reviews, usage events). One transaction.
-- Drops the new review and usage data and the ticket history: export anything needed first. Then rerun the earlier
-- erase_workspace definition (0059) if 0065 is not reapplied.
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ops/rollback-0064-0065.sql
begin;
-- 0065
drop function platform.staff_product_reviews(text, integer);
drop function platform.staff_product_review_status(uuid, uuid, text);
drop function platform.staff_creator_view_stats(integer, integer);
drop function platform.staff_search_stats(integer);
drop table wp.product_reviews, wp.creator_profile_views, wp.search_events;
-- 0064
drop function platform.staff_support_performance(integer);
drop trigger support_messages_first_response on wp.support_messages;
drop function platform.support_message_first_response();
drop trigger support_tickets_history on wp.support_tickets;
drop function platform.support_ticket_record();
drop trigger support_tickets_lifecycle on wp.support_tickets;
drop function platform.support_ticket_before_update();
drop table wp.support_ticket_events;
-- In-progress requests return to open: the earlier status rule has no "in progress".
update wp.support_tickets set status = 'open' where status = 'in_progress';
alter table wp.support_tickets drop constraint support_tickets_status_check;
alter table wp.support_tickets add constraint support_tickets_status_check check (status in ('open', 'waiting_on_customer', 'resolved', 'closed'));
alter table wp.support_tickets drop column first_response_at, drop column resolved_at, drop column reopened_count, drop column last_reopened_at;
delete from platform.schema_migrations where name in ('0064_ticket_lifecycle.sql', '0065_product_reviews_and_usage_events.sql');
commit;
