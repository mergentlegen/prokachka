-- InCruises | Прокачка
-- История выдачи звёзд наставником участникам.

create table if not exists public.star_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  mentor_id uuid references public.users(id) on delete set null,
  stars integer not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists star_awards_team_created_idx
  on public.star_awards(team_id, created_at desc);

create index if not exists star_awards_user_idx
  on public.star_awards(user_id, created_at desc);
