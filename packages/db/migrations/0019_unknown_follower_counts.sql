-- Subscriber counts hidden by the source platform must remain unknown through storage.
alter table gcp.creator_profiles alter column followers drop not null;
alter table gcp.creator_profiles alter column followers drop default;
alter table gcp.profile_metric_snapshots alter column followers drop not null;
