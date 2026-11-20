-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- The mentor's texts after a test-only task: a mistake returns the work at once with the mentor's text,
-- a test without mistakes is accepted with the other text; both stay in the conversation.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
  walker uuid := gen_random_uuid();
  test_task uuid := gen_random_uuid(); plain_task uuid := gen_random_uuid(); voice_task uuid := gen_random_uuid(); written_task uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step1 uuid := gen_random_uuid(); step2 uuid := gen_random_uuid();
  questions jsonb := '[{"id":"q1","kind":"single","prompt":"Сколько?","options":["1","2"],"correct":[1]},
    {"id":"q2","kind":"multiple","prompt":"Какие?","options":["А","Б","В"],"correct":[0,2]}]';
  with_written jsonb := '[{"id":"q1","kind":"single","prompt":"Сколько?","options":["1","2"],"correct":[1]},{"id":"q2","kind":"text","prompt":"Почему?"}]';
  right_answers jsonb := '{"q1":{"choice":[1]},"q2":{"choice":[0,2]}}';
  wrong_answers jsonb := '{"q1":{"choice":[0]},"q2":{"choice":[0,2]}}';
  other_wrong jsonb := '{"q1":{"choice":[1]},"q2":{"choice":[0]}}';
  fail_text text := 'Пересмотри видео и пройди тест ещё раз.'; pass_text text := 'Отлично! Ты разобрался в теме.';
  result jsonb; saved public.submissions%rowtype; review public.feedback_events%rowtype; first_id uuid;
begin
  insert into public.teams(id,name) values(team, 'quiz-texts-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,'9710000001'),
    (m1,'First','Team','Member',m1 || '@test.invalid',m1::text,'test','member',team,'9710000002'),
    (m2,'Second','Team','Member',m2 || '@test.invalid',m2::text,'test','member',team,'9710000003'),
    (m3,'Third','Team','Member',m3 || '@test.invalid',m3::text,'test','member',team,'9710000004'),
    (walker,'Walker','In','Program',walker || '@test.invalid',walker::text,'test','member',team,'9710000005');
  update public.users set parent_user_id = leader where id <> leader and team_id = team;
  insert into public.tasks(id,title,description,team_id,max_points,publisher_id,voice_answer,level) values
    (test_task,'Только тест','Ответьте',team,10,leader,false,1), (plain_task,'Тест без текстов','Ответьте',team,10,leader,false,1),
    (voice_task,'Тест и голосовое','Ответьте',team,10,leader,true,1), (written_task,'Тест и вопрос','Ответьте',team,10,leader,false,1);

  -- Saving: texts go with the questions; null leaves them as they are, '' clears; too long is refused.
  assert public.app_task_quiz_save(leader, test_task, questions, pass_text, fail_text) ? 'data', 'save failed';
  assert public.app_task_quiz_save(leader, test_task, questions) ? 'data', 'an older page saving only questions failed';
  assert (select q.pass_text = pass_text and q.fail_text = fail_text from public.task_quizzes q where task_id = test_task), 'questions alone must keep the texts';
  assert public.app_task_quiz_save(leader, test_task, questions, repeat('а', 1001), fail_text) ? 'validationError', 'a too long text was saved';
  assert public.app_task_quiz_save(m1, test_task, questions, 'x', 'y') ? 'forbidden', 'a participant changed the texts';
  perform public.app_task_quiz_save(leader, plain_task, questions, 'Будет стёрт', 'Будет стёрт');
  perform public.app_task_quiz_save(leader, plain_task, questions, '', '');
  assert (select q.pass_text = '' and q.fail_text = '' from public.task_quizzes q where task_id = plain_task), 'empty texts did not clear';
  perform public.app_task_quiz_save(leader, voice_task, questions, pass_text, fail_text);
  perform public.app_task_quiz_save(leader, written_task, with_written, pass_text, fail_text);

  -- 1. A mistake: back for revision at once with the mentor's text, no miles, no mentor asked, the text in the conversation.
  result := public.app_task_quiz_submit(m1, test_task, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  assert result ? 'data' and (result->>'returned')::boolean and result->>'message' = fail_text, 'the site is not told about the return: ' || result::text;
  select * into saved from public.submissions where id = (result->'data'->>'id')::uuid;
  first_id := saved.id;
  assert saved.status = 'revision' and saved.points = 0 and saved.auto_accepted and saved.reviewed_at is not null and saved.comment = fail_text,
    'not returned with the text: ' || row_to_json(saved)::text;
  assert not exists (select 1 from public.telegram_notification_jobs where submission_id = saved.id and kind = 'submission'), 'a mentor was asked to check a returned test';
  select * into review from public.feedback_events where submission_id = saved.id and kind = 'review';
  assert review.review_status = 'revision' and review.body = fail_text and review.author_name = 'Автопроверка' and review.author_user_id is null,
    'the text is not in the conversation: ' || coalesce(row_to_json(review)::text, 'none');
  assert not exists (select 1 from public.telegram_notification_jobs where feedback_event_seq = review.seq and delivered_at is null and cancelled_at is null),
    'the participant is sent a Telegram message';
  assert (select last_seen_seq >= review.seq from public.feedback_reads where thread_id = review.thread_id and user_id = m1), 'the text is unread for the participant';

  -- The same wrong answers again (a double tap) give the same return, not a second one.
  result := public.app_task_quiz_submit(m1, test_task, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  assert (result->'data'->>'id')::uuid = first_id and (result->>'returned')::boolean, 'the same answers made a second return';
  assert (select count(*) from public.submissions where user_id = m1 and task_id = test_task) = 1, 'a second work was saved';
  -- Other wrong answers: a new try, returned again.
  result := public.app_task_quiz_submit(m1, test_task, 'Тест: 1 из 2 верно', 1, 2, other_wrong);
  assert (result->'data'->>'id')::uuid <> first_id and result->'data'->>'status' = 'revision', 'a new wrong try was not returned';
  -- The test without mistakes: accepted with the miles and the success text.
  result := public.app_task_quiz_submit(m1, test_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  select * into saved from public.submissions where id = (result->'data'->>'id')::uuid;
  assert saved.status = 'accepted' and saved.points = 10 and saved.comment = pass_text and result->>'message' = pass_text and not (result->>'returned')::boolean,
    'not accepted with the text: ' || row_to_json(saved)::text;
  assert (select body = pass_text from public.feedback_events where submission_id = saved.id and kind = 'review'), 'the success text is not in the conversation';
  assert public.app_task_quiz_submit(m1, test_task, 'Ещё', 1, 2, wrong_answers) ? 'validationError', 'an accepted test was sent again';

  -- 2. No texts written: a mistake waits for a mentor as before; a right test gets the usual words.
  result := public.app_task_quiz_submit(m2, plain_task, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  assert result->'data'->>'status' = 'pending' and not (result->>'returned')::boolean and result->'message' = 'null'::jsonb, 'no text must keep the mentor review: ' || result::text;
  assert exists (select 1 from public.telegram_notification_jobs where submission_id = (result->'data'->>'id')::uuid and recipient_id = leader and kind = 'submission'), 'the mentor was not told';
  result := public.app_task_quiz_submit(m3, plain_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert result->'data'->>'status' = 'accepted' and result->'data'->>'comment' = '' and result->>'message' = 'Тест пройден без ошибок — засчитано автоматически.', 'usual words missing';

  -- 3. A voice message or a written question needs a person even with texts written.
  result := public.app_task_quiz_submit(m2, voice_task, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  assert result->'data'->>'status' = 'pending' and not (result->>'returned')::boolean, 'a voice task was returned automatically';
  result := public.app_task_quiz_submit(m2, written_task, 'Тест: 0 из 1 верно', 0, 1, '{"q1":{"choice":[0]},"q2":{"text":"Потому что"}}');
  assert result->'data'->>'status' = 'pending' and not (result->>'returned')::boolean, 'a written answer was returned automatically';

  -- 4. A mentor may still decide on a returned work; the automatic mark goes away.
  result := public.app_task_quiz_submit(m3, test_task, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  select * into saved from public.submissions where id = (result->'data'->>'id')::uuid;
  result := public.tg_review_submission(saved.id, leader, false, 'accepted', 5, 'Засчитываю', saved.review_version);
  assert result ? 'data', 'a mentor could not decide on a returned work: ' || result::text;
  assert (select status = 'accepted' and points = 5 and not auto_accepted from public.submissions where id = saved.id), 'a mentor review kept the automatic mark';

  -- 5. A program step: a mistake keeps the step, the right test opens the next one.
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Тесты', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (step1,'Тест','Ответьте',team,2,'sequential',program,1,leader,48), (step2,'Дальше','Дальше',team,2,'sequential',program,2,leader,48);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (walker, program, step1, now(), now() + interval '2 days', 'active');
  perform public.app_task_quiz_save(leader, step1, questions, pass_text, fail_text);
  result := public.app_task_quiz_submit(walker, step1, 'Тест: 1 из 2 верно', 1, 2, wrong_answers);
  assert result->'data'->>'status' = 'revision', 'the step test was not returned';
  assert (select current_task_id = step1 from public.member_program_progress where user_id = walker and program_id = program), 'a returned step must stay current';
  result := public.app_task_quiz_submit(walker, step1, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert result->'data'->>'status' = 'accepted', 'the step test was not accepted';
  assert (select current_task_id = step2 from public.member_program_progress where user_id = walker and program_id = program), 'the next step did not open';
end $$;
rollback;
