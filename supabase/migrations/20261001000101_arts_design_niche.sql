-- Arts & Design joins the canonical niche taxonomy (owner, 25 Nov): graphic and UI/UX design, video editing and
-- filmmaking, photography, calligraphy and digital art were filed under Education & How-to or Entertainment.
-- Additive only; creators are re-mapped by the catalogue tools, not by this migration.
insert into platform.niches (id, label, sort_order) values ('arts', 'Arts & Design', 24)
on conflict (id) do nothing;
