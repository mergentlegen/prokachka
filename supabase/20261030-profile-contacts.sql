-- Profile, stage 1: a phone number that only the mentors of the participant see, a password change from the profile,
-- and the team / mentor names for the profile header.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

-- Phones live apart from public.users: nothing that lists users (ranking, network, feeds) can show them by accident.
create table if not exists public.user_contacts (
  user_id uuid primary key references public.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[0-9]{10,15}$'),
  updated_at timestamptz not null default now()
);
alter table public.user_contacts enable row level security;
revoke all on public.user_contacts from public, anon, authenticated;

-- The participant's own phone; null or an empty value removes it.
create or replace function public.app_set_own_phone(p_user uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = p_user) then return jsonb_build_object('forbidden', true); end if;
  if p_phone is null or p_phone = '' then
    delete from public.user_contacts where user_id = p_user;
    return jsonb_build_object('phone', null);
  end if;
  if p_phone !~ '^\+[0-9]{10,15}$' then return jsonb_build_object('validationError', 'Проверьте номер телефона.'); end if;
  insert into public.user_contacts(user_id, phone) values (p_user, p_phone)
    on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
  return jsonb_build_object('phone', p_phone);
end $$;

-- What the profile shows about the account itself: own phone, team, the mentor right above.
create or replace function public.app_own_profile_extras(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phone', (select phone from public.user_contacts where user_id = u.id),
    'teamName', (select name from public.teams where id = u.team_id),
    'mentorName', (select mentor.name from public.users mentor where mentor.id = u.parent_user_id and mentor.team_id = u.team_id)
  ) from public.users u where u.id = p_user;
$$;

-- Phones a mentor may see: the team leader sees the team; a mentor with review rights sees the branch below them.
-- Nobody sees their own here, participants and mentors of other branches see nothing.
create or replace function public.app_visible_phones(p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c.user_id, c.phone), '{}'::jsonb)
  from public.user_contacts c join public.users member on member.id = c.user_id join public.users viewer on viewer.id = p_viewer
  where member.id <> viewer.id and viewer.team_id is not null and member.team_id = viewer.team_id
    and (viewer.role = 'admin' or (viewer.role = 'member' and viewer.can_review and viewer.id in (select a.id from public.tg_ancestor_ids(member.id) a)));
$$;

-- A new password from the profile: every other device has to sign in again (session_version).
-- For accounts with e-mail sign-in the password itself is kept by Supabase Auth; p_password_hash is then null.
create or replace function public.app_change_password(p_user uuid, p_password_hash text)
returns integer language plpgsql security definer set search_path = public as $$
declare version integer;
begin
  update public.users set password_hash = coalesce(p_password_hash, password_hash), session_version = session_version + 1
    where id = p_user returning session_version into version;
  return version;
end $$;

revoke all on function public.app_set_own_phone(uuid, text), public.app_own_profile_extras(uuid), public.app_visible_phones(uuid),
  public.app_change_password(uuid, text) from public, anon, authenticated;
grant execute on function public.app_set_own_phone(uuid, text), public.app_own_profile_extras(uuid), public.app_visible_phones(uuid),
  public.app_change_password(uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
