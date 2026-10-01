-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  leader uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); other_leader uuid := gen_random_uuid();
  result jsonb;
begin
  insert into public.teams(id,name) values(team, 'templates-' || team), (other_team, 'templates-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false),
    (reviewer,'Reviewer','Branch','Reviewer',reviewer || '@test.invalid',reviewer::text,'test','member',team,true),
    (other_leader,'Other','Other','Leader',other_leader || '@test.invalid',other_leader::text,'test','admin',other_team,false);

  -- Only the team leader sets the shared list; reviewers only read it.
  assert public.app_replace_review_templates(reviewer, array['Отлично']) ? 'forbidden', 'reviewer changed shared templates';

  -- Blank and repeated lines are dropped, order and trimming are kept.
  result := public.app_replace_review_templates(leader, array['  Отличная работа!  ', '', 'Хорошо, но добавь пример', 'Отличная работа!']);
  assert result->'data' = '["Отличная работа!", "Хорошо, но добавь пример"]'::jsonb, 'templates were not cleaned: ' || result;
  assert (select array_agg(body order by position) from public.review_comment_templates where team_id = team)
    = array['Отличная работа!', 'Хорошо, но добавь пример'], 'stored order differs';

  -- Saving again replaces the whole set; another team is untouched.
  perform public.app_replace_review_templates(other_leader, array['Чужая команда']);
  perform public.app_replace_review_templates(leader, array['Только один']);
  assert (select count(*) from public.review_comment_templates where team_id = team) = 1, 'old templates survived a replace';
  assert (select body from public.review_comment_templates where team_id = other_team) = 'Чужая команда', 'another team was changed';

  -- An empty list is allowed and clears the set.
  assert public.app_replace_review_templates(leader, array[]::text[])->'data' = '[]'::jsonb, 'empty list rejected';

  -- Limits.
  assert public.app_replace_review_templates(leader, array[repeat('я', 301)]) ? 'validationError', 'overlong template accepted';
  assert public.app_replace_review_templates(leader, (select array_agg('Шаблон ' || i) from generate_series(1, 13) i)) ? 'validationError', 'more than 12 templates accepted';
  assert (select count(*) from public.review_comment_templates where team_id = team) = 0, 'a rejected save changed data';
end $$;
rollback;
