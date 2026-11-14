-- Cross-platform identity merge (addendum 3; owner directive 2026-11-04 §3 item 5). One person's Instagram, YouTube and
-- TikTok profiles become one creator: everything that points at the absorbed creator moves to the kept one (profiles,
-- contacts, links, evidence, snapshots, payload index, lists, campaigns, reveals, outreach, discovery, audience and
-- import rows), rows that would duplicate one the kept creator already has are dropped, the absorbed creator becomes
-- status 'merged' with merged_into_id, and both get an identity lifecycle event. All or nothing, in one call. Refused when
-- either creator is not active, or both have a profile on the same platform (two accounts on one platform are not
-- proof of one person), when either is a possible minor without a staff override (the protection must not be lost), or
-- when either has an open removal request (it stays with the creator it was made about). Contacts moved from the absorbed
-- creator become "unverified"; each moved profile records where it came from (merged_from_creator_id), so a merge can be
-- audited or undone. Which pairs are merged is decided by the caller (identity-merge.ts), never by this function.
alter table gcp.creator_profiles add column merged_from_creator_id uuid;
alter table gcp.creator_lifecycle_events drop constraint if exists creator_lifecycle_events_kind_check;
alter table gcp.creator_lifecycle_events add constraint creator_lifecycle_events_kind_check
  check (kind in ('availability', 'retention', 'location', 'removal', 'eligibility', 'identity'));

create function platform.merge_creator(p_keep uuid, p_absorb uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = pg_catalog as $$
declare
  n jsonb := '{}'::jsonb;
  c bigint;
begin
  if p_keep = p_absorb then return jsonb_build_object('merged', false, 'reason', 'same_creator'); end if;
  perform 1 from gcp.creators where id in (p_keep, p_absorb) for update;
  if (select count(*) from gcp.creators where id in (p_keep, p_absorb) and status = 'active') <> 2 then
    return jsonb_build_object('merged', false, 'reason', 'not_active');
  end if;
  if exists (select 1 from gcp.creator_profiles a join gcp.creator_profiles b on a.platform = b.platform
             where a.creator_id = p_keep and b.creator_id = p_absorb) then
    return jsonb_build_object('merged', false, 'reason', 'same_platform');
  end if;
  if exists (select 1 from gcp.creators where id in (p_keep, p_absorb) and is_minor and minor_override_by_staff_id is null) then
    return jsonb_build_object('merged', false, 'reason', 'possible_minor');
  end if;
  if exists (select 1 from gcp.removal_requests where creator_id in (p_keep, p_absorb) and status = 'received') then
    return jsonb_build_object('merged', false, 'reason', 'removal_requested');
  end if;

  update gcp.creator_profiles set creator_id = p_keep, merged_from_creator_id = coalesce(merged_from_creator_id, p_absorb) where creator_id = p_absorb;
  get diagnostics c = row_count; n := n || jsonb_build_object('profiles', c);

  -- Rows the kept creator already has are dropped, then the rest move.
  delete from gcp.creator_contacts a using gcp.creator_contacts k
    where a.creator_id = p_absorb and k.creator_id = p_keep and k.kind = a.kind and k.value_hash = a.value_hash;
  update gcp.creator_contacts set creator_id = p_keep, trust = 'unverified' where creator_id = p_absorb;
  delete from gcp.creator_links a using gcp.creator_links k where a.creator_id = p_absorb and k.creator_id = p_keep and k.url = a.url;
  update gcp.creator_links set creator_id = p_keep where creator_id = p_absorb;
  update gcp.contact_checks set creator_id = p_keep where creator_id = p_absorb;
  update gcp.creator_attribute_evidence set creator_id = p_keep where creator_id = p_absorb;
  update gcp.creator_lifecycle_events set creator_id = p_keep where creator_id = p_absorb;
  update gcp.enrichment_snapshots set creator_id = p_keep where creator_id = p_absorb;
  update gcp.audience_estimates set creator_id = p_keep where creator_id = p_absorb;
  update gcp.removal_requests set creator_id = p_keep where creator_id = p_absorb;
  update platform.raw_payloads set creator_id = p_keep where creator_id = p_absorb;
  delete from platform.summary_requests a using platform.summary_requests k
    where a.creator_id = p_absorb and k.creator_id = p_keep and k.source_hash = a.source_hash;
  update platform.summary_requests set creator_id = p_keep where creator_id = p_absorb;
  delete from gcp.creator_search_documents where creator_id = p_absorb;

  -- Workspace data: shortlists, campaigns, reveals and history follow the person.
  delete from wp.list_members a using wp.list_members k where a.creator_id = p_absorb and k.creator_id = p_keep and k.list_id = a.list_id;
  update wp.list_members set creator_id = p_keep where creator_id = p_absorb;
  get diagnostics c = row_count; n := n || jsonb_build_object('listMembers', c);
  delete from wp.campaign_creators a using wp.campaign_creators k where a.creator_id = p_absorb and k.creator_id = p_keep and k.campaign_id = a.campaign_id;
  update wp.campaign_creators set creator_id = p_keep where creator_id = p_absorb;
  get diagnostics c = row_count; n := n || jsonb_build_object('campaignCreators', c);
  delete from wp.contact_reveals a using wp.contact_reveals k where a.creator_id = p_absorb and k.creator_id = p_keep and k.workspace_id = a.workspace_id;
  update wp.contact_reveals set creator_id = p_keep where creator_id = p_absorb;
  delete from wp.audience_views a using wp.audience_views k
    where a.creator_id = p_absorb and k.creator_id = p_keep and k.workspace_id = a.workspace_id and k.month = a.month;
  update wp.audience_views set creator_id = p_keep where creator_id = p_absorb;
  delete from wp.discovery_results a using wp.discovery_results k where a.creator_id = p_absorb and k.creator_id = p_keep and k.job_id = a.job_id;
  update wp.discovery_results set creator_id = p_keep where creator_id = p_absorb;
  delete from wp.workspace_contacts a using wp.workspace_contacts k
    where a.creator_id = p_absorb and k.creator_id = p_keep and k.workspace_id = a.workspace_id and k.value_hash = a.value_hash;
  update wp.workspace_contacts set creator_id = p_keep where creator_id = p_absorb;
  -- One open audience job per workspace and creator: an absorbed open job whose workspace already has one stays put.
  update wp.audience_jobs a set creator_id = p_keep where a.creator_id = p_absorb
    and not (a.status in ('queued', 'running') and exists (select 1 from wp.audience_jobs k where k.creator_id = p_keep and k.workspace_id = a.workspace_id and k.status in ('queued', 'running')));
  update wp.creator_import_rows set creator_id = p_keep where creator_id = p_absorb;
  update wp.creator_profile_views set creator_id = p_keep where creator_id = p_absorb;
  update wp.discovery_candidates set creator_id = p_keep where creator_id = p_absorb;
  update wp.discovery_jobs set creator_id = p_keep where creator_id = p_absorb;
  update wp.outreach_emails set creator_id = p_keep where creator_id = p_absorb;
  update wp.outreach_events set creator_id = p_keep where creator_id = p_absorb;

  -- The kept creator keeps its own values and fills gaps from the absorbed one.
  update gcp.creators k set
    avatar_url = coalesce(k.avatar_url, a.avatar_url), avatar_key = coalesce(k.avatar_key, a.avatar_key),
    city = coalesce(k.city, a.city), confirmed_country = coalesce(k.confirmed_country, a.confirmed_country),
    public_country = coalesce(k.public_country, a.public_country), public_country_source = coalesce(k.public_country_source, a.public_country_source),
    updated_at = now()
  from gcp.creators a where k.id = p_keep and a.id = p_absorb;
  update gcp.creators set status = 'merged', merged_into_id = p_keep, updated_at = now() where id = p_absorb;
  insert into gcp.creator_lifecycle_events (creator_id, kind, from_state, to_state, reason, source, action)
  values (p_keep, 'identity', null, 'merged_in', left(p_reason, 300), 'backfill', left('absorbed creator ' || p_absorb::text, 120)),
         (p_absorb, 'identity', 'active', 'merged', left(p_reason, 300), 'backfill', left('merged into creator ' || p_keep::text, 120));
  return n || jsonb_build_object('merged', true);
end
$$;
revoke all on function platform.merge_creator(uuid, uuid, text) from public;
grant execute on function platform.merge_creator(uuid, uuid, text) to mushin_worker;
