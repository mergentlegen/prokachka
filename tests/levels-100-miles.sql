\set ON_ERROR_STOP on
-- Levels reached before the change (old dates) go away; a level reached after it stays when the file runs again.
create temporary table levels_100_fixture(name text primary key, id uuid);
do $$
declare team uuid:=gen_random_uuid(); old_member uuid:=gen_random_uuid(); new_member uuid:=gen_random_uuid();
begin
  insert into teams(id,name) values(team,'levels-100-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (old_member,'Old Member','Old','Member',old_member||'@test.invalid',old_member::text,'test','member',team),
    (new_member,'New Member','New','Member',new_member||'@test.invalid',new_member::text,'test','member',team);
  insert into member_levels(user_id,level,reached_at) values(old_member,2,'2026-11-03 10:00+00'),(new_member,2,now());
  insert into telegram_notification_jobs(recipient_id,kind,payload,available_at,created_at) values(old_member,'level-up','{"level":2}','2026-11-03 10:00+00','2026-11-03 10:00+00');
  insert into levels_100_fixture values('team',team),('old',old_member),('new',new_member);
end $$;

\ir ../supabase/20261113-levels-100-miles.sql
\ir ../supabase/20261113-levels-100-miles.sql

do $$
declare old_member uuid:=(select id from levels_100_fixture where name='old'); new_member uuid:=(select id from levels_100_fixture where name='new');
begin
  if app_member_level(old_member)<>1 or exists(select 1 from member_levels where user_id=old_member) then raise exception 'Old level not reset'; end if;
  if exists(select 1 from telegram_notification_jobs where recipient_id=old_member and kind='level-up' and cancelled_at is null) then raise exception 'Old congratulation still queued'; end if;
  if app_member_level(new_member)<>2 then raise exception 'A level reached after the change was reset'; end if;
  if to_regprocedure('public.app_course_standings(uuid)') is not null then raise exception 'Per-level standings still there'; end if;
  if exists(select 1 from pg_trigger where tgname='star_awards_level_check') then raise exception 'Stars still move levels'; end if;
end $$;

delete from telegram_notification_jobs where recipient_id in (select id from levels_100_fixture where name<>'team');
delete from member_levels where user_id in (select id from levels_100_fixture where name<>'team');
delete from users where id in (select id from levels_100_fixture where name<>'team');
delete from teams where id=(select id from levels_100_fixture where name='team');

-- 100 miles on level 1 move up; stars do not; a mentor's «вернуть» stays; level 3 is never automatic.
begin;
do $$
declare team uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid(); t4 uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid(); l2b uuid:=gen_random_uuid();
begin
  insert into teams(id,name) values(team,'levels-100-flow-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (admin_id,'Admin','Admin','Test',admin_id||'@test.invalid',admin_id::text,'test','admin',team,false),
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','member',team,true),
    (member,'Member','Member','Test',member||'@test.invalid',member::text,'test','member',team,false);
  update users set parent_user_id=mentor where id=member;
  insert into tasks(id,title,description,team_id,max_points) values(t1,'A','a',team,60),(t2,'B','b',team,60),(t3,'C','c',team,10),(t4,'D','d',team,10);
  insert into tasks(id,title,description,team_id,max_points,level) values(l2,'L2','l2',team,60,2),(l2b,'L2b','l2b',team,60,2);

  insert into submissions(user_id,task_id,status,points,media_type,answer_text) values(member,t1,'accepted',60,'text','a'),(member,t2,'accepted',39,'text','b');
  insert into star_awards(user_id,team_id,stars,award_kind) values(member,team,5,'premium'),(member,team,5,'premium'),(member,team,5,'premium');
  if app_member_level(member)<>1 then raise exception 'Moved up with 99 miles and 15 stars'; end if;
  if exists(select 1 from telegram_notification_jobs where recipient_id=member and kind='level-up') then raise exception 'Congratulation before 100 miles'; end if;

  -- The hundredth mile: level 2 at once, with a message to the participant and to their mentor.
  insert into submissions(user_id,task_id,status,points,media_type,answer_text) values(member,t3,'accepted',1,'text','c');
  if app_member_level(member)<>2 then raise exception 'Not moved up at 100 miles'; end if;
  if (select count(*) from telegram_notification_jobs where kind='level-up' and (recipient_id=member or payload->>'memberId'=member::text))<>2 then raise exception 'Level messages missing'; end if;

  -- 120 miles on level 2: still level 2.
  insert into submissions(user_id,task_id,status,points,media_type,answer_text) values(member,l2,'accepted',60,'text','x'),(member,l2b,'accepted',60,'text','y');
  if app_member_level(member)<>2 then raise exception 'Level 3 given automatically'; end if;

  -- A mentor's «вернуть» stays although the participant has 100 miles on level 1.
  if (app_set_member_level(admin_id,member,1::smallint)->>'level')::int<>1 then raise exception 'Could not return to level 1'; end if;
  insert into submissions(user_id,task_id,status,points,media_type,answer_text) values(member,t4,'accepted',5,'text','d');
  if app_member_level(member)<>1 then raise exception 'Automatic move overrode the mentor'; end if;
  if (app_set_member_level(admin_id,member,3::smallint)->>'level')::int<>3 then raise exception 'Could not move up by hand'; end if;

  if has_function_privilege('authenticated','public.app_check_member_level(uuid,interval)','execute') then raise exception 'Browser can run the level check'; end if;
end $$;
rollback;
