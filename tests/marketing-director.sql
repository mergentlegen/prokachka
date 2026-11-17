-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); finished uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); game uuid; result jsonb;
begin
  insert into public.teams(id,name) values(team, 'md-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team),
    (finished,'Finished','Done','Member',finished || '@test.invalid',finished::text,'test','member',team);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Старт', 72, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (finished, program, null, now(), now(), 'completed', now());
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    values (finished, step_a, 'accepted', 'text', 'done', 10, now());

  -- Added like the other program games: last step, 2 miles, once per program, reopened for those who had finished.
  assert public.app_program_add_game(member_id, program, 'marketing-director') ? 'forbidden', 'a participant added a game';
  result := public.app_program_add_game(leader, program, 'marketing-director');
  assert result ? 'data', 'game not added: ' || result::text;
  game := (result->'data'->>'id')::uuid;
  assert (select title = 'Путь к Маркетинг директору' and max_points = 2 and position = 2 and interactive_kind = 'marketing-director' from public.tasks where id = game), 'game stored wrong';
  assert (result->>'reopened')::int = 1, 'finished participant did not get the game';
  assert public.app_program_add_game(leader, program, 'marketing-director') ? 'validationError', 'game added twice';
  assert public.app_program_add_game(leader, program, 'free-membership') ? 'data', 'free membership no longer available';
  assert public.app_program_add_game(leader, program, 'safety-watch') ? 'data', 'safety watch no longer available';
  assert public.app_program_add_game(leader, program, 'first-year') ? 'data', 'first year no longer available';
  assert public.app_program_add_game(leader, program, 'captain-cruise') ? 'validationError', 'a catalog game went into a program';
  assert public.app_ready_program_spec('free-membership')->'answers' = '[1,1,1,1,0]'::jsonb, 'free membership spec lost';

  -- Only the participant whose current step is the game can play it; the other trainer's function does not open it.
  assert public.app_marketing_director(member_id, game, 'start', 0, '{}') ? 'validationError', 'game open before its step';
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, game, now(), now() + interval '100 years', 'active');
  assert (public.app_marketing_director(member_id, game, 'start', 0, '{}')->>'step')::int = 0, 'start failed';
  assert public.app_free_membership(member_id, game, 'start', 0, '{}') ? 'validationError', 'the other trainer opened this game';
  assert public.app_marketing_director(member_id, game, 'jump', 0, '{}') ? 'validationError', 'unknown action passed';
  assert public.app_complete_ready_program(member_id, game) ? 'validationError', 'generic completion opened the trainer';

  -- Missions go in order; a mission with a question (4, 5, 6) counts only with its right answer.
  assert public.app_marketing_director(member_id, game, 'save', 2, '{}') ? 'validationError', 'mission skipped';
  assert (public.app_marketing_director(member_id, game, 'save', 1, '{"errors":1,"log":{"m1":1}}')->>'step')::int = 1, 'mission 1 not saved';
  assert (public.app_marketing_director(member_id, game, 'save', 2, '{}')->>'step')::int = 2, 'mission 2 not saved';
  assert (public.app_marketing_director(member_id, game, 'save', 3, '{}')->>'step')::int = 3, 'mission 3 not saved';
  assert public.app_marketing_director(member_id, game, 'save', 4, '{"answer":0}') ? 'validationError', 'a wrong answer passed';
  assert public.app_marketing_director(member_id, game, 'save', 4, '{}') ? 'validationError', 'a missing answer passed';
  assert (public.app_marketing_director(member_id, game, 'save', 4, '{"answer":1}')->>'step')::int = 4, 'mission 4 not saved';
  assert public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[0,1,1,1]}') ? 'validationError', 'completed with missions left';
  assert public.app_marketing_director(member_id, game, 'save', 5, '{"answer":2}') ? 'validationError', 'a wrong answer passed on mission 5';
  assert (public.app_marketing_director(member_id, game, 'save', 5, '{"answer":1}')->>'step')::int = 5, 'mission 5 not saved';
  assert public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[0,1,1,1]}') ? 'validationError', 'completed before the sixth mission';
  assert (public.app_marketing_director(member_id, game, 'save', 1, '{}')->>'step')::int = 5, 'replay moved the step back';
  -- Only known small numbers are kept: m7 and q5 do not exist in this trainer.
  result := public.app_marketing_director(member_id, game, 'save', 6, '{"answer":1,"errors":3,"hints":1,"log":{"m2":2,"m6":1,"m7":4,"q5":1,"x":5,"q1":"lots"}}');
  assert (result->>'step')::int = 6 and result->'stats' = '{"errors":3,"hints":1,"log":{"m2":2,"m6":1}}'::jsonb, 'stats stored wrong: ' || result::text;
  assert public.app_marketing_director(member_id, game, 'save', 7, '{}') ? 'validationError', 'a mission beyond the sixth passed';

  -- The check counts only with every answer right; then two miles once and the program moves on.
  assert public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[1,1,1,1]}') ? 'validationError', 'a wrong check passed';
  assert public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[1,1,1,1,0]}') ? 'validationError', 'the other trainer check passed';
  assert public.app_marketing_director(member_id, game, 'complete', 0, '{}') ? 'validationError', 'an empty check passed';
  assert public.app_marketing_director(member_id, game, 'complete', 0, '"x"') ? 'validationError', 'a broken payload passed';
  result := public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[0,1,1,1],"errors":4,"hints":1,"log":{"m2":2,"m6":1,"q3":1}}');
  assert result->>'completed' = 'true' and (result->>'earnedPoints')::int = 2 and (result->>'step')::int = 6 and (result->'stats'->>'errors')::int = 4, 'completion failed: ' || result::text;
  assert result->'submission'->>'submission_source' = 'interactive', 'no interactive submission returned';
  assert (select count(*) = 1 and sum(points) = 2 from public.submissions where user_id = member_id and task_id = game and status = 'accepted'), 'miles wrong';
  result := public.app_marketing_director(member_id, game, 'complete', 0, '{"answers":[0,1,1,1]}');
  assert result->>'completed' = 'true' and result->'stats'->'log' = '{"m2":2,"m6":1,"q3":1}'::jsonb, 'finished game not readable';
  assert (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'paid twice';
  assert (select current_task_id is distinct from game from public.member_program_progress where user_id = member_id and program_id = program), 'program did not move on';

  assert not has_function_privilege('authenticated', 'public.app_marketing_director(uuid,uuid,text,integer,jsonb)', 'execute'), 'browser plays directly';
  assert not has_function_privilege('anon', 'public.app_marketing_director_stats(jsonb)', 'execute'), 'helper open to the browser';
  assert not has_function_privilege('authenticated', 'public.app_marketing_director_key(integer)', 'execute'), 'key open to the browser';
end $$;
rollback;
