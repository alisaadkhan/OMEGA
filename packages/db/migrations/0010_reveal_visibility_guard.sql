-- Fixes gcp.revealed_contacts (0009): it only checked that the workspace had revealed the creator, so a creator
-- flagged as a possible minor (or with a removal request, or erased) after the reveal kept showing contact values.
-- Contact values are now returned only while the creator is active and not a protected possible minor
-- (SRS §5.2, §5.5: only MUSHIN staff can lift the minor protection).
create or replace function gcp.revealed_contacts(p_creator_id uuid)
  returns table (id uuid, kind text, value_encrypted text, trust text)
  language sql stable security definer set search_path = pg_catalog as $$
  select c.id, c.kind, c.value_encrypted, c.trust
  from gcp.creator_contacts c
  join gcp.creators cr on cr.id = c.creator_id
  where c.creator_id = p_creator_id
    and cr.status = 'active'
    and not (cr.is_minor and cr.minor_override_by_staff_id is null)
    and exists (
      select 1 from wp.contact_reveals r
      where r.workspace_id = platform.current_workspace_id() and r.creator_id = p_creator_id
    )
$$;
revoke all on function gcp.revealed_contacts(uuid) from public;
grant execute on function gcp.revealed_contacts(uuid) to mushin_app;
