-- Niche provenance (owner master directive 2026-11-03, Part 3): whether the niche came from the creator's own bio or
-- platform category ("bio_identified") or was estimated from recent posts read together ("post_estimated"), and how many
-- posts were actually read. Cards and profiles label a post-estimated niche "Estimated niche · Based on N recent posts".
alter table gcp.creators
  add column niche_source text check (niche_source is null or niche_source in ('bio_identified', 'post_estimated')),
  add column niche_posts_assessed integer check (niche_posts_assessed is null or niche_posts_assessed between 0 and 50);
