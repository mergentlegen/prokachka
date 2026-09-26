\set ON_ERROR_STOP on
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  root_id uuid := gen_random_uuid(); branch_id uuid := gen_random_uuid(); child_id uuid := gen_random_uuid();
  sibling_id uuid := gen_random_uuid(); detached_id uuid := gen_random_uuid(); foreign_id uuid := gen_random_uuid();
  root_path text; branch_path text; replacement_path text; abandoned_path text;
  selected uuid; previous_path text; canonical text; job public.welcome_video_cleanup_queue;
begin
  insert into teams(id,name) values (team,'welcome-'||team),(other_team,'welcome-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks) values
    (root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team,false),
    (branch_id,'Branch','Branch','Test',branch_id||'@test.invalid',branch_id::text,'test','member',team,true),
    (child_id,'Child','Child','Test',child_id||'@test.invalid',child_id::text,'test','member',team,false),
    (sibling_id,'Sibling','Sibling','Test',sibling_id||'@test.invalid',sibling_id::text,'test','member',team,false),
    (detached_id,'Detached','Detached','Test',detached_id||'@test.invalid',detached_id::text,'test','member',team,false),
    (foreign_id,'Foreign','Foreign','Test',foreign_id||'@test.invalid',foreign_id::text,'test','admin',other_team,false);
  update users set parent_user_id = root_id where id in (branch_id,sibling_id);
  update users set parent_user_id = branch_id where id = child_id;
  root_path := team||'/'||root_id||'/'||gen_random_uuid()||'.mp4';
  branch_path := team||'/'||branch_id||'/'||gen_random_uuid()||'.mp4';
  replacement_path := team||'/'||branch_id||'/'||gen_random_uuid()||'.mp4';
  abandoned_path := team||'/'||branch_id||'/'||gen_random_uuid()||'.mp4';
  insert into welcome_video_upload_intents(storage_path,team_id,owner_user_id,expires_at) values
    (root_path,team,root_id,now()+interval '2 hours'), (branch_path,team,branch_id,now()+interval '2 hours'),
    (replacement_path,team,branch_id,now()+interval '2 hours'), (abandoned_path,team,branch_id,now()-interval '1 hour');
  perform app_set_welcome_video(team,root_id,root_path,'root.mp4',150000000,180,1920,1080);
  perform app_set_welcome_video(team,branch_id,branch_path,'branch.mp4',1000000,120,720,400);
  select owner_user_id into selected from app_resolve_welcome_video(child_id,team);
  if selected is distinct from branch_id then raise exception 'Nearest branch not selected'; end if;
  select owner_user_id into selected from app_resolve_welcome_video(sibling_id,team);
  if selected is distinct from root_id then raise exception 'Sibling saw wrong video'; end if;
  select owner_user_id into selected from app_resolve_welcome_video(detached_id,team);
  if selected is distinct from root_id then raise exception 'Detached root fallback missing'; end if;
  if exists(select 1 from app_resolve_welcome_video(child_id,other_team)) then raise exception 'Cross-team access'; end if;
  update users set can_publish_tasks=false where id=branch_id;
  select owner_user_id into selected from app_resolve_welcome_video(child_id,team);
  if selected is distinct from root_id then raise exception 'Revoked publisher still selected'; end if;
  update users set can_publish_tasks=true where id=branch_id;
  canonical := app_cache_welcome_video_url(branch_path,'https://test.invalid/token-a',now()+interval '5 hours');
  if app_cache_welcome_video_url(branch_path,'https://test.invalid/token-b',now()+interval '5 hours') is distinct from canonical then raise exception 'Different viewers receive different tokens'; end if;
  update welcome_video_url_cache set refresh_at=now()-interval '1 second' where storage_path=branch_path;
  if app_cache_welcome_video_url(branch_path,'https://test.invalid/token-c',now()+interval '5 hours') <> 'https://test.invalid/token-c' then raise exception 'Expired cache not refreshed'; end if;
  previous_path := app_set_welcome_video(team,branch_id,replacement_path,'new.mp4',1000000,120,400,720);
  if previous_path is distinct from branch_path then raise exception 'Wrong retired file'; end if;
  if not exists(select 1 from welcome_video_cleanup_queue where storage_path=branch_path) then raise exception 'Retired file not queued'; end if;
  if exists(select 1 from welcome_video_url_cache where storage_path=branch_path) then raise exception 'Retired token retained'; end if;
  if exists(select 1 from welcome_video_cleanup_queue where storage_path=replacement_path) then raise exception 'Live file queued on intent consumption'; end if;
  perform app_set_welcome_video(team,branch_id,replacement_path,'new.mp4',1000000,120,400,720); -- retry after lost response
  begin
    perform app_set_welcome_video(team,branch_id,abandoned_path,'expired.mp4',1000000,120,400,720);
    raise exception 'Expired upload became live';
  exception when raise_exception then if sqlerrm <> 'welcome_video_upload_expired' then raise; end if; end;
  select * into job from app_claim_welcome_video_cleanup(100) where storage_path=branch_path;
  if job.lease_token is null then raise exception 'Retired file not claimed'; end if;
  if exists(select 1 from app_claim_welcome_video_cleanup(100) where storage_path=branch_path) then raise exception 'Duplicate worker claim'; end if;
  perform app_ack_welcome_video_cleanup(branch_path,gen_random_uuid(),200);
  if not exists(select 1 from welcome_video_cleanup_queue where storage_path=branch_path) then raise exception 'Wrong lease removed job'; end if;
  perform app_ack_welcome_video_cleanup(branch_path,job.lease_token,503);
  if not exists(select 1 from welcome_video_cleanup_queue where storage_path=branch_path and last_status=503 and lease_token is null and next_attempt_at > now()) then raise exception 'No backoff after failure'; end if;
  update welcome_video_cleanup_queue set next_attempt_at=now() where storage_path=branch_path;
  select * into job from app_claim_welcome_video_cleanup(100) where storage_path=branch_path;
  perform app_ack_welcome_video_cleanup(branch_path,job.lease_token,200);
  if exists(select 1 from welcome_video_cleanup_queue where storage_path=branch_path) then raise exception 'Successful deletion not acked'; end if;
  if not exists(select 1 from welcome_video_cleanup_queue where storage_path=abandoned_path and next_attempt_at >= now()+interval '24 hours') then raise exception 'Abandoned file missing grace'; end if;
  update users set welcome_video_completed_at=now() where id=child_id;
  if exists(select 1 from app_resolve_welcome_video(child_id,team)) then raise exception 'Completed user gets video'; end if;
  delete from welcome_videos where owner_user_id=branch_id;
  if not exists(select 1 from welcome_video_cleanup_queue where storage_path=replacement_path) then raise exception 'Deleted video not queued'; end if;
  if has_table_privilege('anon','welcome_video_url_cache','select') or has_table_privilege('authenticated','welcome_video_cleanup_queue','select')
    or has_function_privilege('authenticated','app_resolve_welcome_video(uuid,uuid)','execute') then raise exception 'Public access to privileged video internals'; end if;
  if (select file_size_limit from storage.buckets where id='welcome-videos') <> 209715200 then raise exception 'Storage limit mismatch'; end if;
end $$;
rollback;
