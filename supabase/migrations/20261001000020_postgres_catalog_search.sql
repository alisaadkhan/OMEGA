-- PostgreSQL-native catalog search projection. Meilisearch remains available as a rollback target during cutover.
create extension if not exists pg_trgm;

create table gcp.creator_search_documents (
  creator_id uuid primary key references gcp.creators (id) on delete cascade,
  display_name text not null,
  name_variants text[] not null default '{}',
  primary_handle text not null,
  handles text[] not null default '{}',
  platforms text[] not null default '{}',
  city text,
  country text,
  niches text[] not null default '{}',
  tags text[] not null default '{}',
  bio text not null default '',
  followers bigint,
  engagement_rate double precision,
  verified boolean not null default false,
  authenticity_score smallint,
  has_contact boolean not null default false,
  followers_updated_epoch bigint,
  updated_epoch bigint not null,
  search_text text not null,
  search_vector tsvector not null
);

create index creator_search_documents_vector_idx on gcp.creator_search_documents using gin (search_vector);
create index creator_search_documents_trigram_idx on gcp.creator_search_documents using gin (search_text gin_trgm_ops);
create index creator_search_documents_platforms_idx on gcp.creator_search_documents using gin (platforms);
create index creator_search_documents_niches_idx on gcp.creator_search_documents using gin (niches);
create index creator_search_documents_city_country_idx on gcp.creator_search_documents (country, city);
create index creator_search_documents_city_folded_idx on gcp.creator_search_documents (country, lower(city)) where city is not null;
create index creator_search_documents_followers_idx on gcp.creator_search_documents (followers);
create index creator_search_documents_engagement_idx on gcp.creator_search_documents (engagement_rate);
create index creator_search_documents_authenticity_idx on gcp.creator_search_documents (authenticity_score);
create index creator_search_documents_fresh_idx on gcp.creator_search_documents (followers_updated_epoch);
create index creator_search_documents_browse_idx on gcp.creator_search_documents
  (engagement_rate desc nulls last, authenticity_score desc nulls last, followers desc nulls last, creator_id);
create index creator_search_documents_contact_idx on gcp.creator_search_documents (creator_id) where has_contact;
create index creator_search_documents_verified_idx on gcp.creator_search_documents (creator_id) where verified;

grant select on gcp.creator_search_documents to mushin_app;
grant select, insert, update, delete on gcp.creator_search_documents to mushin_worker;

-- Initial backfill is additive and includes only customer-visible creators. No audience estimates are indexed.
insert into gcp.creator_search_documents (
  creator_id, display_name, name_variants, primary_handle, handles, platforms, city, country, niches, tags, bio,
  followers, engagement_rate, verified, authenticity_score, has_contact, followers_updated_epoch, updated_epoch, search_text, search_vector
)
select c.id, c.display_name, c.name_variants, c.primary_handle,
  coalesce((select array_agg(distinct p.handle) from gcp.creator_profiles p where p.creator_id = c.id), array[c.primary_handle]),
  coalesce((select array_agg(distinct p.platform) from gcp.creator_profiles p where p.creator_id = c.id), array[c.primary_platform]),
  c.city, c.country, c.niches, c.tags, coalesce(primary_profile.bio, ''),
  (select max(case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end) from gcp.creator_profiles p where p.creator_id = c.id),
  primary_profile.engagement_rate, c.verified, c.authenticity_score,
  exists (select 1 from gcp.creator_contacts k where k.creator_id = c.id),
  extract(epoch from primary_profile.followers_updated_at)::bigint,
  extract(epoch from greatest(c.updated_at,
    coalesce((select max(p.updated_at) from gcp.creator_profiles p where p.creator_id = c.id), c.updated_at),
    coalesce((select max(s.created_at) from gcp.enrichment_snapshots s where s.creator_id = c.id), c.updated_at)))::bigint,
  coalesce(c.display_name, '') || ' ' || coalesce(array_to_string(c.name_variants, ' '), '') || ' ' || c.primary_handle || ' ' ||
    coalesce((select array_to_string(array_agg(distinct p.handle), ' ') from gcp.creator_profiles p where p.creator_id = c.id), '') || ' ' ||
    array_to_string(c.niches, ' ') || ' ' || array_to_string(c.tags, ' ') || ' ' || coalesce(primary_profile.bio, ''),
  setweight(to_tsvector('simple'::regconfig, c.display_name), 'A') ||
    setweight(to_tsvector('simple'::regconfig, array_to_string(c.name_variants, ' ')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, c.primary_handle || ' ' || coalesce((select array_to_string(array_agg(distinct p.handle), ' ') from gcp.creator_profiles p where p.creator_id = c.id), '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, array_to_string(c.niches, ' ') || ' ' || array_to_string(c.tags, ' ')), 'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(primary_profile.bio, '')), 'D')
from gcp.creators c
left join lateral (
  select p.bio, p.engagement_rate, p.followers_updated_at
  from gcp.creator_profiles p where p.creator_id = c.id
  order by (p.platform = c.primary_platform) desc, p.followers desc limit 1
) primary_profile on true
where c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)
on conflict (creator_id) do update set
  display_name = excluded.display_name, name_variants = excluded.name_variants, primary_handle = excluded.primary_handle,
  handles = excluded.handles, platforms = excluded.platforms, city = excluded.city, country = excluded.country,
  niches = excluded.niches, tags = excluded.tags, bio = excluded.bio, followers = excluded.followers,
  engagement_rate = excluded.engagement_rate, verified = excluded.verified, authenticity_score = excluded.authenticity_score,
  has_contact = excluded.has_contact, followers_updated_epoch = excluded.followers_updated_epoch, updated_epoch = excluded.updated_epoch,
  search_text = excluded.search_text, search_vector = excluded.search_vector;
