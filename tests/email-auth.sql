\set ON_ERROR_STOP on
begin;
do $$
declare
  auth_id uuid := gen_random_uuid(); legacy_auth uuid := gen_random_uuid(); rejected_auth uuid := gen_random_uuid();
  stale_auth uuid := gen_random_uuid(); team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); invite uuid := gen_random_uuid();
  account uuid; legacy uuid := gen_random_uuid(); again uuid; outcome jsonb; i integer;
begin
  insert into public.teams(id,name) values(team,'email-auth-'||team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    values(mentor,'Root Mentor','Root','Mentor',mentor||'@test.invalid',mentor::text,'legacy-hash','admin',team),
      (legacy,'Legacy Member','Legacy','Member',legacy||'@test.invalid',legacy::text,'legacy-hash','member',team);
  insert into public.team_invitation_links(id,team_id,inviter_user_id,token_hash)
    values(invite,team,mentor,invite::text);
  insert into auth.users(id,email,email_confirmed_at) values
    (auth_id,auth_id||'@test.invalid',null), (legacy_auth,legacy||'@test.invalid',now()),
    (rejected_auth,rejected_auth||'@test.invalid',now()), (stale_auth,stale_auth||'@test.invalid',now());
  insert into public.email_registration_drafts(auth_user_id,email,first_name,last_name,invitation_id) values
    (auth_id,auth_id||'@test.invalid','New','Member',invite), (legacy_auth,legacy||'@test.invalid','Legacy','Member',null),
    (rejected_auth,rejected_auth||'@test.invalid','Blocked','Member',null), (stale_auth,stale_auth||'@test.invalid','Stale','Member',invite);
  begin
    perform public.app_complete_email_registration(auth_id);
    raise exception 'FAIL: unverified identity was provisioned';
  exception when raise_exception then if sqlerrm <> 'Email is not verified' then raise; end if; end;
  if exists(select 1 from public.users where auth_user_id=auth_id) then raise exception 'FAIL: early app account'; end if;
  if exists(select 1 from public.team_join_requests where invitation_id=invite) then raise exception 'FAIL: early mentor request'; end if;
  update auth.users set email_confirmed_at=now() where id=auth_id;
  account := public.app_complete_email_registration(auth_id);
  again := public.app_complete_email_registration(auth_id);
  if account is distinct from again or (select count(*) from public.users where auth_user_id=auth_id)<>1 then raise exception 'FAIL: non-idempotent provisioning'; end if;
  if not exists(select 1 from public.users where id=account and role='member' and team_id is null and parent_user_id is null and password_hash='!supabase-auth') then raise exception 'FAIL: automatic team acceptance or role escalation'; end if;
  if (select count(*) from public.team_join_requests where user_id=account and team_id=team and status='pending' and invited_by_user_id=mentor)<>1 then raise exception 'FAIL: missing or duplicated invitation request'; end if;
  if exists(select 1 from public.email_registration_drafts where auth_user_id=auth_id) then raise exception 'FAIL: finished draft retained'; end if;
  begin
    perform public.app_complete_email_registration(legacy_auth);
    raise exception 'FAIL: legacy account was linked just by matching email';
  exception when raise_exception then if sqlerrm <> 'Application account already exists' then raise; end if; end;
  if not exists(select 1 from public.users where id=legacy and auth_user_id is null and password_hash='legacy-hash' and team_id=team) then raise exception 'FAIL: changed existing member'; end if;
  update auth.users set banned_until=now()+interval '1 day' where id=rejected_auth;
  begin
    perform public.app_complete_email_registration(rejected_auth);
    raise exception 'FAIL: banned identity provisioned';
  exception when raise_exception then if sqlerrm <> 'Email is not verified' then raise; end if; end;
  update public.team_invitation_links set revoked_at=now() where id=invite;
  account:=public.app_complete_email_registration(stale_auth);
  if account is null or exists(select 1 from public.team_join_requests where user_id=account) then raise exception 'FAIL: expired invite blocked account or created request'; end if;
  outcome:=public.app_email_auth_limit(legacy||'@test.invalid','resend');
  if (outcome->>'allowed')::boolean then raise exception 'FAIL: resend cooldown ignored'; end if;
  for i in 1..10 loop
    outcome:=public.app_email_auth_limit(legacy||'@test.invalid','verify');
    if not (outcome->>'allowed')::boolean then raise exception 'FAIL: early verify limit'; end if;
  end loop;
  outcome:=public.app_email_auth_limit(legacy||'@test.invalid','verify');
  if (outcome->>'allowed')::boolean or (outcome->>'retryAfter')::integer < 1 then raise exception 'FAIL: verify limit ignored'; end if;
  update public.email_registration_drafts set verify_window_at=now()-interval '11 minutes', last_sent_at=now()-interval '61 seconds', send_count=4 where auth_user_id=legacy_auth;
  outcome:=public.app_email_auth_limit(legacy||'@test.invalid','verify');
  if not (outcome->>'allowed')::boolean then raise exception 'FAIL: expired window did not reset'; end if;
  outcome:=public.app_email_auth_limit(legacy||'@test.invalid','resend');
  if not (outcome->>'allowed')::boolean then raise exception 'FAIL: valid resend refused'; end if;
  update public.email_registration_drafts set last_sent_at=now()-interval '61 seconds' where auth_user_id=legacy_auth;
  outcome:=public.app_email_auth_limit(legacy||'@test.invalid','resend');
  if (outcome->>'allowed')::boolean then raise exception 'FAIL: hourly send limit ignored'; end if;
  if has_function_privilege('anon','public.app_complete_email_registration(uuid)','execute')
    or has_function_privilege('authenticated','public.app_email_auth_limit(text,text)','execute')
    or has_table_privilege('authenticated','public.email_registration_drafts','select') then raise exception 'FAIL: public access to private registration data'; end if;
end;
$$;
rollback;
