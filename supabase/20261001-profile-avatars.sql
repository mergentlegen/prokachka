-- Existing installations: apply this file once in Supabase SQL Editor.
-- Reapplying is safe. Photos stay private; only the application signs read URLs.
begin;

alter table public.users add column if not exists avatar_path text;
alter table public.users add column if not exists profile_updated_at timestamptz not null default now();
alter table public.users drop constraint if exists users_avatar_path_owned;
alter table public.users add constraint users_avatar_path_owned check (
  avatar_path is null or (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' and split_part(avatar_path,'/',1) = id::text)
);
create unique index if not exists users_avatar_path_unique_idx on public.users(avatar_path) where avatar_path is not null;

create table if not exists public.profile_avatar_uploads (
  storage_path text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '1 hour',
  constraint profile_avatar_upload_owned check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' and split_part(storage_path,'/',1) = user_id::text)
);
create index if not exists profile_avatar_uploads_expiry_idx on public.profile_avatar_uploads(expires_at);
create table if not exists public.profile_avatar_cleanup_queue (
  storage_path text primary key check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0
);
create index if not exists profile_avatar_cleanup_due_idx on public.profile_avatar_cleanup_queue(next_attempt_at);
alter table public.profile_avatar_uploads enable row level security;
alter table public.profile_avatar_cleanup_queue enable row level security;
revoke all on public.profile_avatar_uploads, public.profile_avatar_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.profile_avatar_uploads, public.profile_avatar_cleanup_queue to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-avatars','profile-avatars',false,262144,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists profile_avatars_server_only on storage.objects;
create policy profile_avatars_server_only on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'profile-avatars') with check (bucket_id <> 'profile-avatars');

create or replace function public.queue_retired_profile_avatar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare path text;
begin
  if tg_table_name = 'users' then
    path := old.avatar_path;
    if tg_op = 'UPDATE' and new.avatar_path is not distinct from path then return null; end if;
  else path := old.storage_path;
  end if;
  if path is not null and not exists (select 1 from public.users where avatar_path = path) then
    insert into public.profile_avatar_cleanup_queue(storage_path) values(path) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists users_retire_avatar on public.users;
create trigger users_retire_avatar after update of avatar_path or delete on public.users
  for each row execute function public.queue_retired_profile_avatar();
drop trigger if exists profile_avatar_upload_retired on public.profile_avatar_uploads;
create trigger profile_avatar_upload_retired after delete on public.profile_avatar_uploads
  for each row execute function public.queue_retired_profile_avatar();

create or replace function public.app_update_profile(
  p_user_id uuid, p_first_name text, p_last_name text, p_expected_version timestamptz,
  p_avatar_action text, p_avatar_path text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.users%rowtype; next_path text;
begin
  if coalesce(char_length(trim(p_first_name)),0) not between 2 and 60
    or coalesce(char_length(trim(p_last_name)),0) not between 2 and 80
    or p_avatar_action is null or p_avatar_action not in ('keep','replace','remove') then
    raise exception using errcode='23514', message='Invalid profile';
  end if;
  select * into account from public.users where id=p_user_id for update;
  if not found then return jsonb_build_object('saved',false); end if;
  if p_expected_version is distinct from account.profile_updated_at then return jsonb_build_object('conflict',true); end if;
  next_path := account.avatar_path;
  if p_avatar_action='remove' then next_path := null;
  elsif p_avatar_action='replace' then
    perform 1 from public.profile_avatar_uploads where storage_path=p_avatar_path and user_id=p_user_id and expires_at > now() for update;
    if not found or not exists (select 1 from storage.objects where bucket_id='profile-avatars' and name=p_avatar_path) then
      raise exception using errcode='23514', message='Avatar upload is unavailable';
    end if;
    next_path := p_avatar_path;
  end if;
  update public.users set first_name=trim(p_first_name), last_name=trim(p_last_name),
    name=trim(p_first_name)||' '||trim(p_last_name), avatar_path=next_path, profile_updated_at=clock_timestamp()
    where id=p_user_id;
  if p_avatar_action='replace' then delete from public.profile_avatar_uploads where storage_path=p_avatar_path; end if;
  return jsonb_build_object('saved',true);
end $$;

create or replace function public.app_claim_profile_avatar_cleanup(p_limit integer default 30)
returns setof public.profile_avatar_cleanup_queue language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.profile_avatar_uploads where storage_path in (
    select storage_path from public.profile_avatar_uploads where expires_at < now()
    order by expires_at limit 100 for update skip locked
  );
  return query with due as (
    select q.storage_path from public.profile_avatar_cleanup_queue q
    where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and not exists (select 1 from public.users u where u.avatar_path=q.storage_path)
      and not exists (select 1 from public.profile_avatar_uploads i where i.storage_path=q.storage_path)
    order by q.next_attempt_at limit greatest(1,least(p_limit,100)) for update of q skip locked
  ) update public.profile_avatar_cleanup_queue q set lease_until=now()+interval '5 minutes',
      lease_token=gen_random_uuid(), attempts=attempts+1 from due where q.storage_path=due.storage_path returning q.*;
end $$;
create or replace function public.app_ack_profile_avatar_cleanup(p_path text,p_lease uuid,p_status integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status between 200 and 299 or p_status=404 then
    delete from public.profile_avatar_cleanup_queue where storage_path=p_path and lease_token=p_lease;
  else
    update public.profile_avatar_cleanup_queue set lease_until=null,lease_token=null,
      next_attempt_at=now()+make_interval(secs=>least(86400,60*power(2,least(attempts,10)))::integer)
      where storage_path=p_path and lease_token=p_lease;
  end if;
end $$;

-- Extend the existing aggregate without changing rating/scoping behavior.
drop function if exists public.app_ranking(uuid,text);
create function public.app_ranking(p_team_id uuid,p_metric text)
returns table(id uuid,name text,points bigint,avatar_path text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_metric='points' then
    return query select u.id,u.name,coalesce(s.total,0)::bigint,u.avatar_path from public.users u
      left join (select s.user_id,sum(s.points)::bigint total from public.submissions s
        join public.users recipient on recipient.id=s.user_id
        where s.status='accepted' and (p_team_id is null or recipient.team_id=p_team_id) group by s.user_id) s on s.user_id=u.id
      where u.role='member' and (p_team_id is null or u.team_id=p_team_id);
  elsif p_metric='stars' then
    return query select u.id,u.name,coalesce(a.total,0)::bigint,u.avatar_path from public.users u
      left join (select a.user_id,sum(a.stars)::bigint total from public.star_awards a
        where p_team_id is null or a.team_id=p_team_id group by a.user_id) a on a.user_id=u.id
      where u.role='member' and (p_team_id is null or u.team_id=p_team_id);
  else raise exception 'Unknown ranking metric'; end if;
end $$;

revoke all on function public.queue_retired_profile_avatar(),public.app_update_profile(uuid,text,text,timestamptz,text,text),
  public.app_claim_profile_avatar_cleanup(integer),public.app_ack_profile_avatar_cleanup(text,uuid,integer),public.app_ranking(uuid,text)
  from public,anon,authenticated;
grant execute on function public.app_update_profile(uuid,text,text,timestamptz,text,text),public.app_claim_profile_avatar_cleanup(integer),
  public.app_ack_profile_avatar_cleanup(text,uuid,integer),public.app_ranking(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
