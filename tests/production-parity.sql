\set ON_ERROR_STOP on
begin;
do $$
begin
  if (select count(*) from pg_indexes where schemaname = 'public'
      and indexname in ('team_join_requests_inviter_idx', 'telegram_link_tokens_user_idx', 'telegram_link_tokens_expiry_idx')) <> 3 then
    raise exception 'Production indexes are missing';
  end if;
  if (select count(*) from pg_constraint where conname in ('tasks_program_fields_check', 'star_awards_comment_check')) <> 2 then
    raise exception 'Production checks are missing';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'star_awards_comment_check')) not like '%500%' then
    raise exception 'Star award comment limit is not 500';
  end if;
end $$;
rollback;
