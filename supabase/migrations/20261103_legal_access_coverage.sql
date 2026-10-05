-- One coherent coverage repair batch. Target TEST wizbeuuvjibmmuxyynly.
-- Read 26 preflight, 27 postflight and campaign report section 11.
-- Keeps the control constrained to false; no data publication or backfill.
begin;
do $$ begin
 if (select enabled from public.legal_enforcement_control where singleton) is distinct from false then raise exception 'Legal enforcement must remain disabled'; end if;
 if exists(select 1 from public.legal_documents where active) then raise exception 'Expected zero active documents'; end if;
 if md5(pg_get_functiondef(to_regprocedure('public.legal_required_direct_access(uuid)'))) is distinct from '155b5f5c5d5d0762ed85245b0d23a1b4' then raise exception 'Definition drift: legal_required_direct_access(uuid)'; end if;
 if md5(pg_get_functiondef(to_regprocedure('public.staff_seed_group_players_attendees(uuid)'))) is distinct from 'a0615e63c6c97c8c5286591186e3d2e7' then raise exception 'Definition drift: staff_seed_group_players_attendees(uuid)'; end if;
 if md5(pg_get_functiondef(to_regprocedure('public.create_player_golf_rounds_transactional(uuid,jsonb,timestamp with time zone[],jsonb)'))) is distinct from '199fd7e14679c1927194288a71636f18' then raise exception 'Definition drift: create_player_golf_rounds_transactional(uuid,jsonb,timestamp with time zone[],jsonb)'; end if;
end $$;

-- An old decision cannot validate changed, unpublished metadata.
CREATE OR REPLACE FUNCTION public.legal_required_direct_access(p_club uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare gate_enabled boolean; actor uuid := auth.uid();
begin
  select enabled into gate_enabled from public.legal_enforcement_control where singleton=true;
  if not found then return false; end if;
  if not gate_enabled then return true; end if;
  if actor is null then return false; end if;

  return not exists (
    select 1 from public.legal_documents d
    where d.active and d.required and d.kind in ('terms','privacy','junior_notice')
      and (d.scope='platform' or (p_club is not null and d.scope='club' and d.club_id=p_club))
      and exists (
        select 1 from unnest(d.audience_roles) as role_name(role_value)
        where (role_name.role_value='admin' and d.scope='platform'
          and exists(select 1 from public.app_admins a where a.user_id=actor))
          or exists(select 1 from public.club_members m where m.user_id=actor and m.is_active
            and m.role::text=role_name.role_value
            and (d.scope='platform' or m.club_id=d.club_id))
      )
      and (
        d.applicability->>'rule' is distinct from 'all_members'
        or not exists (
          select 1 from public.legal_versions v
          join public.legal_current_state s on s.document_id=d.id and s.beneficiary_id=actor
            and s.scope_key=coalesce(d.club_id::text,'platform') and s.version_id=v.id
            and s.conflict=false
            and s.decision=case d.action_kind
              when 'accept' then 'accepted'
              when 'acknowledge' then 'acknowledged'
              when 'read' then 'acknowledged'
              else null end
          where v.document_id=d.id
            and public.legal_version_matches_document(d.id,v.id)
            and v.version_number=(select max(version_number) from public.legal_versions where document_id=d.id)
        )
      )
  );
end $function$
;

-- Resolve the parent outside caller RLS; a missing parent fails closed when ON.
create function public.legal_required_club_training_access(p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
 select enabled into enabled_now from public.legal_enforcement_control where singleton;
 if not found then return false; end if;
 if not enabled_now then return true; end if;
 select club_id into club from public.club_trainings where id=p_id;
 if not found or club is null then return false; end if;
 return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_club_training_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_club_training_access(uuid) to anon,authenticated,service_role;

-- Resolve the parent outside caller RLS; a missing parent fails closed when ON.
create function public.legal_required_thread_access(p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
 select enabled into enabled_now from public.legal_enforcement_control where singleton;
 if not found then return false; end if;
 if not enabled_now then return true; end if;
 select organization_id into club from public.message_threads where id=p_id;
 if not found or club is null then return false; end if;
 return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_thread_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_thread_access(uuid) to anon,authenticated,service_role;

-- Resolve the parent outside caller RLS; a missing parent fails closed when ON.
create function public.legal_required_round_access(p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
 select enabled into enabled_now from public.legal_enforcement_control where singleton;
 if not found then return false; end if;
 if not enabled_now then return true; end if;
 select om_organization_id into club from public.golf_rounds where id=p_id;
 if not found then return false; end if;
 return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_round_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_round_access(uuid) to anon,authenticated,service_role;

-- Resolve the parent outside caller RLS; a missing parent fails closed when ON.
create function public.legal_required_contest_access(p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
 select enabled into enabled_now from public.legal_enforcement_control where singleton;
 if not found then return false; end if;
 if not enabled_now then return true; end if;
 select organization_id into club from public.om_internal_contests where id=p_id;
 if not found or club is null then return false; end if;
 return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_contest_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_contest_access(uuid) to anon,authenticated,service_role;

-- Restrictive AND conditions never confer a business permission. Existing role
-- and guardian predicates remain authoritative. No guard is added to bootstrap
-- identity tables, legal recovery routes, public catalogs or Storage here.
create policy legal_required_direct_access on public.club_evaluation_criteria as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_event_series as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_news as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_seasons as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_trainings as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.coach_player_group_transfers as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.coach_players as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.player_periodic_reports as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.player_periodic_report_deliveries as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.rules_club_participations as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.rules_quiz_attempts as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.rules_rewards as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.platform_news_clubs as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(club_id)) with check (public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_event_coaches as restrictive for all to anon,authenticated
 using (public.legal_required_event_access(event_id)) with check (public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.club_event_evaluation_criteria as restrictive for all to anon,authenticated
 using (public.legal_required_event_access(event_id)) with check (public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.club_event_evaluation_responses as restrictive for all to anon,authenticated
 using (public.legal_required_event_access(event_id)) with check (public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.club_event_player_structure_items as restrictive for all to anon,authenticated
 using (public.legal_required_event_access(event_id)) with check (public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.club_event_structure_items as restrictive for all to anon,authenticated
 using (public.legal_required_event_access(event_id)) with check (public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.coach_group_coaches as restrictive for all to anon,authenticated
 using (public.legal_required_group_access(group_id)) with check (public.legal_required_group_access(group_id));
create policy legal_required_direct_access on public.coach_group_categories as restrictive for all to anon,authenticated
 using (public.legal_required_group_access(group_id)) with check (public.legal_required_group_access(group_id));
create policy legal_required_direct_access on public.rules_coach_coverage as restrictive for all to anon,authenticated
 using (public.legal_required_group_access(group_id)) with check (public.legal_required_group_access(group_id));
create policy legal_required_direct_access on public.message_threads as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.player_dashboard_documents as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.thread_messages as restrictive for all to anon,authenticated
 using (public.legal_required_thread_access(thread_id)) with check (public.legal_required_thread_access(thread_id));
create policy legal_required_direct_access on public.thread_participants as restrictive for all to anon,authenticated
 using (public.legal_required_thread_access(thread_id)) with check (public.legal_required_thread_access(thread_id));
create policy legal_required_direct_access on public.player_activity_events as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access()) with check (public.legal_required_direct_access());
create policy legal_required_direct_access on public.player_handicap_history as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access()) with check (public.legal_required_direct_access());
create policy legal_required_direct_access on public.rules_card_progress as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access()) with check (public.legal_required_direct_access());
create policy legal_required_direct_access on public.om_bonus_entries as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.om_exceptional_tournaments as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.om_internal_contests as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.om_tournament_scores as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(organization_id)) with check (public.legal_required_direct_access(organization_id));
create policy legal_required_direct_access on public.om_internal_contest_results as restrictive for all to anon,authenticated
 using (public.legal_required_contest_access(contest_id)) with check (public.legal_required_contest_access(contest_id));
drop policy legal_required_direct_access on public.golf_rounds;
create policy legal_required_direct_access on public.golf_rounds as restrictive for all to anon,authenticated
 using (public.legal_required_direct_access(om_organization_id)) with check (public.legal_required_direct_access(om_organization_id));
drop policy legal_required_direct_access on public.golf_round_holes;
create policy legal_required_direct_access on public.golf_round_holes as restrictive for all to anon,authenticated
 using (public.legal_required_round_access(round_id)) with check (public.legal_required_round_access(round_id));
create policy legal_required_direct_access on public.club_training_attendance as restrictive for all to anon,authenticated
 using (public.legal_required_club_training_access(training_id)) with check (public.legal_required_club_training_access(training_id));
create policy legal_required_direct_access on public.club_training_coach_evals as restrictive for all to anon,authenticated
 using (public.legal_required_club_training_access(training_id)) with check (public.legal_required_club_training_access(training_id));

-- Legacy RPC: preserve the original membership-in-group check, but require an
-- active staff membership too; the former coach branches skipped that check.
CREATE OR REPLACE FUNCTION public.staff_seed_group_players_attendees(p_event_id uuid)
 RETURNS TABLE(player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group_id uuid;
  v_allowed boolean;
begin
  if public.legal_required_event_access(p_event_id) is not true then
    raise exception 'Legal validation required';
  end if;
  if not exists (
    select 1 from public.club_events e
    join public.coach_groups g on g.id=e.group_id and g.club_id=e.club_id
    join public.club_members m on m.club_id=e.club_id and m.user_id=auth.uid()
      and m.is_active and m.role in ('coach','manager')
    where e.id=p_event_id
  ) then raise exception 'forbidden'; end if;
  select e.group_id
  into v_group_id
  from public.club_events e
  where e.id = p_event_id;

  if v_group_id is null then
    raise exception 'event_not_found';
  end if;

  select exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = v_group_id
      and (
        g.head_coach_user_id = auth.uid()
        or cgc.coach_user_id is not null
        or cm.user_id is not null
      )
  )
  into v_allowed;

  if coalesce(v_allowed, false) = false then
    raise exception 'forbidden';
  end if;

  insert into public.club_event_attendees (event_id, player_id, status)
  select p_event_id, gp.player_user_id, 'present'
  from public.coach_group_players gp
  where gp.group_id = v_group_id
    and not exists (
      select 1
      from public.club_event_attendees a
      where a.event_id = p_event_id
        and a.player_id = gp.player_user_id
    );

  return query
  select a.player_id
  from public.club_event_attendees a
  where a.event_id = p_event_id;
end;
$function$
;
revoke all on function public.staff_seed_group_players_attendees(uuid) from public,anon,authenticated;
grant execute on function public.staff_seed_group_players_attendees(uuid) to authenticated,service_role;

-- Creation must use the same OM club as subsequent update/save RPCs.
CREATE OR REPLACE FUNCTION public.create_player_golf_rounds_transactional(p_player_id uuid, p_round_payload jsonb, p_round_dates timestamp with time zone[], p_holes jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.legal_required_direct_access(nullif(p_round_payload->>'om_organization_id','')::uuid) is not true then raise exception 'Legal validation required'; end if;
  return public.create_player_golf_rounds_transactional_business(p_player_id,p_round_payload,p_round_dates,p_holes);
end $function$
;
notify pgrst, 'reload schema';
commit;
