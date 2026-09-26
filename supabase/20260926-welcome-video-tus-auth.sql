-- Allow direct browser TUS uploads without exposing the service-role key.
-- Each authenticated app upload gets one random, short-lived path capability.
begin;

create table if not exists public.welcome_video_upload_intents (
  storage_path text primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists welcome_video_upload_intents_expiry_idx
  on public.welcome_video_upload_intents(expires_at);

alter table public.welcome_video_upload_intents enable row level security;
revoke all on public.welcome_video_upload_intents from public, anon, authenticated;
grant select, insert, update, delete on public.welcome_video_upload_intents to service_role;

create or replace function public.welcome_video_upload_path_allowed(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.welcome_video_upload_intents i
    where i.storage_path = p_storage_path
      and i.expires_at > statement_timestamp()
  );
$$;
revoke all on function public.welcome_video_upload_path_allowed(text) from public;
grant execute on function public.welcome_video_upload_path_allowed(text) to anon, authenticated, service_role;

drop policy if exists welcome_videos_server_only on storage.objects;
drop policy if exists welcome_video_upload_insert_guard on storage.objects;
drop policy if exists welcome_video_upload_insert_intent on storage.objects;
drop policy if exists welcome_videos_select_server_only on storage.objects;
drop policy if exists welcome_videos_update_server_only on storage.objects;
drop policy if exists welcome_videos_delete_server_only on storage.objects;

-- Other buckets remain unaffected. A welcome-video object can only be created
-- at a random path issued by the authenticated application backend.
create policy welcome_video_upload_insert_guard on storage.objects
  as restrictive for insert to anon, authenticated
  with check (
    bucket_id <> 'welcome-videos'
    or public.welcome_video_upload_path_allowed(name)
  );
create policy welcome_video_upload_insert_intent on storage.objects
  as permissive for insert to anon, authenticated
  with check (
    bucket_id = 'welcome-videos'
    and public.welcome_video_upload_path_allowed(name)
  );

-- Keep reads, replacement, and deletion private to the service-role backend.
create policy welcome_videos_select_server_only on storage.objects
  as restrictive for select to anon, authenticated
  using (bucket_id <> 'welcome-videos');
create policy welcome_videos_update_server_only on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'welcome-videos')
  with check (bucket_id <> 'welcome-videos');
create policy welcome_videos_delete_server_only on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'welcome-videos');

notify pgrst, 'reload schema';
commit;
