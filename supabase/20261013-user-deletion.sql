-- Apply after task feedback and profile avatar migrations. Safe to reapply.
begin;

create table if not exists public.user_auth_cleanup_queue (
  auth_user_id uuid primary key,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid
);
create index if not exists user_auth_cleanup_due_idx on public.user_auth_cleanup_queue(next_attempt_at);
alter table public.user_auth_cleanup_queue enable row level security;
revoke all on public.user_auth_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.user_auth_cleanup_queue to service_role;

create table if not exists public.task_attachment_cleanup_queue (
  storage_path text primary key check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid
);
create index if not exists task_attachment_cleanup_due_idx on public.task_attachment_cleanup_queue(next_attempt_at);
alter table public.task_attachment_cleanup_queue enable row level security;
revoke all on public.task_attachment_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on public.task_attachment_cleanup_queue to service_role;

create or replace function public.queue_retired_task_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_attachment_cleanup_queue(storage_path) values(old.storage_path)
    on conflict do nothing;
  return null;
end $$;
drop trigger if exists task_attachment_retire_blob on public.task_attachments;
create trigger task_attachment_retire_blob after delete on public.task_attachments
  for each row execute function public.queue_retired_task_attachment();

-- A single transaction avoids a half-deleted account and preserves branch privacy.
-- Preview is advisory; the same counts are recomputed under the hierarchy lock on delete.
create or replace function public.app_delete_user(p_target uuid, p_preview boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account public.users%rowtype;
  impact jsonb;
begin
  perform pg_advisory_xact_lock(20260917, 1);
  select * into account from public.users where id = p_target for update;
  if not found then return jsonb_build_object('notFound', true); end if;
  if account.role = 'ceo' then return jsonb_build_object('forbidden', true); end if;

  with affected_tasks as (
    select t.id from public.tasks t
    where t.audience_root_id = p_target
      or t.program_id in (select p.id from public.task_programs p where p.audience_root_id = p_target)
  )
  select jsonb_build_object(
    'children', (select count(*) from public.users u where u.parent_user_id = p_target),
    'tasks', (select count(*) from affected_tasks),
    'programs', (select count(*) from public.task_programs p where p.audience_root_id = p_target),
    'announcements', (select count(*) from public.announcements a where a.audience_root_id = p_target or a.author_id = p_target),
    'otherSubmissions', (select count(*) from public.submissions s join affected_tasks t on t.id = s.task_id where s.user_id <> p_target)
  ) into impact;
  if p_preview then return jsonb_build_object('impact', impact); end if;

  -- Never replace a branch audience with NULL: that would publish it team-wide.
  delete from public.announcements where audience_root_id = p_target;
  delete from public.tasks where audience_root_id = p_target;
  delete from public.task_programs where audience_root_id = p_target;
  -- On deleting a root, children become independent roots; no arbitrary mentor is chosen.
  update public.users set parent_user_id = account.parent_user_id where parent_user_id = p_target;
  if account.auth_user_id is not null then
    insert into public.user_auth_cleanup_queue(auth_user_id) values(account.auth_user_id)
      on conflict do nothing;
  end if;
  delete from public.users where id = p_target;
  if not found then raise exception 'User deletion lost target row'; end if;
  return jsonb_build_object('deleted', true, 'impact', impact, 'authUserId', account.auth_user_id);
end $$;

create or replace function public.app_claim_user_cleanup(p_limit integer default 20)
returns setof public.user_auth_cleanup_queue language plpgsql security definer set search_path = '' as $$
begin
  return query with due as (
    select q.auth_user_id from public.user_auth_cleanup_queue q
    where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and not exists (select 1 from public.users u where u.auth_user_id = q.auth_user_id)
    order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
  ) update public.user_auth_cleanup_queue q set lease_until = now() + interval '5 minutes',
    lease_token = gen_random_uuid(), attempts = attempts + 1
    from due where q.auth_user_id = due.auth_user_id returning q.*;
end $$;

create or replace function public.app_ack_user_cleanup(p_auth_user_id uuid, p_lease uuid, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_success then
    delete from public.user_auth_cleanup_queue where auth_user_id = p_auth_user_id and lease_token = p_lease;
  else
    update public.user_auth_cleanup_queue set lease_until = null, lease_token = null,
      next_attempt_at = now() + make_interval(secs => least(86400, 60 * power(2, least(attempts, 10)))::integer)
      where auth_user_id = p_auth_user_id and lease_token = p_lease;
  end if;
end $$;

create or replace function public.app_claim_task_attachment_cleanup(p_limit integer default 30)
returns setof public.task_attachment_cleanup_queue language plpgsql security definer set search_path = '' as $$
begin
  return query with due as (
    select q.storage_path from public.task_attachment_cleanup_queue q
    where q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and not exists (select 1 from public.task_attachments a where a.storage_path = q.storage_path)
    order by q.next_attempt_at limit greatest(1, least(p_limit, 100)) for update of q skip locked
  ) update public.task_attachment_cleanup_queue q set lease_until = now() + interval '5 minutes',
    lease_token = gen_random_uuid(), attempts = attempts + 1
    from due where q.storage_path = due.storage_path returning q.*;
end $$;

create or replace function public.app_ack_task_attachment_cleanup(p_path text, p_lease uuid, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_success then
    delete from public.task_attachment_cleanup_queue where storage_path = p_path and lease_token = p_lease;
  else
    update public.task_attachment_cleanup_queue set lease_until = null, lease_token = null,
      next_attempt_at = now() + make_interval(secs => least(86400, 60 * power(2, least(attempts, 10)))::integer)
      where storage_path = p_path and lease_token = p_lease;
  end if;
end $$;

revoke all on function public.queue_retired_task_attachment(),
  public.app_delete_user(uuid,boolean), public.app_claim_user_cleanup(integer),
  public.app_ack_user_cleanup(uuid,uuid,boolean), public.app_claim_task_attachment_cleanup(integer),
  public.app_ack_task_attachment_cleanup(text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.app_delete_user(uuid,boolean), public.app_claim_user_cleanup(integer),
  public.app_ack_user_cleanup(uuid,uuid,boolean), public.app_claim_task_attachment_cleanup(integer),
  public.app_ack_task_attachment_cleanup(text,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
