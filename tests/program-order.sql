-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- The mentor's own order of programs: new ones go to the end, the team leader saves the whole list.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); helper uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  game uuid := gen_random_uuid(); foreign_program uuid := gen_random_uuid(); result jsonb;
begin
  insert into public.teams(id,name) values(team, 'program-order-' || team), (other_team, 'program-order-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false),
    (helper,'Helper','Can','Publish',helper || '@test.invalid',helper::text,'test','member',team,true),
    (stranger,'Stranger','Other','Leader',stranger || '@test.invalid',stranger::text,'test','admin',other_team,false);
  update public.users set parent_user_id = leader where id = helper;

  -- New programs go to the end of their team's list; a ready game gets no place.
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (p1, team, 'Первая', 48, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (p2, team, 'Вторая', 48, leader);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (p3, team, 'Третья', 48, helper);
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id, template_key) values (game, team, 'Игра', 48, leader, 'dream-plan');
  insert into public.task_programs(id, team_id, title, deadline_hours, publisher_id) values (foreign_program, other_team, 'Чужая', 48, stranger);
  assert (select array_agg(id order by position) from public.task_programs where team_id = team and template_key is null) = array[p1, p2, p3],
    'new programs did not go to the end';
  assert (select position is null from public.task_programs where id = game), 'a ready game got a place among programs';
  assert (select position = 1 from public.task_programs where id = foreign_program), 'another team shares the numbering';

  -- The leader saves a new order.
  result := public.app_program_order_save(leader, array[p3, p1, p2]);
  assert result ? 'data', 'the leader could not save: ' || result::text;
  assert (select array_agg(id order by position) from public.task_programs where team_id = team and template_key is null) = array[p3, p1, p2],
    'the order was not saved';
  -- Saving the same order again changes nothing and still works.
  assert public.app_program_order_save(leader, array[p3, p1, p2]) ? 'data', 'saving the same order failed';

  -- Only the team leader of that team; a stale or foreign list is refused.
  assert public.app_program_order_save(helper, array[p1, p2, p3]) ? 'forbidden', 'a member changed the order';
  assert public.app_program_order_save(stranger, array[p1, p2, p3]) ? 'forbidden' or public.app_program_order_save(stranger, array[p1, p2, p3]) ? 'validationError',
    'another team leader changed the order';
  assert public.app_program_order_save(leader, array[p1, p2]) ? 'validationError', 'a list without one program was accepted';
  assert public.app_program_order_save(leader, array[p1, p2, p2]) ? 'validationError', 'a list with a repeat was accepted';
  assert public.app_program_order_save(leader, array[p1, p2, p3, game]) ? 'validationError', 'a ready game was put among programs';
  assert public.app_program_order_save(leader, array[p1, p2, foreign_program]) ? 'validationError', 'a program of another team was accepted';
  assert public.app_program_order_save(leader, array[]::uuid[]) ? 'validationError', 'an empty list was accepted';
  assert (select array_agg(id order by position) from public.task_programs where team_id = team and template_key is null) = array[p3, p1, p2],
    'a refused list changed the order';

  -- A program added after the save goes to the end.
  insert into public.task_programs(team_id, title, deadline_hours, publisher_id) values (team, 'Четвёртая', 48, leader);
  assert (select title from public.task_programs where team_id = team and template_key is null order by position desc limit 1) = 'Четвёртая',
    'a new program did not go to the end after a saved order';
end $$;
rollback;
