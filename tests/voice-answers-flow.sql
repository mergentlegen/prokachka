-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  quiz_task uuid := gen_random_uuid(); voice_task uuid := gen_random_uuid(); result jsonb; tg text := '840000000000001';
begin
  insert into public.teams(id,name) values(team, 'voice-flow-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id) values
    (mentor,'Наставник','Наставник','Ветки',mentor || '@test.invalid',mentor::text,'test','admin',team,false,null),
    (member,'Алия Бекова','Алия','Бекова',member || '@test.invalid',member::text,'test','member',team,false,tg);
  update public.users set parent_user_id = mentor where id = member;
  insert into public.tasks(id,title,description,team_id,max_points,voice_answer) values
    (quiz_task,'Тест и рассказ','Ответь и запиши',team,10,true),(voice_task,'Расскажи о себе','Голосовое',team,10,true);
  insert into public.task_quizzes(task_id,questions) values(quiz_task,'[{"id":"q1","kind":"text","prompt":"Что запомнил?"}]');
  insert into public.task_quiz_drafts(user_id,task_id,answers) values(member,quiz_task,'{"q1":{"text":"Многое"}}');

  -- The test is checked without saving anything.
  assert public.app_task_quiz_check(member, quiz_task, '1. Многое') is null, 'a valid test was refused';
  assert public.app_task_quiz_check(member, quiz_task, '  ') = 'Ответы не заполнены.', 'empty answers accepted';
  assert public.app_task_quiz_check(member, voice_task, 'x') is not null, 'a task without questions passed the test check';

  -- A voice task with a test cannot be answered by a voice alone.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('bare-' || member,member,quiz_task,tg,now() + interval '30 minutes');
  perform public.tg_begin_submission('bare-' || member, tg, 100);
  result := public.tg_submit_answer(tg,tg,101,8400000001,'voice','','voice-0');
  assert result->>'validationError' like '%Сначала ответьте на вопросы теста%', 'the test was skipped: ' || result::text;

  -- With the test kept on the link: the bot knows it, wrong types are refused with a hint, the voice saves both.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,metadata) values('quiz-' || member,member,quiz_task,tg,now() + interval '30 minutes',
    jsonb_build_object('quiz', jsonb_build_object('text','1. Что запомнил?' || chr(10) || 'Многое','score',0,'total',0,'answers','{"q1":{"text":"Многое"}}'::jsonb)));
  result := public.tg_begin_submission('quiz-' || member, tg, 200);
  assert (result->>'quiz')::boolean and (result->>'voice')::boolean and result->>'title' = 'Тест и рассказ' and result ? 'expiresAt', 'the bot is not told about the test: ' || result::text;
  assert exists(select 1 from public.telegram_notification_jobs where kind = 'submission-timeout' and payload->>'session' = 'quiz-' || member and available_at > now() + interval '29 minutes'), 'no timeout notice planned';
  result := public.tg_submit_answer(tg,tg,201,8400000002,'text','Текст',null);
  assert result->>'validationError' like '%только голосовое%' and result->>'validationError' like '%Отправьте ещё раз%', 'no hint and retry: ' || result::text;
  assert not exists(select 1 from public.submissions where task_id = quiz_task), 'a wrong message created a work';
  result := public.tg_submit_answer(tg,tg,202,8400000003,'voice','','voice-1');
  assert result ? 'data', 'the voice was refused: ' || result::text;
  assert (select media_type = 'voice' and telegram_file_id = 'voice-1' and answer_text like '%Многое%' and quiz_answers ? 'q1' and status = 'pending'
    from public.submissions where user_id = member and task_id = quiz_task), 'the work lacks the test answers or the voice';
  assert not exists(select 1 from public.task_quiz_drafts where user_id = member and task_id = quiz_task), 'the draft stayed after sending';

  -- After 30 minutes nothing can be sent on the old link; the bot says the time is over.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('late-' || member,member,voice_task,tg,now() + interval '30 minutes');
  perform public.tg_begin_submission('late-' || member, tg, 300);
  update public.telegram_submission_sessions set expires_at = now() - interval '1 minute' where token_hash = 'late-' || member;
  result := public.tg_submit_answer(tg,tg,301,8400000004,'voice','','voice-2');
  assert result->>'validationError' like '⏰%', 'an expired link took the answer: ' || result::text;
  assert not exists(select 1 from public.submissions where task_id = voice_task), 'the expired answer was saved';
end;
$$;
rollback;
