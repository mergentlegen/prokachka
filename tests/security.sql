-- Disposable PostgreSQL only; all fixtures roll back.
begin;
do $$
declare row record; result jsonb; key text := repeat('e',64);
begin
  for row in select c.oid, c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')
  loop
    if not row.relrowsecurity then raise exception 'RLS missing on %', row.relname; end if;
    if has_table_privilege('anon',row.oid,'select,insert,update,delete')
      or has_table_privilege('authenticated',row.oid,'select,insert,update,delete')
      then raise exception 'Public table access on %', row.relname; end if;
  end loop;
  for row in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proname not in ('welcome_video_upload_path_allowed', 'task_video_upload_path_allowed')
  loop
    if has_function_privilege('anon',row.oid,'execute') or has_function_privilege('authenticated',row.oid,'execute')
      then raise exception 'Privileged function exposed: %', row.proname; end if;
  end loop;
  if has_schema_privilege('anon','public','create') or has_schema_privilege('authenticated','public','create')
    then raise exception 'Public schema creation permitted'; end if;
  delete from public.login_attempt_limits where email_hash=key;
  for i in 1..20 loop
    result := public.app_login_attempt_limit(key);
    if result->>'allowed' <> 'true' then raise exception 'Login limited too early'; end if;
  end loop;
  result := public.app_login_attempt_limit(key);
  if result->>'allowed' <> 'false' or (result->>'retryAfter')::integer not between 1 and 900
    then raise exception 'Login limit bypassed'; end if;
  update public.login_attempt_limits set window_at=now()-interval '16 minutes' where email_hash=key;
  if public.app_login_attempt_limit(key)->>'allowed' <> 'true' then raise exception 'Expired limit did not reset'; end if;
  update public.login_attempt_limits set window_at=now()-interval '2 days' where email_hash=key;
  perform public.app_login_attempt_limit(repeat('d',64));
  if exists(select 1 from public.login_attempt_limits where email_hash=key) then raise exception 'Stale counter not cleaned'; end if;
end;
$$;
set local role anon;
do $$ begin
  begin
    perform public.app_login_attempt_limit(repeat('c',64));
    raise exception 'Anonymous role called a private function';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.ready_program_attempts;
    raise exception 'Anonymous role read private attempts';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
