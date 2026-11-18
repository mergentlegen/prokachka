\set ON_ERROR_STOP on
-- «Правила участия» (20261120): one try per question, 1 mile per right first answer, the old quiz path closed.
begin;
do $$
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); second uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid(); rules_task uuid; dream_task uuid; outcome jsonb; saved_id uuid; i integer;
begin
  insert into teams(id,name) values(team,'participation-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor,false),
    (second,'Second','Second','Test',second||'@test.invalid',second::text,'test','member',team,mentor,false),
    (outsider,'Other','Other','Test',outsider||'@test.invalid',outsider::text,'test','member',null,null,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила участия','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Правила участия','description','Правила и 5 вопросов.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid;
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Мечта с планом','templateKey','dream-plan','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Мечта с планом','description','Пройди маршрут и тест.','maxPoints',5,'publicationType','evergreen','interactiveKind','dream-plan'))));
  dream_task := (outcome->'tasks'->0->>'id')::uuid;

  -- access: only members of the team, only this game
  if not (app_participation_rules(outsider,rules_task,'start',null,null) ? 'validationError') then raise exception 'Outsider can open the rules'; end if;
  if not (app_participation_rules(mentor,rules_task,'start',null,null) ? 'validationError') then raise exception 'Mentor can play the rules'; end if;
  if not (app_participation_rules(member_id,dream_task,'start',null,null) ? 'validationError') then raise exception 'Another game accepted'; end if;
  if not (app_participation_rules(member_id,rules_task,'finish',null,null) ? 'validationError') then raise exception 'Unknown action accepted'; end if;

  outcome := app_participation_rules(member_id,rules_task,'start',null,null);
  if outcome->'answers' <> '{}'::jsonb or outcome->'rights' <> '{}'::jsonb or outcome->>'completed' <> 'false' or (outcome->>'maxPoints')::int <> 5 then
    raise exception 'Bad start: %', outcome; end if;
  if not (app_participation_rules(member_id,rules_task,'answer',5,0) ? 'validationError')
    or not (app_participation_rules(member_id,rules_task,'answer',0,3) ? 'validationError')
    or not (app_participation_rules(member_id,rules_task,'answer',null,0) ? 'validationError') then raise exception 'Bad answer accepted'; end if;

  -- a wrong first answer stays wrong; the right option is told only for answered questions
  outcome := app_participation_rules(member_id,rules_task,'answer',0,2);
  if outcome->'answers' <> '{"0":2}'::jsonb or outcome->'rights' <> '{"0":0}'::jsonb or (outcome->>'earnedPoints')::int <> 0 then raise exception 'Bad wrong answer: %', outcome; end if;
  outcome := app_participation_rules(member_id,rules_task,'answer',0,0);
  if outcome->'answers' <> '{"0":2}'::jsonb or (outcome->>'earnedPoints')::int <> 0 then raise exception 'Second try changed the answer'; end if;
  outcome := app_participation_rules(member_id,rules_task,'answer',1,0);
  if (outcome->>'earnedPoints')::int <> 1 or outcome->'rights' <> '{"0":0,"1":0}'::jsonb then raise exception 'Right answer not counted: %', outcome; end if;

  -- the old quiz path cannot give the miles for this game
  perform app_start_ready_program(member_id,rules_task);
  perform app_advance_ready_program(member_id,rules_task,1);
  for i in 0..4 loop perform app_answer_ready_program(member_id,rules_task,0,i); end loop;
  if not (app_complete_ready_program(member_id,rules_task) ? 'validationError') then raise exception 'Old quiz completed the rules'; end if;
  if exists(select 1 from submissions where user_id=member_id and task_id=rules_task) then raise exception 'Miles before the fifth answer'; end if;
  if (app_participation_rules(member_id,rules_task,'start',null,null)->>'earnedPoints')::int <> 1 then raise exception 'Old quiz changed the score'; end if;

  perform app_participation_rules(member_id,rules_task,'answer',2,0);
  perform app_participation_rules(member_id,rules_task,'answer',3,1);
  if exists(select 1 from submissions where user_id=member_id and task_id=rules_task) then raise exception 'Miles before the fifth answer'; end if;
  outcome := app_participation_rules(member_id,rules_task,'answer',4,0);
  saved_id := (outcome->'submission'->>'id')::uuid;
  if outcome->>'completed' <> 'true' or (outcome->>'earnedPoints')::int <> 3 or (outcome->'submission'->>'points')::int <> 3
    or outcome->'submission'->>'status' <> 'accepted' or outcome->'rights' <> '{"0":0,"1":0,"2":0,"3":0,"4":0}'::jsonb then raise exception 'Bad finish: %', outcome; end if;
  if (select status from ready_program_attempts where user_id=member_id and task_id=rules_task) <> 'completed' then raise exception 'Attempt not finished'; end if;

  -- finished: nothing changes any more
  outcome := app_participation_rules(member_id,rules_task,'answer',3,0);
  if (outcome->>'earnedPoints')::int <> 3 or (outcome->'submission'->>'id')::uuid is distinct from saved_id
    or (select count(*) from submissions where user_id=member_id and task_id=rules_task) <> 1
    or (select count(*) from participation_rule_answers where user_id=member_id and task_id=rules_task) <> 5 then raise exception 'Finished game changed'; end if;

  -- all wrong: finished with 0 miles
  for i in 0..4 loop outcome := app_participation_rules(second,rules_task,'answer',i,1); end loop;
  if outcome->>'completed' <> 'true' or (outcome->'submission'->>'points')::int <> 0 then raise exception 'All wrong: %', outcome; end if;

  if has_function_privilege('anon','app_participation_rules(uuid,uuid,text,integer,integer)','execute')
    or has_function_privilege('authenticated','app_participation_rules(uuid,uuid,text,integer,integer)','execute')
    or not has_function_privilege('service_role','app_participation_rules(uuid,uuid,text,integer,integer)','execute')
    or has_table_privilege('authenticated','participation_rule_answers','select')
    or has_table_privilege('anon','participation_rule_answers','select') then raise exception 'Wrong privileges'; end if;
  if (app_ready_program_spec('starter-rules')->'answers') <> '[0,0,0,0,0]'::jsonb then raise exception 'Wrong key'; end if;
  if app_ready_program_spec('marketing-director') is null or app_ready_program_spec('free-membership') is null or app_ready_program_spec('dream-plan') is null then
    raise exception 'Spec lost a game'; end if;
end $$;
rollback;

-- The migration's data changes: old names and texts renamed, unfinished games reset, finished ones kept.
-- The migration commits by itself, so these rows are saved and removed again at the end.
do $$
declare team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); a_user uuid := gen_random_uuid(); b_user uuid := gen_random_uuid();
  team2 uuid := gen_random_uuid(); mentor2 uuid := gen_random_uuid(); outcome jsonb; rules_task uuid; program_id uuid; edited_task uuid;
begin
  insert into teams(id,name) values(team,'participation-old-'||team),(team2,'participation-edited-'||team2);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (a_user,'Anna','Anna','Test',a_user||'@test.invalid',a_user::text,'test','member',team,mentor,false),
    (b_user,'Boris','Boris','Test',b_user||'@test.invalid',b_user::text,'test','member',team,mentor,false),
    (mentor2,'Mentor','Mentor','Test',mentor2||'@test.invalid',mentor2::text,'test','admin',team2,null,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила игры','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Правила игры','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules',
      'description','Мили, звёзды и XP: узнай, как устроен твой прогресс в «Старте новичка», и ответь на пять вопросов. Пройди тест без ошибок и получи 5 миль автоматически.'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid; program_id := (outcome->'program'->>'id')::uuid;
  outcome := app_create_program(jsonb_build_object('teamId',team2,'publisherId',mentor2,'title','Моё название','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Мои правила','description','Свой текст наставника.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules'))));
  edited_task := (outcome->'tasks'->0->>'id')::uuid;
  insert into ready_program_attempts(user_id,task_id,status,current_step,earned_points,state) values
    (a_user,rules_task,'active',1,3,'{"ready":true,"questionIndex":3}'::jsonb),
    (b_user,rules_task,'completed',1,5,'{"ready":true,"questionIndex":5}'::jsonb);
  create temporary table participation_check(task uuid, program uuid, edited uuid, a uuid, b uuid, team uuid, team2 uuid);
  insert into participation_check values(rules_task, program_id, edited_task, a_user, b_user, team, team2);
end $$;
\ir ../supabase/20261120-participation-rules.sql
do $$
declare c record;
begin
  select * into c from participation_check;
  if (select title from tasks where id=c.task) <> 'Правила участия' or (select title from task_programs where id=c.program) <> 'Правила участия'
    or (select description from tasks where id=c.task) not like 'Как проходить «Прокачку»%' then raise exception 'Not renamed'; end if;
  if (select title from tasks where id=c.edited) <> 'Мои правила' or (select description from tasks where id=c.edited) <> 'Свой текст наставника.'
    or (select title from task_programs where id=(select program_id from tasks where id=c.edited)) <> 'Моё название' then raise exception 'Mentor text changed'; end if;
  if (select earned_points + current_step from ready_program_attempts where user_id=c.a and task_id=c.task) <> 0
    or (select state from ready_program_attempts where user_id=c.a and task_id=c.task) <> '{}'::jsonb then raise exception 'Unfinished game kept'; end if;
  if (select earned_points from ready_program_attempts where user_id=c.b and task_id=c.task) <> 5
    or (select status from ready_program_attempts where user_id=c.b and task_id=c.task) <> 'completed' then raise exception 'Finished game changed'; end if;
  if (app_participation_rules(c.b,c.task,'start',null,null)->>'earnedPoints')::int <> 5 then raise exception 'Old passer lost miles'; end if;
end $$;
do $$
declare c record;
begin
  select * into c from participation_check;
  delete from participation_rule_answers where task_id in (select id from tasks where team_id in (c.team, c.team2));
  delete from submissions where task_id in (select id from tasks where team_id in (c.team, c.team2));
  delete from ready_program_attempts where task_id in (select id from tasks where team_id in (c.team, c.team2));
  delete from member_program_progress where user_id in (select id from users where team_id in (c.team, c.team2));
  delete from tasks where team_id in (c.team, c.team2);
  delete from task_programs where team_id in (c.team, c.team2);
  delete from users where team_id in (c.team, c.team2) and role = 'member';
  delete from users where team_id in (c.team, c.team2);
  delete from teams where id in (c.team, c.team2);
end $$;
drop table participation_check;
