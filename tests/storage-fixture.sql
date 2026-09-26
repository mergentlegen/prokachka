-- Minimal Supabase Storage schema for the disposable PostgreSQL integration DB.
-- Production uses Supabase-managed storage tables; CI only needs the columns
-- referenced by the project's bucket setup and RLS policies.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  name text not null
);

alter table storage.objects enable row level security;
