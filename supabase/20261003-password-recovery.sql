-- Password recovery only links a legacy profile after proof of email ownership.
begin;
alter table public.users add column if not exists session_version integer not null default 0;

create table if not exists public.password_recovery_limits (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  send_window_at timestamptz not null default now(),
  last_sent_at timestamptz,
  send_count integer not null default 0,
  verify_window_at timestamptz not null default now(),
  verify_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists password_recovery_limits_updated_idx on public.password_recovery_limits(updated_at);
create table if not exists public.password_recovery_grants (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.users(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_session text not null check (char_length(encrypted_session) between 32 and 16384),
  session_version integer not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_by uuid,
  claim_until timestamptz
);
create index if not exists password_recovery_grants_expiry_idx on public.password_recovery_grants(expires_at);
create index if not exists password_recovery_grants_account_idx on public.password_recovery_grants(account_id);
alter table public.password_recovery_limits enable row level security;
alter table public.password_recovery_grants enable row level security;
revoke all on public.password_recovery_limits, public.password_recovery_grants from public, anon, authenticated;
grant select, insert, update, delete on public.password_recovery_limits, public.password_recovery_grants to service_role;

create or replace function public.app_password_recovery_limit(p_email_hash text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare limits public.password_recovery_limits%rowtype; retry integer;
begin
  -- The tables contain short-lived grants and counters, not a permanent history.
  delete from public.password_recovery_grants where expires_at <= now();
  delete from public.password_recovery_limits where updated_at < now() - interval '1 day';
  insert into public.password_recovery_limits(email_hash) values(p_email_hash) on conflict do nothing;
  select * into limits from public.password_recovery_limits where email_hash=p_email_hash for update;
  if p_action='send' then
    if limits.send_window_at <= now()-interval '1 hour' then
      limits.send_count:=0; limits.send_window_at:=now();
    end if;
    if limits.last_sent_at > now()-interval '60 seconds' or limits.send_count >= 5 then
      retry:=greatest(1,ceil(extract(epoch from (case when limits.send_count>=5 then limits.send_window_at+interval '1 hour'
        else limits.last_sent_at+interval '60 seconds' end)-now()))::integer);
      return jsonb_build_object('allowed',false,'retryAfter',retry);
    end if;
    update public.password_recovery_limits set last_sent_at=now(),send_count=limits.send_count+1,
      send_window_at=limits.send_window_at,updated_at=now() where email_hash=p_email_hash;
  elsif p_action='verify' then
    if limits.verify_window_at <= now()-interval '10 minutes' then
      limits.verify_count:=0; limits.verify_window_at:=now();
    end if;
    if limits.verify_count>=10 then
      retry:=greatest(1,ceil(extract(epoch from limits.verify_window_at+interval '10 minutes'-now()))::integer);
      return jsonb_build_object('allowed',false,'retryAfter',retry);
    end if;
    update public.password_recovery_limits set verify_count=limits.verify_count+1,
      verify_window_at=limits.verify_window_at,updated_at=now() where email_hash=p_email_hash;
  else raise exception 'Unsupported recovery action'; end if;
  return jsonb_build_object('allowed',true);
end;
$$;

create or replace function public.app_issue_password_recovery(p_account_id uuid,p_auth_user_id uuid,p_token_hash text,p_encrypted_session text)
returns void language plpgsql security definer set search_path = '' as $$
declare account public.users%rowtype; verified_email text;
begin
  select * into account from public.users where id=p_account_id for update;
  select lower(email) into verified_email from auth.users where id=p_auth_user_id and email_confirmed_at is not null
    and (banned_until is null or banned_until<=now());
  if account.id is null or verified_email is null or account.role='ceo'
    or (lower(coalesce(account.email,''))<>verified_email and lower(coalesce(account.login,''))<>verified_email)
    or (account.auth_user_id is not null and account.auth_user_id<>p_auth_user_id)
    then raise exception 'Recovery identity mismatch'; end if;
  delete from public.password_recovery_grants where account_id=p_account_id;
  insert into public.password_recovery_grants(token_hash,account_id,auth_user_id,encrypted_session,session_version)
    values(p_token_hash,p_account_id,p_auth_user_id,p_encrypted_session,account.session_version);
end;
$$;

-- A lease serializes concurrent password submissions without holding a SQL
-- transaction open while communicating with the Auth service.
create or replace function public.app_claim_password_recovery(p_token_hash text,p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare grant_row public.password_recovery_grants%rowtype; target_account_id uuid; version integer;
begin
  select g.account_id into target_account_id from public.password_recovery_grants g where token_hash=p_token_hash;
  select session_version into version from public.users where id=target_account_id for update;
  select * into grant_row from public.password_recovery_grants where token_hash=p_token_hash for update;
  if not found or grant_row.expires_at<=now() or grant_row.session_version is distinct from version then
    return jsonb_build_object('status','invalid');
  end if;
  if grant_row.claim_until>now() then return jsonb_build_object('status','busy'); end if;
  update public.password_recovery_grants set claimed_by=p_claim_id,claim_until=now()+interval '2 minutes' where token_hash=p_token_hash;
  return jsonb_build_object('status','ok','authUserId',grant_row.auth_user_id,'encryptedSession',grant_row.encrypted_session);
end;
$$;
create or replace function public.app_release_password_recovery(p_token_hash text,p_claim_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.password_recovery_grants set claimed_by=null,claim_until=null where token_hash=p_token_hash and claimed_by=p_claim_id;
end;
$$;
create or replace function public.app_finish_password_recovery(p_token_hash text,p_claim_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare grant_row public.password_recovery_grants%rowtype; account public.users%rowtype; target_account_id uuid; verified_email text;
begin
  select g.account_id into target_account_id from public.password_recovery_grants g where token_hash=p_token_hash;
  select * into account from public.users where id=target_account_id for update;
  select * into grant_row from public.password_recovery_grants where token_hash=p_token_hash for update;
  if not found or grant_row.claimed_by is distinct from p_claim_id or grant_row.expires_at<=now()
    or grant_row.session_version is distinct from account.session_version then raise exception 'Recovery grant expired'; end if;
  select lower(email) into verified_email from auth.users where id=grant_row.auth_user_id and email_confirmed_at is not null
    and (banned_until is null or banned_until<=now());
  if verified_email is null or account.role='ceo'
    or (lower(coalesce(account.email,''))<>verified_email and lower(coalesce(account.login,''))<>verified_email)
    or (account.auth_user_id is not null and account.auth_user_id<>grant_row.auth_user_id)
    then raise exception 'Recovery identity mismatch'; end if;
  update public.users set auth_user_id=grant_row.auth_user_id,password_hash='!supabase-auth',session_version=session_version+1 where id=account.id;
  delete from public.password_recovery_grants where account_id=account.id;
  delete from public.email_registration_drafts where auth_user_id=grant_row.auth_user_id;
end;
$$;
revoke all on function public.app_password_recovery_limit(text,text), public.app_issue_password_recovery(uuid,uuid,text,text),
  public.app_claim_password_recovery(text,uuid), public.app_release_password_recovery(text,uuid), public.app_finish_password_recovery(text,uuid)
  from public, anon, authenticated;
grant execute on function public.app_password_recovery_limit(text,text), public.app_issue_password_recovery(uuid,uuid,text,text),
  public.app_claim_password_recovery(text,uuid), public.app_release_password_recovery(text,uuid), public.app_finish_password_recovery(text,uuid)
  to service_role;
notify pgrst,'reload schema';
commit;
