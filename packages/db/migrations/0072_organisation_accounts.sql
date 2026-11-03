-- Organisation accounts (owner decision 2026-11-03): an account whose platform category names an organisation
-- (restaurant, brand, magazine, agency, venue...) is not a creator and is excluded from search (eligibility reason
-- "organisation_account"). Nothing is deleted. Staff can override a wrong category in Catalogue review, with a reason.
alter table gcp.creators
  add column organisation_category text check (organisation_category is null or char_length(organisation_category) <= 80),
  add column organisation_override_by_staff_id uuid,
  add column organisation_override_reason text check (organisation_override_reason is null or char_length(organisation_override_reason) <= 500),
  add constraint creators_organisation_override_check check (organisation_override_by_staff_id is null or organisation_override_reason is not null);
