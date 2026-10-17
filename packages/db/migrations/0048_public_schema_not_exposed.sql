-- Audit SEC-11 (2026-10-17). Supabase exposes the `public` schema through its Data API to the anon (public) key and to
-- every signed-in user. MUSHIN keeps nothing of its own there, but 0020 installed pg_trgm into it, so the public key
-- could call its 31 functions (the API listed /rpc/show_trgm and /rpc/show_limit). Found by
-- scripts/supabase/exposure-check.ts on the local Supabase stack.
--
-- On Supabase the extension moves to the `extensions` schema (Supabase's own recommendation; never exposed by the Data
-- API). Its functions are owned by supabase_admin, so revoking them is not possible for us; moving is. Catalogue search
-- calls `<%` and word_similarity unqualified: Supabase's `postgres` login role has `extensions` on its search_path, and
-- MUSHIN's roles get USAGE on it, so name resolution is unchanged. Plain PostgreSQL (no Data API) is left as it is.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_namespace where nspname = 'extensions')
     and exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm' and n.nspname = 'public') then
    alter extension pg_trgm set schema extensions;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    grant usage on schema extensions to mushin_app, mushin_worker;
  end if;
end $$;
