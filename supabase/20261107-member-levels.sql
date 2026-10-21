-- Levels. 300 on «Звёздный курс» (100 miles + 10 stars) moves a participant up a level: 1 → 2 (Капитан) → 3.
-- Every level has its own tasks and programs, its own miles (from tasks of that level) and its own stars
-- (awarded after reaching it), and its own rating. A lower level stays readable as an archive, but nothing can be sent there.
-- A team admin can move a participant up or back by hand; an automatic promotion never overrides a mentor's «вернуть».
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.tasks add column if not exists level smallint not null default 1;
alter table public.task_programs add column if not exists level smallint not null default 1;
alter table public.tasks drop constraint if exists tasks_level_check;
alter table public.tasks add constraint tasks_level_check check (level between 1 and 3);
alter table public.task_programs drop constraint if exists task_programs_level_check;
alter table public.task_programs add constraint task_programs_level_check check (level between 1 and 3);
create index if not exists tasks_team_level_idx on public.tasks(team_id, level);

-- Level 1 has no row: it starts when the participant joins the team.
create table if not exists public.member_levels (
  user_id uuid not null references public.users(id) on delete cascade,
  level smallint not null check (level between 2 and 3),
  reached_at timestamptz not null default now(),
  granted_by uuid references public.users(id) on delete set null,
  revoked_at timestamptz,
  celebrated_at timestamptz,
  primary key (user_id, level)
);
alter table public.member_levels enable row level security;
revoke all on public.member_levels from public, anon, authenticated;
grant select, insert, update, delete on public.member_levels to service_role;

alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder',
    'task-nudge','announcement','start-reminder','miles-recount','review','level-up'));

-- Program steps always belong to their program's level.
create or replace function public.app_task_program_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.program_id is not null then
    new.level := coalesce((select p.level from public.task_programs p where p.id = new.program_id), new.level);
  end if;
  return new;
end $$;
drop trigger if exists tasks_program_level on public.tasks;
create trigger tasks_program_level before insert or update of program_id, level on public.tasks
  for each row execute function public.app_task_program_level();

create or replace function public.app_program_level_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set level = new.level where program_id = new.id and level <> new.level;
  return null;
end $$;
drop trigger if exists task_programs_level on public.task_programs;
create trigger task_programs_level after update of level on public.task_programs
  for each row when (old.level is distinct from new.level) execute function public.app_program_level_follow();

create or replace function public.app_member_level(p_user uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select coalesce((select max(l.level) from public.member_levels l where l.user_id = p_user and l.revoked_at is null), 1)::smallint;
$$;

-- Miles of a level: accepted works on that level's tasks, plus 1 mile per review written while on it.
-- Stars of a level: everything awarded while on it (level 1: before level 2).
create or replace function public.app_level_totals(p_user uuid, p_level smallint)
returns table(miles bigint, stars bigint) language sql stable security definer set search_path = public as $$
  with bounds as (
    select case when p_level = 1 then '-infinity'::timestamptz
        else (select l.reached_at from public.member_levels l where l.user_id = p_user and l.level = p_level and l.revoked_at is null) end as starts,
      coalesce((select min(l.reached_at) from public.member_levels l where l.user_id = p_user and l.level > p_level and l.revoked_at is null),
        'infinity'::timestamptz) as ends
  )
  select
    (coalesce((select sum(s.points) from public.submissions s left join public.tasks t on t.id = s.task_id
       where s.user_id = p_user and s.status = 'accepted' and coalesce(t.level, 1) = p_level), 0)
     + (select count(*) from public.reviews r, bounds b where r.user_id = p_user and r.created_at >= b.starts and r.created_at < b.ends))::bigint,
    coalesce((select sum(a.stars) from public.star_awards a, bounds b
       where a.user_id = p_user and a.created_at >= b.starts and a.created_at < b.ends), 0)::bigint;
$$;

-- The rating of a team: each participant with their current level and that level's miles and stars.
create or replace function public.app_course_standings(p_team_id uuid)
returns table(id uuid, name text, avatar_path text, level smallint, level_at timestamptz, miles bigint, stars bigint)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.avatar_path, cl.level, coalesce(ml.reached_at, u.team_joined_at, u.created_at), tot.miles, tot.stars
  from public.users u
  cross join lateral (select public.app_member_level(u.id) as level) cl
  left join public.member_levels ml on ml.user_id = u.id and ml.level = cl.level and ml.revoked_at is null
  cross join lateral public.app_level_totals(u.id, cl.level) tot
  where u.role = 'member' and u.team_id = p_team_id;
$$;

-- Telegram: the participant, and their mentor (the direct leader, or the team admins without one).
create or replace function public.app_level_notify(p_user uuid, p_level smallint, p_by uuid, p_delay interval default '0 seconds')
returns void language plpgsql security definer set search_path = public as $$
declare member public.users%rowtype;
begin
  select * into member from public.users where id = p_user;
  if member.id is null then return; end if;
  insert into public.telegram_notification_jobs(recipient_id, kind, payload, available_at)
    values(p_user, 'level-up', jsonb_build_object('level', p_level), now() + p_delay);
  insert into public.telegram_notification_jobs(recipient_id, kind, payload, available_at)
    select m.id, 'level-up', jsonb_build_object('level', p_level, 'memberId', p_user), now() + p_delay
    from public.users m
    where m.team_id = member.team_id and m.id <> p_user and m.id is distinct from p_by
      and (m.id = member.parent_user_id or (member.parent_user_id is null and m.role = 'admin'));
end $$;

-- Called after every change that can add miles or stars. Returns the participant's level.
create or replace function public.app_check_member_level(p_user uuid, p_delay interval default '0 seconds')
returns smallint language plpgsql security definer set search_path = public as $$
declare current_level smallint; totals record; member public.users%rowtype;
begin
  select * into member from public.users where id = p_user;
  if member.id is null or member.role <> 'member' then return null; end if;
  current_level := public.app_member_level(p_user);
  if current_level >= 3 then return current_level; end if;
  select * into totals from public.app_level_totals(p_user, current_level);
  if least(totals.miles, 100) + least(totals.stars, 10) * 20 < 300 then return current_level; end if;
  -- A row for the next level that exists here was revoked by a mentor: that decision stays.
  if exists(select 1 from public.member_levels where user_id = p_user and level = current_level + 1) then return current_level; end if;
  -- The real clock, not the transaction start: the star or work that made 300 still belongs to the level it was earned on.
  insert into public.member_levels(user_id, level, reached_at) values(p_user, current_level + 1, clock_timestamp()) on conflict do nothing;
  if found then perform public.app_level_notify(p_user, (current_level + 1)::smallint, null, p_delay); end if;
  return public.app_member_level(p_user);
end $$;

create or replace function public.app_level_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A work counts only once accepted (the status is read only for works: stars and reviews have none).
  if tg_table_name = 'submissions' then
    if to_jsonb(new)->>'status' <> 'accepted' then return null; end if;
  end if;
  perform public.app_check_member_level(new.user_id);
  return null;
end $$;
drop trigger if exists submissions_level_check on public.submissions;
create trigger submissions_level_check after insert or update of status, points on public.submissions
  for each row execute function public.app_level_after_change();
drop trigger if exists star_awards_level_check on public.star_awards;
create trigger star_awards_level_check after insert on public.star_awards
  for each row execute function public.app_level_after_change();
drop trigger if exists reviews_level_check on public.reviews;
create trigger reviews_level_check after insert on public.reviews
  for each row execute function public.app_level_after_change();

-- A lower level is an archive: a participant sends work only on tasks of their current level.
-- A mentor may still record a completion on any level.
create or replace function public.app_submission_level_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare task_level smallint;
begin
  if new.submission_source = 'mentor' then return new; end if;
  select level into task_level from public.tasks where id = new.task_id;
  if task_level is not null and task_level <> public.app_member_level(new.user_id) then
    raise exception 'Это задание другого уровня: отправить ответ нельзя.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists submissions_level_guard on public.submissions;
create trigger submissions_level_guard before insert on public.submissions
  for each row execute function public.app_submission_level_guard();

-- «Перевести на уровень» / «Вернуть на уровень»: only an admin of the participant's team.
create or replace function public.app_set_member_level(p_actor uuid, p_user uuid, p_level smallint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users%rowtype; member public.users%rowtype; current_level smallint; step smallint;
begin
  select * into actor from public.users where id = p_actor;
  select * into member from public.users where id = p_user for update;
  if actor.id is null or member.id is null or actor.role <> 'admin' or member.role <> 'member' or actor.team_id is distinct from member.team_id then
    return jsonb_build_object('forbidden', true);
  end if;
  if p_level is null or p_level not between 1 and 3 then return jsonb_build_object('validationError', 'Уровень может быть от 1 до 3.'); end if;
  current_level := public.app_member_level(p_user);
  if p_level > current_level then
    for step in current_level + 1 .. p_level loop
      insert into public.member_levels(user_id, level, reached_at, granted_by) values(p_user, step, clock_timestamp(), p_actor)
        on conflict (user_id, level) do update set reached_at = clock_timestamp(), granted_by = p_actor, revoked_at = null, celebrated_at = null;
    end loop;
    perform public.app_level_notify(p_user, p_level, p_actor);
  elsif p_level < current_level then
    update public.member_levels set revoked_at = now() where user_id = p_user and level > p_level and revoked_at is null;
  end if;
  return jsonb_build_object('level', public.app_member_level(p_user));
end $$;

-- The congratulation screen is shown once, on any device.
create or replace function public.app_member_level_seen(p_user uuid)
returns boolean language sql security definer set search_path = public as $$
  with seen as (update public.member_levels set celebrated_at = now() where user_id = p_user and celebrated_at is null returning 1)
  select exists(select 1 from seen);
$$;

-- Programs get their level when created or later; their steps follow.
create or replace function public.app_create_program_level(p_input jsonb, p_level smallint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if p_level is null or p_level not between 1 and 3 then raise exception 'Invalid level' using errcode = '22023'; end if;
  result := public.app_create_program(p_input);
  if p_level <> 1 then
    update public.task_programs set level = p_level where id = (result->'program'->>'id')::uuid;
    result := jsonb_build_object('program', (result->'program') || jsonb_build_object('level', p_level),
      'tasks', coalesce((select jsonb_agg(step || jsonb_build_object('level', p_level)) from jsonb_array_elements(result->'tasks') step), '[]'::jsonb));
  end if;
  return result;
end $$;

create or replace function public.app_set_program_level(p_id uuid, p_level smallint, p_actor uuid, p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; program public.task_programs%rowtype;
begin
  if p_level is null or p_level not between 1 and 3 then return jsonb_build_object('validationError', 'Уровень может быть от 1 до 3.'); end if;
  result := public.app_update_program(p_id, '{}'::jsonb, p_actor, p_ceo);
  if result ? 'forbidden' then return result; end if;
  update public.task_programs set level = p_level where id = p_id returning * into program;
  return jsonb_build_object('data', to_jsonb(program));
end $$;

revoke all on function public.app_task_program_level(), public.app_program_level_follow(), public.app_level_after_change(),
  public.app_submission_level_guard(), public.app_member_level(uuid), public.app_level_totals(uuid, smallint),
  public.app_course_standings(uuid), public.app_level_notify(uuid, smallint, uuid, interval),
  public.app_check_member_level(uuid, interval), public.app_set_member_level(uuid, uuid, smallint),
  public.app_member_level_seen(uuid), public.app_create_program_level(jsonb, smallint),
  public.app_set_program_level(uuid, smallint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.app_member_level(uuid), public.app_level_totals(uuid, smallint), public.app_course_standings(uuid),
  public.app_check_member_level(uuid, interval), public.app_set_member_level(uuid, uuid, smallint), public.app_member_level_seen(uuid),
  public.app_create_program_level(jsonb, smallint), public.app_set_program_level(uuid, smallint, uuid, boolean) to service_role;

-- Those who already have 300 move up now. Their Telegram messages wait half an hour, so the new site is live by then.
do $$ declare member_id uuid; begin
  for member_id in select id from public.users where role = 'member' loop
    perform public.app_check_member_level(member_id, '30 minutes');
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
