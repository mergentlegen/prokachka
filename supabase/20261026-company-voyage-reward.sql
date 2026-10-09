-- «Корабль, на который ты поднялся» now gives 2 miles instead of 10.
-- Everyone who already finished it keeps the result, but their record is recounted to 2 miles (8 miles less in the rating).
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":2,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    else null end;
$$;
revoke all on function public.app_ready_program_spec(text) from public, anon, authenticated;

-- Every published copy of the game, in every team and branch.
update public.tasks set max_points = 2,
  description = replace(description, 'получи 10 миль автоматически', 'получи 2 мили автоматически')
  where interactive_kind = 'company-voyage' and (max_points <> 2 or description like '%получи 10 миль%');

-- Finished games: the attempt and the accepted record go from 10 to 2 miles.
-- Accepted game records are protected from edits; the guard is switched off only for this one correction.
create temporary table company_voyage_recount on commit drop as
  select s.id, s.user_id from public.submissions s join public.tasks t on t.id = s.task_id
  where t.interactive_kind = 'company-voyage' and s.submission_source = 'interactive' and s.status = 'accepted' and s.points = 10;

alter table public.submissions disable trigger submissions_interactive_immutable;
update public.submissions s set points = 2 from company_voyage_recount r where s.id = r.id;
alter table public.submissions enable trigger submissions_interactive_immutable;

update public.ready_program_attempts a set earned_points = 2
  from public.tasks t where t.id = a.task_id and t.interactive_kind = 'company-voyage' and a.status = 'completed' and a.earned_points = 10;

-- One line in the CEO journal: what changed and for how many participants.
insert into public.audit_log(actor_name, actor_role, action, target_label, details)
  select 'Обновление сайта', 'ceo', 'task.reward', 'Корабль, на который ты поднялся',
    jsonb_build_object('reward', jsonb_build_array(10, 2), 'recounted', (select count(distinct user_id) from company_voyage_recount))
  where exists (select 1 from company_voyage_recount);

notify pgrst, 'reload schema';
commit;
