-- Private PDF attachments for mentor-created tasks. Apply once to existing projects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 15728640, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Even broad storage policies elsewhere must not expose this private bucket.
drop policy if exists task_attachments_server_only on storage.objects;
create policy task_attachments_server_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'task-attachments')
with check (bucket_id <> 'task-attachments');

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null default 'application/pdf' check (content_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 8 and 15728640),
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists task_attachments_task_created_idx on public.task_attachments(task_id, created_at, id);
alter table public.task_attachments enable row level security;
revoke all on public.task_attachments from anon, authenticated, public;
grant select, insert, delete on public.task_attachments to service_role;

create or replace function public.enforce_task_attachment_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  perform 1 from public.tasks where id = new.task_id for update;
  if not found then raise exception 'task_not_found'; end if;
  select count(*) into current_count from public.task_attachments where task_id = new.task_id;
  if current_count >= 10 then raise exception 'task_attachment_limit'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_task_attachment_limit() from public, anon, authenticated;

drop trigger if exists task_attachments_limit_before_insert on public.task_attachments;
create trigger task_attachments_limit_before_insert
before insert on public.task_attachments
for each row execute function public.enforce_task_attachment_limit();

create or replace function public.broadcast_task_attachment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare attachment_task uuid; team_id text;
begin
  attachment_task := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  select tasks.team_id::text into team_id from public.tasks where tasks.id = attachment_task;
  perform realtime.send(jsonb_build_object('topics', array['tasks','submissions'], 'teamIds',
    case when team_id is null then array[]::text[] else array[team_id] end, 'userIds', array[]::text[]),
    'changed', 'prokachka:changes', true);
  return null;
exception when others then
  raise log 'Task attachment realtime notification unavailable: SQLSTATE %', sqlstate;
  return null;
end;
$$;
revoke all on function public.broadcast_task_attachment_change() from public, anon, authenticated;
drop trigger if exists task_attachments_live_change on public.task_attachments;
create trigger task_attachments_live_change after insert or delete on public.task_attachments
for each row execute function public.broadcast_task_attachment_change();
notify pgrst, 'reload schema';
