-- Existing installations: apply this migration only, after the welcome-video migrations.
begin;

alter table public.welcome_videos drop constraint if exists welcome_videos_size_bytes_check;
alter table public.welcome_videos add constraint welcome_videos_size_bytes_check
  check (size_bytes between 1024 and 209715200);
update storage.buckets set public = false, file_size_limit = 209715200,
  allowed_mime_types = array['video/mp4'] where id = 'welcome-videos';

-- Shared across app processes/restarts. Never expose this table through client RLS.
create table if not exists public.welcome_video_url_cache (
  storage_path text primary key,
  signed_url text not null,
  refresh_at timestamptz not null
);
create table if not exists public.welcome_video_cleanup_queue (
  storage_path text primary key check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_status integer
);
create index if not exists welcome_video_cleanup_due_idx
  on public.welcome_video_cleanup_queue(next_attempt_at);
alter table public.welcome_video_url_cache enable row level security;
alter table public.welcome_video_cleanup_queue enable row level security;
revoke all on public.welcome_video_url_cache, public.welcome_video_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.welcome_video_url_cache, public.welcome_video_cleanup_queue to service_role;

-- Resolve only this member's ancestry, not every account/video in the team.
create or replace function public.app_resolve_welcome_video(p_user_id uuid, p_team_id uuid)
returns setof public.welcome_videos language sql stable security definer set search_path = public as $$
  with recursive account as (
    select id, parent_user_id from public.users
    where id = p_user_id and team_id = p_team_id and role <> 'ceo' and welcome_video_completed_at is null
  ), ancestors as (
    select u.id, u.parent_user_id, u.role, u.can_publish_tasks, 1 as depth, array[a.id, u.id] as visited
    from account a join public.users u on u.id = a.parent_user_id and u.team_id = p_team_id and u.id <> a.id
    union all
    select u.id, u.parent_user_id, u.role, u.can_publish_tasks, a.depth + 1, a.visited || u.id
    from ancestors a join public.users u on u.id = a.parent_user_id and u.team_id = p_team_id
    where not u.id = any(a.visited)
  ), candidates as (
    select v.id, a.depth from ancestors a join public.welcome_videos v on v.owner_user_id = a.id and v.team_id = p_team_id
    where a.role = 'admin' or a.can_publish_tasks
    union all
    select v.id, 2147483647 from public.users u join public.welcome_videos v on v.owner_user_id = u.id and v.team_id = p_team_id
    where exists (select 1 from account) and u.team_id = p_team_id and u.role = 'admin' and u.parent_user_id is null
  ) select v.* from public.welcome_videos v join candidates c on c.id = v.id order by c.depth, v.id limit 1;
$$;

-- Concurrent first viewers must converge on the same token to warm the CDN.
create or replace function public.app_cache_welcome_video_url(p_path text, p_url text, p_refresh_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare chosen text;
begin
  if not exists (select 1 from public.welcome_videos where storage_path = p_path) then return null; end if;
  insert into public.welcome_video_url_cache(storage_path, signed_url, refresh_at) values(p_path, p_url, p_refresh_at)
  on conflict (storage_path) do update set signed_url = excluded.signed_url, refresh_at = excluded.refresh_at
    where welcome_video_url_cache.refresh_at <= now();
  select signed_url into chosen from public.welcome_video_url_cache where storage_path = p_path and refresh_at > now();
  return chosen;
end;
$$;

-- Transactional retirement: old blobs survive only until the cleanup worker succeeds.
create or replace function public.queue_retired_welcome_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'welcome_videos' then
    if tg_op = 'UPDATE' and old.storage_path = new.storage_path then return null; end if;
    delete from public.welcome_video_url_cache where storage_path = old.storage_path;
    insert into public.welcome_video_cleanup_queue(storage_path) values (old.storage_path) on conflict do nothing;
  elsif not exists (select 1 from public.welcome_videos where storage_path = old.storage_path) then
    -- Signed upload tokens last 2h; allow a 24h grace for in-flight TUS requests.
    insert into public.welcome_video_cleanup_queue(storage_path, next_attempt_at)
    values (old.storage_path, greatest(now(), old.expires_at) + interval '24 hours') on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists welcome_video_retire_blob on public.welcome_videos;
create trigger welcome_video_retire_blob after update of storage_path or delete on public.welcome_videos
  for each row execute function public.queue_retired_welcome_video();
drop trigger if exists welcome_video_retire_upload on public.welcome_video_upload_intents;
create trigger welcome_video_retire_upload after delete on public.welcome_video_upload_intents
  for each row execute function public.queue_retired_welcome_video();

-- Serialize replacement of one owner's video and verify the unexpired upload intent
-- in the same transaction. An expired/retired path can never become live again.
create or replace function public.app_set_welcome_video(
  p_team_id uuid, p_owner_user_id uuid, p_storage_path text, p_file_name text,
  p_size_bytes bigint, p_duration_seconds numeric, p_width integer, p_height integer
) returns text language plpgsql security definer set search_path = public as $$
declare previous_path text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_team_id::text || '/' || p_owner_user_id::text, 0));
  if not exists (select 1 from public.users where id = p_owner_user_id and team_id = p_team_id and (role = 'admin' or can_publish_tasks)) then
    raise exception 'welcome_video_forbidden';
  end if;
  select storage_path into previous_path from public.welcome_videos where team_id = p_team_id and owner_user_id = p_owner_user_id for update;
  if previous_path = p_storage_path then return null; end if;
  perform 1 from public.welcome_video_upload_intents where storage_path = p_storage_path
    and team_id = p_team_id and owner_user_id = p_owner_user_id and expires_at > now() for update;
  if not found then raise exception 'welcome_video_upload_expired'; end if;
  insert into public.welcome_videos(team_id, owner_user_id, storage_path, file_name, size_bytes, duration_seconds, width, height)
  values (p_team_id, p_owner_user_id, p_storage_path, p_file_name, p_size_bytes, p_duration_seconds, p_width, p_height)
  on conflict (team_id, owner_user_id) do update set storage_path = excluded.storage_path, file_name = excluded.file_name,
    size_bytes = excluded.size_bytes, duration_seconds = excluded.duration_seconds, width = excluded.width, height = excluded.height;
  delete from public.welcome_video_upload_intents where storage_path = p_storage_path;
  return previous_path;
end;
$$;

create or replace function public.app_claim_welcome_video_cleanup(p_limit integer default 30)
returns setof public.welcome_video_cleanup_queue language plpgsql security definer set search_path = public as $$
begin
  -- Bounded work, independent of site traffic. Deleting intents enqueues abandoned files.
  delete from public.welcome_video_upload_intents where storage_path in (
    select storage_path from public.welcome_video_upload_intents where expires_at < now()
    order by expires_at limit 100 for update skip locked
  );
  delete from public.welcome_video_url_cache where storage_path in (
    select storage_path from public.welcome_video_url_cache where refresh_at < now() limit 100
  );
  return query
    with due as (
      select q.storage_path from public.welcome_video_cleanup_queue q
      where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
        and not exists (select 1 from public.welcome_videos v where v.storage_path = q.storage_path)
        and not exists (select 1 from public.welcome_video_upload_intents i where i.storage_path = q.storage_path)
      order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
    ) update public.welcome_video_cleanup_queue q set lease_until = now() + interval '5 minutes',
      lease_token = gen_random_uuid(), attempts = attempts + 1 from due where q.storage_path = due.storage_path returning q.*;
end;
$$;
create or replace function public.app_ack_welcome_video_cleanup(p_path text, p_lease uuid, p_status integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status between 200 and 299 or p_status = 404 then
    delete from public.welcome_video_cleanup_queue where storage_path = p_path and lease_token = p_lease;
  else
    update public.welcome_video_cleanup_queue set lease_until = null, lease_token = null, last_status = p_status,
      next_attempt_at = now() + make_interval(secs => least(86400, 60 * power(2, least(attempts, 10)))::integer)
      where storage_path = p_path and lease_token = p_lease;
  end if;
end;
$$;

-- Recover legacy orphan blobs, without deleting Storage-managed SQL metadata directly.
insert into public.welcome_video_cleanup_queue(storage_path, next_attempt_at)
select o.name, now() + interval '24 hours' from storage.objects o
where o.bucket_id = 'welcome-videos' and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
  and not exists (select 1 from public.welcome_videos v where v.storage_path = o.name)
  and not exists (select 1 from public.welcome_video_upload_intents i where i.storage_path = o.name)
on conflict do nothing;

revoke all on function public.app_resolve_welcome_video(uuid,uuid), public.app_cache_welcome_video_url(text,text,timestamptz),
  public.queue_retired_welcome_video(), public.app_claim_welcome_video_cleanup(integer),
  public.app_ack_welcome_video_cleanup(text,uuid,integer), public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer)
  from public, anon, authenticated;
grant execute on function public.app_resolve_welcome_video(uuid,uuid), public.app_cache_welcome_video_url(text,text,timestamptz),
  public.app_claim_welcome_video_cleanup(integer), public.app_ack_welcome_video_cleanup(text,uuid,integer),
  public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) to service_role;
notify pgrst, 'reload schema';
commit;
