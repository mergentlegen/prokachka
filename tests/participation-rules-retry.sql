\set ON_ERROR_STOP on
-- «Правила участия» (20261131): a wrong answer can be changed until it is right, the right option is told only after a
-- right answer, all 5 miles come once when every answer is right, mistakes are counted.
begin;
do $$
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); second uuid := gen_random_uuid();
  rules_task uuid; outcome jsonb; saved_id uuid; i integer;
begin
  insert into teams(id,name) values(team,'participation-retry-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor,false),
    (second,'Second','Second','Test',second||'@test.invalid',second::text,'test','member',team,mentor,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила участия','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Правила участия','description','Правила и 5 вопросов.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid;

  if not (app_participation_rules(member_id,rules_task,'answer',5,0) ? 'validationError')
    or not (app_participation_rules(member_id,rules_task,'answer',0,3) ? 'validationError') then raise exception 'Bad answer accepted'; end if;

  -- a wrong answer: red, no right option told, no mile
  outcome := app_participation_rules(member_id,rules_task,'answer',0,2);
  if outcome->'answers' <> '{"0":2}'::jsonb or outcome->'rights' <> '{}'::jsonb or (outcome->>'earnedPoints')::int <> 0 then
    raise exception 'Bad wrong answer: %', outcome; end if;
  -- the same wrong option again is not a new mistake; another wrong one is
  perform app_participation_rules(member_id,rules_task,'answer',0,2);
  outcome := app_participation_rules(member_id,rules_task,'answer',0,1);
  if outcome->'answers' <> '{"0":1}'::jsonb or outcome->'rights' <> '{}'::jsonb then raise exception 'Second wrong answer not saved: %', outcome; end if;
  if (select mistakes from participation_rule_answers where user_id=member_id and task_id=rules_task and question=0) <> 2 then raise exception 'Bad mistakes count'; end if;
  -- the fix: right now, the option is told and the mile counts
  outcome := app_participation_rules(member_id,rules_task,'answer',0,0);
  if outcome->'answers' <> '{"0":0}'::jsonb or outcome->'rights' <> '{"0":0}'::jsonb or (outcome->>'earnedPoints')::int <> 1 then
    raise exception 'Fixed answer not counted: %', outcome; end if;
  -- a right answer stays right
  outcome := app_participation_rules(member_id,rules_task,'answer',0,2);
  if outcome->'answers' <> '{"0":0}'::jsonb or (outcome->>'earnedPoints')::int <> 1 then raise exception 'Right answer changed: %', outcome; end if;

  -- four answered, one wrong: not finished, no miles yet
  perform app_participation_rules(member_id,rules_task,'answer',1,0);
  perform app_participation_rules(member_id,rules_task,'answer',2,0);
  perform app_participation_rules(member_id,rules_task,'answer',3,0);
  outcome := app_participation_rules(member_id,rules_task,'answer',4,1);
  if outcome->>'completed' <> 'false' or (outcome->>'earnedPoints')::int <> 4 or outcome->'rights' ? '4' then raise exception 'Finished with a wrong answer: %', outcome; end if;
  if exists(select 1 from submissions where user_id=member_id and task_id=rules_task) then raise exception 'Miles before all answers are right'; end if;

  -- the last fix finishes the game with all 5 miles
  outcome := app_participation_rules(member_id,rules_task,'answer',4,0);
  saved_id := (outcome->'submission'->>'id')::uuid;
  if outcome->>'completed' <> 'true' or (outcome->>'earnedPoints')::int <> 5 or (outcome->'submission'->>'points')::int <> 5
    or outcome->'submission'->>'status' <> 'accepted' or outcome->'rights' <> '{"0":0,"1":0,"2":0,"3":0,"4":0}'::jsonb then raise exception 'Bad finish: %', outcome; end if;
  if outcome->'submission'->>'answer_text' <> 'Правила участия: все 5 ответов верные. Ошибок: 3.' then raise exception 'Bad result text: %', outcome->'submission'->>'answer_text'; end if;
  if (select status||':'||earned_points from ready_program_attempts where user_id=member_id and task_id=rules_task) <> 'completed:5' then raise exception 'Attempt not finished'; end if;

  -- finished: nothing changes any more
  outcome := app_participation_rules(member_id,rules_task,'answer',3,1);
  if (outcome->>'earnedPoints')::int <> 5 or (outcome->'submission'->>'id')::uuid is distinct from saved_id
    or (select count(*) from submissions where user_id=member_id and task_id=rules_task) <> 1
    or (select answer from participation_rule_answers where user_id=member_id and task_id=rules_task and question=3) <> 0 then raise exception 'Finished game changed'; end if;

  -- all wrong first, then all right: still 5 miles
  for i in 0..4 loop perform app_participation_rules(second,rules_task,'answer',i,2); end loop;
  if (select count(*) from submissions where user_id=second and task_id=rules_task) <> 0 then raise exception 'All wrong finished the game'; end if;
  for i in 0..4 loop outcome := app_participation_rules(second,rules_task,'answer',i,0); end loop;
  if outcome->>'completed' <> 'true' or (outcome->'submission'->>'points')::int <> 5 then raise exception 'All fixed: %', outcome; end if;

  if has_function_privilege('anon','app_participation_rules(uuid,uuid,text,integer,integer)','execute')
    or has_function_privilege('authenticated','app_participation_rules(uuid,uuid,text,integer,integer)','execute')
    or not has_function_privilege('service_role','app_participation_rules(uuid,uuid,text,integer,integer)','execute') then raise exception 'Wrong privileges'; end if;
end $$;
rollback;

-- The new text: the old standard one is replaced, a mentor's own text stays. The migration commits by itself,
-- so these rows are saved and removed again at the end.
do $$
declare team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); outcome jsonb;
begin
  insert into teams(id,name) values(team,'participation-retry-text-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила участия','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(
      jsonb_build_object('title','Правила участия','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules',
        'description','Как проходить «Прокачку»: 10 правил участия и 5 вопросов. За каждый верный ответ с первой попытки — 1 миля, всего до 5 миль автоматически.'))));
  insert into tasks(title,description,team_id,publication_type,interactive_kind) values('Мои правила','Свой текст наставника.',team,'evergreen','starter-rules');
  create temporary table retry_check(team uuid);
  insert into retry_check values(team);
end $$;
\ir ../supabase/20261131-participation-rules-retry.sql
do $$
declare c record;
begin
  select * into c from retry_check;
  if (select count(*) from tasks where team_id=c.team and description like 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов. Ошибку можно исправить:%') <> 1
    or (select count(*) from tasks where team_id=c.team and description = 'Свой текст наставника.') <> 1 then raise exception 'Texts not updated as expected'; end if;
  delete from tasks where team_id = c.team;
  delete from task_programs where team_id = c.team;
  delete from users where team_id = c.team;
  delete from teams where id = c.team;
end $$;
drop table retry_check;
