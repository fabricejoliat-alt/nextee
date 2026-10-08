begin;
create function public.request_organization_identity_checked(p_actor uuid,p_org uuid,p_username text,p_kind text default 'player') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare player uuid; result uuid; begin
  perform public.organization_require_actor(p_actor,p_org);
  if p_kind not in ('player','parent') then raise exception 'Invalid identity purpose'; end if;
  if length(btrim(p_username))<3 or length(p_username)>100 then raise exception 'Exact identifier required'; end if;
  select id into player from public.profiles where lower(username)=lower(btrim(p_username));
  if not found or exists(select 1 from public.app_admins where user_id=player) then raise exception 'Identity review required'; end if;
  insert into public.organization_identity_matches(organization_id,player_id,requested_by,subject_role)
    values(p_org,player,p_actor,p_kind) on conflict(organization_id,player_id,subject_role) do update set requested_by=organization_identity_matches.requested_by
    returning id into result;
  return result;
end $$;
create function public.review_organization_identity_checked(p_actor uuid,p_match uuid,p_approve boolean,p_evidence text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare r public.organization_identity_matches%rowtype; begin
  perform public.organization_require_actor(p_actor,null,true);
  if length(btrim(p_evidence))<20 then raise exception 'Human verification evidence required'; end if;
  select * into r from public.organization_identity_matches where id=p_match for update;
  if not found or r.status<>'pending' then raise exception 'Identity review changed'; end if;
  update public.organization_identity_matches set status=case when p_approve then 'approved' else 'rejected' end,
    approved_by=p_actor,approved_at=now(),evidence_note=p_evidence where id=p_match;
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,next_state)
    values(r.organization_id,'organization_identity_matches',r.id::text,p_actor,'human_review',jsonb_build_object('approved',p_approve,'evidence',p_evidence));
end $$;
create function public.create_external_reference_checked(p_actor uuid,p_org uuid,p_name text,p_country text,p_region text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare result uuid; begin
  perform public.organization_require_actor(p_actor,p_org);
  if not exists(select 1 from public.organizations where id=p_org and org_type='academy') then raise exception 'Academy required'; end if;
  insert into public.external_club_references(name,normalized_name,country_code,region_code,created_by)
    values(btrim(p_name),lower(regexp_replace(btrim(p_name),'\s+',' ','g')),upper(p_country),upper(btrim(p_region)),p_actor)
    on conflict(normalized_name,country_code,region_code) do update set name=external_club_references.name returning id into result;
  return result;
end $$;

-- Auth provisioning is performed server-side. This transaction links only newly
-- provisioned identities; existing identities require a reviewed match.
create function public.provision_academy_family_checked(p_actor uuid,p_academy uuid,p_player uuid,p_player_profile jsonb,
  p_guardian uuid,p_guardian_profile jsonb,p_relation text,p_external uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare entry uuid; begin
  perform public.organization_require_actor(p_actor,p_academy);
  perform set_config('activitee.actor_id',p_actor::text,true);
  if not exists(select 1 from public.organizations where id=p_academy and org_type='academy' and is_active) then raise exception 'Academy required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p_player_profile->>'first_name'))||':'||
    lower(btrim(p_player_profile->>'last_name'))||':'||(p_player_profile->>'birth_date'),0));
  if exists(select 1 from public.profiles where id<>p_player and lower(btrim(first_name))=lower(btrim(p_player_profile->>'first_name'))
    and lower(btrim(last_name))=lower(btrim(p_player_profile->>'last_name')) and birth_date=(p_player_profile->>'birth_date')::date)
    then raise exception 'Potential duplicate needs human review' using errcode='23505'; end if;
  if exists(select 1 from public.organization_members where user_id=p_player) then raise exception 'Existing identity needs human review'; end if;
  if exists(select 1 from public.profiles where id=p_guardian and birth_date>current_date-interval '18 years') then raise exception 'Adult guardian required'; end if;
  if p_relation not in ('father','mother','legal_guardian') or p_player=p_guardian then raise exception 'Invalid family'; end if;
  insert into public.profiles(id,first_name,last_name,birth_date,username,app_role)
    values(p_player,p_player_profile->>'first_name',p_player_profile->>'last_name',(p_player_profile->>'birth_date')::date,
      p_player_profile->>'username','player')
    on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,birth_date=excluded.birth_date,username=excluded.username;
  if exists(select 1 from public.organization_members where user_id=p_guardian) then
    if not exists(select 1 from public.organization_identity_matches where organization_id=p_academy and player_id=p_guardian and subject_role='parent' and status in ('approved','used'))
      then raise exception 'Existing parent needs human review'; end if;
  else
    insert into public.profiles(id,first_name,last_name,username,app_role)
      values(p_guardian,p_guardian_profile->>'first_name',p_guardian_profile->>'last_name',p_guardian_profile->>'username','parent')
      on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,username=excluded.username;
  end if;
  insert into public.player_guardians(player_id,guardian_user_id,relation,can_view,can_edit)
    values(p_player,p_guardian,p_relation,true,true) on conflict do nothing;
  insert into public.organization_identity_matches(organization_id,player_id,requested_by,approved_by,approved_at,evidence_note,status)
    values(p_academy,p_player,p_actor,p_actor,now(),'New Auth identity provisioned after server duplicate check','approved');
  entry:=public.request_academy_roster_checked(p_actor,p_academy,p_player,
    case when p_external is null then 'no_declared_club' else 'external_club' end,null,p_external);
  insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit,created_by)
    values(p_academy,p_player,p_guardian,'pending',true,true,p_actor) on conflict do nothing;
  insert into public.organization_members(organization_id,user_id,role) values(p_academy,p_guardian,'parent') on conflict do nothing;
  return entry;
end $$;

create function public.save_organization_settings_checked(p_actor uuid,p_org uuid,p_values jsonb,p_settings jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  perform public.organization_require_actor(p_actor,null,true);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'Organization unavailable'; end if;
  if length(btrim(p_values->>'name'))<2 or (p_values->>'org_type') not in ('club','academy','federation')
    or p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'Invalid settings'; end if;
  update public.organizations set name=btrim(p_values->>'name'),slug=nullif(btrim(p_values->>'slug'),''),
    org_type=p_values->>'org_type',is_active=(p_values->>'is_active')::boolean,
    country_code=nullif(btrim(p_values->>'country_code'),''),region_code=nullif(btrim(p_values->>'region_code'),'') where id=p_org;
  insert into public.organization_settings(organization_id,settings,updated_by,updated_at) values(p_org,p_settings,p_actor,now())
    on conflict(organization_id) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=now();
end $$;
create function public.delete_empty_organization_checked(p_actor uuid,p_org uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare fk record; occupied boolean; begin
  perform public.organization_require_actor(p_actor,null,true);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'Organization unavailable'; end if;
  for fk in select c.conrelid::regclass as tbl,a.attname as col from pg_constraint c join pg_attribute a
    on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid='public.organizations'::regclass
    and cardinality(c.conkey)=1 and c.conrelid not in ('public.organization_settings'::regclass,
      'public.training_volume_settings'::regclass,'public.training_volume_targets'::regclass) loop
    execute format('select exists(select 1 from %s where %I=$1)',fk.tbl,fk.col) into occupied using p_org;
    if occupied then raise exception 'Organization history requires retention'; end if;
  end loop;
  if exists(select 1 from public.organization_members where organization_id=p_org)
    or exists(select 1 from public.legal_documents where club_id=p_org)
    or exists(select 1 from public.organization_audit_events where organization_id=p_org)
    or exists(select 1 from public.coach_groups where club_id=p_org)
    or exists(select 1 from public.club_events where club_id=p_org)
    or exists(select 1 from public.club_camps where club_id=p_org)
    or exists(select 1 from public.club_news where club_id=p_org) then raise exception 'Organization history requires retention'; end if;
  -- Audit and evidence FKs further enforce retention for all new workflows.
  delete from public.clubs where id=p_org;
  delete from public.organizations where id=p_org;
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('request_organization_identity_checked','review_organization_identity_checked',
      'create_external_reference_checked','provision_academy_family_checked','save_organization_settings_checked','delete_empty_organization_checked') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
