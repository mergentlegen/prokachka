-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  root_id uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); sibling uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); v_task_id uuid := gen_random_uuid();
  answer_id uuid := gen_random_uuid(); second_id uuid := gen_random_uuid(); thread_id uuid;
  first_nonce uuid := gen_random_uuid(); result jsonb;
  extra_task uuid := gen_random_uuid(); own_task uuid := gen_random_uuid(); extra_id uuid; extra_thread uuid; i integer;
begin
  insert into public.teams(id,name) values(team, 'feedback-' || team),(other_team, 'feedback-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (root_id,'Root Mentor','Root','Mentor',root_id || '@test.invalid',root_id::text,'test','admin',team,false),
    (reviewer,'Branch Mentor','Branch','Mentor',reviewer || '@test.invalid',reviewer::text,'test','member',team,true),
    (sibling,'Sibling Mentor','Sibling','Mentor',sibling || '@test.invalid',sibling::text,'test','member',team,true),
    (member_id,'Team Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,false),
    (outsider,'Other Mentor','Other','Mentor',outsider || '@test.invalid',outsider::text,'test','admin',other_team,false);
  update public.users set parent_user_id = root_id where id in (reviewer,sibling);
  update public.users set parent_user_id = reviewer where id = member_id;
  insert into public.tasks(id,title,description,team_id,max_points) values(v_task_id,'Feedback task','Answer',team,10);
  insert into public.submissions(id,user_id,task_id,media_type,answer_text) values(answer_id,member_id,v_task_id,'text','My answer');
  select f.id into thread_id from public.feedback_threads f where f.member_user_id = member_id and f.task_id = v_task_id;
  assert thread_id is not null, 'submission did not create a feedback thread';
  assert (select count(*) = 1 from public.feedback_events e where e.thread_id = thread_id and kind = 'submission'), 'submission event missing';
  assert public.app_feedback_can_access(thread_id, member_id, false), 'member cannot read own thread';
  assert public.app_feedback_can_access(thread_id, reviewer, false), 'ancestor reviewer cannot read';
  assert not public.app_feedback_can_access(thread_id, sibling, false), 'sibling leaked thread';
  assert not public.app_feedback_can_access(thread_id, outsider, false), 'other team leaked thread';
  assert jsonb_array_length(public.app_feedback_list(sibling, false, 100)) = 0, 'sibling listing leaked thread';
  assert public.app_feedback_detail(thread_id, outsider, false) ? 'forbidden', 'detail leaked thread';
  assert public.app_feedback_send(thread_id, outsider, false, 'No access', gen_random_uuid()) ? 'forbidden', 'outsider wrote message';
  assert public.app_feedback_review_submission(answer_id,reviewer,false,'revision',0,'',0) ? 'validationError', 'empty revision accepted';
  result := public.app_feedback_review_submission(answer_id,reviewer,false,'revision',0,'Please explain more',0);
  assert result ? 'data', 'review failed';
  assert (select count(*) = 1 from public.feedback_events e where e.thread_id = thread_id and kind = 'review'), 'review event missing';
  assert (select count(*) = 1 from public.telegram_notification_jobs where feedback_event_seq is not null and recipient_id = member_id), 'member notice missing';
  result := public.app_feedback_send(thread_id,member_id,false,'I will revise',first_nonce);
  assert result ? 'seq', 'member message failed';
  assert public.app_feedback_send(thread_id,member_id,false,'I will revise',first_nonce)->>'seq' = result->>'seq', 'message retry not idempotent';
  assert (select count(*) = 1 from public.feedback_events e where e.thread_id = thread_id and client_nonce = first_nonce), 'message duplicated';
  assert exists(select 1 from jsonb_array_elements(public.app_feedback_list(reviewer,false,100)) x where x->>'id'=thread_id::text and x->>'needsReply'='true'), 'reply queue missing';
  assert (public.app_feedback_counts(reviewer,false)->>'needsReply')::int = 1, 'mentor counter missing reply';
  assert jsonb_array_length(public.app_feedback_list(reviewer,false,50,0,true)) = 1, 'server reply filter missing';
  assert jsonb_array_length(public.app_feedback_list(reviewer,false,50,1,true)) = 0, 'feedback pagination duplicated thread';
  assert public.app_feedback_mark_read(thread_id,reviewer,false), 'reviewer read failed';
  assert exists(select 1 from jsonb_array_elements(public.app_feedback_list(reviewer,false,100)) x where x->>'id'=thread_id::text and x->>'unread'='false'), 'read marker missing';
  assert (select status = 'revision' and points = 0 from public.submissions where id = answer_id), 'message changed decision';
  update public.users set can_review = false where id = reviewer;
  assert not public.app_feedback_can_access(thread_id, reviewer, false), 'revocation ignored';
  assert jsonb_array_length(public.app_feedback_task_groups(reviewer,false,50,0,false)) = 0, 'revoked mentor group remained visible';
  assert public.app_feedback_send(thread_id, reviewer, false, 'No access', gen_random_uuid()) ? 'forbidden', 'revoked reviewer wrote';
  update public.users set can_review = true where id = reviewer;
  update public.users set parent_user_id = sibling where id = member_id;
  assert not public.app_feedback_can_access(thread_id, reviewer, false), 'branch move leaked thread';
  assert public.app_feedback_can_access(thread_id, sibling, false), 'new ancestor cannot read';
  assert jsonb_array_length(public.app_feedback_list_task(reviewer,false,v_task_id,50,0,false)) = 0, 'branch move leaked participant list';
  update public.users set parent_user_id = reviewer where id = member_id;
  insert into public.submissions(id,user_id,task_id,media_type,answer_text) values(second_id,member_id,v_task_id,'text','Revised answer');
  assert (select count(*) = 2 from public.feedback_events e where e.thread_id = thread_id and kind = 'submission'), 'revision attempt missing';
  assert public.app_feedback_review_submission(second_id,reviewer,false,'accepted',10,'Good',0) ? 'data', 'second review failed';
  assert (select count(*) = 2 from public.feedback_events e where e.thread_id = thread_id and kind = 'review'), 'review history lost';
  delete from public.tasks where id = v_task_id;
  assert (select count(*) = 5 from public.feedback_events e where e.thread_id = thread_id), 'task deletion erased conversation';
  assert (select f.task_id is null and f.task_title = 'Feedback task' from public.feedback_threads f where f.id = thread_id), 'task snapshot missing';
  assert not has_function_privilege('authenticated','public.app_feedback_detail(uuid,uuid,boolean)','execute'), 'browser can execute private RPC';
  assert not has_function_privilege('authenticated','public.app_feedback_list(uuid,boolean,integer,integer,boolean)','execute'), 'browser can enumerate private threads';
  assert not has_function_privilege('authenticated','public.app_feedback_counts(uuid,boolean)','execute'), 'browser can read private counters';
  assert jsonb_array_length(public.app_feedback_list_scoped(member_id,false,'personal',50,0,false)) = 1, 'member personal inbox missing';
  assert jsonb_array_length(public.app_feedback_list_scoped(reviewer,false,'personal',50,0,false)) = 0, 'reviewer personal inbox leaked branch conversation';
  assert jsonb_array_length(public.app_feedback_list_scoped(reviewer,false,'mentor',50,0,false)) = 1, 'reviewer mentor inbox missing';
  assert jsonb_array_length(public.app_feedback_list_scoped(member_id,false,'mentor',50,0,false)) = 0, 'member mentor inbox leaked conversation';
  assert exists(select 1 from jsonb_array_elements(public.app_feedback_task_groups(reviewer,false,50,0,false)) x
    where x->>'key'=thread_id::text and (x->>'participants')::int = 1), 'deleted task group missing';
  assert jsonb_array_length(public.app_feedback_list_task(reviewer,false,thread_id,50,0,false)) = 1, 'task participant list missing';
  assert jsonb_array_length(public.app_feedback_list_task(sibling,false,thread_id,50,0,false)) = 0, 'sibling task list leaked branch';
  assert jsonb_array_length(public.app_feedback_task_groups(reviewer,false,50,0,true)) = 0, 'reply-only task group retained resolved thread';
  assert public.app_feedback_detail_scoped(thread_id,reviewer,false,'personal') ? 'forbidden', 'reviewer personal detail leaked branch conversation';
  assert public.app_feedback_send_scoped(thread_id,reviewer,false,'personal','No access',gen_random_uuid()) ? 'forbidden', 'reviewer personal scope wrote branch conversation';
  assert not public.app_feedback_mark_read_scoped(thread_id,reviewer,false,'personal'), 'reviewer personal scope marked branch read';
  assert (public.app_feedback_counts_scoped(reviewer,false,'personal')->>'needsReply')::int = 0, 'reviewer personal counter leaked branch reply';
  assert (public.app_feedback_counts_scoped(reviewer,false,'mentor')->>'needsReply')::int = 0, 'reviewer mentor counter incorrect after acceptance';
  assert not has_function_privilege('authenticated','public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean)','execute'), 'browser can enumerate scoped threads';
  insert into public.tasks(id,title,description,team_id,max_points) values(own_task,'Reviewer own work','Answer',team,10);
  insert into public.submissions(id,user_id,task_id,media_type,answer_text)
    values(gen_random_uuid(),reviewer,own_task,'text','My own work');
  assert jsonb_array_length(public.app_feedback_list_scoped(reviewer,false,'personal',50,0,false)) = 1, 'reviewer own work missing from personal inbox';
  assert jsonb_array_length(public.app_feedback_list_scoped(reviewer,false,'mentor',50,0,false)) = 1, 'reviewer own work leaked into mentor inbox';
  insert into public.tasks(id,title,description,team_id,max_points) values(extra_task,'Many replies','Answer',team,10);
  for i in 1..55 loop
    extra_id := gen_random_uuid();
    insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id)
      values(extra_id,'Participant ' || i,'Participant','Member',extra_id || '@test.invalid',extra_id::text,'test','member',team,reviewer);
    insert into public.feedback_threads(team_id,member_user_id,task_id,task_title)
      values(team,extra_id,extra_task,'Many replies') returning id into extra_thread;
    insert into public.feedback_events(thread_id,kind,author_user_id,author_name,body,client_nonce)
      values(extra_thread,'message',extra_id,'Participant ' || i,'Question',gen_random_uuid());
  end loop;
  assert exists(select 1 from jsonb_array_elements(public.app_feedback_task_groups(reviewer,false,50,0,false)) x
    where x->>'key'=extra_task::text and (x->>'participants')::int = 55), 'task group count truncated at first page';
  assert jsonb_array_length(public.app_feedback_list_task(reviewer,false,extra_task,50,0,false)) = 50, 'first participant page incorrect';
  assert jsonb_array_length(public.app_feedback_list_task(reviewer,false,extra_task,50,50,false)) = 5, 'second participant page incorrect';
end;
$$;
rollback;
