-- Scoped presentation order. This never changes task visibility or program steps.
begin;
create table if not exists public.task_feed_orders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  scope_user_id uuid references public.users(id) on delete cascade,
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries)='array'),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create unique index if not exists task_feed_orders_team_idx on public.task_feed_orders(team_id) where scope_user_id is null;
create unique index if not exists task_feed_orders_branch_idx on public.task_feed_orders(team_id,scope_user_id) where scope_user_id is not null;
alter table public.task_feed_orders enable row level security;
revoke all on public.task_feed_orders from public,anon,authenticated;
grant select,insert,update,delete on public.task_feed_orders to service_role;

create or replace function public.app_task_order_snapshot(p_viewer uuid,p_edit boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.users%rowtype; chain_ids uuid[]; selected_order public.task_feed_orders%rowtype;
  own_scope uuid; items jsonb; own_custom boolean;
begin
  select * into actor from public.users where id=p_viewer;
  if actor.id is null or actor.team_id is null or (p_edit and actor.role<>'admin' and not coalesce(actor.can_publish_tasks,false)) then
    return jsonb_build_object('forbidden',true);
  end if;
  own_scope:=case when actor.role='admin' then null else actor.id end;
  with recursive chain as (
    select id,parent_user_id,array[id] as path,0 as depth from public.users where id=actor.id
    union all
    select u.id,u.parent_user_id,c.path||u.id,c.depth+1 from public.users u join chain c on u.id=c.parent_user_id
      where u.team_id=actor.team_id and not u.id=any(c.path)
  ) select array_agg(id order by depth) into chain_ids from chain;
  -- Team editors arrange shared publications. Branch editors arrange their
  -- inherited publications and their own branch, never a sibling's content.
  select o.* into selected_order from public.task_feed_orders o
    left join public.users owner on owner.id=o.scope_user_id
    where o.team_id=actor.team_id and (
      o.scope_user_id is null or (not (p_edit and actor.role='admin') and o.scope_user_id=any(chain_ids)
        and owner.team_id=actor.team_id and (owner.role='admin' or owner.can_publish_tasks)))
    order by array_position(chain_ids,o.scope_user_id) nulls last limit 1;
  select exists(select 1 from public.task_feed_orders where team_id=actor.team_id and scope_user_id is not distinct from own_scope) into own_custom;
  with candidates as (
    select t.id,t.title,t.created_at,t.max_points,t.interactive_kind,
      case when t.interactive_kind is not null then 'game:'||t.interactive_kind else t.id::text end as item_key,
      case when p.id is not null then p.is_pinned else t.is_pinned end as pinned,
      case when p.id is not null then p.pinned_at else t.pinned_at end as pin_time,
      coalesce(array_position(chain_ids,coalesce(p.audience_root_id,t.audience_root_id)),2147483647) as distance,
      author.name as author_name
    from public.tasks t left join public.task_programs p on p.id=t.program_id
      left join public.users author on author.id=t.publisher_id
    where t.team_id=actor.team_id and t.is_active and t.publication_type<>'sequential'
      and (t.deadline_at is null or t.deadline_at>now())
      and (t.program_id is null or (p.is_active and p.team_id=actor.team_id))
      and (t.audience_root_id is null or (not (p_edit and actor.role='admin') and t.audience_root_id=any(chain_ids)))
      and (p.id is null or p.audience_root_id is null or (not (p_edit and actor.role='admin') and p.audience_root_id=any(chain_ids)))
  ), unique_items as (
    select distinct on (item_key) * from candidates order by item_key,distance,id
  ), saved as (
    select entry,ordinality as rank from jsonb_array_elements(coalesce(selected_order.entries,'[]'::jsonb)) with ordinality as s(entry,ordinality)
  ), ranked as (
    select u.*,s.rank from unique_items u left join saved s on s.entry->>'key'=u.item_key
      and (s.entry->>'pinned')::boolean=u.pinned
      and (not u.pinned or s.entry->>'pinnedAt' is not distinct from to_jsonb(u.pin_time)#>>'{}')
  ) select coalesce(jsonb_agg(jsonb_build_object('key',item_key,'taskId',id,'title',title,
      'kind',interactive_kind,'isPinned',pinned,'pinnedAt',pin_time,'createdAt',created_at,
      'maxPoints',max_points,'authorName',author_name)
    order by pinned desc,rank nulls last,case when pinned then coalesce(pin_time,created_at) else created_at end,id),'[]'::jsonb)
    into items from ranked;
  return jsonb_build_object('items',items,'scope',case when actor.role='admin' then 'team' else 'branch' end,
    'customized',own_custom,'revision',md5(items::text||coalesce(selected_order.id::text,'')||coalesce(selected_order.version::text,'0')||chain_ids::text));
end;
$$;

create or replace function public.app_save_task_order(p_actor uuid,p_revision text,p_pinned text[],p_regular text[],p_inherit boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.users%rowtype; snapshot jsonb; own_scope uuid; locked_team uuid; new_entries jsonb; expected_pinned text[]; expected_regular text[];
begin
  select * into actor from public.users where id=p_actor;
  if actor.id is null or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  -- Serialize saves, including simultaneous first saves where no scope row exists.
  locked_team:=actor.team_id;
  perform 1 from public.teams where id=locked_team for update;
  select * into actor from public.users where id=p_actor for share;
  if actor.team_id is distinct from locked_team then return jsonb_build_object('conflict',true); end if;
  if actor.team_id is null or (actor.role<>'admin' and not coalesce(actor.can_publish_tasks,false)) then return jsonb_build_object('forbidden',true); end if;
  snapshot:=public.app_task_order_snapshot(p_actor,true);
  if snapshot ? 'forbidden' then return snapshot; end if;
  if p_revision is distinct from snapshot->>'revision' then return jsonb_build_object('conflict',true); end if;
  own_scope:=case when actor.role='admin' then null else actor.id end;
  if p_inherit then
    delete from public.task_feed_orders where team_id=actor.team_id and scope_user_id is not distinct from own_scope;
    return public.app_task_order_snapshot(p_actor,true);
  end if;
  select coalesce(array_agg(e->>'key' order by e->>'key') filter(where (e->>'isPinned')::boolean),array[]::text[]),
    coalesce(array_agg(e->>'key' order by e->>'key') filter(where not (e->>'isPinned')::boolean),array[]::text[])
    into expected_pinned,expected_regular from jsonb_array_elements(snapshot->'items') e;
  if p_pinned is null or p_regular is null or cardinality(p_pinned)+cardinality(p_regular)>2000
    or (select coalesce(array_agg(k order by k),array[]::text[]) from unnest(p_pinned) k) is distinct from expected_pinned
    or (select coalesce(array_agg(k order by k),array[]::text[]) from unnest(p_regular) k) is distinct from expected_regular
    then return jsonb_build_object('invalid',true); end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',k,'pinned',(e->>'isPinned')::boolean,'pinnedAt',e->'pinnedAt') order by n),'[]'::jsonb)
    into new_entries from unnest(p_pinned||p_regular) with ordinality s(k,n)
      join jsonb_array_elements(snapshot->'items') e on e->>'key'=k;
  if own_scope is null then
    insert into public.task_feed_orders(team_id,entries) values(actor.team_id,new_entries)
      on conflict(team_id) where scope_user_id is null do update set entries=excluded.entries,version=task_feed_orders.version+1,updated_at=now();
  else
    insert into public.task_feed_orders(team_id,scope_user_id,entries) values(actor.team_id,own_scope,new_entries)
      on conflict(team_id,scope_user_id) where scope_user_id is not null do update set entries=excluded.entries,version=task_feed_orders.version+1,updated_at=now();
  end if;
  return public.app_task_order_snapshot(p_actor,true);
end;
$$;

create or replace function public.broadcast_task_order_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send(jsonb_build_object('topics',array['tasks'],'teamIds',array[case when tg_op='DELETE' then old.team_id::text else new.team_id::text end],
    'userIds',array[]::text[]),'changed','prokachka:changes',true);
  return null;
exception when others then raise log 'Task order notification unavailable: SQLSTATE %',sqlstate; return null;
end;
$$;
drop trigger if exists task_order_live_change on public.task_feed_orders;
create trigger task_order_live_change after insert or update or delete on public.task_feed_orders for each row execute function public.broadcast_task_order_change();
revoke all on function public.app_task_order_snapshot(uuid,boolean),public.app_save_task_order(uuid,text,text[],text[],boolean),public.broadcast_task_order_change() from public,anon,authenticated;
grant execute on function public.app_task_order_snapshot(uuid,boolean),public.app_save_task_order(uuid,text,text[],text[],boolean) to service_role;
notify pgrst,'reload schema';
commit;
