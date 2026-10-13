-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); linked uuid := gen_random_uuid(); unlinked uuid := gen_random_uuid();
  partial uuid := gen_random_uuid(); waiting uuid := gen_random_uuid(); program uuid := gen_random_uuid(); step uuid := gen_random_uuid();
  game uuid := gen_random_uuid(); linked_work uuid; thread uuid; job jsonb;
begin
  insert into public.teams(id,name) values (team, 'recount-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,telegram_id)
    select id, 'User', 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, team, tg
    from (values (leader, 'admin', null), (linked, 'member', '840000000000001'), (unlinked, 'member', null),
      (partial, 'member', '840000000000002'), (waiting, 'member', '840000000000003')) v(id, role, tg);
  update public.users set parent_user_id = leader where id <> leader and team_id = team;
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id, is_active) values (program, team, 'Тест «На воспроизведение»', 72, leader, true);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,program_id,position,publisher_id,is_active) values
    (step,'Тест «На воспроизведение»','Ответь на вопросы',team,5,'sequential',program,1,leader,true);
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, submitted_at, reviewed_at) values
    (linked, step, 'accepted', 'text', 'Ответ', 5, now() - interval '9 hours', now() - interval '8 hours'),
    (unlinked, step, 'accepted', 'text', 'Ответ', 5, now() - interval '9 hours', now() - interval '8 hours'),
    (partial, step, 'accepted', 'text', 'Ответ', 1, now() - interval '9 hours', now() - interval '8 hours'),
    (waiting, step, 'pending', 'text', 'Ответ', 0, now() - interval '1 hour', null);
  select id into linked_work from public.submissions where user_id = linked and task_id = step;
  select id into thread from public.feedback_threads where member_user_id = linked and task_id = step;
  insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, review_status, points, review_version)
    values (thread, linked_work, 'review', leader, 'Наставник', 'accepted', 5, 1);

  -- Raising the miles changes nothing for works already accepted.
  update public.tasks set max_points = 8 where id = step;
  assert (select points from public.submissions where id = linked_work) = 5, 'raising the miles changed a past work';
  assert not exists (select 1 from public.telegram_notification_jobs where kind = 'miles-recount' and recipient_id in (linked, unlinked, partial)), 'raising sent a message';

  -- Lowering to 2: everyone above 2 goes down to 2, a smaller grade and a waiting work stay as they are.
  update public.tasks set max_points = 2 where id = step;
  assert (select points from public.submissions where id = linked_work) = 2, 'miles not recounted';
  assert (select points from public.submissions where user_id = unlinked and task_id = step) = 2, 'participant without Telegram not recounted';
  assert (select points from public.submissions where user_id = partial and task_id = step) = 1, 'a smaller grade changed';
  assert (select status = 'pending' and points = 0 from public.submissions where user_id = waiting and task_id = step), 'a waiting work changed';
  assert (select points from public.feedback_events where submission_id = linked_work and kind = 'review') = 2, 'the mentor decision still shows the old miles';

  -- One Telegram message to the participant with Telegram, none to the others.
  assert (select count(*) from public.telegram_notification_jobs where kind = 'miles-recount' and recipient_id in (linked, unlinked, partial, waiting)) = 1, 'wrong messages queued';
  job := (select payload from public.telegram_notification_jobs where kind = 'miles-recount' and recipient_id = linked);
  assert job->>'title' = 'Тест «На воспроизведение»' and (job->>'from')::int = 5 and (job->>'to')::int = 2, 'wrong message: ' || job::text;

  -- Saving the same miles again recounts nothing and sends nothing new.
  update public.tasks set max_points = 2 where id = step;
  assert (select count(*) from public.telegram_notification_jobs where kind = 'miles-recount' and recipient_id = linked) = 1, 'second message for the same change';

  -- A finished game keeps its miles: game records are protected, the editor never lowers them.
  insert into public.tasks(id,title,description,team_id,max_points,publication_type,interactive_kind,publisher_id,is_active) values
    (game,'Игра','Игра',team,10,'evergreen','company-voyage',leader,true);
  insert into public.submissions(user_id, task_id, status, submission_source, points, submitted_at, reviewed_at)
    values (linked, game, 'accepted', 'interactive', 10, now(), now());
  update public.tasks set max_points = 2 where id = game;
  assert (select points from public.submissions where user_id = linked and task_id = game) = 10, 'a finished game was recounted';

  assert not has_function_privilege('authenticated', 'public.app_recount_task_miles(uuid)', 'execute'), 'browser recounts miles directly';
end $$;
rollback;
