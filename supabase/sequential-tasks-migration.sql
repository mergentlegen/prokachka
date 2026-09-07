-- Sequential task programs: the timer starts per member, not globally.
create table if not exists public.task_programs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  deadline_hours integer not null default 72 check (deadline_hours between 1 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks add column if not exists publication_type text not null default 'fixed';
alter table public.tasks add column if not exists program_id uuid references public.task_programs(id) on delete cascade;
alter table public.tasks add column if not exists position integer;
alter table public.tasks add column if not exists deadline_hours integer;

update public.tasks set publication_type = case when deadline_at is null then 'evergreen' else 'fixed' end
where publication_type is null or publication_type not in ('evergreen','fixed','sequential');

alter table public.tasks drop constraint if exists tasks_publication_type_check;
alter table public.tasks add constraint tasks_publication_type_check check (publication_type in ('evergreen','fixed','sequential'));
alter table public.tasks drop constraint if exists tasks_program_fields_check;
alter table public.tasks add constraint tasks_program_fields_check check (
  (publication_type = 'sequential' and program_id is not null and position is not null and position >= 1)
  or publication_type in ('evergreen','fixed')
);

create table if not exists public.member_program_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  program_id uuid not null references public.task_programs(id) on delete cascade,
  current_task_id uuid references public.tasks(id) on delete set null,
  unlocked_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'active' check (status in ('active','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, program_id)
);

create index if not exists task_programs_team_idx on public.task_programs(team_id, is_active, created_at desc);
create index if not exists tasks_program_position_idx on public.tasks(program_id, position);
create index if not exists member_progress_user_idx on public.member_program_progress(user_id, status);
create index if not exists member_progress_program_idx on public.member_program_progress(program_id, status);

drop trigger if exists task_programs_touch_updated_at on public.task_programs;
create trigger task_programs_touch_updated_at before update on public.task_programs for each row execute procedure public.touch_updated_at();
drop trigger if exists member_progress_touch_updated_at on public.member_program_progress;
create trigger member_progress_touch_updated_at before update on public.member_program_progress for each row execute procedure public.touch_updated_at();

-- Existing fixed/evergreen tasks keep their behavior. New sequential tasks must
-- be created with a program_id and a 1-based position.
