-- Private, network-inherited welcome videos and one-time onboarding completion.
begin;

alter table public.users add column if not exists welcome_video_completed_at timestamptz;
-- Existing members have already entered the cabinet; only members joining after
-- deployment should be placed into this onboarding flow.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'app_live_change' and tgrelid = 'public.users'::regclass and not tgisinternal) then
    alter table public.users disable trigger app_live_change;
  end if;
end $$;
update public.users set welcome_video_completed_at = now()
where team_id is not null and welcome_video_completed_at is null;
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'app_live_change' and tgrelid = 'public.users'::regclass and not tgisinternal) then
    alter table public.users enable trigger app_live_change;
  end if;
end $$;

create table if not exists public.welcome_videos (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_user_id uuid references public.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  size_bytes bigint not null check (size_bytes between 1024 and 157286400),
  duration_seconds numeric(7,2) not null check (duration_seconds > 0 and duration_seconds <= 180),
  width integer not null check (width between 640 and 7680),
  height integer not null check (height between 360 and 4320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welcome_video_landscape_16_9 check (abs(width * 9 - height * 16) <= 32)
);

create unique index if not exists welcome_videos_team_default_unique_idx
  on public.welcome_videos(team_id) where owner_user_id is null;
create unique index if not exists welcome_videos_owner_unique_idx
  on public.welcome_videos(team_id, owner_user_id) where owner_user_id is not null;
create index if not exists welcome_videos_team_owner_idx on public.welcome_videos(team_id, owner_user_id);

drop trigger if exists welcome_videos_touch_updated_at on public.welcome_videos;
create trigger welcome_videos_touch_updated_at before update on public.welcome_videos
  for each row execute function public.touch_updated_at();

create or replace function public.app_set_welcome_video(
  p_team_id uuid, p_owner_user_id uuid, p_storage_path text, p_file_name text,
  p_size_bytes bigint, p_duration_seconds numeric, p_width integer, p_height integer
) returns text language plpgsql security definer set search_path = public as $$
declare previous_path text;
begin
  if p_owner_user_id is null then
    select storage_path into previous_path from public.welcome_videos
      where team_id = p_team_id and owner_user_id is null for update;
    insert into public.welcome_videos(team_id, owner_user_id, storage_path, file_name, size_bytes, duration_seconds, width, height)
    values (p_team_id, null, p_storage_path, p_file_name, p_size_bytes, p_duration_seconds, p_width, p_height)
    on conflict (team_id) where owner_user_id is null do update set
      storage_path = excluded.storage_path, file_name = excluded.file_name, size_bytes = excluded.size_bytes,
      duration_seconds = excluded.duration_seconds, width = excluded.width, height = excluded.height;
  else
    select storage_path into previous_path from public.welcome_videos
      where team_id = p_team_id and owner_user_id = p_owner_user_id for update;
    insert into public.welcome_videos(team_id, owner_user_id, storage_path, file_name, size_bytes, duration_seconds, width, height)
    values (p_team_id, p_owner_user_id, p_storage_path, p_file_name, p_size_bytes, p_duration_seconds, p_width, p_height)
    on conflict (team_id, owner_user_id) where owner_user_id is not null do update set
      storage_path = excluded.storage_path, file_name = excluded.file_name, size_bytes = excluded.size_bytes,
      duration_seconds = excluded.duration_seconds, width = excluded.width, height = excluded.height;
  end if;
  return previous_path;
end;
$$;
revoke all on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) from public, anon, authenticated;
grant execute on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) to service_role;

alter table public.welcome_videos enable row level security;
revoke all on public.welcome_videos from anon, authenticated, public;
grant select, insert, update, delete on public.welcome_videos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('welcome-videos', 'welcome-videos', false, 157286400, array['video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists welcome_videos_server_only on storage.objects;
create policy welcome_videos_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'welcome-videos')
  with check (bucket_id <> 'welcome-videos');

create or replace function public.broadcast_welcome_video_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare changed_team text;
begin
  changed_team := case when tg_op = 'DELETE' then old.team_id::text else new.team_id::text end;
  perform realtime.send(jsonb_build_object('topics', array['session'], 'teamIds', array[changed_team],
    'userIds', array[]::text[]), 'changed', 'prokachka:changes', true);
  return null;
exception when others then
  raise log 'Welcome video realtime notification unavailable: SQLSTATE %', sqlstate;
  return null;
end;
$$;
revoke all on function public.broadcast_welcome_video_change() from public, anon, authenticated;
drop trigger if exists welcome_videos_live_change on public.welcome_videos;
create trigger welcome_videos_live_change after insert or update or delete on public.welcome_videos
  for each row execute function public.broadcast_welcome_video_change();

notify pgrst, 'reload schema';
commit;
