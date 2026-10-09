-- Run on a disposable database after bootstrap. Builds finished games worth 10 miles, applies the reward change
-- and checks the recount; the fixtures are removed at the end.
\set ON_ERROR_STOP on
create temporary table reward_fixture as select gen_random_uuid() team, gen_random_uuid() finished, gen_random_uuid() playing,
  gen_random_uuid() program, gen_random_uuid() game, gen_random_uuid() other_task;
insert into public.teams(id, name) select team, 'reward-' || team from reward_fixture;
insert into public.users(id, name, first_name, last_name, email, login, password_hash, role, team_id)
  select id, 'Member', 'Reward', 'Member', id || '@test.invalid', id::text, 'test', 'member', team
  from reward_fixture, unnest(array[finished, playing]) id;
insert into public.task_programs(id, team_id, title, deadline_hours, template_key) select program, team, 'Корабль', 720, 'company-voyage' from reward_fixture;
insert into public.tasks(id, title, description, team_id, max_points, publication_type, program_id, position, interactive_kind)
  select game, 'Корабль, на который ты поднялся', 'Познакомься с компанией, пройди игру «Правда или миф» без ошибок и получи 10 миль автоматически. Затем собери рассказ.',
    team, 10, 'evergreen', program, 1, 'company-voyage' from reward_fixture;
insert into public.tasks(id, title, description, team_id, max_points, publication_type) select other_task, 'Обычное', 'Обычное задание', team, 10, 'evergreen' from reward_fixture;
insert into public.ready_program_attempts(user_id, task_id, current_step, status, earned_points, completed_at)
  select finished, game, 8, 'completed', 10, now() from reward_fixture
  union all select playing, game, 3, 'active', 9, null from reward_fixture;
insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, reviewed_at, submission_source)
  select finished, game, 'accepted'::public.submission_status, 'text', 'Игра завершена', 10, now(), 'interactive' from reward_fixture
  union all select finished, other_task, 'accepted'::public.submission_status, 'text', 'Обычный ответ', 10, now(), 'mentor' from reward_fixture;

\ir ../supabase/20261026-company-voyage-reward.sql
-- A second run changes nothing.
\ir ../supabase/20261026-company-voyage-reward.sql

do $$
declare f reward_fixture%rowtype;
begin
  select * into f from reward_fixture;
  assert (public.app_ready_program_spec('company-voyage')->>'reward')::int = 2, 'new games still pay 10';
  assert (select max_points = 2 and description like '%получи 2 мили автоматически%' from public.tasks where id = f.game), 'published game not updated';
  assert (select points from public.submissions where task_id = f.game) = 2, 'finished game still worth 10';
  assert (select sum(points) from public.submissions where user_id = f.finished) = 12, 'rating not reduced by exactly 8';
  assert (select points from public.submissions where task_id = f.other_task) = 10, 'another task was changed';
  assert (select earned_points from public.ready_program_attempts where user_id = f.finished) = 2, 'finished attempt not recounted';
  assert (select earned_points from public.ready_program_attempts where user_id = f.playing) = 9, 'a game in progress was touched';
  assert (select count(*) from public.audit_log where action = 'task.reward' and details->'reward' = '[10,2]'::jsonb) = 1, 'journal line missing or repeated';
  -- The edit guard is back on.
  begin
    update public.submissions set points = 5 where task_id = f.game;
    raise exception 'guard is off';
  exception when others then
    if sqlerrm = 'guard is off' then raise; end if;
  end;
end $$;

delete from public.submissions where task_id in (select game from reward_fixture union all select other_task from reward_fixture);
delete from public.teams where id = (select team from reward_fixture);
