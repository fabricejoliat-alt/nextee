begin;
-- Generated aliases add organization terminology without rewriting evidence.
alter table public.legal_documents drop constraint legal_documents_scope_check;
alter table public.legal_documents drop constraint legal_documents_check;
alter table public.legal_documents add constraint legal_documents_scope_check check(scope in ('platform','club','organization'));
alter table public.legal_documents add constraint legal_documents_check check
  ((scope='platform' and club_id is null) or (scope in ('club','organization') and club_id is not null));
do $$ declare t text; begin
  foreach t in array array['legal_documents','legal_presentations','legal_decisions','legal_representative_assertions','legal_representative_events','legal_conflict_resolutions'] loop
    if t='legal_conflict_resolutions' then
      execute format('alter table public.%I add column organization_id uuid generated always as (club_scope) stored',t);
    else execute format('alter table public.%I add column organization_id uuid generated always as (club_id) stored',t); end if;
  end loop;
end $$;
alter table public.legal_current_state add column organization_scope uuid generated always as (club_scope) stored;

create function public.organization_guardian_allowed(p_actor uuid,p_player uuid,p_org uuid,p_edit boolean default false,p_onboarding boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.player_guardian_scopes s
    join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.guardian_user_id and m.role='parent' and m.is_active
    join public.player_guardians g on g.player_id=s.player_id and g.guardian_user_id=s.guardian_user_id
    where s.organization_id=p_org and s.player_id=p_player and s.guardian_user_id=p_actor and s.can_view
      and (not p_edit or s.can_edit) and (s.status='active' or (p_onboarding and s.status='pending'))
      and not exists(select 1 from public.legal_representative_assertions a where a.child_id=p_player
        and a.guardian_id=p_actor and a.club_id=p_org and a.status='revoked'));
$$;

-- Use the latest immutable version, never the legacy granted flag alone.
create function public.organization_player_authorized(p_org uuid,p_player uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_org and m.user_id=p_player and m.role='player' and m.is_active and o.is_active
      and (m.player_consent_status='adult' and exists(select 1 from public.profiles p where p.id=p_player and p.birth_date<=current_date-interval '18 years')
        or (m.player_consent_status='granted' and exists(select 1 from public.legal_documents d
          join public.legal_current_state s on s.document_id=d.id and s.beneficiary_id=p_player and s.club_scope=p_org
          join public.legal_versions v on v.id=s.version_id and v.document_id=d.id
          where d.club_id=p_org and d.active and d.kind='parent_authorization' and d.purpose_key='service.parent_authorization'
            and s.decision='authorized' and not s.conflict and public.legal_version_matches_document(d.id,v.id)
            and v.version_number=(select max(version_number) from public.legal_versions where document_id=d.id)))));
$$;
create function public.organization_actor_access(p_org uuid,p_actor uuid,p_player uuid default null,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_org is not null and exists(select 1 from public.organizations where id=p_org and is_active)
    and (p_player is null or exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_player and role='player' and is_active))
    and (public.is_app_admin(p_actor) or public.organization_is_manager(p_org,p_actor)
      or exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=p_actor and m.is_active and m.role='coach'
        and (p_player is null or (public.organization_player_authorized(p_org,p_player)
          and not exists(select 1 from public.academy_roster_entries r where r.academy_id=p_org and r.player_id=p_player and r.status<>'active')
          and exists(select 1 from public.coach_groups g join public.coach_group_players gp on gp.group_id=g.id
            where g.club_id=p_org and g.is_active and gp.player_user_id=p_player and public.is_group_staff_member(g.id,p_actor)))))
      or ((p_player is null or p_player=p_actor) and public.organization_player_authorized(p_org,p_actor)
        and not exists(select 1 from public.academy_roster_entries r where r.academy_id=p_org and r.player_id=p_actor and r.status<>'active'))
      or exists(select 1 from public.player_guardian_scopes s where s.organization_id=p_org and s.guardian_user_id=p_actor
        and (p_player is null or s.player_id=p_player) and public.organization_guardian_allowed(p_actor,s.player_id,p_org,p_edit)
        and public.organization_player_authorized(p_org,s.player_id)
        and not exists(select 1 from public.academy_roster_entries r where r.academy_id=p_org and r.player_id=s.player_id and r.status<>'active')));
$$;

insert into public.organization_migration_baseline(object_key,definition)
select 'function:'||p.oid::regprocedure,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('legal_actor_allowed','legal_document_actor_allowed','manage_player_guardian_v1') on conflict do nothing;

create or replace function public.legal_actor_allowed(p_actor uuid,p_beneficiary uuid,p_club uuid,p_role text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select case when p_actor=p_beneficiary then
    (exists(select 1 from public.organization_members m where m.user_id=p_actor and m.is_active and m.role=p_role
      and (p_club is null or m.organization_id=p_club))
    or (p_role='admin' and p_club is null and public.is_app_admin(p_actor)))
  else p_role='parent' and p_club is not null
    and public.organization_guardian_allowed(p_actor,p_beneficiary,p_club,true,true)
    and exists(select 1 from public.organization_members m where m.user_id=p_beneficiary and m.organization_id=p_club and m.role='player' and m.is_active)
    and exists(select 1 from public.legal_representative_assertions a where a.guardian_id=p_actor and a.child_id=p_beneficiary and a.club_id=p_club and a.status='verified')
  end;
$$;
create or replace function public.legal_document_actor_allowed(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select case when d.kind='parent_authorization' and d.purpose_key='service.parent_authorization' then
    p_actor<>p_beneficiary and p_role='parent' and d.scope in ('club','organization') and d.club_id is not null
    and public.organization_guardian_allowed(p_actor,p_beneficiary,d.club_id,true,true)
    and exists(select 1 from public.organization_members m where m.user_id=p_beneficiary and m.organization_id=d.club_id and m.role='player'
      and m.is_active and m.player_consent_status is distinct from 'adult')
    and exists(select 1 from public.player_guardians g where g.guardian_user_id=p_actor and g.player_id=p_beneficiary
      and (g.relation in ('father','mother','legal_guardian') or public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role)))
    and not exists(select 1 from public.academy_roster_entries r where r.academy_id=d.club_id and r.player_id=p_beneficiary
      and (r.status='ended' or (r.origin_type='activitee_club' and r.source_approved_at is null)))
  else public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) end
  from public.legal_documents d where d.id=p_document;
$$;

-- Restrictive policies supplement existing narrow Coach/group/owner policies.
-- They also stop global guardian links from opening a second organization's data.
do $$ declare r record; owner_col text; owner_expr text; subject_col text; expression text; begin
  for r in select c.table_name, c.column_name from information_schema.columns c
    join pg_class t on t.relname=c.table_name join pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
    where c.table_schema='public' and t.relkind='r' and t.relrowsecurity
      and c.column_name in ('organization_id','club_id')
      and c.table_name not like 'legal_%' and c.table_name not in ('club_members','organization_members',
        'organization_settings','academy_roster_entries','organization_identity_matches','organization_audit_events','player_guardian_scopes')
    order by c.table_name,c.column_name asc
  loop
    if exists(select 1 from pg_policy p where p.polrelid=('public.'||r.table_name)::regclass and p.polname='organization_scope_guard') then continue; end if;
    owner_col:=r.column_name;
    owner_expr:=quote_ident(owner_col);
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.table_name and column_name='club_id')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.table_name and column_name='organization_id') then
      owner_expr:='coalesce(club_id,organization_id)';
      execute format('alter table public.%I add constraint organization_owner_consistent check(club_id is null or organization_id is null or club_id=organization_id)',r.table_name);
    end if;
    select column_name into subject_col from information_schema.columns where table_schema='public' and table_name=r.table_name
      and column_name in ('player_user_id','player_id','user_id') order by case column_name when 'player_user_id' then 1 when 'player_id' then 2 else 3 end limit 1;
    expression:=format('(%s is null or public.organization_actor_access(%s,auth.uid(),%s))',owner_expr,owner_expr,
      case when subject_col is null then 'null' else format('%I',subject_col) end);
    execute format('create policy organization_scope_guard on public.%I as restrictive for all to authenticated using (%s) with check (%s)',r.table_name,expression,expression);
  end loop;
end $$;

-- Capture and adapt existing legal routines without touching any stored snapshot.
do $$ declare r record; definition text; begin
  for r in select p.oid,p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('create_legal_document','present_legal_document','publish_legal_draft_checked','publish_legal_draft',
       'set_legal_draft_variables','save_legal_draft_text_checked','create_club_legal_drafts_from_templates','legal_required_direct_access') loop
    insert into public.organization_migration_baseline values('function:'||r.signature,r.def) on conflict do nothing;
    definition:=replace(r.def,'public.clubs','public.organizations');
    definition:=regexp_replace(definition,'(d|p_)\.scope\s*=\s*''club''','\1.scope in (''club'',''organization'')','g');
    definition:=replace(definition,'p_scope=''club''','p_scope in (''club'',''organization'')');
    definition:=replace(definition,'p_scope not in (''platform'',''club'')','p_scope not in (''platform'',''club'',''organization'')');
    definition:=replace(definition,'''child_name'',''club_name'',''user_name''','''child_name'',''club_name'',''organization_name'',''user_name''');
    definition:=replace(definition,'when ''club_name'' then','when ''club_name'',''organization_name'' then');
    if r.def like '%create_club_legal_drafts_from_templates%' then
      definition:=replace(definition,'''club'',p_club','''organization'',p_club');
      definition:=replace(definition,'''club'', p_club','''organization'', p_club');
    end if;
    execute definition;
  end loop;
end $$;

create function public.set_academy_roster_status_checked(p_actor uuid,p_entry uuid,p_status text,p_expected_revision integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare r public.academy_roster_entries%rowtype; begin
  select * into r from public.academy_roster_entries where id=p_entry for update;
  if not found then raise exception 'Roster unavailable'; end if;
  perform public.organization_require_actor(p_actor,r.academy_id);
  if r.revision<>p_expected_revision then raise exception 'Roster changed' using errcode='40001'; end if;
  if p_status not in ('active','suspended','ended') or r.status='ended' then raise exception 'Invalid roster transition'; end if;
  if p_status='active' then
    if r.origin_type='activitee_club' and (r.source_approved_at is null or not exists(select 1 from public.organization_relationships
      where source_organization_id=r.academy_id and target_organization_id=r.origin_organization_id and status='active' and player_request_enabled))
      then raise exception 'Source approval required'; end if;
    if not public.organization_player_authorized(r.academy_id,r.player_id) then raise exception 'Academy authorization required'; end if;
    if not public.organization_actor_legal_ready(r.academy_id,r.player_id) then raise exception 'Legal action required'; end if;
  end if;
  perform set_config('activitee.actor_id',p_actor::text,true);
  update public.academy_roster_entries set status=p_status,revision=revision+1,
    joined_at=case when p_status='active' then coalesce(joined_at,now()) else joined_at end,
    ended_at=case when p_status='ended' then now() end where id=p_entry;
  -- Suspension keeps membership available for legal decisions, but the access guard denies business data.
  if p_status='ended' then
    update public.organization_members set is_active=false where organization_id=r.academy_id and user_id=r.player_id and role='player';
    update public.player_guardian_scopes set status='ended',ended_at=now(),updated_at=now() where organization_id=r.academy_id and player_id=r.player_id;
  end if;
end $$;

create function public.organization_legal_scope_transition() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ declare d public.legal_documents%rowtype; actor uuid; begin
  select * into d from public.legal_documents where id=new.document_id;
  if d.kind<>'parent_authorization' or d.purpose_key<>'service.parent_authorization' or d.club_id is null then return new; end if;
  select actor_id into actor from public.legal_decisions where id=new.decision_id;
  perform set_config('activitee.actor_id',actor::text,true);
  if new.decision='authorized' and not new.conflict then
    update public.player_guardian_scopes set status='active',decided_at=now(),updated_at=now()
      where organization_id=d.club_id and player_id=new.beneficiary_id and guardian_user_id=actor and status in ('pending','active');
  else
    update public.academy_roster_entries set status='suspended',revision=revision+1
      where academy_id=d.club_id and player_id=new.beneficiary_id and status='active';
  end if;
  return new;
end $$;
create trigger organization_legal_scope_transition after insert or update on public.legal_current_state
for each row execute function public.organization_legal_scope_transition();

create or replace function public.manage_player_guardian_v1(p_actor_id uuid,p_club_id uuid,p_player_id uuid,p_guardian_id uuid,p_action text,p_relation text default 'other',p_is_primary boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin
  perform public.require_manager_player_scope_v1(p_actor_id,p_club_id,p_player_id);
  perform set_config('activitee.actor_id',p_actor_id::text,true);
  if p_action='delete' then
    update public.player_guardian_scopes set status='ended',ended_at=now(),can_view=false,can_edit=false,updated_at=now()
      where organization_id=p_club_id and player_id=p_player_id and guardian_user_id=p_guardian_id;
    update public.player_periodic_report_configs set recipient_user_ids=array_remove(recipient_user_ids,p_guardian_id),updated_at=now()
      where club_id=p_club_id and player_user_id=p_player_id and p_guardian_id=any(recipient_user_ids);
  elsif p_action='upsert' then
    if p_guardian_id=p_player_id or p_relation not in ('mother','father','legal_guardian','other') then raise exception 'Invalid guardian'; end if;
    if not exists(select 1 from public.organization_members where organization_id=p_club_id and user_id=p_guardian_id and role='parent' and is_active)
      then raise exception 'Guardian unavailable'; end if;
    insert into public.player_guardians(player_id,guardian_user_id,relation,is_primary,can_view,can_edit)
      values(p_player_id,p_guardian_id,p_relation,p_is_primary,true,true) on conflict do nothing;
    -- Existing family identity/authority is never rewritten by another organization.
    insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit,created_by)
      values(p_club_id,p_player_id,p_guardian_id,'pending',true,true,p_actor_id)
      on conflict(organization_id,player_id,guardian_user_id) do update set status='pending',ended_at=null,
        can_view=true,can_edit=true,updated_at=now();
  else raise exception 'Invalid action'; end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.organization_guardian_allowed(uuid,uuid,uuid,boolean,boolean),
  public.organization_player_authorized(uuid,uuid),public.organization_actor_access(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.organization_guardian_allowed(uuid,uuid,uuid,boolean,boolean),
  public.organization_player_authorized(uuid,uuid),public.organization_actor_access(uuid,uuid,uuid,boolean) to authenticated,service_role;
revoke all on function public.set_academy_roster_status_checked(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.set_academy_roster_status_checked(uuid,uuid,text,integer) to service_role;
revoke all on function public.organization_legal_scope_transition() from public,anon,authenticated;
commit;
