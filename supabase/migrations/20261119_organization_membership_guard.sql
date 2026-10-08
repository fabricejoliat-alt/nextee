begin;
insert into public.organization_migration_baseline(object_key,definition)
select 'membership_privileges',coalesce(jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type)),'[]'::jsonb)::text
from information_schema.role_table_grants where table_schema='public' and grantee in ('authenticated','anon')
  and table_name in ('organizations','organization_members','club_members','organization_settings','player_guardians')
  and privilege_type in ('INSERT','UPDATE','DELETE');
-- Administrative membership mutations must include an actor and expected state.
revoke insert,update,delete on public.organizations,public.organization_members,public.club_members,
  public.organization_settings,public.player_guardians from authenticated,anon;
create function public.set_organization_manager_checked(p_actor uuid,p_org uuid,p_member uuid,p_action text,p_expected_active boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.club_members%rowtype; begin
  perform public.organization_require_actor(p_actor,null,true);
  select * into m from public.club_members where id=p_member and club_id=p_org and role='manager' for update;
  if not found then raise exception 'Manager unavailable'; end if;
  if coalesce(m.is_active,false) is distinct from p_expected_active then raise exception 'Membership changed' using errcode='40001'; end if;
  perform set_config('activitee.actor_id',p_actor::text,true);
  if p_action='remove' then delete from public.club_members where id=m.id;
  elsif p_action in ('activate','suspend') then update public.club_members set is_active=(p_action='activate') where id=m.id;
  else raise exception 'Invalid membership action'; end if;
  insert into public.organization_audit_events(organization_id,object_type,object_id,actor_id,action,previous_state,next_state)
    values(p_org,'organization_members',m.id::text,p_actor,p_action,to_jsonb(m),jsonb_build_object('active',p_action='activate'));
end $$;
revoke all on function public.set_organization_manager_checked(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.set_organization_manager_checked(uuid,uuid,uuid,text,boolean) to service_role;

create function public.organization_membership_roster_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.role='player' and exists(select 1 from public.organizations where id=new.organization_id and org_type='academy')
    and not exists(select 1 from public.academy_roster_entries where academy_id=new.organization_id and player_id=new.user_id) then
    raise exception 'Academy players require the reviewed roster workflow' using errcode='42501';
  end if;
  return new;
end $$;
create trigger organization_membership_roster before insert on public.organization_members
for each row execute function public.organization_membership_roster_guard();
revoke all on function public.organization_membership_roster_guard() from public,anon,authenticated;
create policy organization_member_visibility on public.club_members as restrictive for select to authenticated
using(user_id=auth.uid() or role<>'player' or public.organization_actor_access(club_id,auth.uid(),user_id)
  or public.organization_guardian_allowed(auth.uid(),user_id,club_id,false,true));
create policy organization_member_visibility on public.organization_members as restrictive for select to authenticated
using(user_id=auth.uid() or role<>'player' or public.organization_actor_access(organization_id,auth.uid(),user_id)
  or public.organization_guardian_allowed(auth.uid(),user_id,organization_id,false,true));
commit;
