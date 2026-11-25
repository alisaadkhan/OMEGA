-- TikTok engagement per view (owner, 25 Nov): (likes + comments + shares) / plays, the median over recent videos. Shown on
-- the profile next to the per-follower engagement rate and typical views; sorting and filters stay per follower.
alter table gcp.creator_profiles
  add column if not exists engagement_per_view double precision
    check (engagement_per_view is null or (engagement_per_view > 0 and engagement_per_view <= 100));
