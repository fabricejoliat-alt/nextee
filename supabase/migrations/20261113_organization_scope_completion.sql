begin;
create function public.organization_actor_legal_ready(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.legal_documents d where d.active and d.required
    and d.kind in ('terms','privacy','junior_notice') and (d.scope='platform' or d.club_id=p_org)
    and exists(select 1 from public.organization_members m where m.user_id=p_actor and m.is_active and m.role=any(d.audience_roles)
      and (d.scope='platform' or m.organization_id=d.club_id))
    and (d.applicability->>'rule' is distinct from 'all_members' or not exists(
      select 1 from public.legal_current_state s join public.legal_versions v on v.id=s.version_id
      where s.document_id=d.id and s.beneficiary_id=p_actor and s.club_scope is not distinct from d.club_id and not s.conflict
        and s.decision=case d.action_kind when 'accept' then 'accepted' when 'read' then 'acknowledged' when 'acknowledge' then 'acknowledged' end
        and v.version_number=(select max(version_number) from public.legal_versions where document_id=d.id)
        and public.legal_version_matches_document(d.id,v.id))));
$$;
create function public.organization_access_summary_checked(p_actor uuid,p_player uuid default null)
returns table(organization_id uuid,name text,org_type text,player_id uuid,accessible boolean,reason text)
language plpgsql stable security definer set search_path=public,pg_temp as $$ begin
  if auth.role() is distinct from 'service_role' or p_actor is null then raise exception 'Forbidden' using errcode='42501'; end if;
  return query select distinct o.id,o.name,o.org_type,m.user_id,
    public.organization_actor_access(o.id,p_actor,case when m.role='player' then m.user_id else null end) and public.organization_actor_legal_ready(o.id,p_actor),
    case when not public.organization_actor_legal_ready(o.id,p_actor) then 'legal_required'
      when not public.organization_actor_access(o.id,p_actor,case when m.role='player' then m.user_id else null end) then 'authorization_required' else null end
    from public.organizations o join public.organization_members m on m.organization_id=o.id and m.is_active
    where (p_player is null or m.user_id=p_player) and
      ((m.user_id=p_actor and m.role in ('player','coach','manager','owner','admin')) or
       (m.role='player' and public.organization_guardian_allowed(p_actor,m.user_id,o.id,false,true)))
    order by o.name,o.id,m.user_id;
end $$;
revoke all on function public.organization_access_summary_checked(uuid,uuid) from public,anon,authenticated;
grant execute on function public.organization_access_summary_checked(uuid,uuid) to service_role;
revoke all on function public.organization_actor_legal_ready(uuid,uuid) from public,anon;
grant execute on function public.organization_actor_legal_ready(uuid,uuid) to authenticated,service_role;

-- Child rows inherit the owner of their group/event/session/thread/camp.
do $$ declare r record; subject text; expr text; begin
  for r in select c.conrelid::regclass as child,c.confrelid::regclass as parent,a.attname as link,b.attname as pk,
      owner.attname as owner from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
    join pg_attribute owner on owner.attrelid=c.confrelid and owner.attname in ('club_id','organization_id') and not owner.attisdropped
    join pg_class child on child.oid=c.conrelid join pg_namespace n on n.oid=child.relnamespace
    where c.contype='f' and cardinality(c.conkey)=1 and n.nspname='public' and child.relrowsecurity
      and a.attname in ('group_id','event_id','camp_id','session_id','thread_id','report_id','delivery_id','club_member_id')
      and c.confrelid in ('public.coach_groups'::regclass,'public.club_events'::regclass,'public.club_camps'::regclass,
        'public.training_sessions'::regclass,'public.message_threads'::regclass,'public.player_periodic_reports'::regclass,
        'public.player_periodic_report_deliveries'::regclass,'public.club_members'::regclass)
  loop
    select attname into subject from pg_attribute where attrelid=r.child and attname in ('player_id','player_user_id') and not attisdropped limit 1;
    expr:=format('exists(select 1 from %s owner_row where owner_row.%I=%s.%I and (owner_row.%I is null or public.organization_actor_access(owner_row.%I,auth.uid(),%s)))',
      r.parent,r.pk,r.child,r.link,r.owner,r.owner,case when subject is null then 'null' else format('%s.%I',r.child,subject) end);
    if not exists(select 1 from pg_policy where polrelid=r.child and polname='organization_parent_'||r.link) then
      execute format('create policy %I on %s as restrictive for all to authenticated using (%s) with check (%s)',
        'organization_parent_'||r.link,r.child,expr,expr);
    end if;
  end loop;
end $$;

-- All organization business reads also require that actor's current documents.
do $$ declare r record; expr text; begin
  for r in select table_name,column_name from information_schema.columns where table_schema='public'
    and column_name in ('club_id','organization_id') and table_name in
      ('coach_groups','club_events','club_camps','club_news','message_threads','player_dashboard_documents',
       'coach_player_private_notes','coach_training_debriefs','player_periodic_reports','player_periodic_report_deliveries') loop
    expr:=format('(%I is null or public.organization_actor_legal_ready(%I,auth.uid()))',r.column_name,r.column_name);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      'organization_legal_'||r.column_name,r.table_name,expr,expr);
  end loop;
end $$;

-- The existing FTEM seed now runs for clubs, academies and federations.
do $$ begin
  if to_regprocedure('public.seed_new_club_training_volume()') is not null then
    execute 'drop trigger if exists seed_new_club_training_volume on public.clubs';
    execute 'create trigger seed_new_organization_training_volume after insert on public.organizations for each row execute function public.seed_new_club_training_volume()';
  end if;
end $$;
commit;
