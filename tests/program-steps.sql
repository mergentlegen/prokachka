-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); author uuid := gen_random_uuid(); finished uuid := gen_random_uuid(); walking uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); step_b uuid := gen_random_uuid(); added uuid; game uuid; result jsonb;
  progress public.member_program_progress%rowtype;
begin
  insert into public.teams(id,name) values(team, 'steps-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false),
    (author,'Author','Branch','Author',author || '@test.invalid',author::text,'test','member',team,true),
    (finished,'Finished','Done','Member',finished || '@test.invalid',finished::text,'test','member',team,false),
    (walking,'Walking','On','Way',walking || '@test.invalid',walking::text,'test','member',team,false);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Старт', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (step_a,'A','A',team,10,'sequential',program,1,leader,48), (step_b,'B','B',team,10,'sequential',program,2,leader,48);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (finished, program, null, now() - interval '9 days', now() - interval '7 days', 'completed', now() - interval '8 days'),
    (walking, program, step_a, now() - interval '1 day', now() + interval '1 day', 'active', null);
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select finished, t, 'accepted'::public.submission_status, 'text', 'done', 10, now() from unnest(array[step_a, step_b]) t;

  -- Only the program's managers may add steps, and the text is checked.
  assert public.app_program_add_step(author, program, 'Новый шаг', 'Описание', null, 5) ? 'forbidden', 'another author added a step';
  assert public.app_program_add_step(finished, program, 'Новый шаг', 'Описание', null, 5) ? 'forbidden', 'a participant added a step';
  assert public.app_program_add_step(leader, program, ' ', 'Описание', null, 5) ? 'validationError', 'empty title accepted';
  assert public.app_program_add_step(leader, program, 'Новый шаг', 'Описание', null, -1) ? 'validationError', 'negative miles accepted';

  -- The step goes to the end with the program's time per step.
  result := public.app_program_add_step(leader, program, '  Новый шаг ', ' Описание ', 'https://youtu.be/x', 5);
  assert result ? 'data', 'step not added: ' || result::text;
  added := (result->'data'->>'id')::uuid;
  assert (select position = 3 and title = 'Новый шаг' and description = 'Описание' and max_points = 5 and publication_type = 'sequential'
    and deadline_hours = 48 and resource_url = 'https://youtu.be/x' and publisher_id = leader and deadline_at is null and is_active from public.tasks where id = added), 'step stored wrong';

  -- Whoever had finished the program gets the new step with a fresh deadline; others keep their place.
  assert (result->>'reopened')::int = 1, 'reopened count wrong: ' || result::text;
  select * into progress from public.member_program_progress where user_id = finished and program_id = program;
  assert progress.status = 'active' and progress.current_task_id = added and progress.completed_at is null, 'finished participant not reopened';
  assert progress.unlocked_at > now() - interval '1 minute' and abs(extract(epoch from progress.due_at - progress.unlocked_at) - 48 * 3600) < 1, 'reopened step has the wrong deadline';
  assert (select current_task_id = step_a and status = 'active' from public.member_program_progress where user_id = walking and program_id = program), 'participant on the way was moved';

  -- A ready game added later reopens the program too, without a deadline.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (finished, added, 'accepted', 'text', 'done', 5, now());
  update public.member_program_progress set status = 'completed', current_task_id = null, completed_at = now() where user_id = finished and program_id = program;
  result := public.app_program_add_game(leader, program, 'first-year');
  game := (result->'data'->>'id')::uuid;
  assert (select current_task_id = game and status = 'active' and due_at > now() + interval '50 years' from public.member_program_progress where user_id = finished and program_id = program), 'game did not reopen the program';

  -- A branch author manages only their own program.
  update public.task_programs set publisher_id = author where id = program;
  assert public.app_program_add_step(author, program, 'Шаг автора', 'Описание', null, 0) ? 'data', 'the author could not add a step';

  assert not has_function_privilege('authenticated', 'public.app_program_add_step(uuid,uuid,text,text,text,integer)', 'execute'), 'browser adds steps directly';
  assert not has_function_privilege('authenticated', 'public.app_program_reopen(uuid,timestamptz)', 'execute'), 'browser reopens programs';
end $$;
rollback;
