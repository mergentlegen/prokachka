-- Upgrade the first welcome-video schema to one inherited video per mentor.
-- On Free Storage projects, align both the bucket and row limit to 50 MiB.
begin;

do $$
begin
  if to_regclass('public.welcome_videos') is null then
    raise exception 'welcome_videos is missing; apply 20260926-welcome-videos.sql first';
  end if;
end $$;

-- Convert the former team-default video into the root mentor's own video.
-- Do not silently overwrite an existing root video: fail transactionally instead.
with roots as (
  select distinct on (u.team_id) u.team_id, u.id
  from public.users u
  where u.role = 'admin' and u.parent_user_id is null
  order by u.team_id, u.created_at nulls first, u.id
)
update public.welcome_videos v
set owner_user_id = roots.id
from roots
where v.team_id = roots.team_id
  and v.owner_user_id is null
  and not exists (
    select 1 from public.welcome_videos owned
    where owned.team_id = v.team_id and owned.owner_user_id = roots.id
  );

do $$
begin
  if exists (select 1 from public.welcome_videos where owner_user_id is null) then
    raise exception 'Cannot safely assign a legacy team video: no root admin exists or the root already has a video. Inspect welcome_videos before retrying.';
  end if;
  if exists (select 1 from public.welcome_videos where size_bytes > 52428800) then
    raise exception 'A saved welcome video exceeds the new 50 MiB Free-plan limit. Review it before applying the file-size constraint.';
  end if;
end $$;

drop index if exists public.welcome_videos_team_default_unique_idx;
drop index if exists public.welcome_videos_owner_unique_idx;
drop index if exists public.welcome_videos_team_owner_idx;
alter table public.welcome_videos alter column owner_user_id set not null;
create unique index welcome_videos_owner_unique_idx
  on public.welcome_videos(team_id, owner_user_id);

alter table public.welcome_videos drop constraint if exists welcome_videos_size_bytes_check;
alter table public.welcome_videos add constraint welcome_videos_size_bytes_check
  check (size_bytes between 1024 and 52428800);
alter table public.welcome_videos drop constraint if exists welcome_video_landscape_16_9;
alter table public.welcome_videos drop constraint if exists welcome_videos_width_check;
alter table public.welcome_videos drop constraint if exists welcome_videos_height_check;
alter table public.welcome_videos add constraint welcome_video_dimensions_sane
  check (width between 1 and 7680 and height between 1 and 7680);

create or replace function public.app_set_welcome_video(
  p_team_id uuid, p_owner_user_id uuid, p_storage_path text, p_file_name text,
  p_size_bytes bigint, p_duration_seconds numeric, p_width integer, p_height integer
) returns text language plpgsql security definer set search_path = public as $$
declare previous_path text;
begin
  if p_owner_user_id is null then
    raise exception 'A welcome video must have an owner';
  end if;
  select storage_path into previous_path from public.welcome_videos
    where team_id = p_team_id and owner_user_id = p_owner_user_id for update;
  insert into public.welcome_videos(team_id, owner_user_id, storage_path, file_name, size_bytes, duration_seconds, width, height)
  values (p_team_id, p_owner_user_id, p_storage_path, p_file_name, p_size_bytes, p_duration_seconds, p_width, p_height)
  on conflict (team_id, owner_user_id) do update set
    storage_path = excluded.storage_path, file_name = excluded.file_name, size_bytes = excluded.size_bytes,
    duration_seconds = excluded.duration_seconds, width = excluded.width, height = excluded.height;
  return previous_path;
end;
$$;
revoke all on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) from public, anon, authenticated;
grant execute on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) to service_role;

update storage.buckets
set public = false, file_size_limit = 52428800, allowed_mime_types = array['video/mp4']
where id = 'welcome-videos';

notify pgrst, 'reload schema';
commit;
