-- Erasure also scrubs earlier add-by-link and refresh jobs that name the creator's profile, in every workspace
-- (security review of 0012: the job rows kept the handle, profile link and pasted link after erasure).
drop function platform.erase_creator_workspace_rows(uuid);

create function platform.erase_creator_workspace_rows(p_creator_id uuid, p_canonical_urls text[])
  returns void language sql security definer set search_path = pg_catalog as $$
  delete from wp.contact_reveals where creator_id = p_creator_id;
  delete from wp.audience_views where creator_id = p_creator_id;
  delete from wp.discovery_results where creator_id = p_creator_id;
  update wp.discovery_jobs
     set input_url = null, handle = 'erased', canonical_url = 'erased:' || id::text
   where kind <> 'live' and (creator_id = p_creator_id or canonical_url = any (p_canonical_urls));
$$;
revoke all on function platform.erase_creator_workspace_rows(uuid, text[]) from public;
grant execute on function platform.erase_creator_workspace_rows(uuid, text[]) to mushin_worker;
