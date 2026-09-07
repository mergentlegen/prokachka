create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_tokens_user_idx on public.telegram_link_tokens(user_id, created_at desc);
create index if not exists telegram_link_tokens_expiry_idx on public.telegram_link_tokens(expires_at);