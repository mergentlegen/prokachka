-- Run once in the Supabase SQL editor for an existing installation.
alter table public.announcements
  add column if not exists resource_url text;

alter table public.tasks
  add column if not exists resource_url text;

do $$
begin
  alter table public.announcements
    add constraint announcements_resource_url_http_check
    check (resource_url is null or resource_url ~ '^https?://');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks
    add constraint tasks_resource_url_http_check
    check (resource_url is null or resource_url ~ '^https?://');
exception
  when duplicate_object then null;
end $$;
