-- READ ONLY. May be run in the production SQL Editor after the migration.
-- This checks permissions, not account data or secrets.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_access,
  has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as authenticated_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
order by c.relname;

-- Expected: only welcome_video_upload_path_allowed, needed by the scoped
-- Storage upload policy. No app_* / tg_* mutating RPC should appear here.
select p.proname as exposed_privileged_function,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))
order by p.proname;

select to_regprocedure('public.app_login_attempt_limit(text)') is not null as login_protection_installed,
  has_schema_privilege('anon','public','create') as anon_can_create,
  has_schema_privilege('authenticated','public','create') as authenticated_can_create;
