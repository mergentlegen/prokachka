-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- «Тренажёр «Семья против»» (20261135): five dialogue rounds, one sorting round of six phrases, 1 mile once, the voice to the mentors.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); finished uuid := gen_random_uuid();
  other uuid := gen_random_uuid(); program uuid := gen_random_uuid(); step_a uuid := gen_random_uuid(); game uuid; result jsonb; saved_id uuid;
  round integer; right_option integer;
begin
  insert into public.teams(id,name) values(team, 'bl-' || team);
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
  assert public.app_program_add_game(member_id, program, 'semya') ? 'forbidden', 'a participant added the trainer';
  result := public.app_program_add_game(leader, program, 'semya');
  assert result ? 'data', 'trainer not added: ' || result::text;
  game := (result->'data'->>'id')::uuid;
  assert (select title = 'Тренажёр «Семья против»' and max_points = 1 and position = 2 and interactive_kind = 'semya'
    and description like '6 раундов о возражении «Муж / семья против»%' from public.tasks where id = game), 'trainer stored wrong';
  assert (result->>'reopened')::int = 1, 'finished participant did not get the trainer';
  assert public.app_program_add_game(leader, program, 'semya') ? 'validationError', 'trainer added twice';
  -- The earlier games stay in the catalog with their keys.
  foreach result in array array[public.app_program_add_game(leader, program, 'podumayu'), public.app_program_add_game(leader, program, 'dorogo'), public.app_program_add_game(leader, program, 'piramida'), public.app_program_add_game(leader, program, 'garantii'), public.app_program_add_game(leader, program, 'bally'), public.app_program_add_game(leader, program, 'deshevle'), public.app_program_add_game(leader, program, 'strah'), public.app_program_add_game(leader, program, 'vremya'), public.app_program_add_game(leader, program, 'final-voyage-1'),
    public.app_program_add_game(leader, program, 'marketing-director'), public.app_program_add_game(leader, program, 'free-membership')] loop
    assert result ? 'data', 'an earlier program game is no longer available: ' || result::text;
  end loop;
  assert public.app_ready_program_spec('garantii') = '{"steps":6,"reward":1,"answers":[1,2,3,1,1],"sort":[true,false,true,false,true,false]}'::jsonb, 'garantii key lost';
  assert public.app_ready_program_spec('bally') = '{"steps":6,"reward":1,"answers":[1,2,1,2,1],"sort":[true,false,true,false,true,false]}'::jsonb, 'bally key lost';
  assert public.app_ready_program_spec('deshevle') = '{"steps":6,"reward":1,"answers":[1,3,1,2,2],"sort":[true,false,true,false,true,false]}'::jsonb, 'deshevle key lost';
  assert public.app_ready_program_spec('strah') = '{"steps":6,"reward":1,"answers":[2,1,2,1,3],"sort":[true,false,true,false,true,false]}'::jsonb, 'strah key lost';
  assert public.app_ready_program_spec('vremya') = '{"steps":6,"reward":1,"answers":[1,2,1,2,3],"sort":[true,false,true,false,true,false]}'::jsonb, 'vremya key lost';
  assert public.app_ready_program_spec('piramida') = '{"steps":6,"reward":1,"answers":[1,2,1,1,2],"sort":[true,false,true,false,true,false]}'::jsonb, 'piramida key lost';
  assert public.app_ready_program_spec('dorogo') = '{"steps":6,"reward":1,"answers":[1,2,1,2,1],"sort":[true,false,true,false,true,false]}'::jsonb, 'dorogo key lost';
  assert public.app_ready_program_spec('podumayu') = '{"steps":4,"reward":1,"answers":[2,2,2],"sort":[true,false,true,false]}'::jsonb, 'podumayu key lost';
  assert public.app_ready_program_spec('final-voyage-1')->'answers' = '[0,2,1,2,0,2,2,0,1,2,0]'::jsonb, 'final voyage key lost';
  assert (public.app_ready_program_spec('dream-plan')->>'reward')::int = 5, 'dream plan reward lost';
  update public.tasks set position = position + 10 where program_id = program and interactive_kind is distinct from 'semya' and id <> step_a;

  -- Only the participant whose current step is the trainer can play it.
  assert public.app_semya(member_id, game, 'start', 0, '{}') ? 'validationError', 'trainer open before its step';
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
    values (member_id, program, game, now(), now() + interval '100 years', 'active');
  result := public.app_semya(member_id, game, 'start', 0, '{}');
  assert (result->>'step')::int = 0 and (result->>'mistakes')::int = 0 and result->'keys' = 'null'::jsonb and result->>'completed' = 'false'
    and result->'marks' = '{}'::jsonb, 'bad start: ' || result::text;
  assert public.app_semya(other, game, 'start', 0, '{}') ? 'validationError', 'a participant on another step opened the trainer';
  assert public.app_podumayu(member_id, game, 'start', 0, '{}') ? 'validationError', '«Я подумаю» actions opened «Семья против»';
  assert public.app_complete_ready_program(member_id, game) ? 'validationError', 'generic completion opened the trainer';

  -- Round 1: a wrong option is a mistake and the round stays; only the current round is answered.
  result := public.app_semya(member_id, game, 'answer', 0, '{"answer":0}');
  assert result->>'right' = 'false' and (result->>'step')::int = 0 and (result->>'mistakes')::int = 1 and result->'log' = '{"0":1}'::jsonb, 'wrong first answer: ' || result::text;
  assert public.app_semya(member_id, game, 'answer', 1, '{"answer":2}') ? 'validationError', 'a later round was answered';
  assert public.app_semya(member_id, game, 'answer', 0, '{"answer":4}') ? 'validationError', 'option 4 accepted';
  assert public.app_semya(member_id, game, 'mark', 0, '{"item":0,"good":true}') ? 'validationError', 'a phrase marked in a dialogue round';
  -- The five dialogue rounds pass with their right options 2, 1, 2, 1, 3.
  round := 0;
  foreach right_option in array array[2, 1, 2, 1, 3] loop
    result := public.app_semya(member_id, game, 'answer', round, jsonb_build_object('answer', right_option));
    assert result->>'right' = 'true' and (result->>'step')::int = round + 1, 'round ' || round || ' did not pass: ' || result::text;
    round := round + 1;
  end loop;
  assert public.app_semya(member_id, game, 'answer', 4, '{"answer":1}') ? 'validationError', 'a passed round answered again (second window)';

  -- The sorting round: six phrases, each once; a wrong mark is counted, a second mark changes nothing.
  assert public.app_semya(member_id, game, 'answer', 5, '{"answer":0}') ? 'validationError', 'the sorting round was answered as a dialogue';
  assert public.app_semya(member_id, game, 'mark', 5, '{"item":6,"good":true}') ? 'validationError', 'phrase 6 accepted';
  assert public.app_semya(member_id, game, 'complete', 0, '{}') ? 'validationError', 'finished before the finish';
  result := public.app_semya(member_id, game, 'mark', 5, '{"item":5,"good":true}');
  assert result->>'right' = 'false' and (result->>'mistakes')::int = 2 and result->'log' = '{"0":1,"5":1}'::jsonb
    and result->'marks' = '{"5":{"good":true,"right":false}}'::jsonb and (result->>'step')::int = 5, 'wrong mark: ' || result::text;
  result := public.app_semya(member_id, game, 'mark', 5, '{"item":5,"good":false}');
  assert (result->>'mistakes')::int = 2 and result->'marks'->'5' = '{"good":true,"right":false}'::jsonb, 'a second mark changed the first: ' || result::text;
  perform public.app_semya(member_id, game, 'mark', 5, '{"item":0,"good":true}');
  perform public.app_semya(member_id, game, 'mark', 5, '{"item":1,"good":false}');
  perform public.app_semya(member_id, game, 'mark', 5, '{"item":2,"good":true}');
  result := public.app_semya(member_id, game, 'mark', 5, '{"item":3,"good":false}');
  assert (result->>'step')::int = 5, 'the round ended before every phrase was marked';
  result := public.app_semya(member_id, game, 'mark', 5, '{"item":4,"good":true}');
  assert (result->>'step')::int = 6 and result->>'completed' = 'false' and result->'keys' = 'null'::jsonb, 'finish not reached: ' || result::text;
  assert not exists (select 1 from public.submissions where user_id = member_id and task_id = game), 'the mile before «Забрать милю»';
  assert public.tg_company_voice_error(member_id, game) is not null, 'voice before the finish';

  -- The finish: 1 mile once, the mistakes for the mentor, the program moves on, the keys come for the material.
  result := public.app_semya(member_id, game, 'complete', 0, '{}');
  saved_id := (result->'submission'->>'id')::uuid;
  assert result->>'completed' = 'true' and (result->'submission'->>'points')::int = 1 and (result->>'earnedPoints')::int = 1, 'bad finish: ' || result::text;
  assert result->'keys' = '{"answers":[2,1,2,1,3],"sort":[true,false,true,false,true,false]}'::jsonb, 'keys not given after the finish';
  assert result->'submission'->>'answer_text' = 'Тренажёр «Семья против» пройден. Ошибок: 2.', 'mentor text: ' || (result->'submission'->>'answer_text');
  assert (select current_task_id is distinct from game from public.member_program_progress where user_id = member_id and program_id = program), 'the program did not move on';
  result := public.app_semya(member_id, game, 'complete', 0, '{}');
  assert (result->'submission'->>'id')::uuid = saved_id and (select count(*) from public.submissions where user_id = member_id and task_id = game) = 1, 'mile twice';

  -- The voice: once, from the participant, delivered to the mentors of the branch only.
  assert public.tg_company_voice_error(member_id, game) is null, 'voice refused after the finish: ' || public.tg_company_voice_error(member_id, game);
  assert public.tg_company_voice_error(other, game) is not null, 'a participant without the trainer may send a voice';
  update public.submissions set company_voice_file_id = 'file', company_voice_chat_id = '1', company_voice_message_id = 1 where id = saved_id;
  assert public.tg_can_receive_company_voice(leader, saved_id), 'the mentor does not get the voice';
  assert not public.tg_can_receive_company_voice(other, saved_id), 'another participant gets the voice';

  assert not has_function_privilege('anon', 'public.app_semya(uuid,uuid,text,integer,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.app_semya(uuid,uuid,text,integer,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.app_semya(uuid,uuid,text,integer,jsonb)', 'execute'), 'wrong privileges';
end $$;
rollback;
