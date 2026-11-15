-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- Each participant answers tasks of their own level; an earlier level only to send a returned work again.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); player uuid := gen_random_uuid(); captain uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); quiz_task uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); returned uuid; problem text;
begin
  insert into public.teams(id,name) values(team, 'levels-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,'9800000001'),
    (player,'Player','Level','One',player || '@test.invalid',player::text,'test','member',team,'9800000002'),
    (captain,'Captain','Level','Two',captain || '@test.invalid',captain::text,'test','member',team,'9800000003');
  update public.users set parent_user_id = leader where id in (player, captain);
  insert into public.tasks(id,title,description,team_id,max_points,publisher_id,level) values
    (t1,'Уровень 1','Сделать',team,5,leader,1), (t2,'Уровень 2','Сделать',team,5,leader,2),
    (t3,'Ещё уровень 1','Сделать',team,5,leader,1), (quiz_task,'Тест уровня 1','Ответить',team,5,leader,1);
  perform public.app_task_quiz_save(leader, quiz_task, '[{"id":"q1","kind":"single","prompt":"?","options":["1","2"],"correct":[1]}]');
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (program, team, 'Программа уровня 1', 48, leader);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (s1,'Шаг 1','Сделать',team,2,'sequential',program,1,leader,48);
  -- While still on level 1 the future captain sent t1 and the mentor returned it; both finished the program.
  insert into public.submissions(user_id, task_id, status, media_type, answer_text) values (captain, t1, 'pending', 'text', 'Первая попытка')
    returning id into returned;
  update public.submissions set status = 'revision', review_version = review_version + 1, comment = 'Доработай' where id = returned;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at)
    select u, s1, 'accepted', 'text', 'Шаг', 2, now() from unnest(array[player, captain]) u;
  insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status, completed_at)
    select u, program, null, now() - interval '2 days', now() - interval '1 day', 'completed', now() - interval '1 day' from unnest(array[player, captain]) u;
  insert into public.member_levels(user_id, level, reached_at) values (captain, 2, now() - interval '1 hour');

  -- 1. Each answers only their own level.
  assert public.tg_target_error(player, t1) is null, 'a player cannot answer a level 1 task';
  assert public.tg_target_error(captain, t2) is null, 'a captain cannot answer a level 2 task';
  assert public.tg_target_error(player, t2) = 'Это задание следующего уровня.', 'a player may answer a level 2 task';
  problem := public.tg_target_error(captain, t3);
  assert problem like 'Это задание прошлого уровня%', 'a captain may answer an archived task: ' || coalesce(problem, 'null');
  assert public.app_task_quiz_submit(captain, quiz_task, 'Тест: 1 из 1 верно', 1, 1, '{"q1":{"choice":[1]}}') ? 'validationError', 'a captain sent an archived test';
  begin
    insert into public.submissions(user_id, task_id, status, media_type, answer_text) values (captain, t3, 'pending', 'text', 'В обход');
    raise exception 'the guard let an archived task through';
  exception when check_violation then null;
  end;

  -- 2. A returned work of an earlier level can be sent again, once; then it waits for the mentor as usual.
  assert public.tg_target_error(captain, t1) is null, 'a returned archived work cannot be sent again';
  insert into public.submissions(user_id, task_id, status, media_type, answer_text) values (captain, t1, 'pending', 'text', 'Исправил');
  assert public.tg_target_error(captain, t1) = 'Ответ уже отправлен. Дождитесь проверки наставника.', 'a resent archived work can be sent twice';
  assert exists (select 1 from public.telegram_notification_jobs j join public.submissions s on s.id = j.submission_id
    where s.user_id = captain and s.task_id = t1 and s.status = 'pending' and j.recipient_id = leader and j.kind = 'submission'), 'mentor not told about the resent work';

  -- 3. «Напомнить» reaches only those who can answer: a level 2 task — captains, a level 1 task — players.
  assert exists (select 1 from public.app_task_nudge_targets(leader, t2) where user_id = captain), 'captain not reminded about level 2';
  assert not exists (select 1 from public.app_task_nudge_targets(leader, t2) where user_id = player), 'player reminded about a level 2 task';
  assert exists (select 1 from public.app_task_nudge_targets(leader, t3) where user_id = player), 'player not reminded about level 1';
  assert not exists (select 1 from public.app_task_nudge_targets(leader, t3) where user_id = captain), 'captain reminded about an archived task';

  -- 4. A new step reopens the program for players on its level, not for captains who have moved on.
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,deadline_hours) values
    (s2,'Шаг 2','Новый',team,2,'sequential',program,2,leader,48);
  assert (select status = 'active' and current_task_id = s2 from public.member_program_progress where user_id = player and program_id = program), 'player did not get the new step';
  assert (select status = 'completed' and current_task_id is null from public.member_program_progress where user_id = captain and program_id = program), 'captain got a step in the archive';

  -- 5. A mentor may still record a completion on any level.
  assert public.app_mentor_record_submission(t3, captain, leader, false, 5, 'Сделано на встрече') ? 'data', 'mentor could not record an archived completion';

  assert not has_function_privilege('authenticated', 'public.app_task_returned(uuid,uuid)', 'execute'), 'browser reads returned works';
end $$;
rollback;
