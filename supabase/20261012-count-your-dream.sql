-- Sixth ready game. Apply once after 20261011-feedback-scopes.sql.
begin;

alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check
  check (template_key is null or template_key in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream'));

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":10,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    else null end;
$$;

create or replace function public.app_count_dream_valid(p_answers jsonb)
returns boolean language plpgsql immutable security definer set search_path=public as $$
declare item jsonb; total numeric:=0; monthly numeric; extra numeric:=0; choice text;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' or length(p_answers::text)>8000
    or coalesce(p_answers->>'currency','') not in ('₸','$')
    or jsonb_typeof(p_answers->'items') is distinct from 'array'
    or jsonb_array_length(p_answers->'items') not between 1 and 3 then return false; end if;
  for item in select value from jsonb_array_elements(p_answers->'items') loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'n') is distinct from 'string'
      or length(btrim(item->>'n')) not between 1 and 120 or (item->>'n') ~ '[[:cntrl:]]'
      or jsonb_typeof(item->'p') is distinct from 'number' or (item->>'p') !~ '^[0-9]+(\.[0-9]{1,2})?$' then return false; end if;
    if (item->>'p')::numeric not between 1 and 1000000000000 then return false; end if;
    total:=total+(item->>'p')::numeric;
  end loop;
  if coalesce(p_answers->>'howlong','') not in ('Меньше года','1–3 года','Больше 3 лет')
    or coalesce(p_answers->>'plan','') not in ('Да','Нет')
    or jsonb_typeof(p_answers->'confidence') is distinct from 'number'
    or (p_answers->>'confidence') !~ '^(10|[1-9])$'
    or jsonb_typeof(p_answers->'save') is distinct from 'number'
    or (p_answers->>'save') !~ '^[0-9]+(\.[0-9]{1,2})?$' then return false; end if;
  monthly:=(p_answers->>'save')::numeric;
  if monthly>1000000000000 then return false; end if;
  choice:=p_answers->>'caseChoice';
  if monthly>0 and total/monthly/12<=5 then
    if coalesce(choice,'') not in ('fast','big') or (total/monthly/12<1 and choice<>'big') then return false; end if;
    if choice='big' then
      if jsonb_typeof(p_answers->'extraN') is distinct from 'string'
        or length(btrim(p_answers->>'extraN')) not between 1 and 120 or (p_answers->>'extraN') ~ '[[:cntrl:]]'
        or jsonb_typeof(p_answers->'extraP') is distinct from 'number'
        or (p_answers->>'extraP') !~ '^[0-9]+(\.[0-9]{1,2})?$' then return false; end if;
      extra:=(p_answers->>'extraP')::numeric;
      if extra not between 1 and 1000000000000 then return false; end if;
    end if;
  end if;
  return jsonb_typeof(p_answers->'why')='string' and length(btrim(p_answers->>'why')) between 5 and 1000
    and p_answers->>'value' in ('Свобода','Семья','Путешествия','Признание','Рост','Безопасность')
    and p_answers->>'time' in ('3–5 часов','5–10 часов','10 часов и больше','Пока не знаю')
    and p_answers->>'feel' in ('Вдохновение','Немного грустно','Страшно от цифр','Не верю, что это возможно')
    and p_answers->'pledged'='true'::jsonb;
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end $$;

create or replace function public.app_count_your_dream(p_user_id uuid,p_task_id uuid,p_action text,p_step integer,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  select * into task from public.tasks where id=p_task_id;
  if task.interactive_kind is distinct from 'count-your-dream' then return jsonb_build_object('validationError','Тренажёр недоступен для этого задания.'); end if;
  if p_action not in ('start','save','complete') or p_action is null then return jsonb_build_object('validationError','Некорректное действие.'); end if;
  perform 1 from public.users where id=p_user_id for update;
  insert into public.ready_program_attempts(user_id,task_id) values(p_user_id,p_task_id) on conflict(user_id,task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if a.status='completed' then
    select * into saved from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted' order by created_at desc limit 1;
    return jsonb_build_object('step',13,'answers',coalesce(a.state->'dreamAnswers','{}'::jsonb),'completed',true,'earnedPoints',10,'submission',to_jsonb(saved));
  end if;
  if p_action='save' then
    if p_step is null or p_step not between 0 and 12 or p_step>a.current_step+1
      or jsonb_typeof(p_answers) is distinct from 'object' or length(p_answers::text)>8000 then
      return jsonb_build_object('validationError','Некорректный шаг или ответы.'); end if;
    update public.ready_program_attempts set current_step=p_step,state=jsonb_build_object('dreamAnswers',p_answers)
      where id=a.id returning * into a;
  elsif p_action='complete' then
    if a.current_step<>12 or public.app_count_dream_valid(a.state->'dreamAnswers') is distinct from true then
      return jsonb_build_object('validationError','Завершите все шаги тренажёра и заполните ответы.'); end if;
    insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source)
      values(p_user_id,p_task_id,'accepted','text','Тренажёр «Посчитай свою мечту» завершён.',10,
        '10 миль за прохождение. Голосовое наставнику — следующий практический шаг.',now(),'interactive') returning * into saved;
    update public.ready_program_attempts set status='completed',completed_at=now(),earned_points=10 where id=a.id returning * into a;
    return jsonb_build_object('step',13,'answers',a.state->'dreamAnswers','completed',true,'earnedPoints',10,'submission',to_jsonb(saved));
  end if;
  return jsonb_build_object('step',a.current_step,'answers',coalesce(a.state->'dreamAnswers','{}'::jsonb),'completed',false,'earnedPoints',0);
end $$;

-- Reuse the established private voice relay. It stores only Telegram file identifiers,
-- sends to reviewers on the participant's ancestor chain and never awards twice.
create or replace function public.tg_company_voice_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare problem text;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return problem; end if;
  if (select interactive_kind from public.tasks where id=p_task_id) not in ('company-voyage','count-your-dream') then return 'Голосовое недоступно для этого задания.'; end if;
  if not exists(select 1 from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id and status='completed')
    or not exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted') then return 'Сначала завершите задание на сайте.'; end if;
  if exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and company_voice_file_id is not null) then return 'Голосовое уже сохранено для доставки наставникам.'; end if;
  if not exists(select 1 from public.users mentor where mentor.id<>p_user_id and (mentor.role='admin' or (mentor.role='member' and mentor.can_review))
    and mentor.id in (select a.id from public.tg_ancestor_ids(p_user_id) a)) then return 'В вашей ветке пока нет наставника для получения голосового.'; end if;
  return null;
end $$;
create or replace function public.tg_can_receive_company_voice(p_recipient uuid,p_submission uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.submissions s join public.users member on member.id=s.user_id
    join public.users recipient on recipient.id=p_recipient join public.tasks task on task.id=s.task_id
    where s.id=p_submission and s.submission_source='interactive' and s.status='accepted' and s.company_voice_file_id is not null
      and task.interactive_kind in ('company-voyage','count-your-dream') and public.app_ready_task_error(member.id,task.id) is null
      and recipient.id<>member.id and recipient.team_id=member.team_id
      and (recipient.role='admin' or (recipient.role='member' and recipient.can_review))
      and recipient.id in (select a.id from public.tg_ancestor_ids(member.id) a));
$$;

revoke all on function public.app_ready_program_spec(text),public.app_count_dream_valid(jsonb),public.app_count_your_dream(uuid,uuid,text,integer,jsonb),public.tg_company_voice_error(uuid,uuid),public.tg_can_receive_company_voice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_count_your_dream(uuid,uuid,text,integer,jsonb),public.tg_company_voice_error(uuid,uuid),public.tg_can_receive_company_voice(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
