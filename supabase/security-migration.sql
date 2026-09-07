-- Security hardening for an existing Supabase database.
-- Run once in Supabase SQL Editor after the Telegram-link migration.

alter table public.submissions
  add column if not exists telegram_update_id bigint;

create unique index if not exists submissions_telegram_update_id_idx
  on public.submissions(telegram_update_id)
  where telegram_update_id is not null;

create table if not exists public.telegram_contexts (
  telegram_id text primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

alter table public.telegram_contexts
  add column if not exists expires_at timestamptz;

update public.telegram_contexts
set expires_at = created_at + interval '15 minutes'
where expires_at is null;

alter table public.telegram_contexts
  alter column expires_at set default (now() + interval '15 minutes');

alter table public.telegram_contexts
  alter column expires_at set not null;

create index if not exists telegram_contexts_expiry_idx
  on public.telegram_contexts(expires_at);