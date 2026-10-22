\set ON_ERROR_STOP on
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); other_member uuid := gen_random_uuid();
  rules_task uuid; outcome jsonb; answers integer[] := array[0,1,0,0,0]; i integer;
begin
  insert into teams(id,name) values(team,'rules-xp-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor),
    (other_member,'Second','Second','Test',other_member||'@test.invalid',other_member::text,'test','member',team,mentor);
  outcome := app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Правила игры','templateKey','starter-rules','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Правила игры','description','Изучи правила и пройди тест.','maxPoints',5,'publicationType','evergreen','interactiveKind','starter-rules'))));
  rules_task := (outcome->'tasks'->0->>'id')::uuid;

  if app_ready_program_spec('starter-rules')->'answers' is distinct from '[0,1,0,0,0]'::jsonb then
    raise exception 'New answer key missing: %', app_ready_program_spec('starter-rules')::text;
  end if;

  -- The new key: all five right answers give 5 miles.
  perform app_start_ready_program(member_id,rules_task);
  perform app_advance_ready_program(member_id,rules_task,1);
  for i in 0..4 loop
    outcome := app_answer_ready_program(member_id,rules_task,answers[i+1],i);
    if outcome->>'failed' = 'true' then raise exception 'Right answer % rejected: %', i, outcome::text; end if;
  end loop;
  outcome := app_complete_ready_program(member_id,rules_task);
  if outcome->>'completed' is distinct from 'true' or (outcome->'submission'->>'points')::int is distinct from 5 then
    raise exception 'Completion failed: %', outcome::text;
  end if;

  -- The old key no longer passes: its first answer (index 1) is now wrong.
  perform app_start_ready_program(other_member,rules_task);
  perform app_advance_ready_program(other_member,rules_task,1);
  outcome := app_answer_ready_program(other_member,rules_task,1,0);
  if outcome->>'failed' is distinct from 'true' then raise exception 'Old first answer still accepted: %', outcome::text; end if;
end $$;
rollback;
