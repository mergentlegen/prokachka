-- Survey answers, per-answer rewards and a durable Telegram job per ancestor.
begin;

alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check check (template_key is null or template_key in ('dream-plan','starter-rules','heart-survey'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey'));
alter table public.submissions add column if not exists interactive_completed boolean not null default true;
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check check (kind in ('permissions','submission','survey'));

create or replace function public.app_program_interactive_valid(p_kind text)
returns boolean language sql immutable security definer set search_path=public as $$
  select p_kind = 'heart-survey' or public.app_ready_program_spec(p_kind) is not null;
$$;
-- Preserve all existing program creation logic while extending its registry.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.app_create_program(jsonb)'::regprocedure);
  if position('public.app_ready_program_spec(interactive) is null' in definition) > 0 then
    execute replace(definition, 'public.app_ready_program_spec(interactive) is null', 'not public.app_program_interactive_valid(interactive)');
  elsif position('public.app_program_interactive_valid(interactive)' in definition) = 0 then
    raise exception 'Apply 20260927-starter-rules.sql before the heart survey migration';
  end if;
end $$;

create or replace function public.tg_can_receive_survey(p_recipient uuid, p_submission uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.submissions s join public.users participant on participant.id=s.user_id
      join public.tasks task on task.id=s.task_id join public.users recipient on recipient.id=p_recipient
      join public.teams team on team.id=task.team_id
    where s.id=p_submission and s.status='accepted' and s.submission_source='interactive' and s.interactive_completed
      and task.interactive_kind='heart-survey' and team.is_active
      and recipient.id<>participant.id and recipient.team_id=participant.team_id and recipient.team_id=task.team_id
      and (recipient.role='admin' or (recipient.role='member' and recipient.can_review))
      and recipient.id in (select a.id from public.tg_ancestor_ids(participant.id) a)
  );
$$;

-- Existing completed games remain immutable. Only the survey RPC's next saved
-- answer can grow its matching reward, exactly one mile at a time.
create or replace function public.app_guard_interactive_submission_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.submission_source='interactive' and (
    new.user_id is distinct from old.user_id or new.task_id is distinct from old.task_id
    or new.status is distinct from old.status or new.points is distinct from old.points
    or new.submission_source is distinct from old.submission_source
    or new.interactive_completed is distinct from old.interactive_completed
  ) then
    if old.status='accepted' and not old.interactive_completed
      and new.user_id=old.user_id and new.task_id=old.task_id and new.status=old.status
      and new.submission_source=old.submission_source and new.points=old.points+1
      and exists (
        select 1 from public.ready_program_attempts a join public.tasks t on t.id=a.task_id
        where a.user_id=old.user_id and a.task_id=old.task_id and t.interactive_kind='heart-survey'
          and a.earned_points=new.points and (a.status='completed')=new.interactive_completed
          and jsonb_array_length(a.state->'answers')=new.points
      ) then return new; end if;
    raise exception 'Interactive submissions are immutable';
  end if;
  return new;
end $$;

create or replace function public.app_heart_survey(
  p_user_id uuid, p_task_id uuid, p_action text, p_answer integer, p_question_index integer, p_definition jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  account public.users%rowtype; task public.tasks%rowtype; attempt public.ready_program_attempts%rowtype;
  saved public.submissions%rowtype; definition jsonb; answers jsonb; question jsonb;
  current_question integer; summary text; i integer; total_jobs integer; sent_jobs integer; waiting_jobs integer;
begin
  select * into account from public.users where id=p_user_id for update;
  select * into task from public.tasks where id=p_task_id;
  if account.id is null or account.role<>'member' or account.team_id is null
    or task.id is null or not task.is_active or task.interactive_kind is distinct from 'heart-survey'
    or task.publication_type<>'evergreen' or task.deadline_at is not null or task.max_points<>5
    or task.team_id is distinct from account.team_id
    or not exists (select 1 from public.teams where id=account.team_id and is_active)
    or (task.audience_root_id is not null and task.audience_root_id not in (select a.id from public.tg_ancestor_ids(account.id) a))
    or not exists (select 1 from public.task_programs p where p.id=task.program_id and p.is_active
      and p.team_id=account.team_id and p.template_key='heart-survey'
      and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(account.id) a))) then
    return jsonb_build_object('validationError','Опросник недоступен для вашей команды или ветки.');
  end if;
  if p_action is null or p_action not in ('start','answer') then return jsonb_build_object('validationError','Неизвестное действие опросника.'); end if;
  select * into attempt from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not found then
    if p_action<>'start' then return jsonb_build_object('validationError','Сначала откройте опросник.'); end if;
    if jsonb_typeof(p_definition->'questions') is distinct from 'array' or jsonb_array_length(p_definition->'questions')<>5
      or jsonb_typeof(p_definition->'finals') is distinct from 'array' or jsonb_array_length(p_definition->'finals')<>5 then
      return jsonb_build_object('validationError','Опросник настроен неверно.');
    end if;
    for question in select value from jsonb_array_elements(p_definition->'questions') loop
      if jsonb_typeof(question->'options') is distinct from 'array' or jsonb_array_length(question->'options')<>5 then
        return jsonb_build_object('validationError','Опросник настроен неверно.');
      end if;
    end loop;
    insert into public.ready_program_attempts(user_id,task_id,current_step,state)
      values(p_user_id,p_task_id,1,jsonb_build_object('definition',p_definition,'answers','[]'::jsonb,'questionIndex',0)) returning * into attempt;
  end if;
  definition:=attempt.state->'definition'; answers:=attempt.state->'answers'; current_question:=jsonb_array_length(answers);
  select * into saved from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted';
  if p_action='answer' then
    if p_answer is null or p_answer not between 0 and 4 or p_question_index is null or p_question_index not between 0 and 4 then
      return jsonb_build_object('validationError','Некорректный ответ опросника.');
    end if;
    if p_question_index<current_question then
      if (answers->>p_question_index)::int is distinct from p_answer then
        return jsonb_build_object('validationError','Этот ответ уже сохранён. Откройте опросник снова, чтобы продолжить.');
      end if;
      -- An identical retry returns current progress and never grants another mile.
    elsif p_question_index<>current_question or attempt.status='completed' then
      return jsonb_build_object('validationError','Сначала ответьте на текущий вопрос.');
    else
      answers:=answers || jsonb_build_array(p_answer); current_question:=current_question+1;
      update public.ready_program_attempts set earned_points=current_question,
        state=jsonb_build_object('definition',definition,'answers',answers,'questionIndex',current_question),
        status=case when current_question=5 then 'completed' else 'active' end,
        completed_at=case when current_question=5 then now() else null end
        where id=attempt.id returning * into attempt;
      summary:='📋 Опросник «'||(definition->>'title')||'»'||E'\nУчастник: '||account.name||E'\nНачислено: '||current_question||E' миль\n';
      for i in 0..current_question-1 loop
        summary:=summary||E'\n'||(i+1)||'. '||(definition->'questions'->i->>'title')||E'\nОтвет: '||
          (definition->'questions'->i->'options'->((answers->>i)::int)->>'text')||E'\n';
      end loop;
      if current_question=5 then summary:=summary||E'\nМоя причина: '||(definition->'finals'->p_answer->>'title'); end if;
      if saved.id is null then
        insert into public.submissions(user_id,task_id,status,submission_source,media_type,answer_text,points,interactive_completed,comment,reviewed_at)
          values(p_user_id,p_task_id,'accepted','interactive','text',summary,current_question,false,'Опросник: 1 из 5 ответов. Миля начислена автоматически.',now()) returning * into saved;
      else
        update public.submissions set points=current_question, answer_text=summary, interactive_completed=current_question=5,
          comment=case when current_question=5 then 'Опросник завершён. 5 миль начислены автоматически.' else 'Опросник: '||current_question||' из 5 ответов. Мили начислены автоматически.' end,
          reviewed_at=now() where id=saved.id returning * into saved;
      end if;
      if current_question=5 then
        insert into public.telegram_notification_jobs(recipient_id,submission_id,kind)
          select u.id,saved.id,'survey' from public.users u where public.tg_can_receive_survey(u.id,saved.id)
          on conflict(recipient_id,submission_id) do nothing;
      end if;
    end if;
  end if;
  select count(*),count(*) filter(where j.delivered_at is not null),
    count(*) filter(where j.delivered_at is null and j.cancelled_at is null and u.telegram_id is null)
    into total_jobs,sent_jobs,waiting_jobs from public.telegram_notification_jobs j join public.users u on u.id=j.recipient_id
    where j.submission_id=saved.id and j.kind='survey' and public.tg_can_receive_survey(u.id,saved.id);
  return jsonb_build_object('questionIndex',current_question,'earnedPoints',attempt.earned_points,'answers',answers,
    'completed',attempt.status='completed','definition',definition,'submission',case when saved.id is not null then to_jsonb(saved) else null end,
    'delivery',jsonb_build_object('total',total_jobs,'sent',sent_jobs,'waiting',waiting_jobs));
end $$;

revoke all on function public.app_program_interactive_valid(text) from public,anon,authenticated;
revoke all on function public.tg_can_receive_survey(uuid,uuid) from public,anon,authenticated;
revoke all on function public.app_heart_survey(uuid,uuid,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.tg_can_receive_survey(uuid,uuid) to service_role;
grant execute on function public.app_heart_survey(uuid,uuid,text,integer,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
