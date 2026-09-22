-- Run only against the disposable database with tests/realtime-fixture.sql.
\set ON_ERROR_STOP on
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  member uuid := gen_random_uuid(); task uuid := gen_random_uuid(); program uuid := gen_random_uuid();
  answer uuid := gen_random_uuid(); count_before bigint;
begin
  insert into teams(id,name) values(team,'live-'||team),(other_team,'live-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    values(member,'Live Member','Live','Member',member||'@test.invalid',member::text,'never-broadcast-this','member',team);
  insert into task_programs(id,team_id,title) values(program,team,'Live program');
  insert into tasks(id,team_id,title,description,program_id,publication_type,position)
    values(task,team,'Live task','never-broadcast-this',program,'sequential',1);
  insert into submissions(id,user_id,task_id,answer_text) values(answer,member,task,'never-broadcast-this');
  insert into star_awards(user_id,team_id,stars,award_kind) values(member,team,3,'premium');
  insert into announcements(team_id,author_id,title,content) values(team,member,'Live announcement','never-broadcast-this');
  insert into member_program_progress(user_id,program_id,current_task_id,unlocked_at,due_at)
    values(member,program,task,now(),now()+interval '1 day');
  insert into team_join_requests(user_id,team_id,status) values(member,team,'approved');
  if exists(select 1 from realtime.test_messages where not private or topic <> 'prokachka:changes' or event <> 'changed') then
    raise exception 'FAIL: event was sent to a public/wrong channel';
  end if;
  if exists(select 1 from realtime.test_messages where payload::text like '%never-broadcast-this%'
    or payload - array['topics','teamIds','userIds','catalog'] <> '{}'::jsonb) then
    raise exception 'FAIL: row contents leaked into an event';
  end if;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'submissions'
    and payload->'teamIds' ? team::text and payload->'userIds' ? member::text) then
    raise exception 'FAIL: submission did not resolve its team/user';
  end if;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'requests') then raise exception 'FAIL: request event absent'; end if;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'stars') then raise exception 'FAIL: award event absent'; end if;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'announcements') then raise exception 'FAIL: announcement event absent'; end if;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'programs') then raise exception 'FAIL: program event absent'; end if;

  select count(*) into count_before from realtime.test_messages;
  update tasks set title = title where id = task;
  if (select count(*) from realtime.test_messages) <> count_before then raise exception 'FAIL: no-op caused redundant invalidation'; end if;
  begin
    update tasks set title = 'Must roll back' where id = task;
    raise exception 'test rollback';
  exception when raise_exception then null; end;
  if (select count(*) from realtime.test_messages) <> count_before then raise exception 'FAIL: rollback left a phantom event'; end if;

  update users set team_id = other_team, parent_user_id = null where id = member;
  if not exists(select 1 from realtime.test_messages where payload->'topics' ? 'session'
    and payload->'teamIds' ? team::text and payload->'teamIds' ? other_team::text and payload->'userIds' ? member::text) then
    raise exception 'FAIL: access change did not invalidate both scopes';
  end if;
  select count(*) into count_before from realtime.test_messages;
  delete from submissions where id = answer;
  if (select count(*) from realtime.test_messages) <= count_before then raise exception 'FAIL: delete did not broadcast'; end if;
end $$;

-- Even a permissive policy elsewhere must not expose the reserved channel.
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated, service_role;
create policy test_permissive on realtime.messages for all to anon, authenticated using (true) with check (true);
insert into realtime.messages(topic) values('prokachka:changes'),('another-feature');
set local role authenticated;
do $$ begin
  if exists(select 1 from realtime.messages where topic = 'prokachka:changes') then raise exception 'FAIL: reserved channel readable'; end if;
  if not exists(select 1 from realtime.messages where topic = 'another-feature') then raise exception 'FAIL: unrelated channel was blocked'; end if;
  begin
    insert into realtime.messages(topic) values('prokachka:changes');
    raise exception 'FAIL: client can forge reserved events';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Notification failures must not stop business writes.
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql as $$ begin raise exception 'simulated Realtime outage'; end $$;
do $$ declare new_team uuid := gen_random_uuid(); begin
  insert into teams(id,name) values(new_team,'outage-'||new_team);
  if not exists(select 1 from teams where teams.id = new_team) then raise exception 'FAIL: notification outage rolled back a write'; end if;
end $$;
rollback;
