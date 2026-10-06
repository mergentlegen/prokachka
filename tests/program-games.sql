-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); step_b uuid := gen_random_uuid(); step_c uuid := gen_random_uuid();
  game uuid; result jsonb; sub_b uuid; progress public.member_program_progress%rowtype;
  year jsonb := '{"choices":[0,0,1,1,0,0,1,1,1,0,0,0]}';
begin
  insert into public.teams(id,name) values(team, 'games-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team),
    (outsider,'Outsider','Plain','Member',outsider || '@test.invalid',outsider::text,'test','member',team);
  update public.users set parent_user_id = leader where id in (member_id, outsider);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Старт', 72, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader), (step_b,'B','B',team,10,'sequential',program,2,leader), (step_c,'C','C',team,10,'sequential',program,3,leader);

  -- Adding the game: only the program's managers, once, as the last step, without a deadline of its own.
  assert public.app_program_add_game(outsider, program, 'first-year') ? 'forbidden', 'plain member added a game';
  assert public.app_program_add_game(leader, program, 'unknown') ? 'validationError', 'unknown game added';
  result := public.app_program_add_game(leader, program, 'first-year');
  assert result ? 'data', 'game not added: ' || result;
  game := (result->'data'->>'id')::uuid;
  assert (select position = 4 and max_points = 2 and publication_type = 'sequential' and interactive_kind = 'first-year' from public.tasks where id = game), 'game step stored wrong';
  assert public.app_program_add_game(leader, program, 'first-year') ? 'validationError', 'game added twice';

  -- Reordering: exactly the program's steps; a stale or foreign list is refused.
  assert public.app_program_reorder(outsider, program, array[game, step_a, step_b, step_c]) ? 'forbidden', 'plain member reordered';
  assert public.app_program_reorder(leader, program, array[game, step_a, step_b]) ? 'validationError', 'missing step accepted';
  assert public.app_program_reorder(leader, program, array[game, step_a, step_b, step_b]) ? 'validationError', 'duplicate step accepted';
  assert public.app_program_reorder(leader, program, array[step_a, game, step_b, step_c]) ? 'data', 'reorder failed';
  assert (select array_agg(id order by position) from public.tasks where program_id = program) = array[step_a, game, step_b, step_c], 'order not saved';

  -- The participant finished A; the mentor's acceptance of A moved them to the game, which has no deadline.
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, step_a, now(), now() + interval '72 hours', 'active');
  insert into public.submissions(id, user_id, task_id, media_type, answer_text) values (gen_random_uuid(), member_id, step_a, 'text', 'A done');
  result := public.tg_review_submission((select id from public.submissions where user_id = member_id and task_id = step_a), leader, false, 'accepted', 10, 'Ok', 0);
  assert result ? 'data', 'review failed: ' || result;
  select * into progress from public.member_program_progress where user_id = member_id and program_id = program;
  assert progress.current_task_id = game, 'not moved to the game step';
  assert progress.due_at > now() + interval '50 years', 'game step got a deadline';

  -- The game itself: one month at a time, no leaving the club, two miles at the end, then the next step opens.
  assert public.app_first_year(outsider, game, 'start', 0, '{}') ? 'validationError', 'game open to someone on another step';
  assert public.app_first_year(member_id, game, 'start', 0, '{}')->>'completed' = 'false', 'start failed';
  assert public.app_first_year(member_id, game, 'save', 3, '{"choices":[0,0,1]}') ? 'validationError', 'months skipped';
  assert public.app_first_year(member_id, game, 'complete', 0, '{}') ? 'validationError', 'completed without playing';
  for i in 1..12 loop
    result := public.app_first_year(member_id, game, 'save', i, jsonb_build_object('choices', (select jsonb_agg(value) from (select value from jsonb_array_elements(year->'choices') with ordinality e(value, n) where n <= i) s)));
    assert not result ? 'validationError', 'month ' || i || ' not saved: ' || result;
  end loop;
  -- A year where the participant left the club in month 3 cannot be completed.
  update public.ready_program_attempts set state = jsonb_build_object('yearAnswers', '{"choices":[0,0,0,1,0,0,1,1,1,0,0,0]}'::jsonb) where user_id = member_id and task_id = game;
  assert public.app_first_year(member_id, game, 'complete', 0, '{}') ? 'validationError', 'a broken year was accepted';
  update public.ready_program_attempts set state = jsonb_build_object('yearAnswers', year) where user_id = member_id and task_id = game;
  result := public.app_first_year(member_id, game, 'complete', 0, '{}');
  assert result->>'completed' = 'true' and result->>'earnedPoints' = '2', 'completion failed: ' || result;
  assert (select status = 'accepted' and points = 2 and submission_source = 'interactive' from public.submissions where user_id = member_id and task_id = game), 'two miles not awarded';
  assert (select current_task_id = step_b from public.member_program_progress where user_id = member_id and program_id = program), 'next step did not open';
  assert public.app_first_year(member_id, game, 'start', 0, '{}')->>'completed' = 'true', 'finished game not readable';
  assert (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'game paid twice';

  -- After a reorder puts an already accepted step ahead, the participant is never sent back to it.
  perform public.app_program_reorder(leader, program, array[game, step_b, step_a, step_c]);
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (member_id, step_b, 'text', 'B done') returning id into sub_b;
  result := public.tg_review_submission(sub_b, leader, false, 'accepted', 10, 'Ok', 0);
  assert (select current_task_id = step_c from public.member_program_progress where user_id = member_id and program_id = program), 'sent back to an accepted step';

  assert not has_function_privilege('authenticated', 'public.app_first_year(uuid,uuid,text,integer,jsonb)', 'execute'), 'browser plays directly';
  assert not has_function_privilege('authenticated', 'public.app_program_reorder(uuid,uuid,uuid[])', 'execute'), 'browser reorders';
end $$;
rollback;
