-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- «Тренажёр «Я подумаю»» (20261125): three dialogue rounds, one sorting round, 1 mile once, the voice to the mentors.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); finished uuid := gen_random_uuid();
  other uuid := gen_random_uuid(); program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); game uuid; result jsonb; saved_id uuid;
begin
  insert into public.teams(id,name) values(team, 'pd-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,null),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,leader),
    (finished,'Finished','Done','Member',finished || '@test.invalid',finished::text,'test','member',team,leader),
    (other,'Other','Other','Member',other || '@test.invalid',other::text,'test','member',team,leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Возражения', 72, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id) values
    (step_a,'A','A',team,10,'sequential',program,1,leader);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (finished, program, null, now(), now(), 'completed', now());
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    values (finished, step_a, 'accepted', 'text', 'done', 10, now());

  -- Added like the other program games: last step, 1 mile, once per program, reopened for those who had finished.
  assert public.app_program_add_game(member_id, program, 'podumayu') ? 'forbidden', 'a participant added the trainer';
  result := public.app_program_add_game(leader, program, 'podumayu');
  assert result ? 'data', 'trainer not added: ' || result::text;
  game := (result->'data'->>'id')::uuid;
  assert (select title = 'Тренажёр «Я подумаю»' and max_points = 1 and position = 2 and interactive_kind = 'podumayu'
    and description like '4 раунда о самом частом возражении%' from public.tasks where id = game), 'trainer stored wrong';
  assert (result->>'reopened')::int = 1, 'finished participant did not get the trainer';
  assert public.app_program_add_game(leader, program, 'podumayu') ? 'validationError', 'trainer added twice';
  foreach result in array array[public.app_program_add_game(leader, program, 'final-voyage-1'), public.app_program_add_game(leader, program, 'marketing-director'),
    public.app_program_add_game(leader, program, 'free-membership'), public.app_program_add_game(leader, program, 'safety-watch'),
    public.app_program_add_game(leader, program, 'first-year')] loop
    assert result ? 'data', 'an earlier program game is no longer available: ' || result::text;
  end loop;
  assert public.app_ready_program_spec('final-voyage-1')->'answers' = '[0,2,1,2,0,2,2,0,1,2,0]'::jsonb, 'final voyage key lost';
  assert public.app_ready_program_spec('starter-rules')->'answers' = '[0,0,0,0,0]'::jsonb, 'participation rules key lost';
  assert (public.app_ready_program_spec('dream-plan')->>'reward')::int = 5, 'dream plan reward lost';
  -- the earlier games now come after the trainer; keep the trainer the participant's current step
  update public.tasks set position = position + 10 where program_id = program and interactive_kind is distinct from 'podumayu' and id <> step_a;

  -- Only the participant whose current step is the trainer can play it.
  assert public.app_podumayu(member_id, game, 'start', 0, '{}') ? 'validationError', 'trainer open before its step';
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, game, now(), now() + interval '100 years', 'active');
  result := public.app_podumayu(member_id, game, 'start', 0, '{}');
  assert (result->>'step')::int = 0 and (result->>'mistakes')::int = 0 and result->'keys' = 'null'::jsonb and result->>'completed' = 'false'
    and result->'marks' = '{}'::jsonb, 'bad start: ' || result::text;
  assert public.app_podumayu(member_id, game, 'jump', 0, '{}') ? 'validationError', 'unknown action passed';
  assert public.app_complete_ready_program(member_id, game) ? 'validationError', 'generic completion opened the trainer';
  assert public.app_podumayu(other, game, 'start', 0, '{}') ? 'validationError', 'a participant on another step opened the trainer';
  assert public.app_final_voyage(member_id, game, 'start', 0, '{}') ? 'validationError', 'another game''s actions opened the trainer';

  -- A wrong option is a mistake and the round stays; the right one opens the next. Only the current round is answered.
  result := public.app_podumayu(member_id, game, 'answer', 0, '{"answer":0}');
  assert result->>'right' = 'false' and (result->>'step')::int = 0 and (result->>'mistakes')::int = 1 and result->'log' = '{"0":1}'::jsonb, 'wrong first answer: ' || result::text;
  result := public.app_podumayu(member_id, game, 'answer', 0, '{"answer":3}');
  assert result->>'right' = 'false' and (result->>'mistakes')::int = 2 and result->'log' = '{"0":2}'::jsonb, 'option 3 not checked: ' || result::text;
  assert public.app_podumayu(member_id, game, 'answer', 1, '{"answer":2}') ? 'validationError', 'a later round was answered';
  assert public.app_podumayu(member_id, game, 'answer', 0, '{"answer":4}') ? 'validationError', 'option 4 accepted';
  assert public.app_podumayu(member_id, game, 'answer', 0, '{}') ? 'validationError', 'empty answer accepted';
  assert public.app_podumayu(member_id, game, 'mark', 0, '{"item":0,"good":true}') ? 'validationError', 'a phrase marked in a dialogue round';
  result := public.app_podumayu(member_id, game, 'answer', 0, '{"answer":2}');
  assert result->>'right' = 'true' and (result->>'step')::int = 1, 'right answer did not move on';
  assert public.app_podumayu(member_id, game, 'answer', 0, '{"answer":2}') ? 'validationError', 'a passed round answered again (second window)';
  result := public.app_podumayu(member_id, game, 'answer', 1, '{"answer":2}');
  assert (result->>'step')::int = 2, 'round 2 did not pass';
  result := public.app_podumayu(member_id, game, 'answer', 2, '{"answer":2}');
  assert (result->>'step')::int = 3 and (result->>'mistakes')::int = 2, 'round 3 did not pass: ' || result::text;

  -- The sorting round: every phrase once; a wrong mark is counted, a second mark of the same phrase changes nothing.
  assert public.app_podumayu(member_id, game, 'answer', 3, '{"answer":0}') ? 'validationError', 'the sorting round was answered as a dialogue';
  assert public.app_podumayu(member_id, game, 'mark', 3, '{"item":4,"good":true}') ? 'validationError', 'phrase 4 accepted';
  assert public.app_podumayu(member_id, game, 'mark', 3, '{"item":0,"good":"yes"}') ? 'validationError', 'a mark without true/false accepted';
  assert public.app_podumayu(member_id, game, 'complete', 0, '{}') ? 'validationError', 'finished before the finish';
  result := public.app_podumayu(member_id, game, 'mark', 3, '{"item":1,"good":true}');
  assert result->>'right' = 'false' and (result->>'mistakes')::int = 3 and result->'log' = '{"0":2,"3":1}'::jsonb
    and result->'marks' = '{"1":{"good":true,"right":false}}'::jsonb and (result->>'step')::int = 3, 'wrong mark: ' || result::text;
  result := public.app_podumayu(member_id, game, 'mark', 3, '{"item":1,"good":false}');
  assert result->>'right' = 'true' and (result->>'mistakes')::int = 3 and result->'marks'->'1' = '{"good":true,"right":false}'::jsonb, 'a second mark changed the first: ' || result::text;
  perform public.app_podumayu(member_id, game, 'mark', 3, '{"item":0,"good":true}');
  perform public.app_podumayu(member_id, game, 'mark', 3, '{"item":2,"good":true}');
  result := public.app_podumayu(member_id, game, 'mark', 3, '{"item":3,"good":false}');
  assert (result->>'step')::int = 4 and result->>'completed' = 'false' and result->'keys' = 'null'::jsonb, 'finish not reached: ' || result::text;
  assert public.app_podumayu(member_id, game, 'mark', 4, '{"item":0,"good":true}') ? 'validationError', 'marked after the finish';
  assert not exists (select 1 from public.submissions where user_id = member_id and task_id = game), 'the mile before «Забрать милю»';
  assert public.tg_company_voice_error(member_id, game) is not null, 'voice before the finish';

  -- The finish: 1 mile once, the mistakes for the mentor, the program moves on, the keys come for the material.
  result := public.app_podumayu(member_id, game, 'complete', 0, '{}');
  saved_id := (result->'submission'->>'id')::uuid;
  assert result->>'completed' = 'true' and (result->'submission'->>'points')::int = 1 and (result->>'earnedPoints')::int = 1, 'bad finish: ' || result::text;
  assert result->'keys' = '{"answers":[2,2,2],"sort":[true,false,true,false]}'::jsonb, 'keys not given after the finish';
  assert result->'submission'->>'answer_text' = 'Тренажёр «Я подумаю» пройден. Ошибок: 3.', 'mentor text: ' || (result->'submission'->>'answer_text');
  assert (select current_task_id is distinct from game from public.member_program_progress where user_id = member_id and program_id = program), 'the program did not move on';
  result := public.app_podumayu(member_id, game, 'complete', 0, '{}');
  assert (result->'submission'->>'id')::uuid = saved_id and (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'mile twice';
  result := public.app_podumayu(member_id, game, 'answer', 0, '{"answer":1}');
  assert (result->>'mistakes')::int = 3 and result->'right' = 'null'::jsonb and (result->>'step')::int = 4, 'a passed trainer changed';

  -- The voice: once, from the participant, delivered to the mentors of the branch only.
  assert public.tg_company_voice_error(member_id, game) is null, 'voice refused after the finish: ' || public.tg_company_voice_error(member_id, game);
  assert public.tg_company_voice_error(other, game) is not null, 'a participant without the trainer may send a voice';
  assert not public.tg_can_receive_company_voice(leader, saved_id), 'a voice delivered before it was recorded';
  update public.submissions set company_voice_file_id = 'file', company_voice_chat_id = '1', company_voice_message_id = 1 where id = saved_id;
  assert public.tg_can_receive_company_voice(leader, saved_id), 'the mentor does not get the voice';
  assert not public.tg_can_receive_company_voice(other, saved_id), 'another participant gets the voice';
  assert public.tg_company_voice_error(member_id, game) like 'Голосовое уже сохранено%', 'a second voice allowed';

  assert not has_function_privilege('anon', 'public.app_podumayu(uuid,uuid,text,integer,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.app_podumayu(uuid,uuid,text,integer,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.app_podumayu(uuid,uuid,text,integer,jsonb)', 'execute'), 'wrong privileges';
end $$;
rollback;
