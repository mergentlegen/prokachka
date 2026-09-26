-- Additive transition: existing users/password hashes/IDs remain untouched.
begin;
alter table public.users add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists users_auth_user_id_unique_idx on public.users(auth_user_id) where auth_user_id is not null;

create table if not exists public.email_registration_drafts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(trim(email)) and char_length(email) <= 254),
  first_name text not null check (char_length(trim(first_name)) between 2 and 60),
  last_name text not null check (char_length(trim(last_name)) between 2 and 80),
  invitation_id uuid references public.team_invitation_links(id) on delete set null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_window_at timestamptz not null default now(),
  send_count integer not null default 1,
  verify_window_at timestamptz not null default now(),
  verify_count integer not null default 0
);
alter table public.email_registration_drafts enable row level security;
revoke all on public.email_registration_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.email_registration_drafts to service_role;

-- Persistent row-locked limits survive application restarts and multiple workers.
create or replace function public.app_email_auth_limit(p_email text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare draft public.email_registration_drafts%rowtype; retry integer;
begin
  select * into draft from public.email_registration_drafts where email = p_email for update;
  if not found then return jsonb_build_object('allowed', false, 'retryAfter', 60); end if;
  if p_action = 'verify' then
    if draft.verify_window_at <= now() - interval '10 minutes' then
      draft.verify_window_at := now(); draft.verify_count := 0;
    end if;
    if draft.verify_count >= 10 then
      retry := greatest(1, ceil(extract(epoch from draft.verify_window_at + interval '10 minutes' - now()))::integer);
      return jsonb_build_object('allowed', false, 'retryAfter', retry);
    end if;
    update public.email_registration_drafts set verify_count = draft.verify_count + 1,
      verify_window_at = draft.verify_window_at where auth_user_id = draft.auth_user_id;
  elsif p_action = 'resend' then
    if draft.send_window_at <= now() - interval '1 hour' then
      draft.send_window_at := now(); draft.send_count := 0;
    end if;
    if draft.last_sent_at > now() - interval '60 seconds' or draft.send_count >= 5 then
      retry := greatest(1, ceil(extract(epoch from
        case when draft.send_count >= 5 then draft.send_window_at + interval '1 hour' else draft.last_sent_at + interval '60 seconds' end - now()))::integer);
      return jsonb_build_object('allowed', false, 'retryAfter', retry);
    end if;
    update public.email_registration_drafts set last_sent_at = now(), send_count = draft.send_count + 1,
      send_window_at = draft.send_window_at where auth_user_id = draft.auth_user_id;
  else raise exception 'Unsupported email auth action'; end if;
  return jsonb_build_object('allowed', true);
end;
$$;

-- Identity comes from verified auth.users, never from browser metadata or an
-- email-only match. User + invitation request are created in one transaction.
create or replace function public.app_complete_email_registration(p_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare draft public.email_registration_drafts%rowtype; verified_email text; account_id uuid;
  invitation public.team_invitation_links%rowtype;
begin
  select lower(email) into verified_email from auth.users
    where id = p_auth_user_id and email_confirmed_at is not null
      and (banned_until is null or banned_until <= now());
  if verified_email is null then raise exception 'Email is not verified'; end if;
  perform pg_advisory_xact_lock(hashtextextended('email-registration:' || p_auth_user_id::text, 0));
  select id into account_id from public.users where auth_user_id = p_auth_user_id;
  if account_id is not null then return account_id; end if;
  select * into draft from public.email_registration_drafts where auth_user_id = p_auth_user_id for update;
  if not found or draft.email <> verified_email then raise exception 'Registration draft is missing'; end if;
  if exists (select 1 from public.users where lower(email) = verified_email or lower(login) = verified_email) then
    raise exception 'Application account already exists';
  end if;
  insert into public.users(name, first_name, last_name, email, login, password_hash, role, auth_user_id)
    values (trim(draft.first_name) || ' ' || trim(draft.last_name), trim(draft.first_name), trim(draft.last_name),
      verified_email, verified_email, '!supabase-auth', 'member', p_auth_user_id) returning id into account_id;
  if draft.invitation_id is not null then
    select * into invitation from public.team_invitation_links where id = draft.invitation_id for update;
    -- A revoked/expired invitation must not prevent a verified account from
    -- existing. Such members can select a team manually; no automatic approval.
    if found and invitation.revoked_at is null and (invitation.expires_at is null or invitation.expires_at > now())
      and (invitation.max_uses = 0 or invitation.used_count < invitation.max_uses)
      and exists (select 1 from public.teams where id = invitation.team_id and is_active)
      and exists (select 1 from public.users where id = invitation.inviter_user_id and team_id = invitation.team_id and role in ('admin', 'member')) then
      insert into public.team_join_requests(user_id, team_id, invited_by_user_id, invitation_id)
        values (account_id, invitation.team_id, invitation.inviter_user_id, invitation.id);
    end if;
  end if;
  delete from public.email_registration_drafts where auth_user_id = p_auth_user_id;
  return account_id;
end;
$$;
revoke all on function public.app_email_auth_limit(text,text) from public, anon, authenticated;
revoke all on function public.app_complete_email_registration(uuid) from public, anon, authenticated;
grant execute on function public.app_email_auth_limit(text,text) to service_role;
grant execute on function public.app_complete_email_registration(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
