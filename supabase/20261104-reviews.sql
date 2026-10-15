-- Reviews: every participant can leave one review (stars, text, up to 6 photos), seen by everyone in their team.
-- Each team has its own reviews; the CEO sees every team's, with the team name.
-- It is published at once; the author, the team leader, the mentors above the author and the CEO can delete it.
-- A new review is announced in Telegram to the author's nearest mentor and the team leader.
-- Photos live in the private announcement-photos bucket under the review id, so the existing cleanup worker serves both.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(btrim(body)) between 10 and 2000),
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint reviews_one_per_user unique (user_id),
  constraint reviews_photos_valid check (public.app_announcement_photos_valid(id, photos))
);
create index if not exists reviews_newest_idx on public.reviews(created_at desc, id desc);
alter table public.reviews enable row level security;
revoke all on public.reviews from public, anon, authenticated;
grant select, insert, update, delete on public.reviews to service_role;

-- Photos taken off a review (edited away or the review deleted) go to the same cleanup queue as announcement photos.
drop trigger if exists reviews_retire_photos on public.reviews;
create trigger reviews_retire_photos after update of photos or delete on public.reviews
  for each row execute function public.queue_retired_announcement_photos();

-- The cleanup worker never removes a file that a live announcement or review still shows.
create or replace function public.app_claim_announcement_photo_cleanup(p_limit integer default 30)
returns setof public.announcement_photo_cleanup_queue language plpgsql security definer set search_path = public as $$
begin
  delete from public.announcement_photo_cleanup_queue q
    where q.next_attempt_at <= now() and (exists (select 1 from public.announcements a, jsonb_array_elements(a.photos) photo
        where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path)
      or exists (select 1 from public.reviews r, jsonb_array_elements(r.photos) photo
        where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path));
  return query with due as (
    select q.storage_path from public.announcement_photo_cleanup_queue q
    where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and not exists (select 1 from public.announcements a, jsonb_array_elements(a.photos) photo
        where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path)
      and not exists (select 1 from public.reviews r, jsonb_array_elements(r.photos) photo
        where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path)
    order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
  ) update public.announcement_photo_cleanup_queue q
    set lease_until = now() + interval '5 minutes', lease_token = gen_random_uuid(), attempts = attempts + 1
    from due where q.storage_path = due.storage_path returning q.*;
end $$;

-- Who may delete: the author, the leader of the author's team, mentors with review rights above the author. (The CEO is checked by the server.)
create or replace function public.app_review_can_delete(p_viewer uuid, p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_viewer = p_author or exists (
    select 1 from public.users viewer join public.users author on author.id = p_author
    where viewer.id = p_viewer and viewer.team_id is not null and viewer.team_id = author.team_id
      and (viewer.role = 'admin' or (viewer.role = 'member' and viewer.can_review and viewer.id <> author.id
        and viewer.id in (select a.id from public.tg_ancestor_ids(author.id) a))));
$$;

-- The viewer's team reviews (every team's for the CEO, who has no account id), newest first, with the summary over them.
-- The server adds photo and avatar links.
create or replace function public.app_reviews(p_viewer uuid, p_limit integer default 300)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select r.*, u.name as author_name, u.avatar_path, t.name as team_name
    from public.reviews r join public.users u on u.id = r.user_id left join public.teams t on t.id = u.team_id
    where p_viewer is null or u.team_id = (select viewer.team_id from public.users viewer where viewer.id = p_viewer)
  ), shown as (
    select * from base order by created_at desc, id desc limit greatest(1, least(coalesce(p_limit, 300), 500))
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('count', count(*), 'average', coalesce(round(avg(rating)::numeric, 1), 0),
      'stars', jsonb_build_object('5', count(*) filter (where rating = 5), '4', count(*) filter (where rating = 4),
        '3', count(*) filter (where rating = 3), '2', count(*) filter (where rating = 2), '1', count(*) filter (where rating = 1))) from base),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'user_id', user_id, 'author_name', author_name, 'avatar_path', avatar_path,
      -- Inside a team its name says nothing; the CEO needs it to tell teams apart.
      'team_name', case when p_viewer is null then team_name end,
      'rating', rating, 'body', body, 'photos', photos, 'created_at', created_at, 'edited_at', edited_at,
      'can_delete', p_viewer is not null and public.app_review_can_delete(p_viewer, user_id)
    ) order by created_at desc, id desc) from shown), '[]'::jsonb));
$$;

-- Writes the participant's only review: the first save creates it and tells the mentors, later saves edit it.
create or replace function public.app_review_save(p_user uuid, p_id uuid, p_rating integer, p_body text, p_photos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare author public.users%rowtype; existing public.reviews%rowtype; saved public.reviews%rowtype; mentor uuid;
begin
  select * into author from public.users where id = p_user;
  if author.id is null or author.team_id is null or author.role not in ('member', 'admin') then
    return jsonb_build_object('validationError', 'Отзыв могут оставить участники команды.');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then return jsonb_build_object('validationError', 'Поставьте оценку от 1 до 5 звёзд.'); end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 2000 then return jsonb_build_object('validationError', 'Напишите отзыв: от 10 до 2000 символов.'); end if;
  perform pg_advisory_xact_lock(hashtext('review:' || p_user::text));
  select * into existing from public.reviews where user_id = p_user for update;
  if existing.id is not null and existing.id <> p_id then
    return jsonb_build_object('validationError', 'Ваш отзыв уже изменился. Обновите страницу и попробуйте ещё раз.');
  end if;
  if existing.id is not null then
    update public.reviews set rating = p_rating, body = btrim(p_body), photos = coalesce(p_photos, '[]'::jsonb), updated_at = now(), edited_at = now()
      where id = existing.id returning * into saved;
    return jsonb_build_object('data', to_jsonb(saved), 'created', false);
  end if;
  insert into public.reviews(id, user_id, rating, body, photos) values (p_id, p_user, p_rating, btrim(p_body), coalesce(p_photos, '[]'::jsonb))
    returning * into saved;
  -- The nearest mentor with review rights above the author, and the team leader.
  with recursive up(id, depth) as (
    select parent_user_id, 1 from public.users where id = p_user and parent_user_id is not null
    union all
    select u.parent_user_id, up.depth + 1 from up join public.users u on u.id = up.id where u.parent_user_id is not null and up.depth < 50
  ) select u.id into mentor from up join public.users u on u.id = up.id
    where u.team_id = author.team_id and u.role = 'member' and u.can_review order by up.depth limit 1;
  insert into public.telegram_notification_jobs(recipient_id, kind, payload)
    select m.id, 'review', jsonb_build_object('reviewId', saved.id) from public.users m
    where m.id <> p_user and m.team_id = author.team_id and m.telegram_id is not null and (m.role = 'admin' or m.id = mentor);
  return jsonb_build_object('data', to_jsonb(saved), 'created', true);
end $$;

create or replace function public.app_review_delete(p_viewer uuid, p_review uuid, p_ceo boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare review public.reviews%rowtype; author public.users%rowtype;
begin
  select * into review from public.reviews where id = p_review for update;
  if review.id is null then return jsonb_build_object('notFound', true); end if;
  if not coalesce(p_ceo, false) and (p_viewer is null or not public.app_review_can_delete(p_viewer, review.user_id)) then
    return jsonb_build_object('forbidden', true);
  end if;
  select * into author from public.users where id = review.user_id;
  delete from public.reviews where id = review.id;
  return jsonb_build_object('deleted', true, 'own', p_viewer = review.user_id, 'authorName', author.name, 'teamId', author.team_id, 'rating', review.rating);
end $$;

-- Telegram: a new kind of message for mentors.
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder',
    'task-nudge','announcement','start-reminder','miles-recount','review'));

revoke all on function public.app_review_can_delete(uuid, uuid), public.app_reviews(uuid, integer),
  public.app_review_save(uuid, uuid, integer, text, jsonb), public.app_review_delete(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.app_reviews(uuid, integer), public.app_review_save(uuid, uuid, integer, text, jsonb),
  public.app_review_delete(uuid, uuid, boolean) to service_role;
notify pgrst, 'reload schema';
commit;
