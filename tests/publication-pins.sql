\set ON_ERROR_STOP on
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); root_id uuid := gen_random_uuid(); sibling_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  created_program uuid; outcome jsonb; original_date timestamptz;
begin
  insert into teams(id,name) values(team,'pins-'||team),(other_team,'pins-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks) values
    (owner_id,'Owner','Owner','Test',owner_id||'@test.invalid',owner_id::text,'test','member',team,true),
    (root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team,false),
    (sibling_id,'Sibling','Sibling','Test',sibling_id||'@test.invalid',sibling_id::text,'test','member',team,true),
    (outsider_id,'Other','Other','Test',outsider_id||'@test.invalid',outsider_id::text,'test','admin',other_team,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',owner_id,'audienceRootId',owner_id,
    'title','Pin test','deadlineHours',24,'tasks',jsonb_build_array(jsonb_build_object('title','First step','description','Test answer','maxPoints',5))));
  created_program := (outcome->'program'->>'id')::uuid;
  select created_at into original_date from task_programs where id = created_program;
  if (select is_pinned from task_programs where id = created_program) then raise exception 'New programs must be unpinned'; end if;
  if (app_update_program(created_program,'{"isPinned":true}',sibling_id,false)->>'forbidden') is distinct from 'true' then raise exception 'Sibling pinned another branch'; end if;
  if (app_update_program(created_program,'{"isPinned":true}',outsider_id,false)->>'forbidden') is distinct from 'true' then raise exception 'Foreign admin pinned another team'; end if;
  outcome := app_update_program(created_program,'{"isPinned":true}',owner_id,false);
  if (outcome->'data'->>'is_pinned') is distinct from 'true' then raise exception 'Owner pin failed'; end if;
  update users set can_publish_tasks = false where id = owner_id;
  if (app_update_program(created_program,'{"isPinned":false}',owner_id,false)->>'forbidden') is distinct from 'true' then raise exception 'Revoked publisher could unpin'; end if;
  outcome := app_update_program(created_program,'{"isPinned":false}',root_id,false);
  if (outcome->'data'->>'is_pinned') is distinct from 'false' then raise exception 'Root unpin failed'; end if;
  if (select created_at from task_programs where id = created_program) is distinct from original_date then raise exception 'Pinning changed publication date'; end if;
  if exists(select 1 from tasks where tasks.program_id = created_program and (is_pinned or not is_active or deadline_hours <> 24)) then raise exception 'Pinning changed steps'; end if;
  begin
    perform app_update_program(created_program,'{"isPinned":"true"}',root_id,false);
    raise exception 'Invalid pin type accepted';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('anon','app_update_program(uuid,jsonb,uuid,boolean)','execute')
    or has_function_privilege('authenticated','app_update_program(uuid,jsonb,uuid,boolean)','execute') then raise exception 'Public pin RPC access'; end if;
end $$;
rollback;
