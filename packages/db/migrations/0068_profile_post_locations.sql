-- Geotag place names of a profile's latest fetched posts (owner addendum 2026-11-03): two or more recent posts geotagged in
-- Pakistan are country evidence. Stored so a later recomputation from stored data keeps the same decision. Replaced on each
-- fetch (an empty array when the fetch had no geotags); null when never fetched with posts.
alter table gcp.creator_profiles
  add column post_locations text[] check (post_locations is null or cardinality(post_locations) <= 30);
grant update (post_locations) on gcp.creator_profiles to mushin_worker;
