begin;
create table public.organization_relationships (
  id uuid primary key default gen_random_uuid(),
  source_organization_id uuid not null references public.organizations(id) on delete restrict,
  target_organization_id uuid not null references public.organizations(id) on delete restrict,
  relationship_type text not null default 'academy_partner' check(relationship_type='academy_partner'),
  status text not null default 'pending' check(status in ('pending','active','suspended','ended')),
  player_discovery_enabled boolean not null default false,
  player_request_enabled boolean not null default false,
  created_by uuid not null references public.profiles(id), approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), ended_at timestamptz,
  revision integer not null default 1,
  unique(source_organization_id,target_organization_id,relationship_type),
  check(source_organization_id<>target_organization_id),
  check((status='ended')=(ended_at is not null)),
  check(status<>'active' or approved_by is not null)
);
create index organization_relationships_target on public.organization_relationships(target_organization_id,status);
create table public.external_club_references (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 2 and 160),
  normalized_name text not null, country_code text not null default 'CH', region_code text not null default '',
  claimed_organization_id uuid references public.organizations(id) on delete restrict, claimed_at timestamptz,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(normalized_name,country_code,region_code),
  check((claimed_organization_id is null)=(claimed_at is null)),
  check(country_code ~ '^[A-Z]{2}$')
);
create table public.academy_roster_entries (
  id uuid primary key default gen_random_uuid(), academy_id uuid not null references public.organizations(id) on delete restrict,
  player_id uuid not null references public.profiles(id) on delete restrict,
  origin_type text not null check(origin_type in ('activitee_club','external_club','no_declared_club')),
  origin_organization_id uuid references public.organizations(id) on delete restrict,
  external_club_reference_id uuid references public.external_club_references(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','active','suspended','ended')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  joined_at timestamptz, ended_at timestamptz, source_approved_by uuid references public.profiles(id),
  source_approved_at timestamptz, revision integer not null default 1,
  unique(academy_id,player_id),
  check((origin_type='activitee_club' and origin_organization_id is not null and external_club_reference_id is null)
    or (origin_type='external_club' and origin_organization_id is null and external_club_reference_id is not null)
    or (origin_type='no_declared_club' and origin_organization_id is null and external_club_reference_id is null)),
  check((status='ended')=(ended_at is not null)),
  check(status<>'active' or joined_at is not null)
);
create index academy_roster_player on public.academy_roster_entries(player_id,status);
create index academy_roster_origin on public.academy_roster_entries(origin_organization_id,status);
create table public.player_guardian_scopes (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  player_id uuid not null, guardian_user_id uuid not null,
  status text not null default 'pending' check(status in ('pending','active','suspended','ended')),
  can_view boolean not null default false, can_edit boolean not null default false,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  decided_at timestamptz, ended_at timestamptz, updated_at timestamptz not null default now(),
  primary key(organization_id,player_id,guardian_user_id),
  foreign key(player_id,guardian_user_id) references public.player_guardians(player_id,guardian_user_id) on delete restrict,
  check(not can_edit or can_view), check((status='ended')=(ended_at is not null))
);
create index guardian_scopes_actor on public.player_guardian_scopes(guardian_user_id,organization_id,status);
-- This backfill preserves existing access only within an already shared organization.
-- It records no legal decision and no assertion of parental authority.
insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit)
select p.organization_id,g.player_id,g.guardian_user_id,'active',coalesce(g.can_view,true),coalesce(g.can_edit,false)
from public.player_guardians g
join public.organization_members p on p.user_id=g.player_id and p.role='player' and p.is_active
join public.organization_members m on m.user_id=g.guardian_user_id and m.organization_id=p.organization_id and m.role='parent' and m.is_active
where coalesce(g.can_view,true) or coalesce(g.can_edit,false);

-- Only a human administrator can approve a cross-organization identity match.
create table public.organization_identity_matches (
  subject_role text not null default 'player' check(subject_role in ('player','parent')),
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  player_id uuid not null references public.profiles(id), requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id), approved_at timestamptz, evidence_note text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','used')),
  created_at timestamptz not null default now(),
  unique(organization_id,player_id,subject_role),
  check(status not in ('approved','used') or (approved_by is not null and approved_at is not null and length(btrim(evidence_note))>=20))
);
create table public.organization_audit_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete restrict,
  object_type text not null, object_id text not null, actor_id uuid not null references public.profiles(id),
  action text not null, previous_state jsonb, next_state jsonb, created_at timestamptz not null default now()
);
create index organization_audit_owner on public.organization_audit_events(organization_id,created_at desc);
create function public.organization_validate_structure() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if tg_table_name='organization_relationships' then
    if not exists(select 1 from public.organizations where id=new.source_organization_id and org_type='academy')
      or not exists(select 1 from public.organizations where id=new.target_organization_id and org_type='club') then
      raise exception 'Partnership requires an academy and a club'; end if;
    if tg_op='UPDATE' and (new.source_organization_id,new.target_organization_id) is distinct from (old.source_organization_id,old.target_organization_id)
      then raise exception 'Partnership identity is immutable'; end if;
  elsif tg_table_name='academy_roster_entries' then
    if not exists(select 1 from public.organizations where id=new.academy_id and org_type='academy') then raise exception 'Academy required'; end if;
    if new.origin_type='activitee_club' and not exists(select 1 from public.organizations where id=new.origin_organization_id and org_type='club')
      then raise exception 'Origin must be a club'; end if;
    if tg_op='UPDATE' and (new.academy_id,new.player_id) is distinct from (old.academy_id,old.player_id)
      then raise exception 'Roster identity is immutable'; end if;
  elsif new.claimed_organization_id is not null and not exists(select 1 from public.organizations where id=new.claimed_organization_id and org_type='club') then
    raise exception 'External reference must be claimed by a club';
  end if;
  return new;
end $$;
create trigger relationship_validate before insert or update on public.organization_relationships for each row execute function public.organization_validate_structure();
create trigger roster_validate before insert or update on public.academy_roster_entries for each row execute function public.organization_validate_structure();
create trigger external_reference_validate before insert or update on public.external_club_references for each row execute function public.organization_validate_structure();

create function public.organization_audit_transition() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid := nullif(current_setting('activitee.actor_id',true),'')::uuid; owner uuid; obj text; begin
  if actor is null then actor:=auth.uid(); end if;
  if actor is null then raise exception 'Audited mutation requires an actor'; end if;
  if tg_table_name='organization_relationships' then owner:=new.source_organization_id; obj:=new.id::text;
  elsif tg_table_name='academy_roster_entries' then owner:=new.academy_id; obj:=new.id::text;
  else owner:=new.organization_id; obj:=new.player_id::text||':'||new.guardian_user_id::text; end if;
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,previous_state,next_state)
    values(owner,tg_table_name,obj,actor,lower(tg_op),case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
  return new;
end $$;
create trigger relationship_audit after insert or update on public.organization_relationships for each row execute function public.organization_audit_transition();
create trigger roster_audit after insert or update on public.academy_roster_entries for each row execute function public.organization_audit_transition();
create trigger guardian_scope_audit after insert or update on public.player_guardian_scopes for each row execute function public.organization_audit_transition();
create trigger organization_audit_immutable before update or delete on public.organization_audit_events for each row execute function public.legal_prevent_evidence_mutation();

do $$ declare t text; begin
  foreach t in array array['organization_relationships','external_club_references','academy_roster_entries','player_guardian_scopes','organization_identity_matches','organization_audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.organization_audit_events_id_seq to service_role;
create policy relationship_read on public.organization_relationships for select to authenticated using
  (public.is_app_admin(auth.uid()) or public.organization_is_manager(source_organization_id,auth.uid()) or public.organization_is_manager(target_organization_id,auth.uid()));
create policy roster_read on public.academy_roster_entries for select to authenticated using
  (public.is_app_admin(auth.uid()) or public.organization_is_manager(academy_id,auth.uid())
    or public.organization_is_manager(origin_organization_id,auth.uid()) or player_id=auth.uid()
    or exists(select 1 from public.player_guardian_scopes s where s.organization_id=academy_id and s.player_id=academy_roster_entries.player_id
      and s.guardian_user_id=auth.uid() and s.status in ('pending','active') and s.can_view));
create policy guardian_scope_read on public.player_guardian_scopes for select to authenticated using
  (public.is_app_admin(auth.uid()) or public.organization_is_manager(organization_id,auth.uid()) or guardian_user_id=auth.uid() or player_id=auth.uid());
create policy external_reference_read on public.external_club_references for select to authenticated using
  (public.is_app_admin(auth.uid()) or exists(select 1 from public.academy_roster_entries r
    where r.external_club_reference_id=external_club_references.id and (r.player_id=auth.uid() or public.organization_is_manager(r.academy_id,auth.uid()))));
create policy identity_match_read on public.organization_identity_matches for select to authenticated using
  (public.is_app_admin(auth.uid()) or public.organization_is_manager(organization_id,auth.uid()));
create policy organization_audit_read on public.organization_audit_events for select to authenticated using
  (public.is_app_admin(auth.uid()) or public.organization_is_manager(organization_id,auth.uid()));

create function public.set_academy_partnership_checked(p_actor uuid,p_academy uuid,p_club uuid,p_status text,p_discovery boolean,p_requests boolean,p_expected_revision integer) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare r public.organization_relationships%rowtype; result uuid; begin
  perform public.organization_require_actor(p_actor,null,true);
  perform set_config('activitee.actor_id',p_actor::text,true);
  perform 1 from public.organizations where id=p_academy and org_type='academy' for update;
  if not found then raise exception 'Academy unavailable'; end if;
  select * into r from public.organization_relationships where source_organization_id=p_academy and target_organization_id=p_club for update;
  if coalesce(r.revision,0)<>p_expected_revision then raise exception 'Partnership changed' using errcode='40001'; end if;
  if p_status not in ('pending','active','suspended','ended') then raise exception 'Invalid status'; end if;
  if r.status='ended' and p_status<>'ended' then raise exception 'Ended partnership cannot be reopened'; end if;
  insert into public.organization_relationships(source_organization_id,target_organization_id,status,player_discovery_enabled,player_request_enabled,created_by,approved_by,ended_at)
    values(p_academy,p_club,p_status,p_discovery,p_requests,p_actor,case when p_status='active' then p_actor end,case when p_status='ended' then now() end)
  on conflict(source_organization_id,target_organization_id,relationship_type) do update set status=excluded.status,
    player_discovery_enabled=excluded.player_discovery_enabled,player_request_enabled=excluded.player_request_enabled,
    approved_by=coalesce(excluded.approved_by,organization_relationships.approved_by),updated_at=now(),
    revision=organization_relationships.revision+1,ended_at=excluded.ended_at returning id into result;
  -- Ending the partnership stops discovery and new requests. Existing academy affiliations
  -- retain their independent legal relationship and can be ended separately.
  return result;
end $$;

create function public.discover_academy_players_checked(p_actor uuid,p_academy uuid,p_club uuid,p_query text)
returns table(player_id uuid,first_name text,last_name text,origin_organization_id uuid)
language plpgsql stable security definer set search_path=public,pg_temp as $$ begin
  perform public.organization_require_actor(p_actor,p_academy);
  if length(btrim(p_query))<3 or length(p_query)>100 or p_query ~ '[%_]' then raise exception 'Search requires at least three characters'; end if;
  if not exists(select 1 from public.organization_relationships r join public.organizations o on o.id=r.target_organization_id
    where r.source_organization_id=p_academy and r.target_organization_id=p_club and r.status='active'
      and r.player_discovery_enabled and o.is_active) then raise exception 'Discovery forbidden' using errcode='42501'; end if;
  return query select p.id,p.first_name,p.last_name,p_club from public.profiles p
    join public.organization_members m on m.user_id=p.id and m.organization_id=p_club and m.role='player' and m.is_active
    where concat_ws(' ',p.first_name,p.last_name) ilike '%'||btrim(p_query)||'%'
    order by p.last_name,p.first_name,p.id limit 20;
end $$;

create function public.request_academy_roster_checked(p_actor uuid,p_academy uuid,p_player uuid,p_origin_type text,p_origin uuid default null,p_external uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$ declare result uuid; g record; begin
  perform public.organization_require_actor(p_actor,p_academy);
  perform set_config('activitee.actor_id',p_actor::text,true);
  perform 1 from public.organizations where id=p_academy and org_type='academy' and is_active for update;
  if not found then raise exception 'Academy unavailable'; end if;
  if exists(select 1 from public.app_admins where user_id=p_player) then raise exception 'Invalid player'; end if;
  if p_origin_type='activitee_club' then
    perform 1 from public.organization_relationships where source_organization_id=p_academy and target_organization_id=p_origin
      and status='active' and player_request_enabled for share;
    if not found then raise exception 'Request forbidden' using errcode='42501'; end if;
    if not exists(select 1 from public.organization_members where organization_id=p_origin and user_id=p_player and role='player' and is_active)
      then raise exception 'Source player unavailable'; end if;
  else
    perform 1 from public.organization_identity_matches where organization_id=p_academy and player_id=p_player and subject_role='player' and status='approved' for update;
    if not found then raise exception 'Human identity confirmation required' using errcode='42501'; end if;
    update public.organization_identity_matches set status='used' where organization_id=p_academy and player_id=p_player and subject_role='player';
  end if;
  insert into public.academy_roster_entries(academy_id,player_id,origin_type,origin_organization_id,external_club_reference_id,created_by)
    values(p_academy,p_player,p_origin_type,p_origin,p_external,p_actor) returning id into result;
  -- Onboarding membership allows access to legal documents, not academy business data.
  insert into public.organization_members(organization_id,user_id,role,is_active,player_consent_status)
    values(p_academy,p_player,'player',true,'pending') on conflict do nothing;
  if p_origin_type='activitee_club' then
    for g in select * from public.player_guardian_scopes where organization_id=p_origin and player_id=p_player and status='active' and can_view loop
      insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit,created_by)
        values(p_academy,p_player,g.guardian_user_id,'pending',g.can_view,g.can_edit,p_actor) on conflict do nothing;
      insert into public.organization_members(organization_id,user_id,role) values(p_academy,g.guardian_user_id,'parent') on conflict do nothing;
    end loop;
  end if;
  return result;
end $$;

create function public.approve_academy_source_checked(p_actor uuid,p_entry uuid,p_expected_revision integer,p_approve boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare r public.academy_roster_entries%rowtype; begin
  select * into r from public.academy_roster_entries where id=p_entry for update;
  if not found or r.origin_type<>'activitee_club' or (r.status<>'pending' or r.source_approved_at is not null) then raise exception 'Request unavailable'; end if;
  perform public.organization_require_actor(p_actor,r.origin_organization_id);
  if r.revision<>p_expected_revision then raise exception 'Roster changed' using errcode='40001'; end if;
  perform set_config('activitee.actor_id',p_actor::text,true);
  if not exists(select 1 from public.organization_relationships where source_organization_id=r.academy_id and target_organization_id=r.origin_organization_id
    and status='active' and player_request_enabled) then raise exception 'Partnership changed'; end if;
  update public.academy_roster_entries set source_approved_by=case when p_approve then p_actor end,
    source_approved_at=case when p_approve then now() end,status=case when p_approve then 'pending' else 'ended' end,
    ended_at=case when not p_approve then now() end,revision=revision+1 where id=p_entry;
  if not p_approve then
    update public.organization_members set is_active=false where organization_id=r.academy_id and user_id=r.player_id and role='player';
    update public.player_guardian_scopes set status='ended',ended_at=now(),updated_at=now() where organization_id=r.academy_id and player_id=r.player_id;
  end if;
end $$;

create function public.claim_external_club_checked(p_actor uuid,p_reference uuid,p_club uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare ref public.external_club_references%rowtype; begin
  perform public.organization_require_actor(p_actor,null,true);
  if not exists(select 1 from public.organizations where id=p_club and org_type='club' and is_active) then raise exception 'Active club required'; end if;
  select * into ref from public.external_club_references where id=p_reference for update;
  if not found or ref.claimed_organization_id is not null then raise exception 'External reference unavailable'; end if;
  update public.external_club_references set claimed_organization_id=p_club,claimed_at=now() where id=p_reference;
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,previous_state,next_state)
    values(p_club,'external_club_references',p_reference::text,p_actor,'claimed',to_jsonb(ref),jsonb_build_object('club_id',p_club));
  -- Deliberately no affiliation or identity mutation here.
end $$;

create function public.confirm_external_affiliation_checked(p_actor uuid,p_reference uuid,p_player uuid,p_club uuid,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  perform public.organization_require_actor(p_actor,null,true);
  if length(btrim(p_reason))<20 then raise exception 'Human matching evidence required'; end if;
  perform 1 from public.external_club_references where id=p_reference and claimed_organization_id=p_club for update;
  if not found or not exists(select 1 from public.academy_roster_entries where player_id=p_player and external_club_reference_id=p_reference)
    then raise exception 'Matching proposal unavailable'; end if;
  insert into public.organization_members(organization_id,user_id,role,is_active,player_consent_status)
    values(p_club,p_player,'player',true,'pending') on conflict do nothing;
  perform set_config('activitee.actor_id',p_actor::text,true);
  insert into public.organization_members(organization_id,user_id,role,is_active)
    select distinct p_club,s.guardian_user_id,'parent',true from public.player_guardian_scopes s
    join public.academy_roster_entries r on r.academy_id=s.organization_id and r.player_id=s.player_id
    where r.player_id=p_player and r.external_club_reference_id=p_reference and s.status='active' and s.can_view
    on conflict do nothing;
  insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit,created_by)
    select p_club,p_player,s.guardian_user_id,'pending',bool_or(s.can_view),bool_or(s.can_edit),p_actor
    from public.player_guardian_scopes s join public.academy_roster_entries r on r.academy_id=s.organization_id and r.player_id=s.player_id
    where r.player_id=p_player and r.external_club_reference_id=p_reference and s.status='active' and s.can_view
    group by s.guardian_user_id on conflict do nothing;
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,next_state)
    values(p_club,'external_affiliation',p_player::text,p_actor,'human_confirmed',jsonb_build_object('reference_id',p_reference,'reason',p_reason));
  -- Academy origin/history remains unchanged, and club authorization is still pending.
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('set_academy_partnership_checked','discover_academy_players_checked',
      'request_academy_roster_checked','approve_academy_source_checked','claim_external_club_checked','confirm_external_affiliation_checked') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
revoke all on function public.organization_validate_structure(),public.organization_audit_transition() from public,anon,authenticated;
commit;
