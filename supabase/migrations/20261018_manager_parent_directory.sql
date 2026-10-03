-- Remove only a club's parent membership, with an explicit family-link preview.
-- Account, profiles, other roles/clubs and shared family links remain intact.
begin;

create or replace function public.remove_manager_parent_v1(
  p_actor_id uuid, p_club_id uuid, p_member_id uuid,
  p_expected_player_ids uuid[], p_expected_shared_player_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_parent_id uuid;
  v_players uuid[];
  v_shared uuid[];
  v_removed integer;
  v_admin boolean;
begin
  select exists(select 1 from public.app_admins where user_id = p_actor_id) into v_admin;
  perform 1 from public.club_members where club_id = p_club_id and user_id = p_actor_id
    and role = 'manager' and is_active = true for share;
  if not found and not v_admin then
    raise exception using errcode = '42501', message = 'manager_forbidden';
  end if;
  select user_id into v_parent_id from public.club_members
    where id = p_member_id and club_id = p_club_id and role = 'parent';
  if not found then raise exception using errcode = 'P0002', message = 'parent_not_found'; end if;
  if not v_admin and exists(select 1 from public.app_admins where user_id = v_parent_id) then
    raise exception using errcode = '42501', message = 'protected_account';
  end if;

  -- Same lock order as manage_player_guardian_v1: junior profiles, then parent membership.
  perform 1 from public.profiles p where exists (
    select 1 from public.player_guardians g where g.guardian_user_id = v_parent_id and g.player_id = p.id
  ) order by p.id for update;
  perform 1 from public.club_members where id = p_member_id and role = 'parent' and club_id = p_club_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'parent_not_found'; end if;
  perform 1 from public.club_members m where m.role = 'player' and exists (
    select 1 from public.player_guardians g where g.guardian_user_id = v_parent_id and g.player_id = m.user_id
  ) for share;

  select coalesce(array_agg(g.player_id order by g.player_id), '{}'::uuid[]) into v_players
    from public.player_guardians g where g.guardian_user_id = v_parent_id and exists (
      select 1 from public.club_members m where m.user_id = g.player_id and m.club_id = p_club_id and m.role = 'player'
    );
  select coalesce(array_agg(selected.player_id order by selected.player_id), '{}'::uuid[]) into v_shared
    from unnest(v_players) as selected(player_id)
    where exists(select 1 from public.club_members m where m.user_id = selected.player_id and m.role = 'player' and m.club_id <> p_club_id);
  if p_expected_player_ids is null or p_expected_shared_player_ids is null
    or v_players <> array(select distinct id from unnest(p_expected_player_ids) id order by id)
    or v_shared <> array(select distinct id from unnest(p_expected_shared_player_ids) id order by id) then
    raise exception using errcode = '40001', message = 'parent_links_changed';
  end if;

  delete from public.player_guardians where guardian_user_id = v_parent_id
    and player_id = any(v_players) and not (player_id = any(v_shared));
  get diagnostics v_removed = row_count;
  update public.player_periodic_report_configs
    set recipient_user_ids = array_remove(recipient_user_ids, v_parent_id), updated_at = now()
    where v_parent_id = any(recipient_user_ids) and (club_id = p_club_id
      or (player_user_id = any(v_players) and not (player_user_id = any(v_shared))));
  -- Keep delivery history, but prevent unused links issued by this club from being redeemed.
  update public.access_invitation_tokens set consumed_at = now()
    where club_id = p_club_id and consumed_at is null
      and invitation_kind in ('parent_access', 'junior_access')
      and (user_id = v_parent_id or recipient_user_id = v_parent_id);
  delete from public.club_members where id = p_member_id and club_id = p_club_id and role = 'parent';
  return jsonb_build_object('ok', true, 'removed_links', v_removed, 'preserved_shared_links', cardinality(v_shared));
end;
$$;
revoke all on function public.remove_manager_parent_v1(uuid,uuid,uuid,uuid[],uuid[]) from public, anon, authenticated;
grant execute on function public.remove_manager_parent_v1(uuid,uuid,uuid,uuid[],uuid[]) to service_role;
commit;
