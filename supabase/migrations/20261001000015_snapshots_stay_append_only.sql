-- Snapshots stay append-only for every app role (sub-project 3 and 4A specs): 0012 gave the worker DELETE on them for
-- erasure. Erasure now deletes a creator's snapshots through this one function instead.
revoke delete on gcp.enrichment_snapshots, gcp.profile_metric_snapshots from mushin_worker;

create function platform.erase_creator_snapshots(p_creator_id uuid)
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from gcp.profile_metric_snapshots
   where profile_id in (select id from gcp.creator_profiles where creator_id = p_creator_id);
  delete from gcp.enrichment_snapshots where creator_id = p_creator_id;
$$;
revoke all on function platform.erase_creator_snapshots(uuid) from public;
grant execute on function platform.erase_creator_snapshots(uuid) to mushin_worker;
