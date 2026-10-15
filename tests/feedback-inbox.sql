-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); sibling uuid := gen_random_uuid();
  alia uuid := gen_random_uuid(); timur uuid := gen_random_uuid(); first_task uuid := gen_random_uuid(); second_task uuid := gen_random_uuid();
  alia_thread uuid; timur_thread uuid; result jsonb; listed jsonb;
begin
  insert into public.teams(id,name) values(team, 'inbox-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (mentor,'Асель Наставник','Асель','Наставник',mentor || '@test.invalid',mentor::text,'test','admin',team,false),
    (sibling,'Соседний Наставник','Соседний','Наставник',sibling || '@test.invalid',sibling::text,'test','member',team,true),
    (alia,'Алия Бекова','Алия','Бекова',alia || '@test.invalid',alia::text,'test','member',team,false),
    (timur,'Тимур Ахметов','Тимур','Ахметов',timur || '@test.invalid',timur::text,'test','member',team,false);
  update public.users set parent_user_id = mentor where id in (alia, timur, sibling);
  insert into public.tasks(id,title,description,team_id,max_points) values
    (first_task,'Видео','Запиши',team,5),(second_task,'Гайд','Прочитай',team,5);
  insert into public.submissions(user_id,task_id,media_type,answer_text) values(alia,first_task,'text','Ответ'),(timur,second_task,'text','Ответ');
  select id into alia_thread from public.feedback_threads where member_user_id = alia;
  select id into timur_thread from public.feedback_threads where member_user_id = timur;

  -- Тимур wrote first, so he has waited longest.
  perform public.app_feedback_send(timur_thread, timur, false, 'Вопрос по гайду', gen_random_uuid());
  update public.feedback_events set created_at = now() - interval '2 days' where thread_id = timur_thread and kind = 'message';
  perform public.app_feedback_send(alia_thread, alia, false, 'Посмотрите, пожалуйста', gen_random_uuid());

  listed := public.app_feedback_mentor_threads(mentor, false, '', true, 50, 0);
  assert jsonb_array_length(listed) = 2, 'waiting list across tasks is incomplete';
  assert listed->0->>'id' = timur_thread::text, 'the longest wait is not first';
  assert (listed->0->>'waitingSince')::timestamptz < now() - interval '1 day', 'waiting time is not from the first unanswered message';
  assert listed->0 ? 'avatar_path', 'participant photo is missing from the list';
  assert jsonb_array_length(public.app_feedback_mentor_threads(sibling, false, '', true, 50, 0)) = 0, 'a mentor outside the branch sees the waiting list';

  listed := public.app_feedback_mentor_threads(mentor, false, 'ТИМ', false, 50, 0);
  assert jsonb_array_length(listed) = 1 and listed->0->>'memberName' = 'Тимур Ахметов', 'participant search across tasks failed';
  assert jsonb_array_length(public.app_feedback_mentor_threads(alia, false, '', false, 50, 0)) = 0, 'a participant can list mentor conversations';

  -- «Ответ не нужен» clears the wait without a message; a new participant message brings it back.
  assert not public.app_feedback_dismiss_reply(alia_thread, sibling, false), 'an outside mentor dismissed a reply';
  assert not public.app_feedback_dismiss_reply(alia_thread, alia, false), 'the participant dismissed their own question';
  assert public.app_feedback_dismiss_reply(alia_thread, mentor, false), 'dismiss failed';
  assert (public.app_feedback_counts_scoped(mentor, false, 'mentor')->>'needsReply')::int = 1, 'dismissed conversation still counted';
  assert not exists(select 1 from jsonb_array_elements(public.app_feedback_list_task(mentor, false, first_task, 50, 0, true)) x), 'dismissed conversation still waits in its task';
  assert (select count(*) = 0 from public.feedback_events where thread_id = alia_thread and author_user_id = mentor), 'dismiss wrote a message';
  assert not (public.app_feedback_detail_scoped(alia_thread, mentor, false, 'mentor')->>'needsReply')::boolean, 'detail still waits';
  perform public.app_feedback_send(alia_thread, alia, false, 'Ещё вопрос', gen_random_uuid());
  assert (public.app_feedback_counts_scoped(mentor, false, 'mentor')->>'needsReply')::int = 2, 'a new question after dismiss is ignored';

  -- «Прочитано»: the mentor sees how far the participant has read; the participant does not get this field.
  perform public.app_feedback_send(timur_thread, mentor, false, 'Ответ наставника', gen_random_uuid());
  result := public.app_feedback_detail_scoped(timur_thread, mentor, false, 'mentor');
  assert (result->>'memberSeenSeq')::bigint < (select max(seq) from public.feedback_events where thread_id = timur_thread), 'unread message shown as read';
  assert exists(select 1 from jsonb_array_elements(result->'people') p where p->>'id' = mentor::text) and exists(select 1 from jsonb_array_elements(result->'people') p where p->>'id' = timur::text), 'people of the conversation missing';
  perform public.app_feedback_mark_read_scoped(timur_thread, timur, false, 'personal');
  result := public.app_feedback_detail_scoped(timur_thread, mentor, false, 'mentor');
  assert (result->>'memberSeenSeq')::bigint = (select max(seq) from public.feedback_events where thread_id = timur_thread), 'read receipt missing';
  assert not (public.app_feedback_detail_scoped(timur_thread, timur, false, 'personal') ? 'memberSeenSeq'), 'the participant sees read receipts';

  assert not has_function_privilege('authenticated', 'public.app_feedback_mentor_threads(uuid,boolean,text,boolean,integer,integer)', 'execute'), 'browser can list mentor conversations';
  assert not has_function_privilege('authenticated', 'public.app_feedback_dismiss_reply(uuid,uuid,boolean)', 'execute'), 'browser can dismiss replies';
end;
$$;
rollback;
