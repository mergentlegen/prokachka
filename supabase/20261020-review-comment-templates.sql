-- Shared review comment templates: the team leader sets them, every reviewer of the team picks them in one tap.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

create table if not exists public.review_comment_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  position integer not null check (position between 1 and 12),
  body text not null check (char_length(body) between 1 and 300 and body = btrim(body)),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, position)
);
alter table public.review_comment_templates enable row level security;
revoke all on public.review_comment_templates from public, anon, authenticated;
grant select, insert, update, delete on public.review_comment_templates to service_role;

-- Replaces the whole set atomically; only the team leader may change it.
create or replace function public.app_replace_review_templates(p_actor uuid, p_bodies text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users%rowtype; cleaned text[] := '{}'; item text;
begin
  select * into actor from public.users where id = p_actor;
  if actor.id is null or actor.role <> 'admin' or actor.team_id is null then return jsonb_build_object('forbidden', true); end if;
  foreach item in array coalesce(p_bodies, '{}') loop
    item := btrim(coalesce(item, ''));
    if item = '' or item = any(cleaned) then continue; end if;
    if char_length(item) > 300 then return jsonb_build_object('validationError', 'Комментарий длиннее 300 символов.'); end if;
    cleaned := cleaned || item;
  end loop;
  if coalesce(array_length(cleaned, 1), 0) > 12 then return jsonb_build_object('validationError', 'Можно сохранить не больше 12 комментариев.'); end if;
  -- Serializes two leaders saving at the same time.
  perform 1 from public.teams where id = actor.team_id for update;
  delete from public.review_comment_templates where team_id = actor.team_id;
  insert into public.review_comment_templates(team_id, position, body, updated_by)
    select actor.team_id, t.idx, t.body, actor.id from unnest(cleaned) with ordinality as t(body, idx);
  return jsonb_build_object('data', to_jsonb(cleaned));
end $$;

revoke all on function public.app_replace_review_templates(uuid, text[]) from public, anon, authenticated;
grant execute on function public.app_replace_review_templates(uuid, text[]) to service_role;
notify pgrst, 'reload schema';
commit;
