-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid(); leader uuid := gen_random_uuid(); mentor uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); sibling_mentor uuid := gen_random_uuid(); sibling uuid := gen_random_uuid(); stranger uuid := gen_random_uuid();
  phones jsonb; version int;
begin
  insert into public.teams(id,name) values (team, 'Команда мечты ' || team), (other_team, 'Другая ' || other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review)
    select id, name, 'Test', 'User', id || '@test.invalid', id::text, 'salt:hash', role::public.user_role, tid, review
    from (values (leader, 'Руководитель', 'admin', team, false), (mentor, 'Наставник', 'member', team, true), (member_id, 'Участник', 'member', team, false),
      (sibling_mentor, 'Соседний наставник', 'member', team, true), (sibling, 'Сосед', 'member', team, false), (stranger, 'Чужой', 'admin', other_team, false)) v(id, name, role, tid, review);
  update public.users set parent_user_id = leader where id in (mentor, sibling_mentor);
  update public.users set parent_user_id = mentor where id = member_id;
  update public.users set parent_user_id = sibling_mentor where id = sibling;

  -- Saving: a valid number, anything else refused; an empty value removes it.
  assert public.app_set_own_phone(member_id, '+77012345678')->>'phone' = '+77012345678', 'phone not saved';
  assert public.app_set_own_phone(member_id, '87012345678') ? 'validationError', 'unnormalised phone stored';
  assert public.app_set_own_phone(sibling, '+77019998877')->>'phone' = '+77019998877', 'second phone not saved';
  perform public.app_set_own_phone(mentor, '+77010000001');

  -- Who sees what: the leader sees the team, a mentor sees the branch below, nobody else.
  phones := public.app_visible_phones(leader);
  assert phones->>member_id::text = '+77012345678' and phones->>sibling::text = '+77019998877' and phones ? mentor::text, 'leader does not see the team: ' || phones::text;
  phones := public.app_visible_phones(mentor);
  assert phones->>member_id::text = '+77012345678' and not phones ? sibling::text and not phones ? mentor::text, 'mentor sees beyond the branch: ' || phones::text;
  assert not public.app_visible_phones(sibling_mentor) ? member_id::text, 'another branch sees the phone';
  assert public.app_visible_phones(member_id) = '{}'::jsonb, 'a participant sees phones';
  assert public.app_visible_phones(sibling) = '{}'::jsonb, 'a participant sees phones';
  assert public.app_visible_phones(stranger) = '{}'::jsonb, 'another team sees phones';
  update public.users set can_review = false where id = mentor;
  assert public.app_visible_phones(mentor) = '{}'::jsonb, 'a mentor without review rights still sees phones';

  -- The profile header: own phone, team, mentor.
  assert public.app_own_profile_extras(member_id) @> jsonb_build_object('phone', '+77012345678', 'teamName', 'Команда мечты ' || team, 'mentorName', 'Наставник'), 'extras wrong: ' || public.app_own_profile_extras(member_id)::text;
  assert public.app_set_own_phone(member_id, '')->>'phone' is null, 'empty phone not accepted';
  assert public.app_own_profile_extras(member_id)->>'phone' is null, 'phone not removed';

  -- A password change signs other devices out.
  select session_version into version from public.users where id = member_id;
  assert public.app_change_password(member_id, 'newsalt:newhash') = version + 1, 'session not revoked';
  assert (select password_hash = 'newsalt:newhash' from public.users where id = member_id), 'password not saved';
  perform public.app_change_password(member_id, null);
  assert (select password_hash = 'newsalt:newhash' from public.users where id = member_id), 'e-mail account lost its hash';

  assert not has_function_privilege('authenticated', 'public.app_visible_phones(uuid)', 'execute'), 'browser reads phones';
  assert not has_table_privilege('authenticated', 'public.user_contacts', 'select'), 'browser reads the phone table';
end $$;
rollback;
