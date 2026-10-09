-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); done_one uuid := gen_random_uuid(); done_two uuid := gen_random_uuid();
  walking uuid := gen_random_uuid(); lost uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); step_b uuid := gen_random_uuid(); step_c uuid := gen_random_uuid(); step_d uuid := gen_random_uuid();
  progress public.member_program_progress%rowtype;
begin
  insert into public.teams(id,name) values(team, 'catch-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    select id, 'User', 'Catch', 'Up', id || '@test.invalid', id::text, 'test', (case when id = leader then 'admin' else 'member' end)::public.user_role, team
    from unnest(array[leader, done_one, done_two, walking, lost]) id;
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Старт', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader), (step_b,'B','B',team,10,'sequential',program,2,leader);
  -- Two finished the program, one is on step A, one lost their step (it was deleted).
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select u, t, 'accepted'::public.submission_status, 'text', 'done', 10, now()
    from unnest(array[done_one, done_two]) u, unnest(array[step_a, step_b]) t;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (lost, step_a, 'accepted', 'text', 'done', 10, now());
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (done_one, program, null, now() - interval '9 days', now() - interval '7 days', 'completed', now() - interval '8 days'),
    (done_two, program, null, now() - interval '9 days', now() - interval '7 days', 'completed', now() - interval '8 days'),
    (walking, program, step_a, now() - interval '1 day', now() + interval '1 day', 'active', null),
    (lost, program, null, now() - interval '1 day', now() + interval '1 day', 'active', null);

  -- A step added in any way (here straight into the table) opens for everyone who had finished, with a fresh deadline.
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours)
    values (step_c,'C','C',team,10,'sequential',program,3,leader,48);
  select * into progress from public.member_program_progress where user_id = done_one and program_id = program;
  assert progress.status = 'active' and progress.current_task_id = step_c and progress.completed_at is null, 'finished participant did not get the new step';
  assert progress.unlocked_at > now() - interval '1 minute' and abs(extract(epoch from progress.due_at - progress.unlocked_at) - 48 * 3600) < 1, 'new step has the wrong deadline';
  assert (select current_task_id = step_a from public.member_program_progress where user_id = walking), 'participant on the way was moved';
  assert (select current_task_id = step_b and status = 'active' from public.member_program_progress where user_id = lost), 'participant without a step was not given the next one';

  -- A hidden step changes nothing until it is shown; «Показать» opens it.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (done_two, step_c, 'accepted', 'text', 'done', 10, now());
  update public.member_program_progress set status = 'completed', current_task_id = null where user_id = done_two;
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,is_active)
    values (step_d,'D','D',team,10,'sequential',program,4,leader,false);
  assert (select status = 'completed' from public.member_program_progress where user_id = done_two), 'a hidden step was opened';
  update public.tasks set is_active = true where id = step_d;
  assert (select current_task_id = step_d and status = 'active' from public.member_program_progress where user_id = done_two), 'a shown step was not opened';

  -- Nothing new: running the catch-up again opens nothing.
  assert public.app_program_catch_up(program, now()) = 0, 'catch-up repeated';
  assert not has_function_privilege('authenticated', 'public.app_program_catch_up(uuid,timestamptz)', 'execute'), 'browser moves participants';
end $$;
rollback;
