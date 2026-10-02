-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); entry public.audit_log%rowtype;
begin
  insert into public.teams(id,name) values(team, 'audit-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (mentor,'Audit Mentor','Audit','Mentor',mentor || '@test.invalid',mentor::text,'test','admin',team);

  -- The team name is copied; an unknown actor id (the CEO login has none) is stored as empty.
  perform public.app_record_audit(mentor, ' Audit Mentor ', 'admin', 'task.delete', 'x1', 'Old task', team, '{"miles":5}');
  perform public.app_record_audit(gen_random_uuid(), '', 'ceo', 'team.delete', team::text, 'Gone team', gen_random_uuid(), null);
  select * into entry from public.audit_log where action = 'task.delete' and target_id = 'x1';
  assert entry.actor_id = mentor and entry.actor_name = 'Audit Mentor' and entry.team_label = 'audit-' || team and entry.details->>'miles' = '5', 'entry stored wrong';
  select * into entry from public.audit_log where action = 'team.delete' and target_id = team::text;
  assert entry.actor_id is null and entry.actor_name = 'Без имени' and entry.team_id is null and entry.details = '{}', 'unknown actor or team kept';

  -- Entries survive the deletion of the people and teams they mention.
  delete from public.users where id = mentor;
  delete from public.teams where id = team;
  select * into entry from public.audit_log where action = 'task.delete' and target_id = 'x1';
  assert entry.actor_id is null and entry.team_id is null and entry.actor_name = 'Audit Mentor' and entry.team_label = 'audit-' || team, 'history lost with the team';

  begin
    perform public.app_record_audit(null, 'X', 'admin', 'Drop Table', null, null, null, null);
    raise exception 'bad action name accepted';
  exception when check_violation then null;
  end;

  -- The journal is append-only even for the server.
  assert has_table_privilege('service_role','public.audit_log','select'), 'server cannot read the journal';
  assert not has_table_privilege('service_role','public.audit_log','update'), 'server can rewrite the journal';
  assert not has_table_privilege('service_role','public.audit_log','delete'), 'server can erase the journal';
  assert not has_table_privilege('authenticated','public.audit_log','select'), 'browser can read the journal';
  assert not has_function_privilege('authenticated','public.app_record_audit(uuid,text,text,text,text,text,uuid,jsonb)','execute'), 'browser can write the journal';
end $$;
rollback;

begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  leader uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); plain uuid := gen_random_uuid();
  branch_member uuid := gen_random_uuid(); no_telegram uuid := gen_random_uuid(); done uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid(); expired_task uuid := gen_random_uuid(); result jsonb;
begin
  insert into public.teams(id,name) values(team, 'nudge-' || team), (other_team, 'nudge-other-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false,'9300000001'),
    (reviewer,'Reviewer','Branch','Reviewer',reviewer || '@test.invalid',reviewer::text,'test','member',team,true,'9300000002'),
    (plain,'Plain','Plain','Member',plain || '@test.invalid',plain::text,'test','member',team,false,'9300000003'),
    (branch_member,'Branch','Branch','Member',branch_member || '@test.invalid',branch_member::text,'test','member',team,false,'9300000004'),
    (no_telegram,'Silent','No','Telegram',no_telegram || '@test.invalid',no_telegram::text,'test','member',team,false,null),
    (done,'Done','Done','Member',done || '@test.invalid',done::text,'test','member',team,false,'9300000005'),
    (outsider,'Outsider','Other','Leader',outsider || '@test.invalid',outsider::text,'test','admin',other_team,false,'9300000006');
  update public.users set parent_user_id = leader where id in (reviewer, plain, done);
  update public.users set parent_user_id = reviewer where id in (branch_member, no_telegram);
  insert into public.tasks(id,title,description,team_id,max_points) values(v_task,'Write intro','Answer',team,10);
  insert into public.tasks(id,title,description,team_id,max_points,deadline_at) values(expired_task,'Old','Answer',team,10,now() - interval '1 hour');
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(done,v_task,'text','My answer');

  -- Permissions.
  assert public.app_task_nudge(outsider, v_task, false) ? 'forbidden', 'another team nudged';
  assert public.app_task_nudge(plain, v_task, false) ? 'forbidden', 'ordinary member nudged';

  -- The leader reaches everyone who never answered; the reviewer only their branch.
  result := public.app_task_nudge(leader, v_task, false);
  assert result->'data'->>'reachable' = '3' and result->'data'->>'unreachable' = '1', 'leader preview wrong: ' || result;
  assert (select count(*) from public.telegram_notification_jobs where kind = 'task-nudge') = 0, 'preview queued messages';
  result := public.app_task_nudge(reviewer, v_task, false);
  assert result->'data'->>'reachable' = '1' and result->'data'->>'unreachable' = '1', 'reviewer preview wrong: ' || result;
  assert public.app_task_nudge(leader, expired_task, false)->'data'->>'reachable' = '0', 'expired task is nudgeable';

  -- Sending queues one message per reachable person, then a 12-hour pause for everyone.
  result := public.app_task_nudge(leader, v_task, true);
  assert result->'data'->>'queued' = '3', 'nudge not queued: ' || result;
  assert (select count(*) from public.telegram_notification_jobs where kind = 'task-nudge' and payload->>'taskId' = v_task::text) = 3, 'jobs missing';
  assert not exists(select 1 from public.telegram_notification_jobs where kind = 'task-nudge' and recipient_id in (done, no_telegram, leader)), 'wrong recipients';
  assert public.app_task_nudge(reviewer, v_task, true) ? 'validationError', 'second nudge within 12 hours';
  assert (select count(*) from public.task_nudges where task_id = v_task) = 1, 'nudge history wrong';

  -- Answering before delivery cancels the reminder.
  assert public.app_task_nudge_due(plain, v_task), 'nudge is not due';
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(plain,v_task,'text','Now done');
  assert not public.app_task_nudge_due(plain, v_task), 'nudge still due after answering';

  -- Mass mailings wait behind personal notifications.
  insert into public.telegram_notification_jobs(recipient_id,kind,payload) values(leader,'permissions','{"canReview":true}');
  assert (select kind from public.tg_claim_notification()) not in ('task-nudge','announcement','start-reminder'), 'broadcast went before a personal notification';

  update public.task_nudges set created_at = now() - interval '13 hours';
  assert public.app_task_nudge(leader, v_task, true)->'data'->>'queued' = '2', 'nudge after the pause failed';

  assert not has_function_privilege('authenticated','public.app_task_nudge(uuid,uuid,boolean)','execute'), 'browser can send nudges';
  assert not has_table_privilege('authenticated','public.task_nudges','select'), 'browser can read nudges';
end $$;
rollback;

begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); publisher uuid := gen_random_uuid();
  branch_member uuid := gen_random_uuid(); other_member uuid := gen_random_uuid(); silent uuid := gen_random_uuid();
  for_all uuid := gen_random_uuid(); for_branch uuid := gen_random_uuid();
begin
  insert into public.teams(id,name) values(team, 'announce-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks,telegram_id) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false,'9400000001'),
    (publisher,'Publisher','Branch','Publisher',publisher || '@test.invalid',publisher::text,'test','member',team,true,'9400000002'),
    (branch_member,'Branch','Branch','Member',branch_member || '@test.invalid',branch_member::text,'test','member',team,false,'9400000003'),
    (other_member,'Other','Other','Member',other_member || '@test.invalid',other_member::text,'test','member',team,false,'9400000004'),
    (silent,'Silent','No','Telegram',silent || '@test.invalid',silent::text,'test','member',team,false,null);
  update public.users set parent_user_id = leader where id in (publisher, other_member);
  update public.users set parent_user_id = publisher where id in (branch_member, silent);
  insert into public.announcements(id,team_id,author_id,title,content) values(for_all,team,leader,'Hello all','Meeting at 10');
  insert into public.announcements(id,team_id,author_id,audience_root_id,title,content) values(for_branch,team,publisher,publisher,'Branch','Our call');

  assert public.app_queue_announcement(publisher, for_all) = 0, 'not the author queued an announcement';
  -- Members of the team with Telegram, never the author, never mentors.
  assert public.app_queue_announcement(leader, for_all) = 3, 'team announcement recipients wrong';
  assert public.app_queue_announcement(leader, for_all) = 0, 'announcement queued twice';
  assert not exists(select 1 from public.telegram_notification_jobs where kind = 'announcement' and recipient_id in (leader, silent)), 'wrong announcement recipients';
  -- A branch announcement reaches only the branch.
  assert public.app_queue_announcement(publisher, for_branch) = 1, 'branch announcement recipients wrong';
  assert public.app_announcement_recipient_ok(branch_member, for_branch) and not public.app_announcement_recipient_ok(other_member, for_branch), 'branch audience wrong';
  -- Hidden or deleted announcements are not delivered.
  update public.announcements set is_active = false where id = for_all;
  assert not public.app_announcement_recipient_ok(other_member, for_all), 'hidden announcement still delivered';
end $$;
rollback;

begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); fresh uuid := gen_random_uuid(); worker uuid := gen_random_uuid();
  silent uuid := gen_random_uuid(); veteran uuid := gen_random_uuid(); newcomer uuid := gen_random_uuid(); v_task uuid := gen_random_uuid();
begin
  insert into public.teams(id,name) values(team, 'start-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,telegram_id,team_joined_at) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,'9500000001',now() - interval '5 days'),
    (fresh,'Fresh','Fresh','Member',fresh || '@test.invalid',fresh::text,'test','member',team,'9500000002',now() - interval '2 days'),
    (worker,'Worker','Busy','Member',worker || '@test.invalid',worker::text,'test','member',team,'9500000003',now() - interval '2 days'),
    (silent,'Silent','No','Telegram',silent || '@test.invalid',silent::text,'test','member',team,null,now() - interval '2 days'),
    (veteran,'Veteran','Old','Member',veteran || '@test.invalid',veteran::text,'test','member',team,'9500000004',now() - interval '60 days'),
    (newcomer,'Newcomer','New','Member',newcomer || '@test.invalid',newcomer::text,'test','member',team,'9500000005',now() - interval '3 hours');
  insert into public.tasks(id,title,description,team_id,max_points) values(v_task,'First task','Answer',team,10);
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(worker,v_task,'text','Started');

  -- Only the joined-a-day-ago member who has sent nothing and can be reached.
  assert public.app_queue_start_reminders() = 1, 'first reminders wrong';
  assert exists(select 1 from public.telegram_notification_jobs where kind = 'start-reminder' and recipient_id = fresh and payload->>'step' = '1'), 'first reminder missing';
  assert public.app_queue_start_reminders() = 0, 'reminder repeated at once';

  -- The second reminder needs three days since joining and two since the last one.
  update public.users set team_joined_at = now() - interval '4 days' where id = fresh;
  assert public.app_queue_start_reminders() = 0, 'second reminder too soon after the first';
  update public.member_start_reminders set last_sent_at = now() - interval '2 days' where user_id = fresh;
  assert public.app_queue_start_reminders() = 1, 'second reminder missing';
  assert (select sent_count from public.member_start_reminders where user_id = fresh) = 2, 'reminder counter wrong';

  -- After the third one we stop for good.
  update public.users set team_joined_at = now() - interval '8 days' where id = fresh;
  update public.member_start_reminders set last_sent_at = now() - interval '3 days' where user_id = fresh;
  assert public.app_queue_start_reminders() = 1, 'third reminder missing';
  update public.member_start_reminders set last_sent_at = now() - interval '3 days' where user_id = fresh;
  assert public.app_queue_start_reminders() = 0, 'a fourth reminder was queued';

  -- Sending any answer cancels what is still waiting in the queue.
  assert public.app_start_reminder_due(fresh), 'reminder is not due';
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(fresh,v_task,'text','Finally');
  assert not public.app_start_reminder_due(fresh), 'reminder still due after an answer';
  assert not public.app_start_reminder_due(leader), 'a mentor got a start reminder';

  assert not has_function_privilege('authenticated','public.app_queue_start_reminders()','execute'), 'browser can queue reminders';
  assert not has_table_privilege('authenticated','public.member_start_reminders','select'), 'browser can read reminders';
end $$;
rollback;
