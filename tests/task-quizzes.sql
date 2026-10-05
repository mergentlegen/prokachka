-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); publisher uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid(); video_task uuid := gen_random_uuid(); result jsonb; saved_id uuid;
  quiz jsonb := '[{"id":"q1","kind":"single","prompt":"Сколько?","options":["1","2"],"correct":[1]},{"id":"q2","kind":"text","prompt":"Почему?"}]';
begin
  insert into public.teams(id,name) values(team, 'quiz-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false,'9600000001'),
    (publisher,'Publisher','Branch','Publisher',publisher || '@test.invalid',publisher::text,'test','member',team,true,null),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,false,'9600000002');
  update public.users set parent_user_id = leader where id in (publisher, member_id);
  insert into public.tasks(id,title,description,team_id,max_points,publisher_id) values
    (v_task,'Quiz task','Answer',team,10,leader), (video_task,'Video quiz','Watch',team,10,leader);

  -- Who may change the questions: the team leader, not an ordinary member or a foreign publisher.
  assert public.app_task_quiz_save(member_id, v_task, quiz) ? 'forbidden', 'member changed questions';
  assert public.app_task_quiz_save(publisher, v_task, quiz) ? 'forbidden', 'publisher changed a foreign task';
  assert public.app_task_quiz_save(leader, v_task, quiz) ? 'data', 'leader could not save questions';
  assert (select jsonb_array_length(questions) = 2 from public.task_quizzes where task_id = v_task), 'questions not stored';

  -- Sending from the site creates a normal pending submission: feedback thread and mentor notice included.
  insert into public.task_quiz_drafts(user_id, task_id, answers) values (member_id, v_task, '{"q1":{"choice":[1]}}');
  result := public.app_task_quiz_submit(member_id, v_task, 'Тест: 1 из 1 верно', 1, 1, '{"q1":{"choice":[1]},"q2":{"text":"Потому что"}}');
  assert result ? 'data', 'submit failed: ' || result;
  saved_id := (result->'data'->>'id')::uuid;
  assert (select status = 'pending' and submission_source = 'site' and media_type = 'text' and quiz_score = 1 and quiz_total = 1
    from public.submissions where id = saved_id), 'submission stored wrong';
  assert not exists (select 1 from public.task_quiz_drafts where user_id = member_id and task_id = v_task), 'draft kept after sending';
  assert exists (select 1 from public.feedback_events where submission_id = saved_id and kind = 'submission'), 'no feedback thread event';
  assert exists (select 1 from public.telegram_notification_jobs where submission_id = saved_id and recipient_id = leader and kind = 'submission'), 'mentor not notified';

  -- Nothing can be sent twice while it waits, and again after it is returned for changes.
  assert public.app_task_quiz_submit(member_id, v_task, 'Again', 1, 1, '{}') ? 'validationError', 'second pending submission';
  update public.submissions set status = 'revision', review_version = review_version + 1 where id = saved_id;
  assert public.app_task_quiz_submit(member_id, v_task, 'Fixed', 1, 1, '{}') ? 'data', 'resubmission after revision failed';

  -- A task with a video: the questions open only after the video was watched to the end.
  perform public.app_task_quiz_save(leader, video_task, quiz);
  insert into public.task_videos(task_id, team_id, status, video_path, duration_seconds)
    values (video_task, team, 'ready', team || '/' || video_task || '/' || gen_random_uuid() || '.mp4', 60);
  assert public.app_task_quiz_submit(member_id, video_task, 'Ответы', 1, 1, '{}')->>'validationError' = 'Сначала досмотрите видео до конца.', 'sent without watching';
  insert into public.task_video_views(user_id, task_id, video_path, watched_seconds, completed_at)
    select member_id, video_task, video_path, 60, now() from public.task_videos where task_id = video_task;
  assert public.app_task_quiz_submit(member_id, video_task, 'Ответы', 1, 1, '{}') ? 'data', 'watched video still blocks sending';

  -- No questions: nothing to send from the site; an empty list removes them.
  assert public.app_task_quiz_save(leader, v_task, '[]') ? 'data', 'clearing failed';
  assert not exists (select 1 from public.task_quizzes where task_id = v_task), 'empty list kept questions';
  assert public.app_task_quiz_submit(member_id, v_task, 'x', 0, 0, '{}') ? 'validationError', 'sent to a task without questions';

  assert not has_table_privilege('authenticated', 'public.task_quizzes', 'select'), 'browser reads correct answers';
  assert not has_function_privilege('authenticated', 'public.app_task_quiz_submit(uuid,uuid,text,integer,integer,jsonb)', 'execute'), 'browser submits directly';
end $$;
rollback;
