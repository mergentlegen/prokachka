-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); finished uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); step_b uuid := gen_random_uuid(); game uuid; result jsonb;
begin
  insert into public.teams(id,name) values(team, 'watch-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team),
    (finished,'Finished','Done','Member',finished || '@test.invalid',finished::text,'test','member',team);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Старт', 72, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader), (step_b,'B','B',team,10,'sequential',program,2,leader);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (finished, program, null, now(), now(), 'completed', now());

  -- Added like the first game: last step, 2 miles, reopened for those who had finished.
  assert public.app_program_add_game(member_id, program, 'safety-watch') ? 'forbidden', 'a participant added a game';
  result := public.app_program_add_game(leader, program, 'safety-watch');
  assert result ? 'data', 'game not added: ' || result;
  game := (result->'data'->>'id')::uuid;
  assert (select title = 'Вахта безопасности' and max_points = 2 and position = 3 and interactive_kind = 'safety-watch' from public.tasks where id = game), 'game stored wrong';
  assert (result->>'reopened')::int = 1, 'finished participant did not get the game';
  assert public.app_program_add_game(leader, program, 'safety-watch') ? 'validationError', 'game added twice';
  assert public.app_program_add_game(leader, program, 'first-year') ? 'data', 'first game no longer available';

  -- Only the participant whose current step is the game can play it.
  assert public.app_safety_watch(member_id, game, 'start', 0, '{}') ? 'validationError', 'game open before its step';
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, game, now(), now() + interval '100 years', 'active');
  assert (public.app_safety_watch(member_id, game, 'start', 0, '{}')->>'step')::int = 0, 'start failed';

  -- Decks go in order, and a deck counts only with every answer right.
  assert public.app_safety_watch(member_id, game, 'save', 2, '{"answers":[0,1,0,1,1,0,1]}') ? 'validationError', 'deck skipped';
  assert public.app_safety_watch(member_id, game, 'save', 1, '{"answers":[1,1,0,1,1,1,1]}') ? 'validationError', 'a wrong answer passed';
  assert public.app_safety_watch(member_id, game, 'save', 1, '{"answers":[0,1,0,1,1,1]}') ? 'validationError', 'a missing answer passed';
  assert public.app_safety_watch(member_id, game, 'complete', 0, '{}') ? 'validationError', 'completed without playing';
  assert (public.app_safety_watch(member_id, game, 'save', 1, '{"answers":[0,1,0,1,1,1,1],"fixes":2,"seen":9}')->>'step')::int = 1, 'deck 1 not saved';
  assert (public.app_safety_watch(member_id, game, 'save', 2, '{"answers":[0,1,0,1,1,0,1],"fixes":2,"seen":16}')->>'step')::int = 2, 'deck 2 not saved';
  assert (public.app_safety_watch(member_id, game, 'save', 3, '{"answers":[1,1,2,1,2,1,1],"fixes":3,"seen":24}')->>'step')::int = 3, 'deck 3 not saved';
  assert public.app_safety_watch(member_id, game, 'complete', 0, '{}') ? 'validationError', 'completed with a deck left';
  assert (public.app_safety_watch(member_id, game, 'save', 4, '{"answers":[1,1,2,0],"fixes":3,"seen":28}')->>'step')::int = 4, 'deck 4 not saved';

  -- Two miles once; the program moves on; the result stays readable.
  result := public.app_safety_watch(member_id, game, 'complete', 0, '{}');
  assert result->>'completed' = 'true' and (result->>'earnedPoints')::int = 2 and (result->'stats'->>'seen')::int = 28, 'completion failed: ' || result;
  assert (select count(*) = 1 and sum(points) = 2 from public.submissions where user_id = member_id and task_id = game and status = 'accepted'), 'miles wrong';
  assert public.app_safety_watch(member_id, game, 'complete', 0, '{}')->>'completed' = 'true', 'finished game not readable';
  assert (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'paid twice';
  assert (select current_task_id is distinct from game from public.member_program_progress where user_id = member_id and program_id = program), 'program did not move on';

  assert not has_function_privilege('authenticated', 'public.app_safety_watch(uuid,uuid,text,integer,jsonb)', 'execute'), 'browser plays directly';
end $$;
rollback;
