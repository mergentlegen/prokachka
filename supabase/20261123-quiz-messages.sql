-- The mentor's own words after a test-only task. A test-only task (choice questions only, no written question,
-- no voice message) is checked by the database; the mentor may write two texts with the questions:
--   pass_text — shown at once when every answer is right (the work is accepted, as before);
--   fail_text — shown at once when there is a mistake: the work goes back for revision automatically,
--               the participant takes the test again. Empty fail_text keeps the old way: the work waits for a mentor.
-- Both texts also stay in the conversation («Обратная связь») as the review, without a Telegram message.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.task_quizzes add column if not exists pass_text text not null default '' check (char_length(pass_text) <= 1000);
alter table public.task_quizzes add column if not exists fail_text text not null default '' check (char_length(fail_text) <= 1000);

-- Saving the questions together with the two texts. A text passed as null is left as it is; an empty text clears it.
-- An empty list of questions removes the test with its texts. No defaults on purpose: the three-argument version below
-- (an older page saving only the questions) stays a separate function, so a call is never ambiguous, also when
-- 20261023 is applied again after this file.
drop function if exists public.app_task_quiz_save(uuid, uuid, jsonb, text, text);
create function public.app_task_quiz_save(p_actor uuid, p_task uuid, p_questions jsonb, p_pass_text text, p_fail_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.app_task_video_can_manage(p_actor, p_task) then return jsonb_build_object('forbidden', true); end if;
  if char_length(btrim(coalesce(p_pass_text, ''))) > 1000 or char_length(btrim(coalesce(p_fail_text, ''))) > 1000 then
    return jsonb_build_object('validationError', 'Текст после теста — не длиннее 1000 символов.');
  end if;
  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    delete from public.task_quizzes where task_id = p_task;
  else
    insert into public.task_quizzes(task_id, questions, pass_text, fail_text, updated_by, updated_at)
      values (p_task, p_questions, btrim(coalesce(p_pass_text, '')), btrim(coalesce(p_fail_text, '')), p_actor, now())
    on conflict (task_id) do update set questions = excluded.questions,
      pass_text = case when p_pass_text is null then task_quizzes.pass_text else excluded.pass_text end,
      fail_text = case when p_fail_text is null then task_quizzes.fail_text else excluded.fail_text end,
      updated_by = excluded.updated_by, updated_at = now();
  end if;
  return jsonb_build_object('data', true);
end $$;

-- Only the questions: the texts stay as they are.
create or replace function public.app_task_quiz_save(p_actor uuid, p_task uuid, p_questions jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select public.app_task_quiz_save(p_actor, p_task, p_questions, null::text, null::text);
$$;

-- Sending: the rules of 20261116, plus the automatic return with the mentor's text.
-- `auto_accepted` now means «decided automatically»: accepted or returned without a mentor (a mentor's later review clears it).
create or replace function public.app_task_quiz_submit(p_user uuid, p_task uuid, p_answer_text text, p_score integer, p_total integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare problem text; saved public.submissions%rowtype; last public.submissions%rowtype; task public.tasks%rowtype; quiz public.task_quizzes%rowtype;
  test_only boolean; auto boolean; returned boolean; message text; stamp timestamptz := now(); thread uuid; event_seq bigint;
begin
  -- Two taps on "Отправить" create one submission.
  perform pg_advisory_xact_lock(hashtext('task-quiz:' || p_user::text || ':' || p_task::text));
  select * into quiz from public.task_quizzes q where q.task_id = p_task;
  if quiz.questions is null then
    return jsonb_build_object('validationError', 'У задания нет вопросов на сайте.');
  end if;
  problem := public.tg_target_error(p_user, p_task);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  if exists (select 1 from public.task_videos where task_id = p_task and video_path is not null)
    and not exists (select 1 from public.task_video_views where user_id = p_user and task_id = p_task and completed_at is not null) then
    return jsonb_build_object('validationError', 'Сначала досмотрите видео до конца.');
  end if;
  if char_length(btrim(coalesce(p_answer_text, ''))) = 0 or char_length(p_answer_text) > 100000 then
    return jsonb_build_object('validationError', 'Ответы не заполнены.');
  end if;
  select * into task from public.tasks where id = p_task;
  -- Only a test: choice questions only, no voice to listen to, not a game.
  test_only := not coalesce(task.voice_answer, false) and task.interactive_kind is null and jsonb_array_length(quiz.questions) > 0
    and not exists (select 1 from jsonb_array_elements(quiz.questions) question where coalesce(question->>'kind', '') not in ('single', 'multiple'));
  -- Every answer right: the server's own count must agree too; if anything disagrees, the work is not accepted at once.
  auto := test_only and p_total is not null and p_total > 0 and p_score = p_total and p_total = jsonb_array_length(quiz.questions)
    and public.app_task_quiz_all_right(quiz.questions, p_answers);
  -- A mistake with the mentor's text written: back for revision at once, the participant takes the test again.
  returned := test_only and not auto and btrim(quiz.fail_text) <> '';
  message := case when auto then coalesce(nullif(btrim(quiz.pass_text), ''), 'Тест пройден без ошибок — засчитано автоматически.')
    when returned then btrim(quiz.fail_text) end;
  if returned then
    -- The same wrong answers sent again (a double tap, a retry without changes) give the same return, not a second one.
    select * into last from public.submissions where user_id = p_user and task_id = p_task order by submitted_at desc, created_at desc limit 1;
    if last.id is not null and last.status = 'revision' and last.auto_accepted and last.quiz_answers = p_answers then
      return jsonb_build_object('data', to_jsonb(last), 'message', message, 'returned', true);
    end if;
  end if;
  insert into public.submissions(user_id, task_id, status, submission_source, media_type, answer_text, quiz_score, quiz_total, quiz_answers,
      points, reviewed_at, auto_accepted, comment)
    values (p_user, p_task, case when auto then 'accepted' when returned then 'revision' else 'pending' end::public.submission_status, 'site', 'text', p_answer_text,
      p_score, p_total, p_answers, case when auto then task.max_points else 0 end, case when auto or returned then stamp end, auto or returned,
      case when returned or (auto and btrim(quiz.pass_text) <> '') then message else '' end)
    returning * into saved;
  delete from public.task_quiz_drafts where user_id = p_user and task_id = p_task;
  if auto or returned then
    -- A program step opens the next one at once; a returned step stays the current one.
    if auto and task.program_id is not null then perform public.app_program_advance(p_user, p_task, stamp); end if;
    -- The conversation keeps the decision with the mentor's text; the participant already sees it on the screen,
    -- so no Telegram message and nothing unread.
    select id into thread from public.feedback_threads where member_user_id = p_user and task_id = p_task;
    if thread is not null then
      insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, body, review_status, points, review_version, created_at)
        values (thread, saved.id, 'review', null, 'Автопроверка', message, saved.status::text, saved.points, saved.review_version, clock_timestamp())
        returning seq into event_seq;
      update public.telegram_notification_jobs set cancelled_at = now(), locked_until = null
        where feedback_event_seq = event_seq and delivered_at is null;
      insert into public.feedback_reads(thread_id, user_id, last_seen_seq) values (thread, p_user, event_seq)
        on conflict (thread_id, user_id) do update set last_seen_seq = greatest(feedback_reads.last_seen_seq, excluded.last_seen_seq);
    end if;
  end if;
  return jsonb_build_object('data', to_jsonb(saved), 'message', message, 'returned', returned);
end $$;

revoke all on function public.app_task_quiz_save(uuid, uuid, jsonb, text, text), public.app_task_quiz_save(uuid, uuid, jsonb),
  public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_task_quiz_save(uuid, uuid, jsonb, text, text), public.app_task_quiz_save(uuid, uuid, jsonb),
  public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
