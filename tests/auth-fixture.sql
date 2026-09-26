-- Minimal Auth catalog fixture: disposable PostgreSQL CI only, not production.
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  banned_until timestamptz
);
