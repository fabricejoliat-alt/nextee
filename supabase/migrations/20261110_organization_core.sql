-- Canonical ownership. Historical club_id names remain API-compatible aliases.
begin;

create table public.organization_migration_baseline (
  object_key text primary key, definition text not null
);
revoke all on public.organization_migration_baseline from public, anon, authenticated;
alter table public.organization_migration_baseline enable row level security;

insert into public.organization_migration_baseline values
  ('clubs_before',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.clubs t)),
  ('organizations_before',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.organizations t)),
  ('organization_members_before',(select coalesce(jsonb_agg(to_jsonb(t) order by organization_id,user_id,role),'[]'::jsonb)::text from public.organization_members t)),
  ('club_members_before',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.club_members t));

insert into public.organizations(id,name,slug,org_type,is_active)
select id,name,slug,'club',true from public.clubs
on conflict(id) do nothing;

-- Reparent every legacy FK while preserving its delete/update rules and name.
do $$ declare r record; definition text; begin
  for r in select c.oid,c.conname,c.conrelid::regclass as tbl
    from pg_constraint c where c.contype='f' and c.confrelid='public.clubs'::regclass
  loop
    definition := pg_get_constraintdef(r.oid);
    insert into public.organization_migration_baseline values
      ('fk:'||r.tbl||':'||r.conname,definition);
    execute format('alter table %s drop constraint %I',r.tbl,r.conname);
    execute format('alter table %s add constraint %I %s',r.tbl,r.conname,
      regexp_replace(definition,'REFERENCES (public\.)?clubs\(','REFERENCES public.organizations('));
  end loop;
end $$;

-- pg_get_constraintdef may qualify the table depending on search_path.
do $$ begin
  if exists(select 1 from pg_constraint where contype='f' and confrelid='public.clubs'::regclass) then
    raise exception 'Legacy club foreign key cutover incomplete';
  end if;
end $$;

alter table public.organization_members
  add column is_performance boolean not null default false,
  add column player_consent_status text check(player_consent_status in ('pending','granted','refused','adult')),
  add column can_manage_assigned_groups boolean not null default false,
  add column can_manage_assigned_group_planning boolean not null default false,
  add column can_transfer_players_between_club_groups boolean not null default false,
  add column coach_training_assistance_enabled boolean not null default false;

insert into public.organization_members(organization_id,user_id,role,is_active,is_performance,
  player_consent_status,can_manage_assigned_groups,can_manage_assigned_group_planning,
  can_transfer_players_between_club_groups,coach_training_assistance_enabled)
select club_id,user_id,role::text,coalesce(is_active,false),is_performance,player_consent_status,
  can_manage_assigned_groups,can_manage_assigned_group_planning,
  can_transfer_players_between_club_groups,coach_training_assistance_enabled from public.club_members
on conflict(organization_id,user_id,role) do update set is_active=excluded.is_active,
  is_performance=excluded.is_performance,player_consent_status=excluded.player_consent_status,
  can_manage_assigned_groups=excluded.can_manage_assigned_groups,
  can_manage_assigned_group_planning=excluded.can_manage_assigned_group_planning,
  can_transfer_players_between_club_groups=excluded.can_transfer_players_between_club_groups,
  coach_training_assistance_enabled=excluded.coach_training_assistance_enabled;

create function public.sync_organization_members_compatibility() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; begin
  if current_setting('activitee.sync_members',true)='on' then return coalesce(new,old); end if;
  perform set_config('activitee.sync_members','on',true);
  r:=coalesce(new,old);
  if tg_table_name='club_members' then
    if tg_op='DELETE' then
      delete from public.organization_members where organization_id=old.club_id and user_id=old.user_id and role=old.role::text;
    else
      if tg_op='UPDATE' and (new.club_id,new.user_id,new.role) is distinct from (old.club_id,old.user_id,old.role) then
        raise exception 'Membership identity is immutable';
      end if;
      insert into public.organization_members(organization_id,user_id,role,is_active,is_performance,player_consent_status,
        can_manage_assigned_groups,can_manage_assigned_group_planning,can_transfer_players_between_club_groups,coach_training_assistance_enabled)
      values(new.club_id,new.user_id,new.role::text,coalesce(new.is_active,false),new.is_performance,new.player_consent_status,
        new.can_manage_assigned_groups,new.can_manage_assigned_group_planning,new.can_transfer_players_between_club_groups,new.coach_training_assistance_enabled)
      on conflict(organization_id,user_id,role) do update set is_active=excluded.is_active,
        is_performance=excluded.is_performance,player_consent_status=excluded.player_consent_status,
        can_manage_assigned_groups=excluded.can_manage_assigned_groups,
        can_manage_assigned_group_planning=excluded.can_manage_assigned_group_planning,
        can_transfer_players_between_club_groups=excluded.can_transfer_players_between_club_groups,
        coach_training_assistance_enabled=excluded.coach_training_assistance_enabled;
    end if;
  elsif r.role in ('manager','coach','player','parent') then
    if tg_op='DELETE' then
      delete from public.club_members where club_id=old.organization_id and user_id=old.user_id and role::text=old.role;
    else
      if exists(select 1 from public.app_admins where user_id=new.user_id) then raise exception 'Superadmin cannot be an organization member'; end if;
      if tg_op='UPDATE' and (new.organization_id,new.user_id,new.role) is distinct from (old.organization_id,old.user_id,old.role) then
        raise exception 'Membership identity is immutable';
      end if;
      insert into public.club_members(club_id,user_id,role,is_active,is_performance,player_consent_status,
        can_manage_assigned_groups,can_manage_assigned_group_planning,can_transfer_players_between_club_groups,coach_training_assistance_enabled)
      values(new.organization_id,new.user_id,new.role::public.club_role,new.is_active,new.is_performance,new.player_consent_status,
        new.can_manage_assigned_groups,new.can_manage_assigned_group_planning,new.can_transfer_players_between_club_groups,new.coach_training_assistance_enabled)
      on conflict(club_id,user_id,role) do update set is_active=excluded.is_active,
        is_performance=excluded.is_performance,player_consent_status=excluded.player_consent_status,
        can_manage_assigned_groups=excluded.can_manage_assigned_groups,
        can_manage_assigned_group_planning=excluded.can_manage_assigned_group_planning,
        can_transfer_players_between_club_groups=excluded.can_transfer_players_between_club_groups,
        coach_training_assistance_enabled=excluded.coach_training_assistance_enabled;
    end if;
  end if;
  perform set_config('activitee.sync_members','off',true);
  return coalesce(new,old);
end $$;
create trigger organization_member_compatibility after insert or update or delete on public.organization_members
for each row execute function public.sync_organization_members_compatibility();
create trigger club_member_compatibility after insert or update or delete on public.club_members
for each row execute function public.sync_organization_members_compatibility();
revoke all on function public.sync_organization_members_compatibility() from public,anon,authenticated;

-- Canonical identities; academies and federations never produce a clubs row.
delete from public.clubs c using public.organizations o where c.id=o.id and o.org_type<>'club';
create function public.sync_organization_club_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if tg_op='UPDATE' and new.org_type<>old.org_type and (
    exists(select 1 from public.organization_members where organization_id=old.id)
    or exists(select 1 from public.legal_documents where club_id=old.id)
    or exists(select 1 from public.coach_groups where club_id=old.id)) then
    raise exception 'Organization type with members or evidence requires a dedicated migration';
  end if;
  if new.org_type='club' then
    insert into public.clubs(id,name,slug) values(new.id,new.name,new.slug)
    on conflict(id) do update set name=excluded.name,slug=excluded.slug;
  else delete from public.clubs where id=new.id; end if;
  return new;
end $$;
create trigger organization_club_identity after insert or update on public.organizations
for each row execute function public.sync_organization_club_identity();
revoke all on function public.sync_organization_club_identity() from public,anon,authenticated;

create function public.organization_is_manager(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id
    where o.id=p_org and o.is_active and m.user_id=p_actor and m.is_active and m.role in ('owner','admin','manager'));
$$;
create function public.organization_require_actor(p_actor uuid,p_org uuid default null,p_admin_only boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if auth.role() is distinct from 'service_role' or p_actor is null then raise exception 'Forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.app_admins where user_id=p_actor) then return; end if;
  if p_admin_only or not public.organization_is_manager(p_org,p_actor) then raise exception 'Forbidden' using errcode='42501'; end if;
end $$;
revoke all on function public.organization_require_actor(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.organization_require_actor(uuid,uuid,boolean) to service_role;
revoke all on function public.organization_is_manager(uuid,uuid) from public,anon;
grant execute on function public.organization_is_manager(uuid,uuid) to authenticated,service_role;

create function public.create_organization_checked(p_actor uuid,p_name text,p_slug text,p_type text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare id uuid; begin
  perform public.organization_require_actor(p_actor,null,true);
  if p_type not in ('club','academy','federation') or length(btrim(p_name))<2 or length(p_name)>160
    or p_slug !~ '^[a-z0-9][a-z0-9-]{1,99}$' then raise exception 'Invalid organization'; end if;
  insert into public.organizations(name,slug,org_type,country_code,region_code)
    values(btrim(p_name),p_slug,p_type,'CH',null) returning organizations.id into id;
  return id;
end $$;
revoke all on function public.create_organization_checked(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_organization_checked(uuid,text,text,text) to service_role;
commit;
