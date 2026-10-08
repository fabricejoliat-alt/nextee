begin;
-- No ambiguous historical ownership is inferred from a name or affiliation.
alter table public.player_activity_events add column organization_id uuid references public.organizations(id) on delete restrict;
alter table public.player_camps add column organization_id uuid references public.organizations(id) on delete restrict;
insert into public.organization_migration_baseline(object_key,definition)
select 'sports_owner:'||'training_sessions',coalesce(jsonb_object_agg(id,club_id),'{}'::jsonb)::text from public.training_sessions
union all select 'sports_owner:golf_rounds',coalesce(jsonb_object_agg(id,club_id),'{}'::jsonb)::text from public.golf_rounds;
do $$ declare r record; missing boolean; begin
  for r in select unnest(array['training_sessions','golf_rounds','player_activity_events','player_camps']) tbl loop
    execute format('update public.%I t set %I=(select min(m.organization_id::text)::uuid from public.organization_members m where m.user_id=t.user_id and m.role=''player'' and m.is_active having count(*)=1) where %I is null',
      r.tbl,case when r.tbl in ('training_sessions','golf_rounds') then 'club_id' else 'organization_id' end,
      case when r.tbl in ('training_sessions','golf_rounds') then 'club_id' else 'organization_id' end);
    execute format('select exists(select 1 from public.%I where %I is null)',r.tbl,
      case when r.tbl in ('training_sessions','golf_rounds') then 'club_id' else 'organization_id' end) into missing;
    if missing then raise exception 'Historical sports ownership requires human review before migration'; end if;
  end loop;
end $$;

create function public.organization_sports_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid; selected uuid; linked uuid; member_count integer; begin
  if tg_table_name in ('training_sessions','golf_rounds') then owner:=new.club_id; else owner:=new.organization_id; end if;
  if tg_op='UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Sports player is immutable' using errcode='42501'; end if;
    if tg_table_name in ('training_sessions','golf_rounds') then linked:=old.club_id; else linked:=old.organization_id; end if;
    if owner is distinct from linked then raise exception 'Sports organization is immutable' using errcode='42501'; end if;
  end if;
  if tg_table_name='training_sessions' then
   if new.club_event_id is not null then
    select club_id into linked from public.club_events where id=new.club_event_id;
    if linked is null or (owner is not null and owner<>linked) then raise exception 'Sports event ownership mismatch' using errcode='42501'; end if;
    owner:=linked;
   end if;
  end if;
  selected:=nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-activitee-organization','')::uuid;
  if owner is null then owner:=selected; end if;
  if owner is null then
    select count(*),min(organization_id::text)::uuid into member_count,owner from public.organization_members
      where user_id=new.user_id and role='player' and is_active;
    if member_count<>1 then raise exception 'Choose the owning organization' using errcode='42501'; end if;
  end if;
  if not exists(select 1 from public.organization_members where organization_id=owner and user_id=new.user_id and role='player' and is_active)
    then raise exception 'Sports player outside organization' using errcode='42501'; end if;
  if auth.role()='authenticated' and (not public.organization_actor_access(owner,auth.uid(),new.user_id,true)
    or not public.organization_actor_legal_ready(owner,auth.uid())) then raise exception 'Sports access forbidden' using errcode='42501'; end if;
  if tg_table_name in ('training_sessions','golf_rounds') then new.club_id:=owner; else new.organization_id:=owner; end if;
  return new;
end $$;
revoke all on function public.organization_sports_owner() from public,anon,authenticated;

do $$ declare tbl text; owner text; begin
  foreach tbl in array array['training_sessions','golf_rounds','player_activity_events','player_camps'] loop
    owner:=case when tbl in ('training_sessions','golf_rounds') then 'club_id' else 'organization_id' end;
    execute format('alter table public.%I alter column %I set not null',tbl,owner);
    execute format('create trigger organization_sports_owner before insert or update on public.%I for each row execute function public.organization_sports_owner()',tbl);
    if tbl in ('player_activity_events','player_camps') then
      execute format('create policy organization_scope_guard on public.%I as restrictive for all to authenticated using(public.organization_actor_access(organization_id,auth.uid(),user_id)) with check(public.organization_actor_access(organization_id,auth.uid(),user_id,true))',tbl);
    end if;
  end loop;
end $$;
-- The browser context restricts all rows having a direct organization owner.
create function public.organization_view_scope(p_org uuid) returns boolean
language sql stable set search_path=public,pg_temp as $$
  select coalesce(nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-activitee-organization','')::uuid=p_org,true);
$$;
revoke all on function public.organization_view_scope(uuid) from public,anon;
grant execute on function public.organization_view_scope(uuid) to authenticated,service_role;
do $$ declare r record; owner text; begin
  for r in select distinct table_name from information_schema.columns c join pg_class t on t.relname=c.table_name
    join pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
    where c.table_schema='public' and t.relkind='r' and t.relrowsecurity and c.column_name in ('club_id','organization_id')
      and c.table_name not like 'legal_%' and c.table_name not in ('club_members','organization_members','organization_settings',
        'organization_relationships','organization_identity_matches','organization_audit_events','player_guardian_scopes','academy_roster_entries') loop
    owner:=case when exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.table_name and column_name='club_id') then 'club_id' else 'organization_id' end;
    execute format('create policy organization_view_scope on public.%I as restrictive for all to authenticated using(public.organization_view_scope(%I)) with check(public.organization_view_scope(%I))',r.table_name,owner,owner);
  end loop;
end $$;
create policy organization_parent_round_id on public.golf_round_holes as restrictive for all to authenticated
using(exists(select 1 from public.golf_rounds r where r.id=round_id and public.organization_actor_access(r.club_id,auth.uid(),r.user_id)))
with check(exists(select 1 from public.golf_rounds r where r.id=round_id and public.organization_actor_access(r.club_id,auth.uid(),r.user_id,true)));
create policy organization_parent_camp_id on public.player_camp_days as restrictive for all to authenticated
using(exists(select 1 from public.player_camps c where c.id=camp_id and public.organization_actor_access(c.organization_id,auth.uid(),c.user_id)))
with check(exists(select 1 from public.player_camps c where c.id=camp_id and public.organization_actor_access(c.organization_id,auth.uid(),c.user_id,true)));
commit;
