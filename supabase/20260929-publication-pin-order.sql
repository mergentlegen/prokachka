-- Preserve the order in which publications are pinned, independently of creation dates.
begin;

alter table public.tasks add column if not exists pinned_at timestamptz;
alter table public.task_programs add column if not exists pinned_at timestamptz;
alter table public.announcements add column if not exists pinned_at timestamptz;

-- Historical pin times were not recorded. Keep the existing visible order by
-- using creation time as a stable one-time fallback for already pinned rows.
update public.tasks set pinned_at = created_at where is_pinned and pinned_at is null;
update public.task_programs set pinned_at = created_at where is_pinned and pinned_at is null;
update public.announcements set pinned_at = created_at where is_pinned and pinned_at is null;

create or replace function public.track_publication_pin_time()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    new.pinned_at := case when new.is_pinned then clock_timestamp() else null end;
  elsif not new.is_pinned then
    new.pinned_at := null;
  elsif not old.is_pinned then
    new.pinned_at := clock_timestamp();
  else
    new.pinned_at := coalesce(old.pinned_at, clock_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_track_pin_time on public.tasks;
create trigger tasks_track_pin_time before insert or update of is_pinned, pinned_at on public.tasks
  for each row execute function public.track_publication_pin_time();
drop trigger if exists task_programs_track_pin_time on public.task_programs;
create trigger task_programs_track_pin_time before insert or update of is_pinned, pinned_at on public.task_programs
  for each row execute function public.track_publication_pin_time();
drop trigger if exists announcements_track_pin_time on public.announcements;
create trigger announcements_track_pin_time before insert or update of is_pinned, pinned_at on public.announcements
  for each row execute function public.track_publication_pin_time();

create index if not exists tasks_team_pin_order_idx on public.tasks(team_id, pinned_at, created_at, id) where is_pinned;
create index if not exists task_programs_team_pin_order_idx on public.task_programs(team_id, pinned_at, created_at, id) where is_pinned;
create index if not exists announcements_team_pin_order_idx on public.announcements(team_id, pinned_at, created_at, id) where is_pinned;

notify pgrst, 'reload schema';
commit;
