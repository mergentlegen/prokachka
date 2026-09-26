\set ON_ERROR_STOP on
begin;
do $$ <<publication_test>>
declare
  team_id uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid();
  branch_a uuid:=gen_random_uuid(); branch_b uuid:=gen_random_uuid(); child_a uuid:=gen_random_uuid(); deep_a uuid:=gen_random_uuid(); child_b uuid:=gen_random_uuid(); detached uuid:=gen_random_uuid();
  p_a uuid; p_b uuid; p_team uuid; t_a uuid; t_b uuid; t_team uuid; outcome jsonb; input jsonb; old_date timestamptz;
begin
  insert into teams(id,name) values(team_id,'audience-'||team_id),(other_team,'foreign-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team_id,null,false),
    (branch_a,'Branch A','Branch','Alpha',branch_a||'@test.invalid',branch_a::text,'test','member',team_id,root_id,true),
    (branch_b,'Branch B','Branch','Beta',branch_b||'@test.invalid',branch_b::text,'test','member',team_id,root_id,true),
    (child_a,'Child A','Child','Alpha',child_a||'@test.invalid',child_a::text,'test','member',team_id,branch_a,false),
    (deep_a,'Deep A','Deep','Alpha',deep_a||'@test.invalid',deep_a::text,'test','member',team_id,child_a,false),
    (child_b,'Child B','Child','Beta',child_b||'@test.invalid',child_b::text,'test','member',team_id,branch_b,false),
    (detached,'Detached','Detached','Member',detached||'@test.invalid',detached::text,'test','member',team_id,null,false);
  input:=jsonb_build_object('teamId',team_id,'title','Rules publication','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Rules game','description','Read the rules and answer.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules')));
  outcome:=app_create_program(input||jsonb_build_object('publisherId',branch_a,'audienceRootId',branch_a));
  p_a:=(outcome->'program'->>'id')::uuid; t_a:=(outcome->'tasks'->0->>'id')::uuid;
  outcome:=app_create_program(input||jsonb_build_object('publisherId',branch_b,'audienceRootId',branch_b));
  p_b:=(outcome->'program'->>'id')::uuid; t_b:=(outcome->'tasks'->0->>'id')::uuid;
  outcome:=app_create_program(input||jsonb_build_object('publisherId',root_id,'audienceRootId',null));
  p_team:=(outcome->'program'->>'id')::uuid; t_team:=(outcome->'tasks'->0->>'id')::uuid;
  if p_a=p_b or p_a=p_team or p_b=p_team then raise exception 'Audiences share the same publication'; end if;
  begin
    perform app_update_program(p_a,'{"title":"Edited built-in game"}',branch_a,false);
    raise exception 'Built-in game can be edited as an ordinary program';
  exception when check_violation then null; end;
  update users set role='member',can_publish_tasks=true where id=root_id;
  if (app_update_program(p_team,'{"isActive":false}',root_id,false)->>'forbidden') is distinct from 'true' then
    raise exception 'Demoted admin still controls a team-wide publication';
  end if;
  update users set role='admin' where id=root_id;
  if app_ready_task_error(child_a,t_a) is not null or app_ready_task_error(deep_a,t_a) is not null then raise exception 'Descendants cannot access branch A'; end if;
  if app_ready_task_error(child_b,t_a) is null or app_ready_task_error(detached,t_a) is null then raise exception 'Branch A leaked'; end if;
  if app_ready_task_error(child_b,t_b) is not null then raise exception 'Branch B lost its independent publication'; end if;
  if app_ready_task_error(child_a,t_team) is not null or app_ready_task_error(child_b,t_team) is not null or app_ready_task_error(detached,t_team) is not null then raise exception 'Root publication does not reach the whole team'; end if;
  begin
    perform app_create_program(input||jsonb_build_object('publisherId',branch_a,'audienceRootId',branch_a));
    raise exception 'Duplicate branch publication accepted';
  exception when unique_violation then null; end;
  begin
    perform app_create_program(input||jsonb_build_object('publisherId',root_id,'audienceRootId',null));
    raise exception 'Duplicate team publication accepted';
  exception when unique_violation then null; end;
  begin
    perform app_create_program(input||jsonb_build_object('publisherId',branch_a,'audienceRootId',null));
    raise exception 'Member published to the whole team';
  exception when insufficient_privilege then null; end;
  begin
    perform app_create_program(input||jsonb_build_object('publisherId',branch_a,'audienceRootId',branch_b));
    raise exception 'Member published to a sibling branch';
  exception when insufficient_privilege then null; end;
  begin
    perform app_create_program(input||jsonb_build_object('teamId',other_team,'publisherId',branch_a,'audienceRootId',branch_a));
    raise exception 'Publisher crossed teams';
  exception when insufficient_privilege then null; end;
  perform app_start_ready_program(child_a,t_a);
  perform app_advance_ready_program(child_a,t_a,1);
  select created_at into old_date from task_programs where id=p_a;
  perform app_update_program(p_a,'{"isActive":false}',branch_a,false);
  if app_ready_task_error(child_a,t_a) is null or app_ready_task_error(child_b,t_b) is not null then raise exception 'Unpublishing crossed audiences'; end if;
  -- Legacy task hiding must be recoverable without creating another task/attempt.
  update tasks set is_active=false where id=t_a;
  perform app_update_program(p_a,'{"isActive":true}',branch_a,false);
  if app_ready_task_error(child_a,t_a) is not null then raise exception 'Re-add did not restore the hidden step'; end if;
  if (app_start_ready_program(child_a,t_a)->>'step')::int is distinct from 1 then raise exception 'Re-add lost progress'; end if;
  if (select created_at from task_programs where id=p_a) is distinct from old_date then raise exception 'Re-add changed publication date'; end if;
  update users set parent_user_id=branch_b where id=child_a;
  if app_ready_task_error(child_a,t_a) is null or app_ready_task_error(deep_a,t_a) is null
    or app_ready_task_error(child_a,t_b) is not null or app_ready_task_error(deep_a,t_b) is not null then raise exception 'Moving a branch did not change access for its descendants'; end if;
  if (select count(*) from tasks where program_id in(p_a,p_b,p_team))<>3 then raise exception 'Publication lost or duplicated a step'; end if;
  if has_function_privilege('anon','app_create_program(jsonb)','execute') or has_function_privilege('authenticated','app_create_program(jsonb)','execute') then raise exception 'Public publication RPC'; end if;
end $$;
rollback;
