\set ON_ERROR_STOP on
-- Verify replay against the fresh bootstrap as well as the upgrade path.
\ir ../supabase/20261003-password-recovery.sql
\ir ../supabase/20261003-password-recovery.sql
begin;
do $$
declare
  account_id uuid:=gen_random_uuid(); auth_id uuid:=gen_random_uuid(); stranger_id uuid:=gen_random_uuid();
  test_team_id uuid:=gen_random_uuid(); lease_id uuid:=gen_random_uuid(); other_lease uuid:=gen_random_uuid();
  token text:=repeat('a',64); replacement text:=repeat('b',64); email_hash text:=repeat('c',64);
  result jsonb; i integer;
begin
  insert into public.teams(id,name) values(test_team_id,'recovery-'||test_team_id);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    values(account_id,'Legacy Mentor','Legacy','Mentor',account_id||'@test.invalid',account_id||'@test.invalid','old-hash','admin',test_team_id);
  insert into auth.users(id,email,email_confirmed_at) values(auth_id,account_id||'@test.invalid',null),(stranger_id,'stranger@test.invalid',now());
  begin
    perform public.app_issue_password_recovery(account_id,auth_id,token,repeat('encrypted',10));
    raise exception 'FAIL: unverified email authorized reset';
  exception when raise_exception then if sqlerrm<>'Recovery identity mismatch' then raise; end if; end;
  update auth.users set email_confirmed_at=now() where id=auth_id;
  begin
    perform public.app_issue_password_recovery(account_id,stranger_id,token,repeat('encrypted',10));
    raise exception 'FAIL: another email authorized reset';
  exception when raise_exception then if sqlerrm<>'Recovery identity mismatch' then raise; end if; end;
  perform public.app_issue_password_recovery(account_id,auth_id,token,repeat('encrypted',10));
  if not exists(select 1 from public.users where id=account_id and auth_user_id is null and password_hash='old-hash') then
    raise exception 'FAIL: proof alone changed legacy account'; end if;
  result:=public.app_claim_password_recovery(token,lease_id);
  if result->>'status'<>'ok' or result->>'authUserId'<>auth_id::text then raise exception 'FAIL: valid grant rejected'; end if;
  if public.app_claim_password_recovery(token,other_lease)->>'status'<>'busy' then raise exception 'FAIL: concurrent claim succeeded'; end if;
  begin
    perform public.app_finish_password_recovery(token,other_lease);
    raise exception 'FAIL: wrong lease consumed grant';
  exception when raise_exception then if sqlerrm<>'Recovery grant expired' then raise; end if; end;
  perform public.app_release_password_recovery(token,other_lease);
  if public.app_claim_password_recovery(token,other_lease)->>'status'<>'busy' then raise exception 'FAIL: wrong lease released lock'; end if;
  perform public.app_release_password_recovery(token,lease_id);
  if public.app_claim_password_recovery(token,other_lease)->>'status'<>'ok' then raise exception 'FAIL: retry refused after release'; end if;
  perform public.app_finish_password_recovery(token,other_lease);
  if not exists(select 1 from public.users where id=account_id and auth_user_id=auth_id and password_hash='!supabase-auth'
    and team_id=test_team_id and role='admin' and name='Legacy Mentor' and session_version=1) then
    raise exception 'FAIL: profile changed or old sessions retained'; end if;
  if public.app_claim_password_recovery(token,lease_id)->>'status'<>'invalid' then raise exception 'FAIL: consumed grant replayed'; end if;
  perform public.app_issue_password_recovery(account_id,auth_id,token,repeat('encrypted',10));
  perform public.app_issue_password_recovery(account_id,auth_id,replacement,repeat('encrypted',10));
  if public.app_claim_password_recovery(token,lease_id)->>'status'<>'invalid' then raise exception 'FAIL: newer proof failed to revoke older grant'; end if;
  update public.password_recovery_grants set expires_at=now()-interval '1 second' where token_hash=replacement;
  if public.app_claim_password_recovery(replacement,lease_id)->>'status'<>'invalid' then raise exception 'FAIL: expired grant authorized reset'; end if;
  result:=public.app_password_recovery_limit(email_hash,'send');
  if not (result->>'allowed')::boolean then raise exception 'FAIL: first send refused'; end if;
  if (public.app_password_recovery_limit(email_hash,'send')->>'allowed')::boolean then raise exception 'FAIL: send cooldown ignored'; end if;
  for i in 1..10 loop
    if not (public.app_password_recovery_limit(email_hash,'verify')->>'allowed')::boolean then raise exception 'FAIL: verify refused early'; end if;
  end loop;
  if (public.app_password_recovery_limit(email_hash,'verify')->>'allowed')::boolean then raise exception 'FAIL: code limit ignored'; end if;
  if exists(select 1 from public.password_recovery_grants where token_hash=replacement) then raise exception 'FAIL: expired grant not cleaned'; end if;
  if has_table_privilege('anon','public.password_recovery_grants','select')
    or has_function_privilege('authenticated','public.app_finish_password_recovery(text,uuid)','execute') then raise exception 'FAIL: browser can authorize password changes'; end if;
end;
$$;
rollback;
