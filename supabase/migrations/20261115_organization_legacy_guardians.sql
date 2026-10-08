begin;
insert into public.organization_migration_baseline(object_key,definition)
select 'function:'||p.oid::regprocedure,pg_get_functiondef(p.oid) from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='remove_manager_parent_v1'
on conflict do nothing;

create or replace function public.remove_manager_parent_v1(p_actor_id uuid,p_club_id uuid,p_member_id uuid,
  p_expected_player_ids uuid[],p_expected_shared_player_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare parent uuid; players uuid[]; shared uuid[]; affected integer; begin
  perform public.organization_require_actor(p_actor_id,p_club_id);
  select user_id into parent from public.club_members where id=p_member_id and club_id=p_club_id and role='parent' for update;
  if not found then raise exception 'parent_not_found'; end if;
  if public.is_app_admin(parent) then raise exception 'protected_account' using errcode='42501'; end if;
  perform 1 from public.player_guardian_scopes where organization_id=p_club_id and guardian_user_id=parent for update;
  select coalesce(array_agg(s.player_id order by s.player_id),'{}'::uuid[]) into players
    from public.player_guardian_scopes s where s.organization_id=p_club_id and s.guardian_user_id=parent
      and s.status in ('pending','active') and s.can_view;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into shared from unnest(players) id
    where exists(select 1 from public.organization_members m where m.user_id=id and m.role='player' and m.organization_id<>p_club_id);
  if p_expected_player_ids is null or p_expected_shared_player_ids is null
    or players<>array(select distinct id from unnest(p_expected_player_ids) id order by id)
    or shared<>array(select distinct id from unnest(p_expected_shared_player_ids) id order by id)
    then raise exception 'parent_links_changed' using errcode='40001'; end if;
  perform set_config('activitee.actor_id',p_actor_id::text,true);
  update public.player_guardian_scopes set status='ended',can_view=false,can_edit=false,ended_at=now(),updated_at=now()
    where organization_id=p_club_id and guardian_user_id=parent and status<>'ended';
  get diagnostics affected=row_count;
  update public.player_periodic_report_configs set recipient_user_ids=array_remove(recipient_user_ids,parent),updated_at=now()
    where club_id=p_club_id and parent=any(recipient_user_ids);
  update public.access_invitation_tokens set consumed_at=now() where club_id=p_club_id and consumed_at is null
    and invitation_kind in ('parent_access','junior_access') and (user_id=parent or recipient_user_id=parent);
  delete from public.club_members where id=p_member_id and club_id=p_club_id and role='parent';
  return jsonb_build_object('ok',true,'removed_links',affected,'preserved_shared_links',cardinality(shared));
end $$;

create function public.attach_academy_guardian_checked(p_actor uuid,p_entry uuid,p_guardian uuid,p_relation text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ declare r public.academy_roster_entries%rowtype; begin
  select * into r from public.academy_roster_entries where id=p_entry for update;
  if not found or r.status='ended' then raise exception 'Roster unavailable'; end if;
  perform public.organization_require_actor(p_actor,r.academy_id);
  if p_guardian=r.player_id or p_relation not in ('mother','father','legal_guardian','other') then raise exception 'Invalid guardian'; end if;
  perform 1 from public.organization_identity_matches where organization_id=r.academy_id and player_id=p_guardian
    and subject_role='parent' and status in ('approved','used') for update;
  if not found then raise exception 'Human parent identity confirmation required' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where id=p_guardian and birth_date>current_date-interval '18 years') then raise exception 'Adult guardian required'; end if;
  perform set_config('activitee.actor_id',p_actor::text,true);
  insert into public.player_guardians(player_id,guardian_user_id,relation,can_view,can_edit)
    values(r.player_id,p_guardian,p_relation,true,true) on conflict do nothing;
  insert into public.organization_members(organization_id,user_id,role) values(r.academy_id,p_guardian,'parent') on conflict do nothing;
  insert into public.player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit,created_by)
    values(r.academy_id,r.player_id,p_guardian,'pending',true,true,p_actor) on conflict do nothing;
  update public.organization_identity_matches set status='used' where organization_id=r.academy_id and player_id=p_guardian and subject_role='parent';
end $$;
revoke all on function public.attach_academy_guardian_checked(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.attach_academy_guardian_checked(uuid,uuid,uuid,text) to service_role;
commit;
