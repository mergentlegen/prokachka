-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  start_program uuid := gen_random_uuid(); done_program uuid := gen_random_uuid(); hidden_program uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); h1 uuid := gen_random_uuid();
  programs jsonb; current jsonb;
begin
  insert into public.teams(id,name) values (team, 'stage2-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id)
    select id, name, 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, team, review, tg
    from (values (leader, 'Руководитель', 'admin', false, null), (mentor, 'Наставник', 'member', true, null),
      (member_id, 'Участник', 'member', false, '830000000000001'), (other, 'Другой', 'member', false, null)) v(id, name, role, review, tg);
  update public.users set parent_user_id = leader where id in (mentor, other);
  update public.users set parent_user_id = mentor where id = member_id;

  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id, is_active) values
    (start_program, team, 'Старт', 72, leader, true), (done_program, team, 'Пройденная', 72, leader, true), (hidden_program, team, 'Скрытая', 72, leader, false);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,is_active) values
    (s1,'1','1',team,10,'sequential',start_program,1,leader,true), (s2,'2','2',team,10,'sequential',start_program,2,leader,false),
    (s3,'3','3',team,10,'sequential',start_program,3,leader,true), (s4,'4','4',team,10,'sequential',start_program,4,leader,true),
    (d1,'d','d',team,10,'sequential',done_program,1,leader,true), (h1,'h','h',team,10,'sequential',hidden_program,1,leader,true);
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at) values
    (member_id, start_program, s3, now(), now() + interval '3 days', 'active', null),
    (member_id, done_program, null, now(), now(), 'completed', now()),
    (member_id, hidden_program, h1, now(), now() + interval '3 days', 'active', null);

  -- The active program first, the step number counts only visible steps; a hidden program is not shown.
  programs := public.app_member_programs(member_id);
  assert jsonb_array_length(programs) = 2, 'wrong programs: ' || programs::text;
  current := programs->0;
  assert current->>'title' = 'Старт' and (current->>'currentStep')::int = 2 and (current->>'totalSteps')::int = 3 and current->>'status' = 'active', 'step counted wrong: ' || current::text;
  assert programs->1->>'status' = 'completed' and (programs->1->>'totalSteps')::int = 1, 'finished program wrong: ' || programs::text;
  assert public.app_member_programs(other) = '[]'::jsonb, 'someone else sees programs';

  -- Branch size: the leader counts the team, a mentor the branch below, a participant nobody.
  assert (public.app_own_profile_extras(leader)->>'branchSize')::int = 3, 'leader branch wrong';
  assert (public.app_own_profile_extras(mentor)->>'branchSize')::int = 1, 'mentor branch wrong';
  assert (public.app_own_profile_extras(member_id)->>'branchSize')::int = 0, 'participant has a branch';

  -- Unlinking Telegram: the link and any chosen task are gone; a second unlink is harmless.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values ('stage2-' || member_id, member_id, s3, '830000000000001', now() + interval '15 minutes');
  insert into public.telegram_submission_contexts(telegram_id, session_hash, last_start_message_id) values ('830000000000001', 'stage2-' || member_id, 1);
  assert (public.app_unlink_telegram(member_id)->>'unlinked')::boolean, 'unlink failed';
  assert (select telegram_id is null from public.users where id = member_id), 'Telegram still linked';
  assert (select session_hash is null from public.telegram_submission_contexts where telegram_id = '830000000000001'), 'chosen task still active';
  assert (select consumed_at is not null from public.telegram_submission_sessions where token_hash = 'stage2-' || member_id), 'open session not closed';
  assert (public.app_unlink_telegram(member_id)->>'unlinked')::boolean, 'second unlink failed';

  assert not has_function_privilege('authenticated', 'public.app_unlink_telegram(uuid)', 'execute'), 'browser unlinks directly';
  assert not has_function_privilege('authenticated', 'public.app_member_programs(uuid)', 'execute'), 'browser reads programs directly';
end $$;
rollback;
