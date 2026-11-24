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

-- The migration's data changes: the old standard text is replaced, a mentor's own text stays; a game finished with
-- 4 miles gets the fifth, one with 5 stays as it was, other tasks are untouched, an unfinished one can fix its answer.
-- The migration commits by itself, so these rows are saved and removed again at the end.
do $$
declare team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); four uuid := gen_random_uuid(); five uuid := gen_random_uuid();
  pending uuid := gen_random_uuid(); outcome jsonb; rules_task uuid; plain_task uuid := gen_random_uuid();
begin
  insert into teams(id,name) values(team,'participation-retry-text-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_publish_tasks) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false),
    (four,'Four','Four','Test',four||'@test.invalid',four::text,'test','member',team,mentor,false),
    (five,'Five','Five','Test',five||'@test.invalid',five::text,'test','member',team,mentor,false),
    (pending,'Pending','Pending','Test',pending||'@test.invalid',pending::text,'test','member',team,mentor,false);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила участия','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(
      jsonb_build_object('title','Правила участия','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules',
        'description','Как проходить «Прокачку»: 10 правил участия и 5 вопросов. За каждый верный ответ с первой попытки — 1 миля, всего до 5 миль автоматически.'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid;
  insert into tasks(title,description,team_id,publication_type,interactive_kind) values('Мои правила','Свой текст наставника.',team,'evergreen','starter-rules');
  insert into tasks(id,title,description,team_id,publication_type) values(plain_task,'Plain task','Answer',team,'evergreen');
  -- finished under the old rule: 4 of 5 and 5 of 5; an ordinary task reviewed with 3 miles
  insert into ready_program_attempts(user_id,task_id,status,completed_at,earned_points) values
    (four,rules_task,'completed',now(),4),(five,rules_task,'completed',now(),5);
  insert into submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source) values
    (four,rules_task,'accepted','text','Правила участия: верных ответов 4 из 5.',4,'Зачтено автоматически: 1 миля за каждый верный ответ с первой попытки.',now(),'interactive'),
    (five,rules_task,'accepted','text','Правила участия: верных ответов 5 из 5.',5,'Зачтено автоматически: 1 миля за каждый верный ответ с первой попытки.',now(),'interactive'),
    (four,plain_task,'accepted','text','Answer',3,'Mentor review',now(),'site');
  -- unfinished with a saved wrong answer
  insert into ready_program_attempts(user_id,task_id) values (pending,rules_task);
  insert into participation_rule_answers(user_id,task_id,question,answer) values (pending,rules_task,0,2);
  create temporary table retry_check(team uuid, task uuid, plain uuid, four uuid, five uuid, pending uuid);
  insert into retry_check values(team, rules_task, plain_task, four, five, pending);
end $$;
\ir ../supabase/20261131-participation-rules-retry.sql
-- Running it again changes nothing.
\ir ../supabase/20261131-participation-rules-retry.sql
do $$
declare c record; outcome jsonb;
begin
  select * into c from retry_check;
  if (select count(*) from tasks where team_id=c.team and description like 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов. Ошибку можно исправить:%') <> 1
    or (select count(*) from tasks where team_id=c.team and description = 'Свой текст наставника.') <> 1 then raise exception 'Texts not updated as expected'; end if;
  if (select points from submissions where user_id=c.four and task_id=c.task) <> 5
    or (select comment from submissions where user_id=c.four and task_id=c.task) not like 'Зачтено автоматически: 5 миль. Недостающие мили добавлены%'
    or (select answer_text from submissions where user_id=c.four and task_id=c.task) <> 'Правила участия: верных ответов 4 из 5.'
    or (select status||':'||earned_points from ready_program_attempts where user_id=c.four and task_id=c.task) <> 'completed:5' then raise exception 'Missing mile not added'; end if;
  if (app_participation_rules(c.four,c.task,'start',null,null)->>'earnedPoints')::int <> 5 then raise exception 'The game does not show 5 miles'; end if;
  if (select points||':'||comment from submissions where user_id=c.five and task_id=c.task) <> '5:Зачтено автоматически: 1 миля за каждый верный ответ с первой попытки.'
    then raise exception 'A full result changed'; end if;
  if (select points from submissions where user_id=c.four and task_id=c.plain) <> 3 then raise exception 'Another task changed'; end if;
  if (select count(*) from submissions where task_id=c.task) <> 2 then raise exception 'Extra results'; end if;
  begin
    update submissions set points = 4 where user_id=c.four and task_id=c.task;
    raise exception 'guard is off';
  exception when others then
    if sqlerrm <> 'Interactive submissions are immutable' then raise exception 'The guard was not switched back on: %', sqlerrm; end if;
  end;
  outcome := app_participation_rules(c.pending,c.task,'answer',0,0);
  if (outcome->>'earnedPoints')::int <> 1 or outcome->'rights' <> '{"0":0}'::jsonb then raise exception 'Saved wrong answer cannot be fixed: %', outcome; end if;
  delete from participation_rule_answers where task_id = c.task;
  delete from submissions where task_id in (select id from tasks where team_id = c.team);
  delete from ready_program_attempts where task_id in (select id from tasks where team_id = c.team);
  delete from member_program_progress where user_id in (select id from users where team_id = c.team);
  delete from tasks where team_id = c.team;
  delete from task_programs where team_id = c.team;
  delete from users where team_id = c.team;
  delete from teams where id = c.team;
end $$;
drop table retry_check;
