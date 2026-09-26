\set ON_ERROR_STOP on
begin;
do $$
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); sibling uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  rules_task uuid; program_id uuid; dream_task uuid; outcome jsonb; saved_id uuid; answers integer[] := array[1,1,0,1,2]; i integer;
begin
  insert into teams(id,name) values(team,'rules-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor,false),
    (sibling,'Sibling','Sibling','Test',sibling||'@test.invalid',sibling::text,'test','member',team,mentor,true),
    (outsider,'Other','Other','Test',outsider||'@test.invalid',outsider::text,'test','member',null,null,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила игры','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Правила игры','description','Изучи правила и пройди тест.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid; program_id := (outcome->'program'->>'id')::uuid;
  if (select deadline_at is not null or deadline_hours is not null from tasks where id=rules_task) then raise exception 'Ready game has a deadline'; end if;
  if app_ready_task_error(mentor,rules_task) is null or app_ready_task_error(outsider,rules_task) is null then raise exception 'Non-member or foreign member can access game'; end if;
  update tasks set audience_root_id=sibling where id=rules_task;
  if app_ready_task_error(member_id,rules_task) is null then raise exception 'Sibling branch can access game'; end if;
  update tasks set audience_root_id=null where id=rules_task;
  update task_programs set is_active=false where id=program_id;
  if app_ready_task_error(member_id,rules_task) is null then raise exception 'Hidden program remains accessible'; end if;
  update task_programs set is_active=true where id=program_id;

  perform app_start_ready_program(member_id,rules_task);
  if not (app_answer_ready_program(member_id,rules_task,1,0) ? 'validationError') then raise exception 'Quiz accepted before introduction'; end if;
  if not (app_complete_ready_program(member_id,rules_task) ? 'validationError') then raise exception 'Premature reward'; end if;
  perform app_advance_ready_program(member_id,rules_task,1);
  if not (app_advance_ready_program(member_id,rules_task,2) ? 'validationError') then raise exception 'Rules allowed dream route steps'; end if;
  outcome := app_answer_ready_program(member_id,rules_task,1,0);
  if (outcome->>'earnedPoints')::int is distinct from 1 then raise exception 'First answer failed'; end if;
  outcome := app_answer_ready_program(member_id,rules_task,1,0);
  if (outcome->>'questionIndex')::int is distinct from 1 or (outcome->>'earnedPoints')::int is distinct from 1 then raise exception 'Replay answered next question'; end if;
  if not (app_answer_ready_program(member_id,rules_task,0,0) ? 'validationError') then raise exception 'Stale conflicting answer accepted'; end if;
  outcome := app_answer_ready_program(member_id,rules_task,0,1);
  if outcome->>'failed' is distinct from 'true' or (outcome->>'questionIndex')::int is distinct from 1 then raise exception 'Wrong answer was reset automatically'; end if;
  outcome := app_start_ready_program(member_id,rules_task);
  if outcome->>'failed' is distinct from 'true' or (outcome->>'lastAnswer')::int is distinct from 0 then raise exception 'Wrong answer not restored'; end if;
  perform app_answer_ready_program(member_id,rules_task,1,1);
  if (select earned_points from ready_program_attempts where user_id=member_id and ready_program_attempts.task_id=rules_task) is distinct from 1 then raise exception 'Failed quiz continued'; end if;
  if exists(select 1 from submissions where user_id=member_id and submissions.task_id=rules_task) then raise exception 'Partial miles awarded'; end if;
  outcome := app_restart_ready_program_quiz(member_id,rules_task);
  if (outcome->>'step')::int is distinct from 1 or (outcome->>'earnedPoints')::int is distinct from 0 or (outcome->>'attemptNumber')::int is distinct from 2 then raise exception 'Manual retry failed'; end if;
  for i in 0..4 loop perform app_answer_ready_program(member_id,rules_task,answers[i+1],i); end loop;
  if exists(select 1 from submissions where user_id=member_id and submissions.task_id=rules_task) then raise exception 'Awarded before Finish'; end if;
  outcome := app_complete_ready_program(member_id,rules_task); saved_id := (outcome->'submission'->>'id')::uuid;
  if outcome->>'completed' is distinct from 'true' or (outcome->'submission'->>'points')::int is distinct from 5 then raise exception 'Final award failed'; end if;
  if (outcome->'submission'->>'answer_text' like '%Правила игры%') is distinct from true then raise exception 'Wrong result title'; end if;
  outcome := app_complete_ready_program(member_id,rules_task);
  if saved_id is null or (outcome->'submission'->>'id')::uuid is distinct from saved_id or (select count(*) from submissions where user_id=member_id and submissions.task_id=rules_task) <> 1 then raise exception 'Duplicate reward'; end if;
  update task_programs set is_active=false where id=program_id;
  update task_programs set is_active=true where id=program_id;
  outcome := app_start_ready_program(member_id,rules_task,true);
  if outcome->>'completed' is distinct from 'true' then raise exception 'Republication reset awarded progress'; end if;

  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Мечта с планом','templateKey','dream-plan','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Мечта с планом','description','Пройди маршрут и тест.','maxPoints',5,'publicationType','evergreen','interactiveKind','dream-plan'))));
  dream_task := (outcome->'tasks'->0->>'id')::uuid;
  perform app_start_ready_program(member_id,dream_task);
  perform app_advance_ready_program(member_id,dream_task,1);
  if not (app_answer_ready_program(member_id,dream_task,1,0) ? 'validationError') then raise exception 'Dream plan route can be skipped'; end if;
  for i in 2..12 loop perform app_advance_ready_program(member_id,dream_task,i); end loop;
  answers := array[1,2,1,2,2];
  for i in 0..4 loop perform app_answer_ready_program(member_id,dream_task,answers[i+1],i); end loop;
  outcome := app_complete_ready_program(member_id,dream_task);
  if outcome->>'completed' is distinct from 'true' then raise exception 'Dream plan regression'; end if;
  if (select sum(points) from submissions where user_id=member_id and submission_source='interactive') is distinct from 10 then raise exception 'Games do not sum rewards'; end if;
  if has_function_privilege('anon','app_ready_program_spec(text)','execute') or has_function_privilege('authenticated','app_answer_ready_program(uuid,uuid,integer,integer)','execute') then raise exception 'Public scoring access'; end if;
end $$;
rollback;
