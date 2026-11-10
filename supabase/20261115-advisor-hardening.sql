-- Notes from the Supabase security advisor (2026-11-10). Nothing here changes how the site works.
-- 1. Two trigger functions had no fixed search_path.
-- 2. Trigger functions are run by the database itself, so nobody needs the right to call them over the API.
--    rls_auto_enable() exists only on production (Supabase added it; it switches RLS on for new tables).
-- The two *_upload_path_allowed functions stay callable: storage policies run them as the uploading browser.
-- Re-running this file is safe.
begin;

alter function public.validate_user_hierarchy() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
revoke all on function public.validate_user_hierarchy(), public.touch_updated_at() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
