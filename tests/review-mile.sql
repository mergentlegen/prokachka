-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); author uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  task uuid := gen_random_uuid(); review uuid := gen_random_uuid();
  miles bigint;
begin
  insert into public.teams(id,name) values (team, 'mile-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    select id, 'User', 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, team
    from (values (leader, 'admin'), (author, 'member'), (other, 'member')) v(id, role);
  update public.users set parent_user_id = leader where id in (author, other);
  insert into public.tasks(id,title,description,team_id,max_points,publication_type) values (task,'Задание','Задание',team,10,'evergreen');
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points) values (author, task, 'accepted', 'text', 'Ответ', 10);

  select points into miles from public.app_ranking(team, 'points') where id = author;
  assert miles = 10, 'miles before the review: ' || miles;

  -- A review adds 1 mile, an edit does not add another, deleting it takes the mile back.
  perform public.app_review_save(author, review, 5, 'Отличный клуб, всем советую!', '[]');
  select points into miles from public.app_ranking(team, 'points') where id = author;
  assert miles = 11, 'no mile for the review: ' || miles;
  perform public.app_review_save(author, review, 4, 'Исправленный отзыв о клубе.', '[]');
  select points into miles from public.app_ranking(team, 'points') where id = author;
  assert miles = 11, 'an edit paid again: ' || miles;
  assert (select points from public.app_ranking(team, 'points') where id = other) = 0, 'someone without a review got a mile';
  perform public.app_review_delete(leader, review, false);
  select points into miles from public.app_ranking(team, 'points') where id = author;
  assert miles = 10, 'the mile stayed after deleting: ' || miles;
end $$;
rollback;
