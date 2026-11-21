-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- Programs open one at a time (20261126): on each level the first program not passed is open, the later ones are closed.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); helper uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pc uuid := gen_random_uuid(); pe uuid := gen_random_uuid(); px uuid := gen_random_uuid();
  l2a uuid := gen_random_uuid(); l2b uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); x1 uuid := gen_random_uuid(); l2a1 uuid := gen_random_uuid(); l2b1 uuid := gen_random_uuid();
  game uuid; result jsonb; old_unlock timestamptz := now() - interval '20 days'; work uuid;
begin
  insert into public.teams(id,name) values(team, 'queue-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team),
    (helper,'Helper','Branch','Root',helper || '@test.invalid',helper::text,'test','member',team),
    (member_id,'Member','Queue','Member',member_id || '@test.invalid',member_id::text,'test','member',team),
    (other,'Other','Branch','Member',other || '@test.invalid',other::text,'test','member',team);
  update public.users set parent_user_id = leader where id in (helper, member_id);
  update public.users set parent_user_id = helper where id = other;

  -- Level 1: A, B, C in this order; an empty program E and a program X for another branch stand between them and hold nothing.
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (pa, team, 'PA', 48, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (pe, team, 'Empty', 48, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id, audience_root_id) values (px, team, 'Branch only', 48, leader, helper);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (pb, team, 'PB', 24, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (pc, team, 'PC', 48, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id, level) values (l2a, team, 'L2 A', 48, leader, 2), (l2b, team, 'L2 B', 48, leader, 2);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,level) values
    (a1,'a1','a1',team,2,'sequential',pa,1,leader,1), (a2,'a2','a2',team,2,'sequential',pa,2,leader,1),
    (b1,'b1','b1',team,2,'sequential',pb,1,leader,1), (b2,'b2','b2',team,2,'sequential',pb,2,leader,1),
    (c1,'c1','c1',team,2,'sequential',pc,1,leader,1), (x1,'x1','x1',team,2,'sequential',px,1,leader,1),
    (l2a1,'l2a1','l2a1',team,2,'sequential',l2a,1,leader,2), (l2b1,'l2b1','l2b1',team,2,'sequential',l2b,1,leader,2);

  -- The page creates the participant's progress for every program at once (as before): only A stays open.
  -- B was even started out of turn: b1 is accepted and the participant stood on b2.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (member_id, b1, 'accepted', 'text', 'done', 2, now());
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (member_id, pa, a1, old_unlock, old_unlock + interval '48 hours', 'active'),
    (member_id, pb, b2, old_unlock, old_unlock + interval '24 hours', 'active'),
    (member_id, pc, c1, old_unlock, old_unlock + interval '48 hours', 'active');
  assert (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id
    where m.user_id = member_id) = 'PA=active,PB=locked,PC=locked', 'the queue: ' || (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id where m.user_id = member_id);
  assert (select unlocked_at = old_unlock from public.member_program_progress where user_id = member_id and program_id = pa), 'the open program got a new deadline';

  -- Nothing can be sent to a closed program: the site, the bot and «Напомнить» all ask tg_target_error.
  assert public.tg_target_error(member_id, b2) = 'Эта программа ещё закрыта: она откроется, когда будет пройдена предыдущая.', 'closed program: ' || coalesce(public.tg_target_error(member_id, b2), 'null');
  assert public.tg_target_error(member_id, c1) like 'Эта программа ещё закрыта%', 'C is not closed';
  assert public.tg_target_error(member_id, a1) is null, 'the open program refuses: ' || coalesce(public.tg_target_error(member_id, a1), 'null');
  -- The other branch has its own queue: X is first there; the participant of the main branch never sees X.
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (other, pa, a1, now(), now() + interval '48 hours', 'active'), (other, px, x1, now(), now() + interval '48 hours', 'active');
  assert (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id
    where m.user_id = other) = 'PA=active,Branch only=locked,PB=locked,PC=locked', 'the other branch queue: ' || (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id where m.user_id = other);
  assert not exists (select 1 from public.member_program_progress where user_id = member_id and program_id = px), 'a program of another branch was given';

  -- A is passed: B opens at once with a fresh deadline, on its first step not passed (b2), C stays closed.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (member_id, a1, 'accepted', 'text', 'done', 2, now());
  perform public.app_program_advance(member_id, a1, now());
  assert (select status = 'locked' from public.member_program_progress where user_id = member_id and program_id = pb), 'B opened before A was passed';
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (member_id, a2, 'accepted', 'text', 'done', 2, now());
  perform public.app_program_advance(member_id, a2, now());
  assert (select status = 'completed' from public.member_program_progress where user_id = member_id and program_id = pa), 'A not passed';
  assert (select status = 'active' and current_task_id = b2 and unlocked_at > now() - interval '1 minute' and due_at between now() + interval '23 hours' and now() + interval '25 hours'
    from public.member_program_progress where user_id = member_id and program_id = pb), 'B did not open on b2 with a fresh deadline: '
    || (select row_to_json(m)::text from public.member_program_progress m where user_id = member_id and program_id = pb);
  assert (select status = 'locked' from public.member_program_progress where user_id = member_id and program_id = pc), 'C opened too early';
  assert public.tg_target_error(member_id, b2) is null, 'B refuses after opening';

  -- A work waiting in a program that gets closed: nothing new can be sent there until it opens again.
  insert into public.submissions(user_id, task_id, media_type, answer_text) values (member_id, b2, 'text', 'Answer') returning id into work;

  -- The leader puts C first: C opens, B closes (its waiting work keeps its place), A stays passed.
  assert public.app_program_order_save(leader, array[pc, pa, pe, px, pb, l2a, l2b]) ? 'data', 'order not saved';
  assert (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id
    where m.user_id = member_id and coalesce(p.level, 1) = 1) = 'PC=active,PA=completed,PB=locked', 'after the new order: ' || (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id where m.user_id = member_id and coalesce(p.level,1) = 1);
  assert (select unlocked_at > now() - interval '1 minute' from public.member_program_progress where user_id = member_id and program_id = pc), 'C opened with its old deadline';

  -- Hiding C opens B again; showing C closes B again.
  update public.task_programs set is_active = false where id = pc;
  assert (select status = 'active' from public.member_program_progress where user_id = member_id and program_id = pb), 'hidden C still holds B';
  update public.task_programs set is_active = true where id = pc;
  assert (select status = 'locked' from public.member_program_progress where user_id = member_id and program_id = pb), 'shown C does not hold B';

  -- C is passed, then a new step is added to the passed A: A opens again, and B waits for it.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at) values (member_id, c1, 'accepted', 'text', 'done', 2, now());
  perform public.app_program_advance(member_id, c1, now());
  assert (select status = 'active' from public.member_program_progress where user_id = member_id and program_id = pb), 'B did not open after C and A';
  result := public.app_program_add_game(leader, pa, 'podumayu');
  game := (result->'data'->>'id')::uuid;
  -- The game reopens the passed A, and B closes again.
  assert (select status = 'active' and current_task_id = game from public.member_program_progress where user_id = member_id and program_id = pa), 'A did not open again for its new step';
  assert (select status = 'locked' from public.member_program_progress where user_id = member_id and program_id = pb), 'B stays open while A has a new step';
  assert (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id
    where m.user_id = member_id and coalesce(p.level, 1) = 1) = 'PC=completed,PA=active,PB=locked', 'after the new step';
  assert public.app_podumayu(member_id, game, 'start', 0, '{}') ? 'step', 'the game of the open program refused';
  -- A program game in a closed program refuses.
  result := public.app_program_add_game(leader, pb, 'final-voyage-1');
  assert public.app_program_game_error(member_id, (result->'data'->>'id')::uuid) like 'Эта программа ещё закрыта%', 'a game in a closed program is open';

  -- Level 2 has its own queue: its first program opens with the level, whatever level 1 holds.
  insert into public.member_levels(user_id, level, reached_at) values (member_id, 2, now());
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status) values
    (member_id, l2a, l2a1, now(), now() + interval '48 hours', 'active'), (member_id, l2b, l2b1, now(), now() + interval '48 hours', 'active');
  assert (select string_agg(p.title || '=' || m.status, ',' order by p.position) from public.member_program_progress m join public.task_programs p on p.id = m.program_id
    where m.user_id = member_id and p.level = 2) = 'L2 A=active,L2 B=locked', 'level 2 queue';

  -- Running the queue again changes nothing.
  assert public.app_program_queue(member_id) = 0, 'the queue is not stable';
  assert not has_function_privilege('authenticated', 'public.app_program_queue(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.app_program_queue(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.app_program_queue(uuid)', 'execute'), 'wrong privileges';
end $$;
rollback;
