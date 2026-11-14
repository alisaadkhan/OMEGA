-- Blue tick per platform profile (owner unified plan 2026-11-14, Phase 2.5): a creator can be verified on Instagram and
-- not on TikTok. Every fetch writes the profile's own badge; the creator is verified when any of its profiles is.
-- YouTube's Data API exposes no badge, so YouTube profiles stay false unless a staff member confirms one.
alter table gcp.creator_profiles add column verified boolean not null default false;
update gcp.creator_profiles p set verified = true
from gcp.creators c where c.id = p.creator_id and c.verified and p.platform = c.primary_platform and p.platform <> 'youtube';
