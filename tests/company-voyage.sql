\set ON_ERROR_STOP on
-- Replaying must preserve existing attempts and work after older migration tests.
\ir ../supabase/20261005-company-voyage.sql
\ir ../supabase/20261005-company-voyage.sql
begin;
do $$
declare
  team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid();
  publisher uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  company_task uuid; branch_task uuid; program_id uuid; result jsonb; reward_id uuid; i int;
  answers int[]:=array[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1];
begin
  insert into teams(id,name) values(team,'company-'||team),(other_team,'other-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (publisher,'Publisher','Publisher','Test',publisher||'@test.invalid',publisher::text,'test','member',team,mentor,true),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,publisher,false),
    (sibling,'Sibling','Sibling','Test',sibling||'@test.invalid',sibling::text,'test','member',team,mentor,false),
    (outsider,'Other','Other','Test',outsider||'@test.invalid',outsider::text,'test','member',other_team,null,false);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Корабль, на который ты поднялся','templateKey','company-voyage','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Корабль, на который ты поднялся','description','Company course','maxPoints',10,'publicationType','evergreen','interactiveKind','company-voyage'))));
  company_task:=(result->'tasks'->0->>'id')::uuid; program_id:=(result->'program'->>'id')::uuid;
  if company_task is null then raise exception 'Company publication failed: %',result; end if;
  if (select deadline_at is not null or deadline_hours is not null from tasks where id=company_task) then raise exception 'Company task has deadline'; end if;
  if app_ready_task_error(sibling,company_task) is not null then raise exception 'Root publication inaccessible to another branch'; end if;
  if app_ready_task_error(outsider,company_task) is null or app_ready_task_error(mentor,company_task) is null then raise exception 'Wrong team/role allowed'; end if;
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',publisher,'audienceRootId',publisher,'title','Branch company','templateKey','company-voyage','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Branch company','description','Branch course','maxPoints',10,'publicationType','evergreen','interactiveKind','company-voyage'))));
  branch_task:=(result->'tasks'->0->>'id')::uuid;
  if branch_task is null or app_ready_task_error(member_id,branch_task) is not null or app_ready_task_error(sibling,branch_task) is null then raise exception 'Branch scope broken: %',result; end if;
  perform app_start_ready_program(member_id,company_task);
  if not (app_advance_ready_program(member_id,company_task,8) ? 'validationError') then raise exception 'Skipped cards'; end if;
  if not (app_answer_ready_program(member_id,company_task,1,0) ? 'validationError') then raise exception 'Answered before cards'; end if;
  if not (app_save_company_story(member_id,company_task,array[0,0,0]) ? 'validationError') then raise exception 'Saved story before completion'; end if;
  if not (app_complete_ready_program(member_id,company_task) ? 'validationError') then raise exception 'Premature reward'; end if;
  for i in 1..8 loop perform app_advance_ready_program(member_id,company_task,i); end loop;
  result:=app_answer_ready_program(member_id,company_task,0,0);
  if result->>'failed' is distinct from 'true' or (result->>'lastAnswer')::int is distinct from 0 then raise exception 'Wrong answer not retained'; end if;
  result:=app_start_ready_program(member_id,company_task);
  if result->>'failed' is distinct from 'true' then raise exception 'Failed state lost on reopen'; end if;
  result:=app_answer_ready_program(member_id,company_task,1,0);
  if result->>'failed' is distinct from 'true' or (result->>'questionIndex')::int is distinct from 0 then raise exception 'Failed quiz can continue'; end if;
  result:=app_restart_ready_program_quiz(member_id,company_task);
  if (result->>'step')::int is distinct from 8 or (result->>'attemptNumber')::int is distinct from 2 then raise exception 'Manual retry loses cards'; end if;
  for i in 0..16 loop
    result:=app_answer_ready_program(member_id,company_task,answers[i+1],i);
    if result ? 'validationError' or (result->>'questionIndex')::int is distinct from i+1 then raise exception 'Question % failed: %',i,result; end if;
    if (result->>'earnedPoints')::int is distinct from 0 or (result->>'maxPoints')::int is distinct from 10 then raise exception 'Questions masquerade as 17 miles'; end if;
    -- Network replay must not answer the next question or double-count progress.
    result:=app_answer_ready_program(member_id,company_task,answers[i+1],i);
    if (result->>'questionIndex')::int is distinct from i+1 then raise exception 'Answer replay advances progress'; end if;
  end loop;
  if result->>'ready' is distinct from 'true' or exists(select 1 from submissions where user_id=member_id and task_id=company_task) then raise exception 'Reward given before Finish'; end if;
  update tasks set max_points=17 where id=company_task;
  if not (app_complete_ready_program(member_id,company_task) ? 'validationError') then raise exception 'Misconfigured reward accepted'; end if;
  update tasks set max_points=10 where id=company_task;
  result:=app_complete_ready_program(member_id,company_task); reward_id:=(result->'submission'->>'id')::uuid;
  if result->>'completed' is distinct from 'true' or (result->'submission'->>'points')::int is distinct from 10 or (result->>'earnedPoints')::int is distinct from 10 then raise exception 'Reward is not exactly ten: %',result; end if;
  result:=app_complete_ready_program(member_id,company_task);
  if (result->'submission'->>'id')::uuid is distinct from reward_id then raise exception 'Duplicate completion changes reward'; end if;
  result:=app_start_ready_program(member_id,company_task,true);
  if result->>'completed' is distinct from 'true' then raise exception 'Completed game restarted'; end if;
  if not (app_save_company_story(member_id,company_task,array[3,0,0]) ? 'validationError') or not (app_save_company_story(member_id,company_task,array[0,5,0]) ? 'validationError')
    or not (app_save_company_story(member_id,company_task,array[0,0,null]) ? 'validationError') then raise exception 'Invalid story choices accepted'; end if;
  result:=app_save_company_story(member_id,company_task,array[2,4,1]);
  if result->'storyChoices' is distinct from '[2,4,1]'::jsonb or (result->>'earnedPoints')::int is distinct from 10 then raise exception 'Story did not persist'; end if;
  result:=app_start_ready_program(member_id,company_task);
  if result->'storyChoices' is distinct from '[2,4,1]'::jsonb then raise exception 'Story lost on reopen'; end if;
  if (select count(*) from submissions where user_id=member_id and task_id=company_task)<>1 or (select sum(points) from submissions where user_id=member_id)<>10 then raise exception 'Story or replay awarded extra miles'; end if;
  update task_programs set is_active=false where id=program_id;
  if not (app_save_company_story(member_id,company_task,array[0,0,0]) ? 'validationError') then raise exception 'Hidden game still writable'; end if;
  if has_function_privilege('anon','app_save_company_story(uuid,uuid,integer[])','execute') or has_function_privilege('authenticated','app_ready_program_spec(text)','execute') then raise exception 'Public grading/story privilege'; end if;
end $$;
rollback;
