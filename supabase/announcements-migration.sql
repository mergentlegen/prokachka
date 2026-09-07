-- InCruises | Прокачка
-- Таблица объявлений для команд.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  content text not null check (char_length(trim(content)) between 2 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_team_created_idx
  on public.announcements(team_id, created_at desc);

create index if not exists announcements_active_idx
  on public.announcements(team_id, is_active, created_at desc);

drop trigger if exists announcements_touch_updated_at on public.announcements;
create trigger announcements_touch_updated_at
before update on public.announcements
for each row execute procedure public.touch_updated_at();
