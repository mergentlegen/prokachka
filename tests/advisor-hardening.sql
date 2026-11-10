\set ON_ERROR_STOP on
-- Production has rls_auto_enable(); a database built from bootstrap does not, so the test brings its own.
create temporary table advisor_fixture(made boolean);
do $$
begin
  insert into advisor_fixture values(to_regprocedure('public.rls_auto_enable()') is null);
  if (select made from advisor_fixture) then
    create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path = pg_catalog as $f$ begin end $f$;
    grant execute on function public.rls_auto_enable() to public, anon, authenticated;
  end if;
  grant execute on function public.validate_user_hierarchy(), public.touch_updated_at() to public, anon, authenticated;
end $$;

\ir ../supabase/20261115-advisor-hardening.sql
\ir ../supabase/20261115-advisor-hardening.sql

do $$
declare fn text; team uuid := gen_random_uuid(); parent uuid := gen_random_uuid(); child uuid := gen_random_uuid(); task uuid := gen_random_uuid();
begin
  foreach fn in array array['public.validate_user_hierarchy()', 'public.touch_updated_at()', 'public.rls_auto_enable()'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% can still be called from the browser', fn;
    end if;
    if not exists (select 1 from pg_proc where oid = fn::regprocedure and proconfig::text like '%search_path=%') then
      raise exception '% has no fixed search_path', fn;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.task_video_upload_path_allowed(text)', 'execute') then
    raise exception 'Video uploads lost their path check';
  end if;

  -- The triggers behind these functions still work for the role the site uses.
  insert into public.teams(id,name) values(team, 'advisor-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (parent,'Parent User','Parent','User',parent || '@test.invalid',parent::text,'test','member',team),
    (child,'Child User','Child','User',child || '@test.invalid',child::text,'test','member',team);
  insert into public.tasks(id,title,description,team_id,max_points,updated_at) values(task,'Advisor','Check',team,5,'2020-01-01');
  set local role service_role;
  update public.users set parent_user_id = parent where id = child;
  begin
    update public.users set parent_user_id = child where id = parent;
    raise exception 'A hierarchy cycle was accepted';
  exception when others then
    if sqlerrm = 'A hierarchy cycle was accepted' then raise; end if;
  end;
  update public.tasks set title = 'Advisor 2' where id = task;
  reset role;
  if (select updated_at from public.tasks where id = task) < now() - interval '1 hour' then raise exception 'updated_at is no longer touched'; end if;
  delete from public.tasks where id = task;
  delete from public.users where id in (child, parent);
  delete from public.teams where id = team;
  if (select made from advisor_fixture) then drop function public.rls_auto_enable(); end if;
end $$;
