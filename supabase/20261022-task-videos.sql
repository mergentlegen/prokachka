-- Protected task videos: mentors upload into a private bucket, the server compresses them,
-- participants watch through short-lived links and the site remembers how far each one watched.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- 1. Private bucket. Originals up to 1 GB (phones record big files); the compressed copy is far smaller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-videos', 'task-videos', false, 1073741824, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. One video per task. While a replacement is being compressed, the previous file keeps playing.
create table if not exists public.task_videos (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  status text not null check (status in ('processing', 'ready', 'failed')),
  source_path text check (source_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'),
  video_path text check (video_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
  file_name text not null default '' check (char_length(file_name) <= 180),
  source_size_bytes bigint check (source_size_bytes between 1024 and 1073741824),
  size_bytes bigint check (size_bytes > 0),
  duration_seconds numeric(8, 2) check (duration_seconds > 0 and duration_seconds <= 1200),
  width integer check (width between 1 and 7680),
  height integer check (height between 1 and 7680),
  attempts integer not null default 0,
  lease_until timestamptz,
  lease_token uuid,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'processing' or source_path is not null),
  check (status <> 'ready' or (video_path is not null and duration_seconds is not null))
);
create index if not exists task_videos_processing_idx on public.task_videos(updated_at) where status = 'processing';

-- 3. A random upload path is a one-time capability issued by the backend after its permission check.
create table if not exists public.task_video_upload_intents (
  storage_path text primary key check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists task_video_upload_intents_expiry_idx on public.task_video_upload_intents(expires_at);

-- 4. Files that are no longer used wait here until the cleanup worker removes them from Storage.
create table if not exists public.task_video_cleanup_queue (
  storage_path text primary key check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_status integer
);
create index if not exists task_video_cleanup_due_idx on public.task_video_cleanup_queue(next_attempt_at);

-- 5. One signed link per file is shared by viewers for a while, so the CDN can serve it.
create table if not exists public.task_video_url_cache (
  storage_path text primary key,
  signed_url text not null,
  refresh_at timestamptz not null
);

-- 6. How far each participant has watched. Replacing the video restarts unfinished progress.
create table if not exists public.task_video_views (
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  video_path text not null,
  watched_seconds numeric(8, 2) not null default 0 check (watched_seconds >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.task_videos enable row level security;
alter table public.task_video_upload_intents enable row level security;
alter table public.task_video_cleanup_queue enable row level security;
alter table public.task_video_url_cache enable row level security;
alter table public.task_video_views enable row level security;
revoke all on public.task_videos, public.task_video_upload_intents, public.task_video_cleanup_queue,
  public.task_video_url_cache, public.task_video_views from public, anon, authenticated;
grant select, insert, update, delete on public.task_videos, public.task_video_upload_intents, public.task_video_cleanup_queue,
  public.task_video_url_cache, public.task_video_views to service_role;

-- Storage: the browser may only create an object at a path the backend issued; everything else is server-only.
create or replace function public.task_video_upload_path_allowed(p_storage_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.task_video_upload_intents i where i.storage_path = p_storage_path and i.expires_at > statement_timestamp());
$$;
revoke all on function public.task_video_upload_path_allowed(text) from public;
grant execute on function public.task_video_upload_path_allowed(text) to anon, authenticated, service_role;

drop policy if exists task_video_upload_insert_guard on storage.objects;
drop policy if exists task_video_upload_insert_intent on storage.objects;
drop policy if exists task_videos_select_server_only on storage.objects;
drop policy if exists task_videos_update_server_only on storage.objects;
drop policy if exists task_videos_delete_server_only on storage.objects;
create policy task_video_upload_insert_guard on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'task-videos' or public.task_video_upload_path_allowed(name));
create policy task_video_upload_insert_intent on storage.objects as permissive for insert to anon, authenticated
  with check (bucket_id = 'task-videos' and public.task_video_upload_path_allowed(name));
create policy task_videos_select_server_only on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'task-videos');
create policy task_videos_update_server_only on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'task-videos') with check (bucket_id <> 'task-videos');
create policy task_videos_delete_server_only on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'task-videos');

-- Any file that stops being referenced is queued for deletion; nothing is deleted while still in use.
create or replace function public.task_video_retire_paths()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'task_video_upload_intents' then
    insert into public.task_video_cleanup_queue(storage_path) values (old.storage_path) on conflict do nothing;
    return old;
  end if;
  if tg_op = 'DELETE' then
    insert into public.task_video_cleanup_queue(storage_path)
      select p from unnest(array[old.source_path, old.video_path]) p where p is not null on conflict do nothing;
    return old;
  end if;
  insert into public.task_video_cleanup_queue(storage_path)
    select p from unnest(array[old.source_path, old.video_path]) p
    where p is not null and p is distinct from new.source_path and p is distinct from new.video_path
    on conflict do nothing;
  return new;
end $$;
drop trigger if exists task_video_retire_blob on public.task_videos;
create trigger task_video_retire_blob after update of source_path, video_path or delete on public.task_videos
  for each row execute function public.task_video_retire_paths();
drop trigger if exists task_video_retire_upload on public.task_video_upload_intents;
create trigger task_video_retire_upload after delete on public.task_video_upload_intents
  for each row execute function public.task_video_retire_paths();

-- Pages refresh when a video becomes ready, fails or is removed.
create or replace function public.broadcast_task_video_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare row_team uuid;
begin
  row_team := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  perform realtime.send(jsonb_build_object('topics', array['tasks'], 'teamIds', array[row_team::text], 'userIds', array[]::text[]),
    'changed', 'prokachka:changes', true);
  return null;
end $$;
drop trigger if exists task_video_broadcast on public.task_videos;
create trigger task_video_broadcast after insert or update of status, video_path or delete on public.task_videos
  for each row execute function public.broadcast_task_video_change();

-- Same rule as editing the task: the team leader, or the participant-publisher for their own task.
create or replace function public.app_task_video_can_manage(p_actor uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t join public.users a on a.id = p_actor
    where t.id = p_task and t.interactive_kind is null and a.team_id = t.team_id
      and (a.role = 'admin' or (a.can_publish_tasks and t.publisher_id = a.id))
  );
$$;

create or replace function public.app_task_video_begin_upload(p_actor uuid, p_task uuid, p_path text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.app_task_video_can_manage(p_actor, p_task)
    or p_path not like (select team_id::text || '/' || id::text || '/%' from public.tasks where id = p_task) then return false; end if;
  insert into public.task_video_upload_intents(storage_path, task_id, user_id, expires_at) values (p_path, p_task, p_actor, now() + interval '3 hours');
  return true;
end $$;

-- The uploaded original replaces the previous one and waits for compression.
create or replace function public.app_task_video_register(p_actor uuid, p_task uuid, p_path text, p_file_name text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare task_team uuid;
begin
  if not public.app_task_video_can_manage(p_actor, p_task) then return jsonb_build_object('forbidden', true); end if;
  if not exists (select 1 from public.task_video_upload_intents where storage_path = p_path and task_id = p_task and user_id = p_actor and expires_at > now()) then
    return jsonb_build_object('validationError', 'Загрузка устарела. Выберите видео ещё раз.');
  end if;
  select team_id into task_team from public.tasks where id = p_task;
  insert into public.task_videos(task_id, team_id, uploaded_by, status, source_path, file_name, source_size_bytes)
    values (p_task, task_team, p_actor, 'processing', p_path, left(coalesce(p_file_name, ''), 180), p_size)
  on conflict (task_id) do update set uploaded_by = excluded.uploaded_by, status = 'processing', source_path = excluded.source_path,
    file_name = excluded.file_name, source_size_bytes = excluded.source_size_bytes, attempts = 0, lease_until = null,
    lease_token = null, last_error = null, updated_at = now();
  -- Registered: the intent is spent. Its trigger queues the path, but cleanup skips files still in use.
  delete from public.task_video_upload_intents where storage_path = p_path;
  return jsonb_build_object('data', true);
end $$;

-- The compression worker takes one video at a time; a crashed run is retried, at most three times.
create or replace function public.app_task_video_claim()
returns table(task_id uuid, team_id uuid, source_path text, lease_token uuid, attempts integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  update public.task_videos v set status = case when v.video_path is null then 'failed' else 'ready' end,
    last_error = coalesce(v.last_error, 'Не удалось обработать видео.'), source_path = null, lease_until = null, lease_token = null, updated_at = now()
    where v.status = 'processing' and v.attempts >= 3 and (v.lease_until is null or v.lease_until < now());
  return query
    with due as (
      select v.task_id from public.task_videos v
      where v.status = 'processing' and v.attempts < 3 and (v.lease_until is null or v.lease_until < now())
      order by v.updated_at limit 1 for update skip locked
    ) update public.task_videos v set lease_until = now() + interval '45 minutes', lease_token = gen_random_uuid(), attempts = v.attempts + 1
      from due where v.task_id = due.task_id
      returning v.task_id, v.team_id, v.source_path, v.lease_token, v.attempts;
end $$;

-- Applied only if the same original is still current; otherwise the fresh copy is queued for deletion.
create or replace function public.app_task_video_finish(p_task uuid, p_lease uuid, p_source text, p_video text,
  p_size bigint, p_duration numeric, p_width integer, p_height integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.task_videos set status = 'ready', video_path = p_video, source_path = null, size_bytes = p_size,
    duration_seconds = p_duration, width = p_width, height = p_height, lease_until = null, lease_token = null,
    last_error = null, updated_at = now()
  where task_id = p_task and lease_token = p_lease and source_path = p_source;
  if found then return true; end if;
  insert into public.task_video_cleanup_queue(storage_path) values (p_video) on conflict do nothing;
  return false;
end $$;

-- A file that is not a usable video fails at once; a temporary problem is retried by the next run.
create or replace function public.app_task_video_fail(p_task uuid, p_lease uuid, p_error text, p_final boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.task_videos set last_error = left(p_error, 300), lease_until = null, lease_token = null, updated_at = now(),
    status = case when p_final then case when video_path is null then 'failed' else 'ready' end else status end,
    source_path = case when p_final then null else source_path end
  where task_id = p_task and lease_token = p_lease;
end $$;

-- Watching can only move forward about as fast as real time, so the end cannot be reached by one request.
create or replace function public.app_task_video_progress(p_user uuid, p_task uuid, p_position numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare video public.task_videos%rowtype; seen public.task_video_views%rowtype; allowed numeric; watched numeric;
begin
  select * into video from public.task_videos where task_id = p_task;
  if video.task_id is null or video.video_path is null or video.duration_seconds is null then return jsonb_build_object('notFound', true); end if;
  select * into seen from public.task_video_views where user_id = p_user and task_id = p_task for update;
  if seen.user_id is null then
    insert into public.task_video_views(user_id, task_id, video_path, watched_seconds, updated_at) values (p_user, p_task, video.video_path, 0, now())
      returning * into seen;
    allowed := 15;
  elsif seen.video_path <> video.video_path and seen.completed_at is null then
    update public.task_video_views set video_path = video.video_path, watched_seconds = 0, updated_at = now()
      where user_id = p_user and task_id = p_task returning * into seen;
    allowed := 15;
  else
    allowed := seen.watched_seconds + extract(epoch from now() - seen.updated_at) * 2.5 + 15;
  end if;
  watched := greatest(seen.watched_seconds, least(coalesce(p_position, 0), allowed, video.duration_seconds));
  update public.task_video_views set watched_seconds = watched, updated_at = now(),
    completed_at = coalesce(completed_at, case when watched >= video.duration_seconds - 2 then now() end)
  where user_id = p_user and task_id = p_task returning * into seen;
  return jsonb_build_object('data', jsonb_build_object('watchedSeconds', seen.watched_seconds, 'completed', seen.completed_at is not null));
end $$;

-- Concurrent viewers converge on one link per file.
create or replace function public.app_cache_task_video_url(p_path text, p_url text, p_refresh_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare chosen text;
begin
  if not exists (select 1 from public.task_videos where video_path = p_path) then return null; end if;
  insert into public.task_video_url_cache(storage_path, signed_url, refresh_at) values (p_path, p_url, p_refresh_at)
  on conflict (storage_path) do update set signed_url = excluded.signed_url, refresh_at = excluded.refresh_at
    where public.task_video_url_cache.refresh_at <= now()
  returning signed_url into chosen;
  if chosen is null then select signed_url into chosen from public.task_video_url_cache where storage_path = p_path; end if;
  return chosen;
end $$;

create or replace function public.app_claim_task_video_cleanup(p_limit integer default 30)
returns setof public.task_video_cleanup_queue language plpgsql security definer set search_path = public as $$
begin
  -- Abandoned uploads: deleting the intent queues its file.
  delete from public.task_video_upload_intents where storage_path in (
    select storage_path from public.task_video_upload_intents where expires_at < now() order by expires_at limit 100 for update skip locked
  );
  delete from public.task_video_url_cache where storage_path in (
    select storage_path from public.task_video_url_cache where refresh_at < now() limit 100
  );
  return query
    with due as (
      select q.storage_path from public.task_video_cleanup_queue q
      where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
        and not exists (select 1 from public.task_videos v where v.source_path = q.storage_path or v.video_path = q.storage_path)
        and not exists (select 1 from public.task_video_upload_intents i where i.storage_path = q.storage_path)
      order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
    ) update public.task_video_cleanup_queue q set lease_until = now() + interval '5 minutes',
      lease_token = gen_random_uuid(), attempts = attempts + 1 from due where q.storage_path = due.storage_path returning q.*;
end $$;

create or replace function public.app_ack_task_video_cleanup(p_path text, p_lease uuid, p_status integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status between 200 and 299 or p_status = 404 then
    delete from public.task_video_cleanup_queue where storage_path = p_path and lease_token = p_lease;
  else
    update public.task_video_cleanup_queue set lease_until = null, lease_token = null, last_status = p_status,
      next_attempt_at = now() + make_interval(secs => least(86400, 60 * power(2, least(attempts, 10)))::integer)
      where storage_path = p_path and lease_token = p_lease;
  end if;
end $$;

revoke all on function public.task_video_retire_paths(), public.broadcast_task_video_change(),
  public.app_task_video_can_manage(uuid, uuid), public.app_task_video_begin_upload(uuid, uuid, text),
  public.app_task_video_register(uuid, uuid, text, text, bigint), public.app_task_video_claim(),
  public.app_task_video_finish(uuid, uuid, text, text, bigint, numeric, integer, integer),
  public.app_task_video_fail(uuid, uuid, text, boolean), public.app_task_video_progress(uuid, uuid, numeric),
  public.app_cache_task_video_url(text, text, timestamptz), public.app_claim_task_video_cleanup(integer),
  public.app_ack_task_video_cleanup(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.app_task_video_can_manage(uuid, uuid), public.app_task_video_begin_upload(uuid, uuid, text),
  public.app_task_video_register(uuid, uuid, text, text, bigint), public.app_task_video_claim(),
  public.app_task_video_finish(uuid, uuid, text, text, bigint, numeric, integer, integer),
  public.app_task_video_fail(uuid, uuid, text, boolean), public.app_task_video_progress(uuid, uuid, numeric),
  public.app_cache_task_video_url(text, text, timestamptz), public.app_claim_task_video_cleanup(integer),
  public.app_ack_task_video_cleanup(text, uuid, integer) to service_role;
notify pgrst, 'reload schema';
commit;
