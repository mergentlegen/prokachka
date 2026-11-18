-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- «Финальный рейс уровня 1» (20261121): a wrong answer moves one step back, the dream form, 5 miles once, the voice to the mentors.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); finished uuid := gen_random_uuid();
  other uuid := gen_random_uuid(); program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); game uuid; result jsonb; saved_id uuid;
  keys integer[] := array[0,2,1,2,0,2,2,0,1,null,2,0]; i integer;
  dream jsonb := '{"what":"Круиз всей семьёй","price":"$6 000","when":"лето 2028"}';
begin
  insert into public.teams(id,name) values(team, 'fv-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,null),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,leader),
    (finished,'Finished','Done','Member',finished || '@test.invalid',finished::text,'test','member',team,leader),
    (other,'Other','Other','Member',other || '@test.invalid',other::text,'test','member',team,leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Уровень 1', 72, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (finished, program, null, now(), now(), 'completed', now());
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    values (finished, step_a, 'accepted', 'text', 'done', 10, now());

  -- Added like the other program games: last step, 5 miles, once per program, reopened for those who had finished.
  assert public.app_program_add_game(member_id, program, 'final-voyage-1') ? 'forbidden', 'a participant added a game';
  result := public.app_program_add_game(leader, program, 'final-voyage-1');
  assert result ? 'data', 'game not added: ' || result::text;
  game := (result->'data'->>'id')::uuid;
  assert (select title = 'Финальный рейс уровня 1' and max_points = 5 and position = 2 and interactive_kind = 'final-voyage-1'
    and description like 'Проверь себя в жизненных ситуациях%' from public.tasks where id = game), 'game stored wrong';
  assert (result->>'reopened')::int = 1, 'finished participant did not get the game';
  assert public.app_program_add_game(leader, program, 'final-voyage-1') ? 'validationError', 'game added twice';
  foreach result in array array[public.app_program_add_game(leader, program, 'marketing-director'), public.app_program_add_game(leader, program, 'free-membership'),
    public.app_program_add_game(leader, program, 'safety-watch'), public.app_program_add_game(leader, program, 'first-year')] loop
    assert result ? 'data', 'an earlier program game is no longer available: ' || result::text;
  end loop;
  assert public.app_ready_program_spec('starter-rules')->'answers' = '[0,0,0,0,0]'::jsonb, 'participation rules key lost';
  assert public.app_ready_program_spec('marketing-director')->'answers' = '[0,1,1,1]'::jsonb, 'marketing director key lost';
  -- the earlier games now come after the voyage; keep the voyage the participant's current step
  update public.tasks set position = position + 10 where program_id = program and interactive_kind is distinct from 'final-voyage-1' and id <> step_a;

  -- Only the participant whose current step is the game can play it.
  assert public.app_final_voyage(member_id, game, 'start', 0, '{}') ? 'validationError', 'game open before its step';
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, game, now(), now() + interval '100 years', 'active');
  result := public.app_final_voyage(member_id, game, 'start', 0, '{}');
  assert (result->>'step')::int = 0 and (result->>'mistakes')::int = 0 and result->'keys' = 'null'::jsonb and result->>'completed' = 'false', 'bad start: ' || result::text;
  assert public.app_final_voyage(member_id, game, 'jump', 0, '{}') ? 'validationError', 'unknown action passed';
  assert public.app_complete_ready_program(member_id, game) ? 'validationError', 'generic completion opened the game';
  assert public.app_final_voyage(other, game, 'start', 0, '{}') ? 'validationError', 'a participant on another step opened the game';

  -- Wrong: a mistake and one step back (never below 0); right: one step forward. Only the current step is answered.
  result := public.app_final_voyage(member_id, game, 'answer', 0, '{"answer":1}');
  assert result->>'right' = 'false' and (result->>'step')::int = 0 and (result->>'mistakes')::int = 1 and result->'log' = '{"0":1}'::jsonb, 'wrong first answer: ' || result::text;
  assert public.app_final_voyage(member_id, game, 'answer', 1, '{"answer":0}') ? 'validationError', 'a later step was answered';
  assert public.app_final_voyage(member_id, game, 'answer', 0, '{"answer":3}') ? 'validationError', 'option 3 accepted';
  assert public.app_final_voyage(member_id, game, 'answer', 0, '{}') ? 'validationError', 'empty answer accepted';
  result := public.app_final_voyage(member_id, game, 'answer', 0, '{"answer":0}');
  assert result->>'right' = 'true' and (result->>'step')::int = 1, 'right answer did not move on';
  result := public.app_final_voyage(member_id, game, 'answer', 1, '{"answer":0}');
  assert (result->>'step')::int = 0 and (result->>'mistakes')::int = 2 and result->'log' = '{"0":1,"1":1}'::jsonb, 'wrong answer did not move back';
  for i in 0..8 loop
    result := public.app_final_voyage(member_id, game, 'answer', i, jsonb_build_object('answer', keys[i + 1]));
    assert (result->>'step')::int = i + 1, 'step ' || i || ' did not pass: ' || result::text;
  end loop;

  -- The dream form (step 9): three filled lines; questions and the finish wait for it.
  assert public.app_final_voyage(member_id, game, 'answer', 9, '{"answer":0}') ? 'validationError', 'the dream step was answered as a question';
  assert public.app_final_voyage(member_id, game, 'complete', 0, '{}') ? 'validationError', 'finished before the finish';
  assert public.app_final_voyage(member_id, game, 'dream', 9, '{"what":"Круиз","price":" ","when":"2028"}') ? 'validationError', 'empty dream line accepted';
  assert public.app_final_voyage(member_id, game, 'dream', 9, jsonb_build_object('what', repeat('я', 121), 'price', '1', 'when', '2')) ? 'validationError', 'long dream accepted';
  result := public.app_final_voyage(member_id, game, 'dream', 9, dream);
  assert (result->>'step')::int = 10 and result->'dream' = dream, 'dream not saved: ' || result::text;
  -- a mistake right after the dream opens the form again, filled in
  result := public.app_final_voyage(member_id, game, 'answer', 10, '{"answer":0}');
  assert (result->>'step')::int = 9 and (result->>'mistakes')::int = 3 and result->'dream' = dream, 'back to the dream failed';
  perform public.app_final_voyage(member_id, game, 'dream', 9, dream);
  perform public.app_final_voyage(member_id, game, 'answer', 10, '{"answer":2}');
  result := public.app_final_voyage(member_id, game, 'answer', 11, '{"answer":0}');
  assert (result->>'step')::int = 12 and result->>'completed' = 'false', 'finish not reached';
  assert public.app_final_voyage(member_id, game, 'answer', 12, '{"answer":0}') ? 'validationError', 'answered after the finish';
  assert not exists (select 1 from public.submissions where user_id = member_id and task_id = game), 'miles before «Да, понятно»';

  -- The voice waits for the miles.
  assert public.tg_company_voice_error(member_id, game) is not null, 'voice before the finish';

  -- «Да, понятно»: 5 miles once, the dream and the mistakes for the mentor, the program moves on.
  result := public.app_final_voyage(member_id, game, 'complete', 0, '{}');
  saved_id := (result->'submission'->>'id')::uuid;
  assert result->>'completed' = 'true' and (result->'submission'->>'points')::int = 5 and (result->>'earnedPoints')::int = 5, 'bad finish: ' || result::text;
  assert result->'keys' = '[0,2,1,2,0,2,2,0,1,2,0]'::jsonb, 'keys not given after the finish';
  assert result->'submission'->>'answer_text' = 'Финальный рейс уровня 1 пройден. Ошибок: 3. Мечта: Круиз всей семьёй · стоит: $6 000 · срок: лето 2028.', 'mentor text: ' || (result->'submission'->>'answer_text');
  assert (select current_task_id is distinct from game from public.member_program_progress where user_id = member_id and program_id = program), 'the program did not move on';
  result := public.app_final_voyage(member_id, game, 'complete', 0, '{}');
  assert (result->'submission'->>'id')::uuid = saved_id and (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'miles twice';
  result := public.app_final_voyage(member_id, game, 'answer', 3, '{"answer":1}');
  assert (result->>'mistakes')::int = 3 and result->'right' = 'null'::jsonb and (result->>'step')::int = 12, 'a passed game changed';

  -- The voice: once, from the participant, delivered to the mentors of the branch only.
  assert public.tg_company_voice_error(member_id, game) is null, 'voice refused after the finish: ' || public.tg_company_voice_error(member_id, game);
  assert public.tg_company_voice_error(other, game) is not null, 'a participant without the game may send a voice';
  assert not public.tg_can_receive_company_voice(leader, saved_id), 'a voice delivered before it was recorded';
  update public.submissions set company_voice_file_id = 'file', company_voice_chat_id = '1', company_voice_message_id = 1 where id = saved_id;
  assert public.tg_can_receive_company_voice(leader, saved_id), 'the mentor does not get the voice';
  assert not public.tg_can_receive_company_voice(other, saved_id), 'another participant gets the voice';
  assert public.tg_company_voice_error(member_id, game) like 'Голосовое уже сохранено%', 'a second voice allowed';

  assert not has_function_privilege('anon', 'public.app_final_voyage(uuid,uuid,text,integer,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.app_final_voyage(uuid,uuid,text,integer,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.app_final_voyage(uuid,uuid,text,integer,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.tg_can_receive_company_voice(uuid,uuid)', 'execute'), 'wrong privileges';
end $$;
rollback;
