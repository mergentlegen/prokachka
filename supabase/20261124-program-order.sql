-- The mentor's own order of programs. The team leader moves programs up and down («↕ Порядок программ»);
-- participants see their programs in exactly that order, on the current level and in the archive.
-- «Закрепить сверху» is gone for programs: putting a program first does the same. Ready games keep their pins.
-- The order starts as the programs stood before (pinned first in pin order, then by creation), so nothing moves by itself.
-- A new program goes to the end of the list.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.task_programs add column if not exists position integer;

-- The order participants saw until now becomes the saved order.
with ranked as (
  select id, row_number() over (partition by team_id
    order by is_pinned desc, case when is_pinned then pinned_at end nulls last, created_at, id) as place
  from public.task_programs where template_key is null
)
update public.task_programs p set position = ranked.place from ranked where p.id = ranked.id and p.position is null;

-- Programs are no longer pinned: their place in the list says it all.
update public.task_programs set is_pinned = false where template_key is null and is_pinned;

-- A new program goes to the end of its team's list. Programs created at the same moment get their own places.
create or replace function public.app_program_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.template_key is null and new.position is null then
    perform pg_advisory_xact_lock(hashtext('program-order:' || new.team_id::text));
    select coalesce(max(position), 0) + 1 into new.position from public.task_programs where team_id = new.team_id and template_key is null;
  end if;
  return new;
end $$;
drop trigger if exists task_programs_place on public.task_programs;
create trigger task_programs_place before insert on public.task_programs for each row execute function public.app_program_place();

-- Saves the whole list of the team's programs in the new order (hidden ones and every level included).
-- Only the team leader. If a program was added or deleted meanwhile, the list is refused and the page reloads it.
create or replace function public.app_program_order_save(p_actor uuid, p_program_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare team uuid; total integer := coalesce(array_length(p_program_ids, 1), 0);
begin
  select u.team_id into team from public.users u where u.id = p_actor and u.role = 'admin' and u.team_id is not null;
  if team is null then return jsonb_build_object('forbidden', true); end if;
  -- Two leaders saving at the same moment: one waits for the other, neither loses a program.
  perform pg_advisory_xact_lock(hashtext('program-order:' || team::text));
  perform 1 from public.task_programs where team_id = team and template_key is null for update;
  if total = 0 or total > 500
    or (select count(distinct listed.id) from unnest(p_program_ids) as listed(id)) <> total
    or total <> (select count(*) from public.task_programs where team_id = team and template_key is null)
    or exists (select 1 from unnest(p_program_ids) as listed(id) where not exists (
      select 1 from public.task_programs p where p.id = listed.id and p.team_id = team and p.template_key is null)) then
    return jsonb_build_object('validationError', 'Список программ изменился. Обновите страницу и попробуйте снова.');
  end if;
  update public.task_programs p set position = ordered.place
    from unnest(p_program_ids) with ordinality as ordered(id, place)
    where p.id = ordered.id and p.position is distinct from ordered.place;
  return jsonb_build_object('data', true);
end $$;

revoke all on function public.app_program_place(), public.app_program_order_save(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.app_program_order_save(uuid, uuid[]) to service_role;
notify pgrst, 'reload schema';
commit;
