-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- A test answered without mistakes is accepted at once; anything a person has to read or hear still waits for a mentor.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); second uuid := gen_random_uuid();
  captain uuid := gen_random_uuid(); climber uuid := gen_random_uuid();
  test_task uuid := gen_random_uuid(); written_task uuid := gen_random_uuid(); voice_task uuid := gen_random_uuid();
  level2_task uuid := gen_random_uuid(); big_task uuid := gen_random_uuid(); old_work uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step1 uuid := gen_random_uuid(); step2 uuid := gen_random_uuid();
  test_only jsonb := '[{"id":"q1","kind":"single","prompt":"Сколько?","options":["1","2"],"correct":[1]},
    {"id":"q2","kind":"multiple","prompt":"Какие?","options":["А","Б","В"],"correct":[0,2]}]';
  with_written jsonb := '[{"id":"q1","kind":"single","prompt":"Сколько?","options":["1","2"],"correct":[1]},{"id":"q2","kind":"text","prompt":"Почему?"}]';
  right_answers jsonb := '{"q1":{"choice":[1]},"q2":{"choice":[2,0]}}';
  result jsonb; saved public.submissions%rowtype; review public.feedback_events%rowtype; progress public.member_program_progress%rowtype;
begin
  insert into public.teams(id,name) values(team, 'auto-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,'9700000001'),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,'9700000002'),
    (second,'Second','Team','Member',second || '@test.invalid',second::text,'test','member',team,'9700000003'),
    (captain,'Captain','Level','Two',captain || '@test.invalid',captain::text,'test','member',team,'9700000004'),
    (climber,'Climber','Almost','Hundred',climber || '@test.invalid',climber::text,'test','member',team,'9700000005');
  update public.users set parent_user_id = leader where id in (member_id, second, captain, climber);
  insert into public.tasks(id,title,description,team_id,max_points,publisher_id,voice_answer,level) values
    (test_task,'Только тест','Ответьте',team,10,leader,false,1),
    (written_task,'Тест и вопрос','Ответьте',team,10,leader,false,1),
    (voice_task,'Тест и голосовое','Ответьте',team,10,leader,true,1),
    (level2_task,'Тест уровня 2','Ответьте',team,7,leader,false,2),
    (big_task,'Большой тест','Ответьте',team,10,leader,false,1),
    (old_work,'Старая работа','Было',team,95,leader,false,1);
  perform public.app_task_quiz_save(leader, t, test_only) from unnest(array[test_task, voice_task, level2_task, big_task]) t;
  perform public.app_task_quiz_save(leader, written_task, with_written);

  -- 1. Only a test, every answer right (the order of choices does not matter): accepted at once with the task's miles.
  insert into public.task_quiz_drafts(user_id, task_id, answers) values (member_id, test_task, right_answers);
  result := public.app_task_quiz_submit(member_id, test_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert result ? 'data', 'submit failed: ' || result::text;
  select * into saved from public.submissions where id = (result->'data'->>'id')::uuid;
  assert saved.status = 'accepted' and saved.points = 10 and saved.auto_accepted and saved.reviewed_at is not null
    and saved.submission_source = 'site' and saved.quiz_score = 2, 'not accepted at once: ' || row_to_json(saved)::text;
  assert result->'data'->>'status' = 'accepted', 'the site is not told it was accepted';
  assert not exists (select 1 from public.task_quiz_drafts where user_id = member_id and task_id = test_task), 'draft kept';
  -- Mentors get no "new work" message: there is nothing to check.
  assert not exists (select 1 from public.telegram_notification_jobs where submission_id = saved.id and kind = 'submission'), 'mentor asked to check an accepted test';
  -- The conversation shows the decision; the participant gets no Telegram message about it and nothing unread.
  select * into review from public.feedback_events where submission_id = saved.id and kind = 'review';
  assert review.review_status = 'accepted' and review.points = 10 and review.author_user_id is null and review.author_name = 'Автопроверка',
    'no automatic decision in the conversation: ' || coalesce(row_to_json(review)::text, 'none');
  assert exists (select 1 from public.feedback_events where submission_id = saved.id and kind = 'submission'), 'the answers are missing from the conversation';
  assert not exists (select 1 from public.telegram_notification_jobs where feedback_event_seq = review.seq and delivered_at is null and cancelled_at is null),
    'the participant is sent a Telegram message about the automatic decision';
  assert (select last_seen_seq >= review.seq from public.feedback_reads where thread_id = review.thread_id and user_id = member_id), 'the decision is unread for the participant';
  assert public.app_task_quiz_submit(member_id, test_task, 'Ещё раз', 2, 2, right_answers) ? 'validationError', 'an accepted test was sent again';

  -- 2. One mistake: the work waits for a mentor, who is told about it.
  result := public.app_task_quiz_submit(second, test_task, 'Тест: 1 из 2 верно', 1, 2, '{"q1":{"choice":[1]},"q2":{"choice":[0]}}');
  select * into saved from public.submissions where id = (result->'data'->>'id')::uuid;
  assert saved.status = 'pending' and saved.points = 0 and not saved.auto_accepted and saved.reviewed_at is null, 'a test with a mistake was accepted';
  assert exists (select 1 from public.telegram_notification_jobs where submission_id = saved.id and recipient_id = leader and kind = 'submission'), 'mentor not told about a test with a mistake';
  assert not exists (select 1 from public.feedback_events where submission_id = saved.id and kind = 'review'), 'a decision was written for a test with a mistake';

  -- 3. A written question needs a person, even when the test part is right.
  result := public.app_task_quiz_submit(member_id, written_task, 'Тест: 1 из 1 верно', 1, 1, '{"q1":{"choice":[1]},"q2":{"text":"Потому что"}}');
  assert (select status = 'pending' and not auto_accepted from public.submissions where id = (result->'data'->>'id')::uuid), 'a written answer was accepted without a mentor';

  -- 4. A voice task needs a person too.
  result := public.app_task_quiz_submit(member_id, voice_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert (select status = 'pending' and not auto_accepted from public.submissions where id = (result->'data'->>'id')::uuid), 'a voice task was accepted without a mentor';

  -- 5. When the server's count and the stored answers disagree, a mentor decides.
  result := public.app_task_quiz_submit(second, big_task, 'Тест: 1 из 2 верно', 1, 2, right_answers);
  assert (select status = 'pending' from public.submissions where id = (result->'data'->>'id')::uuid), 'accepted although the count says one mistake';
  update public.submissions set status = 'revision', review_version = review_version + 1 where user_id = second and task_id = big_task;
  result := public.app_task_quiz_submit(second, big_task, 'Тест: 2 из 2 верно', 2, 2, '{"q1":{"choice":[1]},"q2":{"choice":[0,1,2]}}');
  assert (select status = 'pending' from public.submissions where id = (result->'data'->>'id')::uuid), 'accepted although one answer has an extra choice';
  update public.submissions set status = 'revision', review_version = review_version + 1 where user_id = second and task_id = big_task and status = 'pending';
  -- After a revision a test without mistakes is accepted at once.
  result := public.app_task_quiz_submit(second, big_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert (select status = 'accepted' and auto_accepted from public.submissions where id = (result->'data'->>'id')::uuid), 'a corrected test was not accepted';

  -- 6. A program step: the next step opens at once.
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Программа', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (step1,'Шаг 1','Тест',team,5,'sequential',program,1,leader,48), (step2,'Шаг 2','Дальше',team,5,'sequential',program,2,leader,48);
  perform public.app_task_quiz_save(leader, step1, test_only);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (member_id, program, step1, now() - interval '1 hour', now() + interval '47 hours', 'active');
  result := public.app_task_quiz_submit(member_id, step1, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert (select status = 'accepted' and points = 5 from public.submissions where id = (result->'data'->>'id')::uuid), 'program step not accepted';
  select * into progress from public.member_program_progress where user_id = member_id and program_id = program;
  assert progress.current_task_id = step2 and progress.status = 'active', 'the next step did not open: ' || row_to_json(progress)::text;

  -- 7. Every level: a level 2 participant's level 2 test is accepted the same way.
  insert into public.member_levels(user_id, level, reached_at) values (captain, 2, now() - interval '1 day');
  result := public.app_task_quiz_submit(captain, level2_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert (select status = 'accepted' and points = 7 from public.submissions where id = (result->'data'->>'id')::uuid), 'level 2 test not accepted';

  -- 8. The miles count for the level at once: 95 + 10 moves the participant to level 2.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    values (climber, old_work, 'accepted', 'text', 'Было', 95, now() - interval '1 day');
  assert public.app_member_level(climber) = 1, 'fixture: the participant should start on level 1';
  result := public.app_task_quiz_submit(climber, test_task, 'Тест: 2 из 2 верно', 2, 2, right_answers);
  assert result->'data'->>'status' = 'accepted', 'climber test not accepted';
  assert public.app_member_level(climber) = 2, 'the automatic miles did not count for the level';

  -- 9. A mentor can still return an automatic decision; the mark «автоматически» goes with it.
  select * into saved from public.submissions where user_id = member_id and task_id = test_task;
  result := public.app_feedback_review_submission(saved.id, leader, false, 'revision', 0, 'Перепройдите тест', saved.review_version);
  assert result ? 'data', 'mentor could not return the work: ' || result::text;
  assert (select status = 'revision' and not auto_accepted from public.submissions where id = saved.id), 'the automatic mark stayed after a mentor decision';

  -- The answer check on its own: only choice questions count, every one must match exactly.
  assert public.app_task_quiz_all_right(test_only, right_answers), 'right answers not recognised';
  assert not public.app_task_quiz_all_right('[{"id":"q1","kind":"text","prompt":"?","correct":[0]}]', '{"q1":{"choice":[0],"text":"x"}}'),
    'a written question counts as a test';
  assert not public.app_task_quiz_all_right(test_only, '{"q1":{"choice":[1]}}'), 'an unanswered question counts as right';
  assert not public.app_task_quiz_all_right('[]', '{}'), 'an empty test counts as right';
  assert not has_function_privilege('authenticated', 'public.app_task_quiz_all_right(jsonb,jsonb)', 'execute'), 'browser checks answers directly';
  assert not has_function_privilege('authenticated', 'public.app_task_quiz_submit(uuid,uuid,text,integer,integer,jsonb)', 'execute'), 'browser submits directly';
end $$;
rollback;
