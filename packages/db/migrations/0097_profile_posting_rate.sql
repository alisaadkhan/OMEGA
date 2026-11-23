-- Content consistency on every creator card (owner, 23 Nov: "make sure every creator card is full and complete"): the
-- measured posting rate of a profile's recent non-pinned posts, saved on each fetch. Until now it lived only in the AI
-- assessment's evidence, which names only the signals the model chose to mention, so most cards showed "Not measured".
alter table gcp.creator_profiles add column if not exists posts_per_week double precision check (posts_per_week is null or posts_per_week >= 0);
alter table gcp.creator_profiles add column if not exists posting_measured_at timestamptz;
