-- Manager family mutations: authenticate the actor, scope the target, then write atomically.
-- Deploy before the API changes. No destructive fallback is permitted when these RPCs are absent.
begin;

create or replace function public.require_manager_player_scope_v1(p_actor_id uuid, p_club_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.club_members
    where user_id = p_actor_id and club_id = p_club_id and role = 'manager' and is_active = true for share;
  if not found then
    perform 1 from public.app_admins where user_id = p_actor_id for share;
    if not found then raise exception using errcode = '42501', message = 'manager_forbidden'; end if;
  end if;
  -- The profile lock serializes global family-link/consent changes across clubs.
  perform 1 from public.profiles where id = p_player_id for update;
  perform 1 from public.club_members
    where club_id = p_club_id and user_id = p_player_id and role = 'player' and is_active = true for share;
  if not found then raise exception using errcode = 'P0002', message = 'player_not_found'; end if;
end;
$$;

create or replace function public.manage_player_guardian_v1(
  p_actor_id uuid, p_club_id uuid, p_player_id uuid, p_guardian_id uuid,
  p_action text, p_relation text default 'other', p_is_primary boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_manager_player_scope_v1(p_actor_id, p_club_id, p_player_id);
  if p_action = 'delete' then
    delete from public.player_guardians where player_id = p_player_id and guardian_user_id = p_guardian_id;
    -- Revoked links must not remain scheduled recipients, including other clubs.
    update public.player_periodic_report_configs
      set recipient_user_ids = array_remove(recipient_user_ids, p_guardian_id), updated_at = now()
      where player_user_id = p_player_id and p_guardian_id = any(recipient_user_ids);
  elsif p_action = 'upsert' then
    if p_guardian_id = p_player_id or p_relation not in ('mother', 'father', 'legal_guardian', 'other') then
      raise exception using errcode = '22023', message = 'invalid_guardian';
    end if;
    perform 1 from public.club_members where user_id = p_guardian_id and club_id = p_club_id
      and role = 'parent' and is_active = true for share;
    if not found then raise exception using errcode = 'P0002', message = 'guardian_not_found'; end if;
    if p_is_primary then
      update public.player_guardians set is_primary = false where player_id = p_player_id;
    end if;
    insert into public.player_guardians (player_id, guardian_user_id, relation, is_primary, can_view, can_edit)
      values (p_player_id, p_guardian_id, p_relation, p_is_primary, true, true)
      on conflict (player_id, guardian_user_id) do update set
        relation = excluded.relation, is_primary = excluded.is_primary, can_view = true, can_edit = true;
  else
    raise exception using errcode = '22023', message = 'invalid_action';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_manager_player_consent_v1(
  p_actor_id uuid, p_club_id uuid, p_player_id uuid, p_values jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status text := p_values->>'status';
  v_source text := coalesce(nullif(p_values->>'source', ''), 'manager');
  v_signer uuid := nullif(p_values->>'signer_guardian_user_id', '')::uuid;
  v_decided_at timestamptz;
  v_consent public.player_consents%rowtype;
begin
  perform public.require_manager_player_scope_v1(p_actor_id, p_club_id, p_player_id);
  if v_status is null or v_status not in ('pending', 'granted', 'refused', 'adult')
    or v_source not in ('manager', 'import') then
    raise exception using errcode = '22023', message = 'invalid_consent';
  end if;
  if v_signer is not null then
    perform 1 from public.player_guardians
      where player_id = p_player_id and guardian_user_id = v_signer and can_view = true for share;
    if not found then raise exception using errcode = '42501', message = 'invalid_signer'; end if;
  end if;
  v_decided_at := case when v_status = 'pending' then null
    else coalesce(nullif(p_values->>'decided_at', '')::timestamptz, now()) end;
  -- Preserve the existing global consent-status synchronization after checking the target.
  update public.club_members set player_consent_status = v_status
    where user_id = p_player_id and role = 'player' and is_active = true;
  insert into public.player_consents (club_id, player_user_id, status, decided_at, signer_guardian_user_id,
    signer_name, source, consent_version, internal_notes, updated_by, updated_at)
  values (p_club_id, p_player_id, v_status, v_decided_at, v_signer,
    nullif(trim(p_values->>'signer_name'), ''), v_source, nullif(trim(p_values->>'consent_version'), ''),
    nullif(trim(p_values->>'internal_notes'), ''), p_actor_id, now())
  on conflict (club_id, player_user_id) do update set status = excluded.status, decided_at = excluded.decided_at,
    signer_guardian_user_id = excluded.signer_guardian_user_id, signer_name = excluded.signer_name,
    source = excluded.source, consent_version = excluded.consent_version, internal_notes = excluded.internal_notes,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_consent;
  insert into public.player_consent_history (club_id, player_user_id, status, decided_at,
    signer_guardian_user_id, signer_name, source, consent_version, internal_notes, changed_by)
  values (p_club_id, p_player_id, v_status, v_decided_at, v_signer, v_consent.signer_name, v_source,
    v_consent.consent_version, v_consent.internal_notes, p_actor_id);
  return jsonb_build_object('ok', true, 'consent', to_jsonb(v_consent), 'history', (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.changed_at desc), '[]'::jsonb)
    from (select * from public.player_consent_history where club_id = p_club_id and player_user_id = p_player_id
      order by changed_at desc limit 100) h));
end;
$$;

revoke all on function public.require_manager_player_scope_v1(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.manage_player_guardian_v1(uuid, uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.save_manager_player_consent_v1(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.manage_player_guardian_v1(uuid, uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.save_manager_player_consent_v1(uuid, uuid, uuid, jsonb) to service_role;
commit;
