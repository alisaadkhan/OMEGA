-- Creator display eligibility (policy elig-1, owner requirement 2026-10-16): a creator reaches customers only when one of
-- their own profiles has a known, recent count of at least 10,000 followers/subscribers (apps/api creators/eligibility.ts).
-- Nothing is deleted: the search projection records whether a creator is eligible, until when the evidence holds, the
-- reasons and the policy version; customer-facing reads filter on it.

-- Latest public post seen on the profile (activity evidence); unknown for rows collected before this migration.
alter table gcp.creator_profiles add column last_post_at timestamptz;

alter table gcp.creator_search_documents
  add column eligible boolean not null default false,
  add column eligible_until_epoch bigint,
  add column eligibility_version text,
  add column eligibility_reasons text[] not null default '{}',
  add column eligibility_flags text[] not null default '{}',
  add column qualifying_platforms text[] not null default '{}';

-- Searches filter eligible documents whose evidence has not expired.
create index creator_search_documents_eligible_idx on gcp.creator_search_documents (eligible_until_epoch) where eligible;

-- Fail closed until every document is recomputed under the policy: existing documents are ineligible now, and resetting
-- their epoch makes the worker's start-up reconcile rebuild all of them (npm run search:reindex does the same on demand).
update gcp.creator_search_documents set eligible = false, updated_epoch = 0;

-- YouTube API data retention (0029/0031): when the 30-day job clears a YouTube profile's metrics, the post date derived
-- from the same API data goes with them.
create function gcp.clear_youtube_last_post() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  if new.platform = 'youtube' and old.followers_updated_at is not null and new.followers_updated_at is null then
    new.last_post_at := null;
  end if;
  return new;
end
$$;
create trigger creator_profiles_youtube_last_post before update on gcp.creator_profiles
  for each row execute function gcp.clear_youtube_last_post();
