-- Evidence and provenance for creator attributes (search-v2, owner instruction 2026-10-20). With SEARCH_PROFILE=v2 the
-- enrichment pipeline stores city, country and niches on the creator only when the creator's own public text supports
-- them; every observation (supported, weak or conflicting) is kept here with its source and a short quote, so unknown
-- stays unknown and a platform registration country or an AI reading is never presented as fact.
create table gcp.creator_attribute_evidence (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references gcp.creators (id) on delete cascade,
  attribute text not null check (attribute in ('city', 'country', 'niche', 'language')),
  value text not null check (length(value) between 1 and 80),
  source text not null check (source in ('profile_text', 'post_text', 'platform_registration', 'ai_assessment')),
  status text not null check (status in ('supported', 'weak', 'conflicting')),
  evidence text not null check (length(evidence) <= 300),
  payload_id uuid references platform.raw_payloads (id) on delete set null,
  observed_at timestamptz not null default now()
);
create index creator_attribute_evidence_creator on gcp.creator_attribute_evidence (creator_id, attribute);
grant select on gcp.creator_attribute_evidence to mushin_app;
grant select, insert, delete on gcp.creator_attribute_evidence to mushin_worker;
