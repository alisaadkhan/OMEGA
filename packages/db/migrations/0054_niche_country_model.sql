-- One niche taxonomy and a source-labelled country model (owner instruction 2026-10-26). Additive only: the existing
-- `niches` and `country` columns stay what search, filters and the projection read; the new columns say how they were
-- reached. Nothing is deleted.

-- The canonical niche list: every concept in terminology.ts maps to exactly one of these labels.
insert into platform.niches (id, label, sort_order) values
  ('education', 'Education & How-to', 11), ('gaming', 'Gaming', 12), ('history', 'History', 13),
  ('literature', 'Literature', 14), ('agriculture', 'Agriculture', 15), ('business', 'Business & Ecommerce', 16),
  ('automotive', 'Automotive', 17), ('religion', 'Religion', 18), ('music', 'Music', 19),
  ('news', 'News & Commentary', 20), ('sports', 'Sports', 21), ('entertainment', 'Entertainment', 22),
  ('real_estate', 'Real Estate', 23)
on conflict (id) do nothing;

-- Niche classification: `niches` keeps the labels search filters on (main first, then up to two secondary; for
-- `variety`, the subjects covered). Null status = not yet classified under this model.
alter table gcp.creators
  add column niche_main text,
  add column niche_status text check (niche_status in ('classified', 'variety', 'unknown')),
  add column niche_confidence text check (niche_confidence in ('high', 'medium', 'low')),
  add column niche_assessed_at timestamptz,
  add constraint creators_niche_main_status check (niche_main is null or niche_status = 'classified');

-- Country by source (ISO 3166-1 alpha-2). `country` is the resolved value shown and searched:
-- creator-confirmed, else creator-stated, else platform-declared; `country_source` says which.
alter table gcp.creators
  add column platform_country char(2) check (platform_country ~ '^[A-Z]{2}$'),
  add column stated_country char(2) check (stated_country ~ '^[A-Z]{2}$'),
  add column confirmed_country char(2) check (confirmed_country ~ '^[A-Z]{2}$'),
  add column country_source text check (country_source in ('creator_confirmed', 'creator_stated', 'platform_declared')),
  add column country_confidence text check (country_confidence in ('high', 'medium', 'low')),
  add column country_checked_at timestamptz;

-- Legacy values: "UK" is not an ISO code (GB is); lower-case codes become upper case.
update gcp.creators set country = 'GB' where upper(country) = 'UK';
update gcp.creators set country = upper(country) where country <> upper(country);
update gcp.creator_attribute_evidence set value = 'GB' where attribute = 'country' and upper(value) = 'UK';

-- Evidence sources: a display name (weak on its own) and the platform's own account category are now recorded apart.
alter table gcp.creator_attribute_evidence drop constraint creator_attribute_evidence_source_check;
alter table gcp.creator_attribute_evidence add constraint creator_attribute_evidence_source_check
  check (source in ('profile_text', 'post_text', 'platform_registration', 'ai_assessment', 'display_name', 'account_category'));
