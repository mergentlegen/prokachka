-- Disposable integration database only. Every fixture is rolled back.
begin;
do $$
declare team uuid := gen_random_uuid(); person uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  first_path text; next_path text; abandoned text; current_version timestamptz; result jsonb;
  job public.profile_avatar_cleanup_queue%rowtype;
begin
  insert into public.teams(id,name) values(team,'Avatar integration '||team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,team_id) values
    (person,'First Member','First','Member',person||'@fixture.test',person::text,'fixture',team),
    (other,'Other Member','Other','Member',other||'@fixture.test',other::text,'fixture',team);
  first_path := person||'/'||gen_random_uuid()||'.webp';
  next_path := person||'/'||gen_random_uuid()||'.webp';
  abandoned := person||'/'||gen_random_uuid()||'.webp';
  select profile_updated_at into current_version from public.users where id=person;
  insert into public.profile_avatar_uploads(storage_path,user_id) values(first_path,person);
  insert into storage.objects(bucket_id,name) values('profile-avatars',first_path);
  result := public.app_update_profile(person,'Anna','Member',current_version,'replace',first_path);
  if result->>'saved' <> 'true' then raise exception 'Profile not saved'; end if;
  if not exists(select 1 from public.users where id=person and name='Anna Member' and avatar_path=first_path and role='member' and email=person||'@fixture.test') then
    raise exception 'Profile changed account permissions or identity'; end if;
  if exists(select 1 from public.profile_avatar_uploads where storage_path=first_path)
    or exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=first_path) then raise exception 'Live avatar incorrectly retired'; end if;
  result := public.app_update_profile(person,'Stale','Member',current_version,'remove');
  if result->>'conflict' <> 'true' then raise exception 'Stale version accepted'; end if;
  select profile_updated_at into current_version from public.users where id=person;
  insert into public.profile_avatar_uploads(storage_path,user_id) values(next_path,person);
  insert into storage.objects(bucket_id,name) values('profile-avatars',next_path);
  result := public.app_update_profile(person,'Anna','Updated',current_version,'replace',next_path);
  if result->>'saved' <> 'true' or not exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=first_path) then raise exception 'Old avatar not enqueued'; end if;
  if (select avatar_path from public.app_ranking(team,'points') where id=person) <> next_path
    or (select avatar_path from public.app_ranking(team,'stars') where id=person) <> next_path then raise exception 'Ratings omitted avatar'; end if;
  select profile_updated_at into current_version from public.users where id=other;
  begin
    perform public.app_update_profile(other,'Other','Member',current_version,'replace',next_path);
    raise exception 'Another account reused a private avatar';
  exception when check_violation then null; end;
  insert into public.profile_avatar_uploads(storage_path,user_id,expires_at) values(abandoned,person,now()-interval '1 minute');
  perform public.app_claim_profile_avatar_cleanup(100);
  if exists(select 1 from public.profile_avatar_uploads where storage_path=abandoned)
    or not exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=abandoned) then raise exception 'Abandoned upload not reclaimed'; end if;
  select * into job from public.profile_avatar_cleanup_queue where storage_path=first_path;
  perform public.app_ack_profile_avatar_cleanup(first_path,gen_random_uuid(),204);
  if not exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=first_path) then raise exception 'Wrong lease removed a job'; end if;
  perform public.app_ack_profile_avatar_cleanup(first_path,job.lease_token,503);
  if not exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=first_path and lease_token is null and next_attempt_at>now()) then raise exception 'Failed deletion not deferred'; end if;
  select profile_updated_at into current_version from public.users where id=person;
  perform public.app_update_profile(person,'Anna','Updated',current_version,'remove');
  if (select avatar_path from public.users where id=person) is not null
    or not exists(select 1 from public.profile_avatar_cleanup_queue where storage_path=next_path) then raise exception 'Removed avatar not retired'; end if;
  if has_function_privilege('anon','public.app_update_profile(uuid,text,text,timestamptz,text,text)','EXECUTE')
    or has_table_privilege('authenticated','public.profile_avatar_uploads','SELECT') then raise exception 'Private profile operations exposed'; end if;
  if not exists(select 1 from storage.buckets where id='profile-avatars' and not public and file_size_limit=262144) then raise exception 'Avatar bucket misconfigured'; end if;
  delete from public.users where id=person;
end $$;
rollback;
