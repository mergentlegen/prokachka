-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  leader uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); helper uuid := gen_random_uuid(); author uuid := gen_random_uuid();
  neighbour uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); teamless uuid := gen_random_uuid();
  review uuid := gen_random_uuid(); result jsonb; list jsonb; photo uuid := gen_random_uuid();
begin
  insert into public.teams(id,name) values (team, 'reviews-' || team), (other_team, 'other-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id)
    select id, name, 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, tid, review_right, tg
    from (values (leader, 'Руководитель', 'admin', team, false, '860000000000001'), (mentor, 'Наставник', 'member', team, true, '860000000000002'),
      (helper, 'Без прав', 'member', team, false, '860000000000003'), (author, 'Алия', 'member', team, false, null),
      (neighbour, 'Сосед', 'member', team, true, '860000000000004'), (stranger, 'Чужой', 'admin', other_team, false, null),
      (teamless, 'Без команды', 'member', null, false, null)) v(id, name, role, tid, review_right, tg);
  -- leader > mentor > helper > author; the neighbour is a mentor on another branch.
  update public.users set parent_user_id = leader where id in (mentor, neighbour);
  update public.users set parent_user_id = mentor where id = helper;
  update public.users set parent_user_id = helper where id = author;

  -- Checks before anything is written.
  assert public.app_review_save(teamless, gen_random_uuid(), 5, 'Отличный клуб, всем советую', '[]') ? 'validationError', 'someone without a team wrote a review';
  assert public.app_review_save(author, review, 6, 'Отличный клуб, всем советую', '[]') ? 'validationError', 'six stars accepted';
  assert public.app_review_save(author, review, 5, 'Коротко', '[]') ? 'validationError', 'too short a review accepted';

  -- The first review is published at once and tells the nearest mentor with review rights and the team leader.
  result := public.app_review_save(author, review, 5, '  Съездила в первый круиз, всё понравилось!  ', jsonb_build_array(jsonb_build_object(
    'id', photo, 'fullPath', review || '/' || photo || '-full.webp', 'thumbPath', review || '/' || photo || '-thumb.webp', 'width', 1200, 'height', 900)));
  assert (result->>'created')::boolean and result->'data'->>'body' = 'Съездила в первый круиз, всё понравилось!', 'review not saved: ' || result::text;
  assert (select array_agg(recipient_id order by recipient_id) from public.telegram_notification_jobs where kind = 'review' and payload->>'reviewId' = review::text)
    = (select array_agg(id order by id) from unnest(array[leader, mentor]) id), 'wrong people told about the review';

  -- One review per person: a second one with another id is refused, the same id edits it without new messages.
  assert public.app_review_save(author, gen_random_uuid(), 4, 'Хочу написать ещё один отзыв', '[]') ? 'validationError', 'a second review was created';
  result := public.app_review_save(author, review, 4, 'Исправила отзыв: всё понравилось, кроме погоды.', '[]');
  assert not (result->>'created')::boolean and (result->'data'->>'rating')::int = 4 and result->'data'->>'edited_at' is not null, 'review not edited';
  assert (select count(*) from public.telegram_notification_jobs where kind = 'review') = 2, 'an edit sent messages again';
  assert exists (select 1 from public.announcement_photo_cleanup_queue where storage_path = review || '/' || photo || '-full.webp'), 'a removed photo was not queued for cleanup';

  -- Everyone sees it; only the right people may delete it.
  list := public.app_reviews(stranger, 300);
  assert (list->'summary'->>'count')::int = 1 and (list->'summary'->>'average')::numeric = 4 and (list->'summary'->'stars'->>'4')::int = 1, 'wrong summary: ' || list::text;
  assert list->'reviews'->0->>'author_name' = 'Алия' and list->'reviews'->0->>'team_name' = 'reviews-' || team, 'author not shown';
  assert not (list->'reviews'->0->>'can_delete')::boolean, 'another team may delete';
  assert (public.app_reviews(leader, 300)->'reviews'->0->>'can_delete')::boolean, 'the team leader may not delete';
  assert (public.app_reviews(mentor, 300)->'reviews'->0->>'can_delete')::boolean, 'the mentor above may not delete';
  assert not (public.app_reviews(helper, 300)->'reviews'->0->>'can_delete')::boolean, 'a member without review rights may delete';
  assert not (public.app_reviews(neighbour, 300)->'reviews'->0->>'can_delete')::boolean, 'a mentor of another branch may delete';
  assert (public.app_reviews(author, 300)->'reviews'->0->>'can_delete')::boolean, 'the author may not delete';
  assert public.app_review_delete(stranger, review, false) ? 'forbidden', 'another team deleted the review';
  assert public.app_review_delete(neighbour, review, false) ? 'forbidden', 'another branch deleted the review';
  result := public.app_review_delete(mentor, review, false);
  assert (result->>'deleted')::boolean and not (result->>'own')::boolean and result->>'authorName' = 'Алия', 'mentor could not delete: ' || result::text;
  assert not exists (select 1 from public.reviews where id = review), 'review still there';
  assert public.app_review_delete(mentor, review, false) ? 'notFound', 'deleted twice';

  -- After deleting, the author may write again; the CEO may delete anything.
  review := gen_random_uuid();
  assert (public.app_review_save(author, review, 3, 'Второй раз пишу отзыв, уже спокойнее.', '[]')->>'created')::boolean, 'cannot write again after deleting';
  assert (public.app_review_delete(null, review, true)->>'deleted')::boolean, 'the CEO could not delete';

  assert not has_function_privilege('authenticated', 'public.app_review_save(uuid,uuid,integer,text,jsonb)', 'execute'), 'browser writes reviews directly';
  assert not has_function_privilege('anon', 'public.app_reviews(uuid,integer)', 'execute'), 'anonymous visitors read reviews directly';
end $$;
rollback;
