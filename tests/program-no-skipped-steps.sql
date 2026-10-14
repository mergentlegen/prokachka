-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); walking uuid := gen_random_uuid(); stuck uuid := gen_random_uuid(); done uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); last_step uuid := gen_random_uuid();
  inserted uuid; work uuid; done_work uuid; result jsonb; progress public.member_program_progress%rowtype;
begin
  insert into public.teams(id,name) values(team, 'gaps-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (walking,'Walking','On','Way',walking || '@test.invalid',walking::text,'test','member',team),
    (stuck,'Stuck','Was','Skipped',stuck || '@test.invalid',stuck::text,'test','member',team),
    (done,'Done','All','Steps',done || '@test.invalid',done::text,'test','member',team);
  update public.users set parent_user_id = leader where id in (walking, stuck, done);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Билет', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (s1,'1','1',team,2,'sequential',program,1,leader,48), (s2,'2','2',team,2,'sequential',program,2,leader,48), (last_step,'Тест','Тест',team,2,'sequential',program,3,leader,48);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (walking, program, last_step, now() - interval '1 day', now() + interval '1 day', 'active');
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select walking, t, 'accepted'::public.submission_status, 'text', 'done', 2, now() from unnest(array[s1, s2]) t;
  -- One participant has finished the whole program.
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (done, program, null, now() - interval '5 days', now() - interval '4 days', 'completed', now() - interval '4 days');
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select done, t, 'accepted'::public.submission_status, 'text', 'done', 2, now() from unnest(array[s1, s2, last_step]) t;
  -- The participant has sent the last step and waits for the review.
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (walking, last_step, 'text', 'Тест') returning id into work;

  -- The mentor adds a step and moves it between the second step and the test.
  result := public.app_program_add_step(leader, program, 'Дубликация', 'Описание', null, 2);
  inserted := (result->'data'->>'id')::uuid;
  assert public.app_program_reorder(leader, program, array[s1, s2, inserted, last_step]) ? 'data', 'reorder failed';

  -- Whoever had finished the program gets the new step at once, also after it was moved between the steps.
  select * into progress from public.member_program_progress where user_id = done and program_id = program;
  assert progress.status = 'active' and progress.current_task_id = inserted, 'a finished participant does not see the step added between: ' || row_to_json(progress)::text;
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (done, inserted, 'text', 'Сделал') returning id into done_work;
  result := public.tg_review_submission(done_work, leader, false, 'accepted', 2, 'Ok', 0);
  assert (select status = 'completed' from public.member_program_progress where user_id = done and program_id = program), 'program not finished again';

  -- The test is accepted: the new step opens instead of the program counting as finished.
  result := public.tg_review_submission(work, leader, false, 'accepted', 2, 'Ok', 0);
  select * into progress from public.member_program_progress where user_id = walking and program_id = program;
  assert progress.status = 'active' and progress.current_task_id = inserted, 'the step above was skipped: ' || row_to_json(progress)::text;
  assert abs(extract(epoch from progress.due_at - progress.unlocked_at) - 48 * 3600) < 1, 'the opened step has the wrong deadline';

  -- Once that step is accepted too, the program is finished.
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (walking, inserted, 'text', 'Готово') returning id into work;
  result := public.tg_review_submission(work, leader, false, 'accepted', 2, 'Ok', 0);
  assert (select status = 'completed' and current_task_id is null from public.member_program_progress where user_id = walking and program_id = program), 'program not finished';

  -- Someone already marked as finished with a step left behind gets it back.
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (stuck, program, null, now() - interval '3 days', now() - interval '2 days', 'completed', now() - interval '2 days');
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select stuck, t, 'accepted'::public.submission_status, 'text', 'done', 2, now() from unnest(array[s1, s2, last_step]) t;
  perform public.app_program_catch_up(program, now());
  assert (select status = 'active' and current_task_id = inserted from public.member_program_progress where user_id = stuck and program_id = program), 'skipped step not reopened';
  assert (select status = 'completed' from public.member_program_progress where user_id = walking and program_id = program), 'a finished participant was reopened';
end $$;
rollback;
