-- Contacts and links from video descriptions / post captions (owner unified plan 2026-11-14, Phase 4.1). When the bio or
-- About section has no email or phone, the last 5 videos' descriptions (YouTube) or captions (Instagram, TikTok) are read;
-- what was found there is recorded with its own source, so staff and customers see where it came from.
alter table gcp.creator_links drop constraint if exists creator_links_source_check;
alter table gcp.creator_links add constraint creator_links_source_check check (source in ('bio', 'profile_link', 'video_description', 'post_caption'));

-- Location from recent video descriptions / captions (Phase 4.2), kept as evidence on the profile so every later country
-- decision can read it: an explicit Pakistani residence statement in one of the last 5, or Pakistani evidence in 2+.
alter table gcp.creator_profiles add column caption_country_evidence text check (caption_country_evidence is null or char_length(caption_country_evidence) <= 300);
