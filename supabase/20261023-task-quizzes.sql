-- Questions answered on the site: a mentor adds tests and open questions to a task, the participant answers
-- after watching the task video, and the answers become a normal submission for review.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- 1. Answers sent from the site are a new kind of submission; the test result is stored next to the text.
alter table public.submissions drop constraint if exists submissions_submission_source_check;
alter table public.submissions drop constraint if exists submissions_source_check;
alter table public.submissions add constraint submissions_source_check
  check (submission_source in ('telegram', 'interactive', 'mentor', 'site'));
alter table public.submissions add column if not exists quiz_score integer check (quiz_score >= 0);
alter table public.submissions add column if not exists quiz_total integer check (quiz_total >= 0);
alter table public.submissions add column if not exists quiz_answers jsonb check (quiz_answers is null or jsonb_typeof(quiz_answers) = 'object');

-- 2. The questions of a task, with the correct choices. Only the server reads them; participants get a copy without answers.
create table if not exists public.task_quizzes (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 30 and pg_column_size(questions) <= 200000),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 3. Unsent answers, saved while the participant types, so closing the page loses nothing.
create table if not exists public.task_quiz_drafts (
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 100000),
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.task_quizzes enable row level security;
alter table public.task_quiz_drafts enable row level security;
revoke all on public.task_quizzes, public.task_quiz_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.task_quizzes, public.task_quiz_drafts to service_role;

-- Participants' pages refresh when the questions of a task change.
create or replace function public.broadcast_task_quiz_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare changed_task uuid; changed_team uuid;
begin
  changed_task := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  select team_id into changed_team from public.tasks where id = changed_task;
  if changed_team is not null then
    perform realtime.send(jsonb_build_object('topics', array['tasks'], 'teamIds', array[changed_team::text], 'userIds', array[]::text[]),
      'changed', 'prokachka:changes', true);
  end if;
  return null;
end $$;
drop trigger if exists task_quiz_broadcast on public.task_quizzes;
create trigger task_quiz_broadcast after insert or update or delete on public.task_quizzes
  for each row execute function public.broadcast_task_quiz_change();

-- Saving replaces the whole list; an empty list turns the task back into a Telegram answer.
-- The server validates the questions; the database checks who may change them.
create or replace function public.app_task_quiz_save(p_actor uuid, p_task uuid, p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.app_task_video_can_manage(p_actor, p_task) then return jsonb_build_object('forbidden', true); end if;
  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    delete from public.task_quizzes where task_id = p_task;
  else
    insert into public.task_quizzes(task_id, questions, updated_by, updated_at) values (p_task, p_questions, p_actor, now())
    on conflict (task_id) do update set questions = excluded.questions, updated_by = excluded.updated_by, updated_at = now();
  end if;
  return jsonb_build_object('data', true);
end $$;

-- Sending: the same rules as a Telegram answer (task open, nothing waiting or accepted), plus the video watched to the end.
create or replace function public.app_task_quiz_submit(p_user uuid, p_task uuid, p_answer_text text, p_score integer, p_total integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare problem text; saved public.submissions%rowtype;
begin
  -- Two taps on "Отправить" create one submission.
  perform pg_advisory_xact_lock(hashtext('task-quiz:' || p_user::text || ':' || p_task::text));
  if not exists (select 1 from public.task_quizzes where task_id = p_task) then
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
  insert into public.submissions(user_id, task_id, status, submission_source, media_type, answer_text, quiz_score, quiz_total, quiz_answers)
    values (p_user, p_task, 'pending', 'site', 'text', p_answer_text, p_score, p_total, p_answers)
    returning * into saved;
  delete from public.task_quiz_drafts where user_id = p_user and task_id = p_task;
  return jsonb_build_object('data', to_jsonb(saved));
end $$;

revoke all on function public.broadcast_task_quiz_change(), public.app_task_quiz_save(uuid, uuid, jsonb),
  public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_task_quiz_save(uuid, uuid, jsonb),
  public.app_task_quiz_submit(uuid, uuid, text, integer, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
