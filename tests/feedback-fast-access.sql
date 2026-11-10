-- Run on a disposable database after bootstrap. Every fixture is rolled back.
-- The fast list of visible conversations must match the per-conversation check for every reader.
begin;
do $$
#variable_conflict use_variable
declare
  team_a uuid := gen_random_uuid(); team_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid(); lead uuid := gen_random_uuid(); sub uuid := gen_random_uuid();
  side uuid := gen_random_uuid(); plain uuid := gen_random_uuid(); moved uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
  m4 uuid := gen_random_uuid(); m5 uuid := gen_random_uuid(); m6 uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
  task_a uuid := gen_random_uuid(); task_b uuid := gen_random_uuid();
  actor uuid; ceo boolean; scope text; expected uuid[]; actual uuid[]; checked integer := 0; fn text;
begin
  insert into public.teams(id,name) values(team_a, 'fast-a-' || team_a), (team_b, 'fast-b-' || team_b);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review)
  select u.id, u.name, u.name, 'Тест', u.id || '@test.invalid', u.id::text, 'test', u.role::public.user_role, u.team, u.can_review
  from (values
    (admin_a,'Руководитель А','admin',team_a,false), (lead,'Наставник','member',team_a,true),
    (sub,'Младший наставник','member',team_a,true), (side,'Соседний наставник','member',team_a,true),
    (plain,'Без права проверки','member',team_a,false), (moved,'Ушедший наставник','member',team_a,true),
    (m1,'Участник 1','member',team_a,false), (m2,'Участник 2','member',team_a,false), (m3,'Участник 3','member',team_a,false),
    (m4,'Участник 4','member',team_a,false), (m5,'Участник 5','member',team_a,false), (m6,'Участник 6','member',team_a,false),
    (admin_b,'Руководитель Б','admin',team_b,false), (b1,'Участник Б','member',team_b,false)
  ) as u(id,name,role,team,can_review);
  update public.users set parent_user_id = admin_a where id in (lead, side, plain);
  update public.users set parent_user_id = lead where id in (sub, m1);
  update public.users set parent_user_id = sub where id in (m2, m3, moved);
  update public.users set parent_user_id = side where id = m4;
  update public.users set parent_user_id = plain where id = m5;
  update public.users set parent_user_id = moved where id = m6;
  update public.users set parent_user_id = admin_b where id = b1;
  insert into public.tasks(id,title,description,team_id,max_points) values
    (task_a,'Задание А','Сделай',team_a,5), (task_b,'Задание Б','Сделай',team_b,5);
  insert into public.submissions(user_id,task_id,media_type,answer_text)
  select id, task_a, 'text', 'Ответ' from public.users where id in (lead, sub, side, plain, moved, m1, m2, m3, m4, m5, m6);
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(b1, task_b, 'text', 'Ответ');
  -- Data the guards normally forbid: a mentor now in another team, still inside the old branch
  -- (Наставник → Младший наставник → Ушедший наставник → Участник 6). Both versions must cut the branch at the team border.
  alter table public.users disable trigger user;
  update public.users set team_id = team_b where id = moved;
  alter table public.users enable trigger user;
  perform public.app_feedback_send((select id from public.feedback_threads where member_user_id = m2), m2, false, 'Вопрос', gen_random_uuid());

  for actor in select id from public.users where team_id in (team_a, team_b) union all select null::uuid loop
    foreach ceo in array array[false, true] loop
      foreach scope in array array['personal', 'mentor', 'other'] loop
        expected := array(select f.id from public.feedback_threads f
          where public.app_feedback_scope_access(f.id, actor, ceo, scope) order by f.id);
        actual := array(select v.id from public.app_feedback_scope_threads(actor, ceo, scope) v(id) order by v.id);
        assert expected = actual, 'fast access differs from the per-conversation check: actor ' || coalesce(actor::text, 'none')
          || ', ceo ' || ceo::text || ', scope ' || scope || ', expected ' || coalesce(array_length(expected, 1), 0)::text
          || ', got ' || coalesce(array_length(actual, 1), 0)::text;
        checked := checked + 1;
      end loop;
    end loop;
  end loop;
  assert checked = 15 * 2 * 3, 'not every reader was compared';

  -- The comparison above must not pass on empty lists.
  assert (select count(*) from public.app_feedback_scope_threads(admin_a, false, 'mentor')) = 10, 'the team admin does not see the whole team';
  assert (select count(*) from public.app_feedback_scope_threads(lead, false, 'mentor')) = 4, 'a mentor does not see exactly their branch';
  assert (select count(*) from public.app_feedback_scope_threads(sub, false, 'mentor')) = 2, 'a junior mentor does not see exactly their branch';
  assert (select count(*) from public.app_feedback_scope_threads(side, false, 'mentor')) = 1, 'a neighbouring mentor sees another branch';
  assert (select count(*) from public.app_feedback_scope_threads(plain, false, 'mentor')) = 0, 'a parent without the review right reads conversations';
  assert (select count(*) from public.app_feedback_scope_threads(moved, false, 'mentor')) = 0, 'a mentor who left the team still reads it';
  assert (select count(*) from public.app_feedback_scope_threads(admin_b, false, 'mentor')) = 1, 'an admin reads another team';
  assert (select count(*) from public.app_feedback_scope_threads(null, true, 'mentor')) >= 12, 'the CEO panel misses conversations';
  assert (select count(*) from public.app_feedback_scope_threads(m1, false, 'personal')) = 1, 'a participant does not see their own conversation';

  -- The lists themselves read from the fast set.
  assert jsonb_array_length(public.app_feedback_list_scoped(lead, false, 'mentor', 50, 0, false)) = 4, 'mentor list is wrong';
  assert jsonb_array_length(public.app_feedback_list_scoped(lead, false, 'personal', 50, 0, false)) = 1, 'personal list is wrong';
  assert (public.app_feedback_counts_scoped(lead, false, 'mentor')->>'needsReply')::int = 1, 'waiting counter is wrong';
  assert (public.app_feedback_counts_scoped(side, false, 'mentor')->>'needsReply')::int = 0, 'another branch is counted';
  assert (public.app_feedback_task_groups(lead, false, 50, 0, false)->0->>'participants')::int = 4, 'task card counts another branch';
  assert jsonb_array_length(public.app_feedback_list_task(sub, false, task_a, 50, 0, false)) = 2, 'participants of a task are wrong';
  assert jsonb_array_length(public.app_feedback_mentor_threads(lead, false, '', true, 50, 0)) = 1, 'waiting list is wrong';
  assert jsonb_array_length(public.app_feedback_mentor_threads(admin_b, false, '', false, 50, 0)) = 1, 'another team leaks into the list';
  foreach fn in array array['app_feedback_list_scoped', 'app_feedback_counts_scoped', 'app_feedback_task_groups',
    'app_feedback_list_task', 'app_feedback_mentor_threads'] loop
    assert (select count(*) = 1 and bool_and(position('app_feedback_scope_threads' in prosrc) > 0
        and position('app_feedback_scope_access' in prosrc) = 0)
      from pg_proc where pronamespace = 'public'::regnamespace and proname = fn), fn || ' checks access per conversation again';
  end loop;
  assert not has_function_privilege('authenticated', 'public.app_feedback_scope_threads(uuid,boolean,text)', 'execute'), 'browser can list visible conversations';
  assert not has_function_privilege('anon', 'public.app_feedback_scope_threads(uuid,boolean,text)', 'execute'), 'anyone can list visible conversations';
end;
$$;
rollback;
