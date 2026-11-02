-- Country from a public record (owner directive 2026-11-03): a creator researched into a curated Pakistani seed manifest, or
-- confirmed by MUSHIN staff from public sources, carries the country with the URL it came from. It is a separate source
-- ("public_record"), never stored as the creator's own confirmation. A profile whose bio states a life abroad stays foreign.
-- Linked profiles of one creator may share it ("linked_profile"), unless that profile states a life abroad.
alter table gcp.creators
  add column public_country char(2) check (public_country is null or public_country ~ '^[A-Z]{2}$'),
  add column public_country_source text check (public_country_source is null or length(public_country_source) <= 500),
  add column public_country_at timestamptz;

alter table gcp.creators drop constraint if exists creators_country_source_check;
alter table gcp.creators add constraint creators_country_source_check
  check (country_source is null or country_source in ('creator_confirmed', 'creator_stated', 'platform_declared', 'public_record', 'linked_profile'));
alter table gcp.creator_profiles drop constraint if exists creator_profiles_country_source_check;
alter table gcp.creator_profiles add constraint creator_profiles_country_source_check
  check (country_source is null or country_source in ('creator_confirmed', 'creator_stated', 'platform_declared', 'public_record', 'linked_profile'));
