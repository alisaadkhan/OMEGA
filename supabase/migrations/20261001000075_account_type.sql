-- Account type (owner master directive 2026-11-03, Part 5). Individual creators are the target; companies, brands, shops,
-- media publications, fan/aggregator pages and traditional public figures (non-creator celebrities) are kept but left out
-- of ordinary creator search. UNKNOWN is never assumed to be an individual creator. Every decision keeps its source,
-- confidence and evidence; staff may override it (organisation_override_* from 0072 is the override).
alter table gcp.creators
  add column account_type text check (account_type is null or account_type in ('INDIVIDUAL_CREATOR', 'CELEBRITY_PUBLIC_FIGURE', 'COMPANY_CORPORATE', 'BRAND_ACCOUNT', 'BUSINESS_STORE', 'MEDIA_PUBLICATION', 'FAN_PAGE_AGGREGATOR', 'UNKNOWN')),
  add column account_type_source text check (account_type_source is null or account_type_source in ('platform_category', 'rules', 'ai', 'staff')),
  add column account_type_confidence text check (account_type_confidence is null or account_type_confidence in ('high', 'medium', 'low')),
  add column account_type_evidence text check (account_type_evidence is null or char_length(account_type_evidence) <= 300),
  add column account_type_assessed_at timestamptz;
