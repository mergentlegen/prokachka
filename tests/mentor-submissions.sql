-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); mentor uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); sibling uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); outsider_leader uuid := gen_random_uuid();
  task uuid := gen_random_uuid(); foreign_task uuid := gen_random_uuid(); long text := repeat('Ответ участника. ', 60);
  rows jsonb; row jsonb;
begin
  insert into public.teams(id,name) values (team, 'mentor-list-' || team), (other_team, 'other-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review)
    select id, 'User', 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, tid, review
    from (values (leader, 'admin', team, false), (mentor, 'member', team, true), (member_id, 'member', team, false), (sibling, 'member', team, false),
      (stranger, 'member', other_team, false), (outsider_leader, 'admin', other_team, false)) v(id, role, tid, review);
  update public.users set parent_user_id = leader where id in (mentor, sibling);
  update public.users set parent_user_id = mentor where id = member_id;
  insert into public.tasks(id,title,description,team_id,max_points,publication_type) values
    (task,'Видео','Задание',team,10,'evergreen'), (foreign_task,'Чужое','Задание',other_team,10,'evergreen');
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, submitted_at, reviewed_at) values
    (member_id, task, 'pending', 'text', long, 0, now() - interval '1 hour', null),
    (member_id, task, 'accepted', 'text', long, 10, now() - interval '3 days', now() - interval '2 days'),
    (member_id, task, 'revision', 'text', long, 0, now() - interval '90 days', now() - interval '89 days'),
    (member_id, task, 'pending', null, '', 0, now() - interval '2 hours', null),
    (sibling, task, 'pending', 'text', 'Сосед', 0, now() - interval '3 hours', null),
    (stranger, foreign_task, 'pending', 'text', 'Чужой', 0, now(), null);
  update public.submissions set comment = 'Отличная работа, спасибо!' where status = 'accepted';
  update public.submissions set comment = 'Доработай' where status = 'revision';

  -- The team leader: the whole team, newest first, without the empty placeholder and without another team.
  rows := public.app_mentor_submissions(leader);
  assert jsonb_array_length(rows) = 4, 'leader list wrong: ' || jsonb_array_length(rows);
  assert not exists (select 1 from jsonb_array_elements(rows) r where r->>'answer_text' = '' and r->>'status' = 'pending'), 'empty placeholder listed';
  assert (rows->0->>'status') = 'pending' and rows->0->>'answer_text' = long and not (rows->0->>'answer_truncated')::boolean, 'pending work not complete';
  -- Accepted works come without texts (they open on demand); works sent back carry a preview and the comment.
  row := (select r from jsonb_array_elements(rows) r where r->>'status' = 'accepted');
  assert row->>'answer_text' = '' and (row->>'answer_truncated')::boolean and row->>'comment' = '' and (row->>'comment_omitted')::boolean, 'accepted work carries texts: ' || row::text;
  row := (select r from jsonb_array_elements(rows) r where r->>'status' = 'revision');
  assert char_length(row->>'answer_text') = 300 and (row->>'answer_truncated')::boolean and row->>'comment' = 'Доработай', 'work sent back lost its preview or comment: ' || row::text;
  assert rows->0->'tasks'->>'title' = 'Видео' and (rows->0->'tasks'->>'max_points')::int = 10, 'task title missing';

  -- A mentor with review rights: only the branch below, never a neighbour; without the rights: nothing.
  rows := public.app_mentor_submissions(mentor);
  assert jsonb_array_length(rows) = 3 and not exists (select 1 from jsonb_array_elements(rows) r where r->>'user_id' = sibling::text), 'mentor sees beyond the branch';
  update public.users set can_review = false where id = mentor;
  assert public.app_mentor_submissions(mentor) = '[]'::jsonb, 'mentor without rights sees works';
  assert public.app_mentor_submissions(member_id) = '[]'::jsonb, 'a participant sees works';
  assert jsonb_array_length(public.app_mentor_submissions(outsider_leader)) = 1, 'another team leader sees this team';

  assert not has_function_privilege('authenticated', 'public.app_mentor_submissions(uuid)', 'execute'), 'browser reads works directly';
end $$;
rollback;
