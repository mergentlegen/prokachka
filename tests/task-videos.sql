-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  leader uuid := gen_random_uuid(); publisher uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  own_task uuid := gen_random_uuid(); leader_task uuid := gen_random_uuid(); game_task uuid := gen_random_uuid();
  source1 text; source2 text; out1 text; out2 text; job record; result jsonb;
begin
  insert into public.teams(id,name) values(team, 'videos-' || team), (other_team, 'videos-other-' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_publish_tasks) values
    (leader,'Leader','Team','Leader',leader || '@test.invalid',leader::text,'test','admin',team,false),
    (publisher,'Publisher','Branch','Publisher',publisher || '@test.invalid',publisher::text,'test','member',team,true),
    (member_id,'Member','Team','Member',member_id || '@test.invalid',member_id::text,'test','member',team,false),
    (outsider,'Outsider','Other','Leader',outsider || '@test.invalid',outsider::text,'test','admin',other_team,false);
  insert into public.tasks(id,title,description,team_id,max_points,publisher_id) values
    (own_task,'Publisher task','Watch',team,10,publisher), (leader_task,'Leader task','Watch',team,10,leader);
  insert into public.tasks(id,title,description,team_id,max_points,interactive_kind) values(game_task,'Game','Game',team,5,'dream-route');
  source1 := team || '/' || own_task || '/' || gen_random_uuid() || '.mov';
  source2 := team || '/' || own_task || '/' || gen_random_uuid() || '.mp4';
  out1 := team || '/' || own_task || '/' || gen_random_uuid() || '.mp4';
  out2 := team || '/' || own_task || '/' || gen_random_uuid() || '.mp4';

  -- Who may attach a video: the team leader, the publisher for their own task; never games or other teams.
  assert public.app_task_video_can_manage(leader, own_task), 'leader cannot manage';
  assert public.app_task_video_can_manage(publisher, own_task), 'publisher cannot manage own task';
  assert not public.app_task_video_can_manage(publisher, leader_task), 'publisher manages a foreign task';
  assert not public.app_task_video_can_manage(member_id, own_task), 'member manages a task';
  assert not public.app_task_video_can_manage(outsider, own_task), 'other team manages a task';
  assert not public.app_task_video_can_manage(leader, game_task), 'a game got a video';
  assert not public.app_task_video_begin_upload(publisher, own_task, other_team || '/' || own_task || '/' || gen_random_uuid() || '.mp4'), 'foreign path issued';

  -- Upload capability: only the issued path is writable, and only until registered.
  assert public.app_task_video_begin_upload(publisher, own_task, source1), 'upload not issued';
  assert public.task_video_upload_path_allowed(source1), 'issued path not allowed';
  assert not public.task_video_upload_path_allowed(source2), 'unissued path allowed';
  assert public.app_task_video_register(member_id, own_task, source1, 'a.mov', 5000) ? 'forbidden', 'member registered a video';
  assert public.app_task_video_register(publisher, own_task, source2, 'a.mp4', 5000) ? 'validationError', 'unissued file registered';
  assert public.app_task_video_register(publisher, own_task, source1, 'lesson.mov', 5000) ? 'data', 'register failed';
  assert not public.task_video_upload_path_allowed(source1), 'spent intent still writable';
  assert (select status = 'processing' and source_path = source1 from public.task_videos where task_id = own_task), 'not queued for processing';

  -- The worker claims it once; the fresh copy replaces the original, which goes to cleanup.
  select * into job from public.app_task_video_claim();
  assert job.task_id = own_task and job.source_path = source1 and job.attempts = 1, 'claim wrong';
  assert not exists (select 1 from public.app_task_video_claim()), 'claimed twice while leased';
  assert not public.app_task_video_finish(own_task, gen_random_uuid(), source1, out1, 900, 240, 1280, 720), 'finished with a foreign lease';
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = out1), 'orphan output not queued';
  delete from public.task_video_cleanup_queue where storage_path = out1;
  assert public.app_task_video_finish(own_task, job.lease_token, source1, out1, 900, 240, 1280, 720), 'finish failed';
  assert (select status = 'ready' and video_path = out1 and source_path is null from public.task_videos where task_id = own_task), 'not ready';
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = source1), 'original not queued for cleanup';
  assert not exists (select 1 from public.task_video_cleanup_queue where storage_path = out1), 'live file queued for cleanup';

  -- Watching: progress moves about as fast as real time, completion needs the end.
  result := public.app_task_video_progress(member_id, own_task, 240);
  assert (result->'data'->>'watchedSeconds')::numeric = 15, 'jumped to the end on the first report: ' || result;
  update public.task_video_views set updated_at = now() - interval '60 seconds' where user_id = member_id;
  result := public.app_task_video_progress(member_id, own_task, 100);
  assert (result->'data'->>'watchedSeconds')::numeric = 100 and result->'data'->>'completed' = 'false', 'normal progress rejected: ' || result;
  result := public.app_task_video_progress(member_id, own_task, 50);
  assert (result->'data'->>'watchedSeconds')::numeric = 100, 'progress went back';
  update public.task_video_views set updated_at = now() - interval '10 minutes' where user_id = member_id;
  result := public.app_task_video_progress(member_id, own_task, 239);
  assert result->'data'->>'completed' = 'true', 'watching to the end did not complete';

  -- A replacement keeps the old file playing until it is ready; finished viewers stay finished.
  assert public.app_task_video_begin_upload(leader, own_task, source2), 'replacement upload not issued';
  assert public.app_task_video_register(leader, own_task, source2, 'new.mp4', 6000) ? 'data', 'replacement not registered';
  assert (select status = 'processing' and video_path = out1 from public.task_videos where task_id = own_task), 'old video stopped playing';
  select * into job from public.app_task_video_claim();
  perform public.app_task_video_fail(own_task, job.lease_token, 'not a video', true);
  assert (select status = 'ready' and video_path = out1 and source_path is null and last_error = 'not a video' from public.task_videos where task_id = own_task), 'failed replacement broke the old video';
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = source2), 'failed original not queued';

  -- Three crashed runs end in a visible failure instead of looping forever.
  delete from public.task_videos where task_id = own_task;
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = out1), 'removed video not queued';
  source1 := team || '/' || own_task || '/' || gen_random_uuid() || '.mp4';
  perform public.app_task_video_begin_upload(publisher, own_task, source1);
  perform public.app_task_video_register(publisher, own_task, source1, 'x.mp4', 5000);
  for i in 1..3 loop
    select * into job from public.app_task_video_claim();
    assert job.task_id = own_task, 'retry ' || i || ' not claimed';
    update public.task_videos set lease_until = now() - interval '1 minute' where task_id = own_task;
  end loop;
  assert not exists (select 1 from public.app_task_video_claim()), 'claimed a fourth time';
  assert (select status = 'failed' and source_path is null from public.task_videos where task_id = own_task), 'endless retries';

  -- Cleanup never touches a file in use, and expired uploads are swept.
  perform public.app_task_video_begin_upload(publisher, own_task, source2);
  update public.task_video_upload_intents set expires_at = now() - interval '1 minute' where storage_path = source2;
  perform public.app_claim_task_video_cleanup(100);
  assert not exists (select 1 from public.task_video_upload_intents where storage_path = source2), 'expired intent kept';
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = source2), 'abandoned upload not queued';

  -- Deleting the task removes its video record and queues the files.
  perform public.app_task_video_begin_upload(publisher, own_task, out2);
  perform public.app_task_video_register(publisher, own_task, out2, 'y.mp4', 5000);
  delete from public.tasks where id = own_task;
  assert exists (select 1 from public.task_video_cleanup_queue where storage_path = out2), 'task deletion left the file';

  -- Browser access.
  assert not has_table_privilege('authenticated', 'public.task_videos', 'select'), 'browser reads videos';
  assert not has_table_privilege('authenticated', 'public.task_video_views', 'select'), 'browser reads views';
  assert not has_function_privilege('authenticated', 'public.app_task_video_progress(uuid,uuid,numeric)', 'execute'), 'browser records progress';
  assert has_function_privilege('authenticated', 'public.task_video_upload_path_allowed(text)', 'execute'), 'storage policy helper not callable';
end $$;
rollback;
