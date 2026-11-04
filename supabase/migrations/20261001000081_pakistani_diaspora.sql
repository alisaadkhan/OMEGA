-- Pakistani diaspora creators are kept (owner execution directive 2026-11-04, Stage 1 §4). A profile whose country
-- decision is "foreign" (lives abroad) but whose own bio states Pakistani identity is a Pakistani creator living abroad:
-- shown and eligible like a Pakistan-based one, and labelled as based abroad. Only the creator's own words count (never
-- the name, language, looks or content): "Pakistani in Toronto", "proud Pakistani", "Pakistani-American", "born in
-- Pakistan", "Pakistani heritage/origin", or the 🇵🇰 flag. A topic such as "Pakistani recipes" or "Pakistani dramas" is
-- not identity. Generated, so every writer of country_status or bio keeps it right without code changes.
alter table gcp.creator_profiles add column pakistani_diaspora boolean generated always as (
  country_status = 'foreign' and bio is not null
  -- A bio that states another identity ("An Afghan girl in Islamabad", "Indian creator") is never Pakistani diaspora.
  -- ("Pakistani-American mom" is Pakistani identity: the compound is folded to "Pakistani" before this check.)
  and regexp_replace(bio, 'pakistani\s*[-–]?\s*(american|british|canadian|turkish|arab)', 'pakistani', 'gi') !~* '(^|[^[:alpha:]])(afghan|indian|bangladeshi|iranian|nepali|sri\s+lankan|arab|turkish|british|american|canadian)\s+(girl|boy|guy|woman|man|mom|mum|dad|creator|blogger|vlogger|youtuber|influencer|family|couple)([^[:alpha:]]|$)'
  and (
    -- The flag alone is not identity on a shop's bio ("Made in 🇺🇸 · Delivering all over 🇵🇰").
    (bio like '%🇵🇰%' and bio !~* '(made\s+in|deliver(ing|y|s)|(^|[^[:alpha:]])(stores?|ceo|wholesale|cod|shop|outlets?)([^[:alpha:]]|$)|cash\s+on\s+delivery)')
    or bio ~* '(^|[^[:alpha:]])(born\s+in\s+pakistan|pakistani\s+(origin|heritage|roots|descent)|pak(istan)?[- ]born|proud(ly)?\s+pakistani|pakistani\s*[-–]?\s*(american|british|canadian|australian|german|norwegian|danish|dutch|french|italian|irish|scottish|swedish|kiwi|emirati|turkish)|(a|am|i''m|im)\s+pakistani|pakistani\s+(in|living|based|from|girl|boy|mom|mum|dad|wife|husband|guy|woman|man|creator|blogger|vlogger|youtuber|abroad|expat))([^[:alpha:]]|$)'
  )
) stored;
