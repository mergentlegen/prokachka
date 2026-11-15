-- A test answered without a single mistake is accepted at once, without a mentor.
-- It applies to every task and program step on every level whose answer is only the test:
-- choice questions only, no written question, no voice message. With a mistake the work waits for a mentor as before.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- 1. The mark the mentor sees: «засчитано автоматически». Any later review by a person takes it off.
alter table public.submissions add column if not exists auto_accepted boolean not null default false;

create or replace function public.app_submission_auto_mark()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.review_version is distinct from old.review_version then new.auto_accepted := false; end if;
  return new;
end $$;
drop trigger if exists submissions_auto_mark on public.submissions;
create trigger submissions_auto_mark before update of review_version on public.submissions
  for each row when (old.auto_accepted) execute function public.app_submission_auto_mark();

-- 2. Whether every answer is right, checked against the stored correct choices (the order of choices does not matter).
-- False when the task has a written question: a person has to read it.
create or replace function public.app_task_quiz_all_right(p_questions jsonb, p_answers jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_questions) = 'array' and jsonb_array_length(p_questions) > 0
    and jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_array_elements(p_questions) question
      where coalesce(question->>'kind', '') not in ('single', 'multiple')
        or jsonb_typeof(question->'correct') is distinct from 'array'
        or jsonb_array_length(question->'correct') = 0
        or jsonb_typeof(p_answers->(question->>'id')->'choice') is distinct from 'array'
        or (select coalesce(array_agg(distinct value order by value), '{}') from jsonb_array_elements_text(p_answers->(question->>'id')->'choice') value)
          is distinct from (select coalesce(array_agg(distinct value order by value), '{}') from jsonb_array_elements_text(question->'correct') value)
    );
$$;

-- 3. Sending: the same rules as before; a test without mistakes is saved as accepted with the task's full miles.
create or replace function public.app_task_quiz_submit(p_user uuid, p_task uuid, p_answer_text text, p_score integer, p_total integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare problem text; saved public.submissions%rowtype; task public.tasks%rowtype; questions jsonb; auto boolean;
  stamp timestamptz := now(); thread uuid; event_seq bigint;
begin
  -- Two taps on "Отправить" create one submission.
  perform pg_advisory_xact_lock(hashtext('task-quiz:' || p_user::text || ':' || p_task::text));
  select q.questions into questions from public.task_quizzes q where q.task_id = p_task;
  if questions is null then
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
  -- Only a test, every answer right, no voice to listen to: there is nothing left for a mentor to check.
  -- The server's own count must agree too; if anything disagrees, a mentor decides.
  auto := not coalesce(task.voice_answer, false) and task.interactive_kind is null
    and p_total is not null and p_total > 0 and p_score = p_total and p_total = jsonb_array_length(questions)
    and public.app_task_quiz_all_right(questions, p_answers);
  insert into public.submissions(user_id, task_id, status, submission_source, media_type, answer_text, quiz_score, quiz_total, quiz_answers,
      points, reviewed_at, auto_accepted)
    values (p_user, p_task, case when auto then 'accepted' else 'pending' end::public.submission_status, 'site', 'text', p_answer_text,
      p_score, p_total, p_answers, case when auto then task.max_points else 0 end, case when auto then stamp end, auto)
    returning * into saved;
  delete from public.task_quiz_drafts where user_id = p_user and task_id = p_task;
  if auto then
    -- A program step opens the next one at once.
    if task.program_id is not null then perform public.app_program_advance(p_user, p_task, stamp); end if;
    -- The conversation shows the decision; the participant already sees it on the screen, so no Telegram message and nothing unread.
    select id into thread from public.feedback_threads where member_user_id = p_user and task_id = p_task;
    if thread is not null then
      insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, body, review_status, points, review_version, created_at)
        values (thread, saved.id, 'review', null, 'Автопроверка', 'Тест пройден без ошибок — засчитано автоматически.', 'accepted',
          saved.points, saved.review_version, clock_timestamp())
        returning seq into event_seq;
      update public.telegram_notification_jobs set cancelled_at = now(), locked_until = null
        where feedback_event_seq = event_seq and delivered_at is null;
      insert into public.feedback_reads(thread_id, user_id, last_seen_seq) values (thread, p_user, event_seq)
        on conflict (thread_id, user_id) do update set last_seen_seq = greatest(feedback_reads.last_seen_seq, excluded.last_seen_seq);
    end if;
  end if;
  return jsonb_build_object('data', to_jsonb(saved));
end $$;

revoke all on function public.app_submission_auto_mark(), public.app_task_quiz_all_right(jsonb, jsonb),
  public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
