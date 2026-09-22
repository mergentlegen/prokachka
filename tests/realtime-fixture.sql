-- TEST ONLY: a transaction-aware replacement for Supabase in disposable PostgreSQL.
create schema if not exists realtime;
create table if not exists realtime.messages (topic text);
alter table realtime.messages enable row level security;
create table if not exists realtime.test_messages (
  payload jsonb not null, event text not null, topic text not null, private boolean not null
);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.test_messages values (payload, event, topic, private);
$$;
