\set ON_ERROR_STOP on
\ir ../supabase/20261018-announcement-photos.sql
\ir ../supabase/20261018-announcement-photos.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); author uuid:=gen_random_uuid(); announcement uuid:=gen_random_uuid();
  first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); first_photo jsonb; second_photo jsonb;
  job public.announcement_photo_cleanup_queue%rowtype;
begin
  insert into public.teams(id,name) values(team,'photos-'||team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    values(author,'Mentor','Mentor','Photos',author||'@test.invalid',author::text,'test','admin',team);
  first_photo:=jsonb_build_object('id',first_id,'fullPath',announcement||'/'||first_id||'-full.webp',
    'thumbPath',announcement||'/'||first_id||'-thumb.webp','width',1800,'height',1200);
  second_photo:=jsonb_build_object('id',second_id,'fullPath',announcement||'/'||second_id||'-full.webp',
    'thumbPath',announcement||'/'||second_id||'-thumb.webp','width',2048,'height',1536);
  insert into public.announcements(id,team_id,author_id,title,content,photos)
    values(announcement,team,author,'Photo news','News with photos',jsonb_build_array(first_photo,second_photo));
  if public.app_announcement_photos_valid(announcement,jsonb_build_array(first_photo)) is distinct from true
    or public.app_announcement_photos_valid(announcement,jsonb_build_array(first_photo,first_photo,first_photo,first_photo,first_photo,first_photo,first_photo))
    or public.app_announcement_photos_valid(announcement,jsonb_build_array(jsonb_set(first_photo,'{fullPath}','"wrong/path.webp"'::jsonb)))
    or public.app_announcement_photos_valid(announcement,jsonb_build_array(first_photo-'id'))
    then raise exception 'Photo constraints failed'; end if;
  update public.announcements set photos=jsonb_build_array(second_photo) where id=announcement;
  if (select count(*) from public.announcement_photo_cleanup_queue)<>2 then raise exception 'Retired photo not queued'; end if;
  select * into job from public.app_claim_announcement_photo_cleanup(10) limit 1;
  if job.storage_path not like '%'||first_id||'%' then raise exception 'Claimed wrong photo'; end if;
  perform public.app_ack_announcement_photo_cleanup(job.storage_path,job.lease_token,true);
  if (select count(*) from public.announcement_photo_cleanup_queue)<>1 then raise exception 'Cleanup ack failed'; end if;
  delete from public.announcements where id=announcement;
  if (select count(*) from public.announcement_photo_cleanup_queue)<>3 then raise exception 'Delete did not queue photos'; end if;
  if exists(select 1 from public.app_claim_announcement_photo_cleanup(10) where storage_path not like '%'||first_id||'%' and storage_path not like '%'||second_id||'%') then raise exception 'Bad cleanup path'; end if;
  if has_table_privilege('authenticated','public.announcement_photo_cleanup_queue','select') then raise exception 'Cleanup queue exposed'; end if;
end $$;
rollback;
