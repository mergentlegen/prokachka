-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  first_task uuid := gen_random_uuid(); second_task uuid := gen_random_uuid(); level_two_task uuid := gen_random_uuid();
  result jsonb; prog uuid; failed boolean;
begin
  insert into public.teams(id,name) values(team, 'levels-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (admin_id,'Руководитель','Руководитель','Команды',admin_id || '@test.invalid',admin_id::text,'test','admin',team,false),
    (mentor,'Наставник','Наставник','Ветки',mentor || '@test.invalid',mentor::text,'test','member',team,true),
    (member,'Алия Бекова','Алия','Бекова',member || '@test.invalid',member::text,'test','member',team,false);
  update public.users set parent_user_id = mentor where id = member;
  insert into public.tasks(id,title,description,team_id,max_points) values
    (first_task,'Видео','Запиши',team,60),(second_task,'Гайд','Прочитай',team,60);
  insert into public.tasks(id,title,description,team_id,max_points,level) values(level_two_task,'Собери команду','Пригласи',team,30,2);

  -- 120 miles and 9 stars are 280: still level 1.
  insert into public.submissions(user_id,task_id,status,points,media_type,answer_text) values
    (member,first_task,'accepted',60,'text','a'),(member,second_task,'accepted',60,'text','b');
  insert into public.star_awards(user_id,team_id,stars,award_kind) values(member,team,5,'premium'),(member,team,2,'classic'),(member,team,2,'classic');
  assert public.app_member_level(member) = 1, 'promoted before 300';
  assert (select count(*) = 0 from public.telegram_notification_jobs where kind = 'level-up'), 'level message before 300';

  -- The tenth star makes 300: level 2 at once, with a message to the participant and to their mentor.
  insert into public.star_awards(user_id,team_id,stars,award_kind) values(member,team,1,'starter');
  assert public.app_member_level(member) = 2, 'not promoted at 300';
  assert (select count(*) = 2 from public.telegram_notification_jobs where kind = 'level-up'), 'level messages missing';
  assert exists(select 1 from public.telegram_notification_jobs where kind = 'level-up' and recipient_id = mentor and payload->>'memberId' = member::text), 'mentor not told';
  assert not exists(select 1 from public.telegram_notification_jobs where kind = 'level-up' and recipient_id = admin_id), 'admin told although the participant has a mentor';
  assert (select miles = 120 and stars = 10 from public.app_level_totals(member, 1::smallint)), 'the star that made 300 left level 1';
  -- Everything here happens in one transaction; later stars must look later than the move to level 2.
  update public.star_awards set created_at = now() - interval '2 hours' where user_id = member;
  update public.member_levels set reached_at = now() - interval '1 hour' where user_id = member;
  assert (select miles = 0 and stars = 0 from public.app_level_totals(member, 2::smallint)), 'level 2 does not start from zero';
  assert (select level = 2 and miles = 0 from public.app_course_standings(team) where id = member), 'rating does not show level 2';

  -- Level 1 is an archive now: nothing can be sent there, but a mentor may record a completion.
  failed := false;
  begin insert into public.submissions(user_id,task_id,media_type,answer_text) values(member,first_task,'text','again');
  exception when check_violation then failed := true; end;
  assert failed, 'a level 1 task accepted a new answer';
  insert into public.submissions(user_id,task_id,status,submission_source,media_type,answer_text) values(member,first_task,'pending','mentor','text','by mentor');
  insert into public.submissions(user_id,task_id,status,points,media_type,answer_text) values(member,level_two_task,'accepted',30,'text','team');
  insert into public.star_awards(user_id,team_id,stars,award_kind) values(member,team,2,'classic');
  assert (select miles = 30 and stars = 2 from public.app_level_totals(member, 2::smallint)), 'level 2 miles and stars are not counted separately';

  -- Programs carry a level; their steps follow it.
  result := public.app_create_program_level(jsonb_build_object('teamId', team, 'title', 'Капитанский старт', 'deadlineHours', 72,
    'tasks', jsonb_build_array(jsonb_build_object('title', 'Первый шаг', 'description', 'Сделай', 'maxPoints', 5))), 2::smallint);
  prog := (result->'program'->>'id')::uuid;
  assert (result->'program'->>'level')::int = 2 and (result->'tasks'->0->>'level')::int = 2, 'created program level not returned';
  assert (select level = 2 from public.task_programs where id = prog), 'program level not saved';
  assert (select bool_and(level = 2) from public.tasks where program_id = prog), 'steps do not follow the program level';
  assert public.app_set_program_level(prog, 1::smallint, mentor, false) ? 'forbidden', 'a mentor without rights moved a program';
  assert public.app_set_program_level(prog, 1::smallint, admin_id, false) ? 'data', 'admin could not move a program';
  assert (select bool_and(level = 1) from public.tasks where program_id = prog), 'steps did not follow the new level';

  -- A mentor's «вернуть» stays even though the participant still has 300 on level 1.
  assert public.app_set_member_level(mentor, member, 1::smallint) ? 'forbidden', 'only a team admin changes levels';
  assert (public.app_set_member_level(admin_id, member, 1::smallint)->>'level')::int = 1, 'could not return to level 1';
  insert into public.star_awards(user_id,team_id,stars,award_kind) values(member,team,1,'starter');
  assert public.app_member_level(member) = 1, 'automatic promotion overrode the mentor';
  assert (public.app_set_member_level(admin_id, member, 2::smallint)->>'level')::int = 2, 'could not move up by hand';
  assert public.app_member_level_seen(member), 'congratulation not marked as seen';
  assert not public.app_member_level_seen(member), 'congratulation shown twice';
  assert public.app_set_member_level(admin_id, member, 4::smallint) ? 'validationError', 'level 4 accepted';

  assert not has_function_privilege('authenticated', 'public.app_set_member_level(uuid,uuid,smallint)', 'execute'), 'browser can change levels';
  assert not has_function_privilege('authenticated', 'public.app_course_standings(uuid)', 'execute'), 'browser can read standings';
  assert not has_table_privilege('authenticated', 'public.member_levels', 'select'), 'browser can read levels';
end;
$$;
rollback;
