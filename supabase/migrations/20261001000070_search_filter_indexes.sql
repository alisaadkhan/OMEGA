-- Search filter indexes for catalogue scale (security hardening & 60K-scale directive, 2026-11-03). Every catalogue
-- search filters on d.eligible; the platform filter is `qualifying_platforms @> array[...]` and the creator-city filter
-- is `lower(city) in (...)` without a country, which the existing (country, lower(city)) index cannot serve.

create index if not exists creator_search_documents_qualifying_platforms_idx
  on gcp.creator_search_documents using gin (qualifying_platforms) where eligible;

create index if not exists creator_search_documents_city_lower_idx
  on gcp.creator_search_documents (lower(city)) where eligible and city is not null;
