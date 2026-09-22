-- Apply after 20260917-architecture-integrity.sql. No row contents are broadcast.
-- Supabase Realtime Database Broadcast is required; no public subscription policy.
begin;
do $$ begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    raise exception 'Supabase realtime.send is unavailable. Enable/update Realtime before this migration.';
  end if;
end $$;

-- Reserve this metadata channel for the service role, even if another feature
-- later adds a permissive Realtime policy for signed-in/public clients.
drop policy if exists app_changes_server_only on realtime.messages;
create policy app_changes_server_only on realtime.messages as restrictive
  for all to anon, authenticated
  using (topic <> 'prokachka:changes') with check (topic <> 'prokachka:changes');

create or replace function public.broadcast_app_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  before_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  row_data jsonb;
  topics text[];
  team_ids text[] := array[]::text[];
  user_ids text[] := array[]::text[];
  related_team text;
begin
  if tg_op = 'UPDATE' and (before_row - 'updated_at') = (after_row - 'updated_at') then return null; end if;
  topics := case tg_table_name
    when 'tasks' then array['tasks']
    when 'task_programs' then array['programs','tasks']
    when 'announcements' then array['announcements']
    when 'submissions' then array['submissions','tasks']
    when 'star_awards' then array['stars']
    when 'users' then array['users','network','session']
    when 'teams' then array['teams','users','network','session']
    when 'team_join_requests' then array['requests']
    when 'member_program_progress' then array['programs','tasks']
    else array[]::text[] end;
  -- Both scopes need invalidation when a user/row moves to another team.
  foreach row_data in array array[before_row, after_row] loop
    team_ids := array_append(team_ids, row_data->>'team_id');
    user_ids := array_append(user_ids, row_data->>'user_id');
    if tg_table_name = 'users' then user_ids := array_append(user_ids, row_data->>'id'); end if;
    if tg_table_name = 'teams' then team_ids := array_append(team_ids, row_data->>'id'); end if;
    if tg_table_name = 'submissions' and row_data ? 'task_id' then
      select team_id::text into related_team from public.tasks where id = (row_data->>'task_id')::uuid;
      team_ids := array_append(team_ids, related_team);
    end if;
    if tg_table_name = 'member_program_progress' and row_data ? 'program_id' then
      select team_id::text into related_team from public.task_programs where id = (row_data->>'program_id')::uuid;
      team_ids := array_append(team_ids, related_team);
    end if;
    if row_data ? 'user_id' then
      select team_id::text into related_team from public.users where id = (row_data->>'user_id')::uuid;
      team_ids := array_append(team_ids, related_team);
    end if;
  end loop;
  select coalesce(array_agg(distinct id), array[]::text[]) into team_ids from unnest(team_ids) id where id is not null;
  select coalesce(array_agg(distinct id), array[]::text[]) into user_ids from unnest(user_ids) id where id is not null;
  perform realtime.send(jsonb_build_object('topics', topics, 'teamIds', team_ids, 'userIds', user_ids,
    'catalog', tg_table_name = 'teams'), 'changed', 'prokachka:changes', true);
  return null;
exception when others then
  -- A notification outage must never roll back a submitted/reviewed assignment.
  raise log 'App realtime notification unavailable: SQLSTATE %', sqlstate;
  return null;
end;
$$;
revoke all on function public.broadcast_app_change() from public, anon, authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array['tasks','task_programs','announcements','submissions','star_awards','users','teams','team_join_requests','member_program_progress'] loop
    execute format('drop trigger if exists app_live_change on public.%I', table_name);
    execute format('create trigger app_live_change after insert or update or delete on public.%I for each row execute function public.broadcast_app_change()', table_name);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
