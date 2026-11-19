-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- The step a participant works on is always their first step not passed, in the mentor's order.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid();
  ahead uuid := gen_random_uuid(); waiting uuid := gen_random_uuid(); opened uuid := gen_random_uuid(); hidden uuid := gen_random_uuid(); archived uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  inserted uuid; work uuid; result jsonb; progress public.member_program_progress%rowtype; old_unlock timestamptz := now() - interval '5 days';
begin
  insert into public.teams(id,name) values(team, 'first-open-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (ahead,'Ahead','On','Step2',ahead || '@test.invalid',ahead::text,'test','member',team),
    (waiting,'Waiting','For','Review',waiting || '@test.invalid',waiting::text,'test','member',team),
    (opened,'Opened','Link','Only',opened || '@test.invalid',opened::text,'test','member',team),
    (hidden,'Hidden','Step','Member',hidden || '@test.invalid',hidden::text,'test','member',team),
    (archived,'Archived','Level','Two',archived || '@test.invalid',archived::text,'test','member',team);
  update public.users set parent_user_id = leader where id <> leader and team_id = team;
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Готов', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (s1,'1','1',team,2,'sequential',program,1,leader,48), (s2,'2','2',team,2,'sequential',program,2,leader,48), (s3,'3','3',team,2,'sequential',program,3,leader,48);
  -- Everyone has passed step 1 and stands on step 2, with an expired deadline.
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    select u, program, s2, old_unlock, old_unlock + interval '48 hours', 'active' from unnest(array[ahead, waiting, opened, hidden, archived]) u;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select u, s1, 'accepted'::public.submission_status, 'text', 'done', 2, now() from unnest(array[ahead, waiting, opened, hidden, archived]) u;
  -- One has sent step 2 and waits for the review; one only opened the Telegram link, nothing was sent.
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (waiting, s2, 'text', 'Ответ') returning id into work;
  insert into public.submissions(user_id, task_id, answer_text) values (opened, s2, '');
  -- One is already on level 2: this level 1 program is their archive.
  insert into public.member_levels(user_id, level, reached_at) values (archived, 2, now() - interval '1 day');

  -- The mentor adds a step and puts it first.
  result := public.app_program_add_step(leader, program, 'Готов ли ты?', 'Описание', null, 2);
  inserted := (result->'data'->>'id')::uuid;
  assert (select current_task_id = s2 from public.member_program_progress where user_id = ahead and program_id = program), 'a step added at the end must not move anyone';
  assert public.app_program_reorder(leader, program, array[inserted, s1, s2, s3]) ? 'data', 'reorder failed';

  select * into progress from public.member_program_progress where user_id = ahead and program_id = program;
  assert progress.status = 'active' and progress.current_task_id = inserted, 'the new first step is not current: ' || row_to_json(progress)::text;
  assert progress.unlocked_at > old_unlock and abs(extract(epoch from progress.due_at - progress.unlocked_at) - 48 * 3600) < 1, 'the new step has no fresh deadline';
  assert (select current_task_id = inserted from public.member_program_progress where user_id = opened and program_id = program), 'an opened link without an answer must not hold the participant';
  assert (select current_task_id = s2 from public.member_program_progress where user_id = waiting and program_id = program), 'a work waiting for review must keep its step';
  assert (select current_task_id = s2 and unlocked_at = old_unlock from public.member_program_progress where user_id = archived and program_id = program), 'an archived program must not change';
  assert public.app_program_realign(program, now()) = 0, 'running it again must change nothing';

  -- The waiting work is accepted: the first step not passed opens.
  result := public.tg_review_submission(work, leader, false, 'accepted', 2, 'Ok', 0);
  assert (select current_task_id = inserted from public.member_program_progress where user_id = waiting and program_id = program), 'after the review the new first step must open';

  -- The participant who passed the new step goes on to step 2 as before.
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (ahead, inserted, 'text', 'Готов') returning id into work;
  result := public.tg_review_submission(work, leader, false, 'accepted', 2, 'Ok', 0);
  assert (select current_task_id = s2 from public.member_program_progress where user_id = ahead and program_id = program), 'after the new step comes step 2';

  -- A hidden current step does not leave the participant without a step; shown again, it is current again.
  update public.member_program_progress set current_task_id = s2 where user_id = hidden and program_id = program;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (hidden, inserted, 'accepted', 'text', 'done', 2, now());
  update public.tasks set is_active = false where id = s2;
  assert (select current_task_id = s3 from public.member_program_progress where user_id = hidden and program_id = program), 'a hidden current step must give way to the next one';
  update public.tasks set is_active = true where id = s2;
  assert (select current_task_id = s2 from public.member_program_progress where user_id = hidden and program_id = program), 'a step shown again must be current again';

  -- A new order that puts a passed step first changes nothing for those who passed it.
  assert public.app_program_reorder(leader, program, array[s1, inserted, s2, s3]) ? 'data', 'second reorder failed';
  assert (select current_task_id = s2 from public.member_program_progress where user_id = ahead and program_id = program), 'a passed step must never open again';
end $$;
rollback;
