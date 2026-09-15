-- Integration regression suite. Use a disposable local database only.
-- Fixtures are rolled back even after a successful run.
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  root uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); publisher uuid := gen_random_uuid(); sibling uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); parent uuid; child uuid;
  task uuid := gen_random_uuid(); foreign_task uuid := gen_random_uuid(); restricted uuid := gen_random_uuid();
  program uuid := gen_random_uuid(); step1 uuid := gen_random_uuid(); step2 uuid := gen_random_uuid();
  result jsonb; saved_id uuid; prior_count integer; progress_due timestamptz;
begin
  insert into public.teams(id,name) values(team,'Integrity test team'),(other_team,'Integrity other team');
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review)
    values(root,'Root Mentor','Root','Mentor','root@fixture.test','fixture-root','test-only','admin',team,false),
      (mentor,'Branch Mentor','Branch','Mentor','mentor@fixture.test','fixture-mentor','test-only','member',team,false),
      (publisher,'Branch Publisher','Branch','Publisher','publisher@fixture.test','fixture-publisher','test-only','member',team,false),
      (sibling,'Sibling Reviewer','Sibling','Reviewer','sibling@fixture.test','fixture-sibling','test-only','member',team,true),
      (outsider,'Other Mentor','Other','Mentor','other@fixture.test','fixture-other','test-only','admin',other_team,false);
  update public.users set parent_user_id = root where id in (mentor,sibling);
  update public.users set parent_user_id = mentor where id = publisher;
  parent := publisher;
  for i in 1..100 loop
    child := gen_random_uuid();
    insert into public.users(id,name,first_name,last_name,email,login,password_hash,team_id,parent_user_id)
      values(child,'Deep Participant','Deep','Participant','deep'||i||'@fixture.test','fixture-deep-'||i,'test-only',team,parent);
    parent := child;
  end loop;
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,team_id,parent_user_id)
    values(alice,'Alice Member','Alice','Member','alice@fixture.test','fixture-alice','test-only',team,parent),
      (bob,'Bob Member','Bob','Member','bob@fixture.test','fixture-bob','test-only',team,parent);
  insert into public.tasks(id,title,description,team_id,publication_type,audience_root_id) values
    (task,'Task','Answer',team,'evergreen',mentor),(foreign_task,'Other task','Answer',other_team,'evergreen',null),
    (restricted,'Sibling task','Answer',team,'evergreen',sibling);

  insert into public.telegram_link_tokens(token,user_id,expires_at) values
    ('fixture-link-alice',alice,now()+interval '1 hour'),('fixture-link-bob',bob,now()+interval '1 hour'),
    ('fixture-link-alice-2',alice,now()+interval '1 hour'),('fixture-expired',bob,now()-interval '1 hour');
  result := public.tg_link_account('fixture-link-alice','111');
  assert result->>'userId' = alice::text, 'link succeeds';
  assert public.tg_link_account('fixture-link-alice','111')->>'userId' = alice::text, 'link retry is idempotent';
  assert public.tg_link_account('fixture-link-bob','111') ? 'validationError', 'one Telegram cannot bind to two accounts';
  assert public.tg_link_account('fixture-link-alice-2','222') ? 'validationError', 'another token cannot overwrite account binding';
  assert public.tg_link_account('fixture-expired','222') ? 'validationError', 'expired token rejected';
  assert public.tg_link_account('fixture-link-bob','222')->>'userId' = bob::text, 'second account uses its own Telegram';
  assert (select telegram_id = '111' from public.users where id = alice), 'first binding unchanged';
  assert (select count(*) = 104 from public.tg_ancestor_ids(alice)), 'all 100 nested levels are reachable';
  assert public.tg_target_error(alice,foreign_task) is not null, 'cannot send to another team';
  assert public.tg_target_error(alice,restricted) is not null, 'cannot send to sibling audience';

  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values
    ('fixture-session-a',alice,task,'111',now()+interval '1 hour'),
    ('fixture-session-b',bob,task,'222',now()+interval '1 hour');
  assert public.tg_begin_submission('fixture-session-a','111',10)->>'ready' = 'true', 'own task selected';
  assert public.tg_begin_submission('fixture-session-b','111',11) ? 'validationError', 'website B cannot submit through Telegram A';
  assert (select session_hash is null from public.telegram_submission_contexts where telegram_id = '111'), 'foreign start clears stale selection';
  assert public.tg_submit_answer('111','111',12,100,'text','Must not save',null) ? 'validationError', 'no answer after failed account switch';
  assert public.tg_begin_submission('fixture-session-a','111',13)->>'ready' = 'true', 'select again';
  assert public.tg_begin_submission('fixture-session-b','111',9)->>'duplicate' = 'true', 'out-of-order start ignored';
  assert public.tg_submit_answer('111','999',14,101,'text','Wrong chat',null) ? 'validationError', 'group/wrong chat rejected';
  assert public.tg_submit_answer('111','111',12,102,'text','Older than selection',null) ? 'validationError', 'older answer cannot target newer selection';
  insert into public.submissions(user_id,task_id,status) values(alice,task,'pending');
  assert public.tg_target_error(alice,task) is null, 'legacy empty placeholder cannot block real answer';
  result := public.tg_submit_answer('111','111',14,103,'text','Real answer',null);
  saved_id := (result->'data'->>'id')::uuid;
  assert saved_id is not null, 'answer persisted';
  assert public.tg_submit_answer('111','111',14,103,'text','Real answer',null)->>'duplicate' = 'true', 'update retry does not duplicate work after context consumption';
  assert public.tg_submit_answer('111','111',15,104,'text','Must not overwrite',null) ? 'validationError', 'consumed context cannot overwrite pending answer';
  assert (select answer_text = 'Real answer' from public.submissions where id = saved_id), 'answer stays immutable';
  assert (select count(*) = 1 from public.telegram_notification_jobs where submission_id = saved_id), 'only root mentor receives initially';
  assert not public.tg_can_review(sibling,saved_id), 'sibling cannot review';
  assert not public.tg_can_review(outsider,saved_id), 'other team cannot review';
  update public.users set can_publish_tasks = true where id = publisher;
  assert not exists(select 1 from public.telegram_notification_jobs where recipient_id = publisher and submission_id = saved_id), 'publication permission is not review permission';
  update public.users set can_review = true where id = mentor;
  assert public.tg_can_review(mentor,saved_id), 'reviewer sees hundredth-level descendant';
  assert exists(select 1 from public.telegram_notification_jobs where recipient_id = mentor and submission_id = saved_id), 'grant backfills pending work';
  assert exists(select 1 from public.telegram_notification_jobs where recipient_id = mentor and kind = 'permissions'), 'grant creates permission notification';
  select count(*) into prior_count from public.telegram_notification_jobs where recipient_id = mentor;
  update public.users set can_review = true where id = mentor;
  assert (select count(*) = prior_count from public.telegram_notification_jobs where recipient_id = mentor), 'unchanged rights do not spam';
  update public.users set can_review = true where id = alice;
  assert not public.tg_can_review(alice,saved_id), 'cannot review oneself';
  assert public.tg_review_submission(saved_id,alice,false,'accepted',10,'') ? 'forbidden', 'self review denied inside transaction';
  update public.users set can_review = false where id = mentor;
  assert public.tg_review_submission(saved_id,mentor,false,'accepted',10,'') ? 'forbidden', 'revoked reviewer rejected with fresh database rights';
  update public.users set can_review = true where id = mentor;
  result := public.tg_review_submission(saved_id,mentor,false,'revision',0,'Please revise');
  assert result->'data'->>'status' = 'revision', 'request revision';
  assert public.tg_review_submission(saved_id,root,false,'accepted',10,'') ? 'validationError', 'another reviewer cannot overwrite decision';
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('fixture-revision',alice,task,'111',now()+interval '1 hour');
  perform public.tg_begin_submission('fixture-revision','111',20);
  result := public.tg_submit_answer('111','111',21,105,'photo','Revised photo','fixture-file');
  saved_id := (result->'data'->>'id')::uuid;
  assert saved_id is not null, 'revision creates a separate attempt';
  assert (select count(*) = 2 from public.submissions where user_id = alice and media_type is not null), 'revision history retained';
  perform public.tg_review_submission(saved_id,mentor,false,'accepted',100,'Good');
  assert (select points = 10 from public.submissions where id = saved_id), 'points clamped to task maximum';
  assert public.tg_target_error(alice,task) is not null, 'accepted task cannot be submitted again for extra points';
  assert public.tg_review_submission(saved_id,mentor,false,'revision',0,'Return from history',1)->'data'->>'status' = 'revision', 'history return remains available with current version';
  assert public.tg_review_submission(saved_id,mentor,false,'accepted',10,'Accept from history',2)->'data'->>'status' = 'accepted', 'history accept remains available with current version';
  assert public.tg_review_submission((select id from public.submissions where user_id = alice and task_id = task and status = 'revision'),mentor,false,'accepted',10,'Stale attempt',1) ? 'validationError', 'old attempt cannot replace revised answer';

  insert into public.task_programs(id,team_id,title,deadline_hours) values(program,team,'Sequential test',48);
  insert into public.tasks(id,title,description,team_id,publication_type,program_id,position,deadline_hours)
    values(step1,'Step one','First',team,'sequential',program,1,24),(step2,'Step two','Second',team,'sequential',program,2,12);
  insert into public.member_program_progress(user_id,program_id,current_task_id,unlocked_at,due_at)
    values(alice,program,step1,now()-interval '2 days',now()-interval '1 day');
  assert public.tg_target_error(alice,step2) is not null, 'cannot skip program steps';
  assert public.tg_target_error(alice,step1) is null, 'late program submission remains allowed';
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('fixture-program',alice,step1,'111',now()+interval '1 hour');
  perform public.tg_begin_submission('fixture-program','111',30);
  result := public.tg_submit_answer('111','111',31,106,'video','Step answer','fixture-video');
  saved_id := (result->'data'->>'id')::uuid;
  perform public.tg_review_submission(saved_id,mentor,false,'accepted',10,'');
  assert (select current_task_id = step2 from public.member_program_progress where user_id = alice and program_id = program), 'acceptance unlocks next step';
  select due_at into progress_due from public.member_program_progress where user_id = alice and program_id = program;
  assert progress_due = now()+interval '12 hours', 'next step uses its own deadline';
  assert public.tg_review_submission(saved_id,root,false,'accepted',10,'') ? 'validationError', 'duplicate review cannot advance twice';
  assert public.tg_review_submission(saved_id,mentor,false,'revision',0,'Return step',1)->'data'->>'status' = 'revision', 'can return step before downstream work starts';
  assert (select current_task_id = step1 from public.member_program_progress where user_id = alice and program_id = program), 'return restores program step atomically';
  perform public.tg_review_submission(saved_id,mentor,false,'accepted',10,'Accept again',2);
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(alice,step2,'text','Next step started');
  assert public.tg_review_submission(saved_id,mentor,false,'revision',0,'Unsafe rollback',3) ? 'validationError', 'cannot roll program backward over later answers';

  assert not has_table_privilege('anon','public.users','select'), 'anonymous cannot read password hashes';
  assert not has_table_privilege('authenticated','public.submissions','select'), 'browser cannot bypass submission scope';
  assert not has_function_privilege('anon','public.tg_link_account(text,text)','execute'), 'link RPC server only';
  assert not has_function_privilege('authenticated','public.tg_review_submission(uuid,uuid,boolean,text,integer,text,integer)','execute'), 'review RPC server only';
  assert has_function_privilege('service_role','public.tg_submit_answer(text,text,bigint,bigint,text,text,text)','execute'), 'backend can save work';
  raise notice 'Telegram integrity integration assertions passed';
end;
$$;
rollback;
