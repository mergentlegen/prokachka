-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); root_id uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid();
  sibling uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); other_member uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid(); game_task uuid := gen_random_uuid(); hidden_task uuid := gen_random_uuid();
  result jsonb; saved_id uuid; before_count integer;
begin
  insert into public.teams(id,name) values(team, 'mentor-completion-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id) values
    (root_id,'Root Mentor','Root','Mentor',root_id || '@test.invalid',root_id::text,'test','admin',team,false,'9100000001'),
    (reviewer,'Branch Mentor','Branch','Mentor',reviewer || '@test.invalid',reviewer::text,'test','member',team,true,'9100000002'),
    (sibling,'Sibling Mentor','Sibling','Mentor',sibling || '@test.invalid',sibling::text,'test','member',team,true,'9100000003'),
    (member_id,'Team Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,false,'9100000004'),
    (other_member,'Other Member','Other','Member',other_member || '@test.invalid',other_member::text,'test','member',team,false,null);
  update public.users set parent_user_id = root_id where id in (reviewer,sibling);
  update public.users set parent_user_id = reviewer where id in (member_id,other_member);
  insert into public.tasks(id,title,description,team_id,max_points,resource_url,deadline_at) values
    (v_task,'External test','Pass the test',team,10,'https://hirebox.app/tests/org/x',now() - interval '1 day');
  insert into public.tasks(id,title,description,team_id,max_points,resource_url,is_active) values
    (hidden_task,'Hidden test','Hidden',team,10,'https://example.test',false);
  insert into public.tasks(id,title,description,team_id,max_points,interactive_kind) values(game_task,'Game','Game',team,5,'dream-route');

  -- Permissions: only the branch's mentors and team admins may record a completion.
  assert public.app_mentor_record_submission(v_task,member_id,sibling,false,10,'Good') ? 'forbidden', 'sibling mentor recorded completion';
  assert public.app_mentor_record_submission(v_task,member_id,member_id,false,10,'Good') ? 'forbidden', 'member recorded own completion';
  assert public.app_mentor_record_submission(v_task,member_id,other_member,false,10,'Good') ? 'forbidden', 'ordinary member recorded completion';
  assert public.app_mentor_record_submission(v_task,member_id,reviewer,false,10,'  ') ? 'validationError', 'empty feedback accepted';
  assert public.app_mentor_record_submission(game_task,member_id,reviewer,false,5,'Good') ? 'validationError', 'interactive game recorded manually';
  assert public.app_mentor_record_submission(hidden_task,member_id,reviewer,false,5,'Good') ? 'validationError', 'hidden task recorded';
  assert not exists(select 1 from public.submissions where user_id = member_id), 'rejected attempts left submissions';

  -- A past deadline does not block the mentor; points are capped by the task like a normal review.
  result := public.app_mentor_record_submission(v_task,member_id,reviewer,false,50,'Great result on the test');
  assert result ? 'data', 'branch mentor could not record completion: ' || result::text;
  saved_id := (result->'data'->>'id')::uuid;
  assert (select status = 'accepted' and points = 10 and submission_source = 'mentor' and comment = 'Great result on the test'
    from public.submissions where id = saved_id), 'completion saved with wrong state';
  assert (select count(*) = 1 from public.feedback_events e join public.feedback_threads f on f.id = e.thread_id
    where f.member_user_id = member_id and f.task_id = v_task and e.kind = 'review' and e.points = 10), 'feedback review event missing';
  assert exists(select 1 from public.telegram_notification_jobs where recipient_id = member_id and kind = 'feedback'), 'participant notice missing';
  assert not exists(select 1 from public.telegram_notification_jobs where submission_id = saved_id and kind = 'submission' and cancelled_at is null),
    'mentors were notified about already checked work';
  assert public.app_mentor_record_submission(v_task,member_id,root_id,false,10,'Again') ? 'validationError', 'accepted task recorded twice';

  -- A participant's own pending answer must be reviewed instead of overwritten.
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(other_member,v_task,'text','My answer');
  before_count := (select count(*) from public.submissions where user_id = other_member);
  assert public.app_mentor_record_submission(v_task,other_member,root_id,false,10,'Good') ? 'validationError', 'pending answer bypassed';
  assert (select count(*) from public.submissions where user_id = other_member) = before_count, 'pending check left a submission';

  -- A failing review inside the function rolls back the created submission.
  update public.submissions set status = 'revision', review_version = review_version + 1 where user_id = other_member;
  result := public.app_mentor_record_submission(v_task,other_member,root_id,false,7,'Counted by admin');
  assert result ? 'data', 'admin could not record after revision: ' || result::text;
  assert (select points = 7 from public.submissions where id = (result->'data'->>'id')::uuid), 'admin points lost';

  assert not has_function_privilege('authenticated','public.app_mentor_record_submission(uuid,uuid,uuid,boolean,integer,text)','execute'),
    'browser can record completions';
end $$;
rollback;

begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); silent uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid(); plain_task uuid := gen_random_uuid(); queued integer;
begin
  insert into public.teams(id,name) values(team, 'task-reminders-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id) values
    (mentor,'Mentor','Mentor','One',mentor || '@test.invalid',mentor::text,'test','admin',team,false,'9200000001'),
    (member_id,'Member','Member','One',member_id || '@test.invalid',member_id::text,'test','member',team,false,'9200000002'),
    (silent,'No Telegram','No','Telegram',silent || '@test.invalid',silent::text,'test','member',team,false,null);
  update public.users set parent_user_id = mentor where id in (member_id, silent);
  insert into public.tasks(id,title,description,team_id,max_points,resource_url) values(v_task,'External test','Pass it',team,10,'https://hirebox.app/tests/org/x');
  insert into public.tasks(id,title,description,team_id,max_points) values(plain_task,'No link','Answer',team,10);

  assert public.app_record_task_link_open(member_id, v_task), 'open was not recorded';
  assert public.app_record_task_link_open(silent, v_task), 'open without Telegram was not recorded';
  assert not public.app_record_task_link_open(member_id, plain_task), 'task without link recorded';
  assert not public.app_record_task_link_open(mentor, v_task), 'mentor open recorded';
  assert public.app_queue_task_reminders() = 0, 'reminder queued before an hour passed';

  update public.task_link_opens set opened_at = now() - interval '61 minutes';
  queued := public.app_queue_task_reminders();
  assert queued = 1, 'expected exactly one reminder, got ' || queued;
  assert exists(select 1 from public.telegram_notification_jobs where recipient_id = member_id and kind = 'task-reminder'
    and payload->>'taskId' = v_task::text), 'reminder job missing';
  assert public.app_queue_task_reminders() = 0, 'reminder queued twice';
  assert public.app_task_reminder_due(member_id, v_task), 'queued reminder is not due';

  -- Sending the work cancels the pending reminder at delivery time.
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(member_id,v_task,'text','Done');
  assert not public.app_task_reminder_due(member_id, v_task), 'reminder still due after submission';

  -- Reopening restarts the hour, and stale opens are ignored.
  assert not public.app_record_task_link_open(member_id, v_task), 'pending work accepted a new open';
  update public.task_link_opens set opened_at = now() - interval '2 days', reminded_at = null where user_id = silent;
  update public.users set telegram_id = '9200000003' where id = silent;
  assert public.app_queue_task_reminders() = 0, 'stale open produced a reminder';

  assert not has_function_privilege('authenticated','public.app_queue_task_reminders()','execute'), 'browser can queue reminders';
  assert not has_table_privilege('authenticated','public.task_link_opens','select'), 'browser can read link opens';
end $$;
rollback;
