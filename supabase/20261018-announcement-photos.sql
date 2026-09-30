-- Private, optimized announcement galleries. Safe to apply more than once.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-photos', 'announcement-photos', false, 2097152, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists announcement_photos_server_only on storage.objects;
create policy announcement_photos_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'announcement-photos')
  with check (bucket_id <> 'announcement-photos');

alter table public.announcements add column if not exists photos jsonb not null default '[]'::jsonb;

create or replace function public.app_announcement_photos_valid(p_id uuid, p_photos jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare photo jsonb; prefix text := p_id::text || '/';
begin
  if jsonb_typeof(p_photos) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_photos) > 6 then return false; end if;
  for photo in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(photo) is distinct from 'object'
      or coalesce(photo->>'id','') !~ '^[0-9a-f-]{36}$'
      or photo->>'fullPath' is distinct from prefix || (photo->>'id') || '-full.webp'
      or photo->>'thumbPath' is distinct from prefix || (photo->>'id') || '-thumb.webp'
      or coalesce(photo->>'width','') !~ '^[0-9]{1,5}$'
      or coalesce(photo->>'height','') !~ '^[0-9]{1,5}$' then return false; end if;
    if (photo->>'width')::integer not between 1 and 2400
      or (photo->>'height')::integer not between 1 and 2400 then return false; end if;
  end loop;
  return true;
end $$;
alter table public.announcements drop constraint if exists announcements_photos_valid;
alter table public.announcements add constraint announcements_photos_valid
  check (public.app_announcement_photos_valid(id, photos));

create table if not exists public.announcement_photo_cleanup_queue (
  storage_path text primary key,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0
);
create index if not exists announcement_photo_cleanup_due_idx
  on public.announcement_photo_cleanup_queue(next_attempt_at);
alter table public.announcement_photo_cleanup_queue enable row level security;
revoke all on public.announcement_photo_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.announcement_photo_cleanup_queue to service_role;

create or replace function public.queue_retired_announcement_photos()
returns trigger language plpgsql security definer set search_path = public as $$
declare photo jsonb;
begin
  for photo in select value from jsonb_array_elements(old.photos) loop
    if tg_op = 'UPDATE' then
      if exists (select 1 from jsonb_array_elements(new.photos) current_photo
        where current_photo->>'id' = photo->>'id') then continue; end if;
    end if;
    insert into public.announcement_photo_cleanup_queue(storage_path)
    values (photo->>'fullPath'), (photo->>'thumbPath') on conflict do nothing;
  end loop;
  return null;
end $$;
drop trigger if exists announcements_retire_photos on public.announcements;
create trigger announcements_retire_photos after update of photos or delete on public.announcements
  for each row execute function public.queue_retired_announcement_photos();

create or replace function public.app_claim_announcement_photo_cleanup(p_limit integer default 30)
returns setof public.announcement_photo_cleanup_queue language plpgsql security definer set search_path = public as $$
begin
  -- Clear stale intents for files already committed to a live announcement.
  delete from public.announcement_photo_cleanup_queue q
    where q.next_attempt_at <= now() and exists (select 1 from public.announcements a,
      jsonb_array_elements(a.photos) photo
      where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path);
  return query with due as (
    select q.storage_path from public.announcement_photo_cleanup_queue q
    where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and not exists (select 1 from public.announcements a,
        jsonb_array_elements(a.photos) photo
        where photo->>'fullPath' = q.storage_path or photo->>'thumbPath' = q.storage_path)
    order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
  ) update public.announcement_photo_cleanup_queue q
    set lease_until = now() + interval '5 minutes', lease_token = gen_random_uuid(), attempts = attempts + 1
    from due where q.storage_path = due.storage_path returning q.*;
end $$;

create or replace function public.app_ack_announcement_photo_cleanup(p_path text, p_lease uuid, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    delete from public.announcement_photo_cleanup_queue where storage_path = p_path and lease_token = p_lease;
  else
    update public.announcement_photo_cleanup_queue set lease_until = null, lease_token = null,
      next_attempt_at = now() + make_interval(secs => least(86400, 60 * power(2, least(attempts, 10)))::integer)
      where storage_path = p_path and lease_token = p_lease;
  end if;
end $$;

revoke all on function public.app_announcement_photos_valid(uuid,jsonb),
  public.queue_retired_announcement_photos(), public.app_claim_announcement_photo_cleanup(integer),
  public.app_ack_announcement_photo_cleanup(text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.app_claim_announcement_photo_cleanup(integer),
  public.app_ack_announcement_photo_cleanup(text,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
