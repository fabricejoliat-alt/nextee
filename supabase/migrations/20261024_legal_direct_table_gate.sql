-- Apply after 20261023. This first direct-table gate is OFF by default.
-- Do not enable it until RPC, Storage, parent/child and offline paths are covered and tested.
begin;

create table public.legal_enforcement_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false constraint legal_enforcement_control_inactive check (enabled=false),
  updated_at timestamptz not null default now()
);
insert into public.legal_enforcement_control(singleton,enabled) values(true,false);
alter table public.legal_enforcement_control enable row level security;
revoke all on public.legal_enforcement_control from public,anon,authenticated;
grant select,update on public.legal_enforcement_control to service_role;

-- The policy's caller is identified only by its JWT. A service-role call bypasses RLS.
-- A null club checks platform documents only; a club also checks that club's documents.
create function public.legal_required_direct_access(p_club uuid default null)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
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
            and v.version_number=(select max(version_number) from public.legal_versions where document_id=d.id)
        )
      )
  );
end $$;
revoke all on function public.legal_required_direct_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_direct_access(uuid) to anon,authenticated,service_role;

-- Resolve parent rows as the definer so a caller cannot turn an RLS-filtered
-- parent lookup into a null club and skip a club-specific legal document.
create function public.legal_required_event_access(p_event uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
  select enabled into enabled_now from public.legal_enforcement_control where singleton=true;
  if not found then return false; end if;
  if not enabled_now then return true; end if;
  if p_event is null then return public.legal_required_direct_access(null); end if;
  select e.club_id into club from public.club_events e where e.id=p_event;
  if not found or club is null then return false; end if;
  return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_event_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_event_access(uuid) to anon,authenticated,service_role;

create function public.legal_required_group_access(p_group uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare club uuid; enabled_now boolean;
begin
  select enabled into enabled_now from public.legal_enforcement_control where singleton=true;
  if not found then return false; end if;
  if not enabled_now then return true; end if;
  select g.club_id into club from public.coach_groups g where g.id=p_group;
  if not found or club is null then return false; end if;
  return public.legal_required_direct_access(club);
end $$;
revoke all on function public.legal_required_group_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_group_access(uuid) to anon,authenticated,service_role;

create function public.legal_required_session_access(p_session uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare event_id uuid; enabled_now boolean;
begin
  select enabled into enabled_now from public.legal_enforcement_control where singleton=true;
  if not found then return false; end if;
  if not enabled_now then return true; end if;
  select s.club_event_id into event_id from public.training_sessions s where s.id=p_session;
  if not found then return false; end if;
  return public.legal_required_event_access(event_id);
end $$;
revoke all on function public.legal_required_session_access(uuid) from public,anon,authenticated;
grant execute on function public.legal_required_session_access(uuid) to anon,authenticated,service_role;

-- Existing permissive business policies still decide who may see or change a row.
-- This additional restrictive policy can only remove access after the SQL switch is enabled.
create policy legal_required_direct_access on public.club_events as restrictive for all to anon,authenticated
  using(public.legal_required_direct_access(club_id))
  with check(public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.club_event_attendees as restrictive for all to anon,authenticated
  using(public.legal_required_event_access(event_id))
  with check(public.legal_required_event_access(event_id));
create policy legal_required_direct_access on public.coach_groups as restrictive for all to anon,authenticated
  using(public.legal_required_direct_access(club_id))
  with check(public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.coach_group_players as restrictive for all to anon,authenticated
  using(public.legal_required_group_access(group_id))
  with check(public.legal_required_group_access(group_id));
create policy legal_required_direct_access on public.marketplace_items as restrictive for all to anon,authenticated
  using(public.legal_required_direct_access(club_id))
  with check(public.legal_required_direct_access(club_id));
create policy legal_required_direct_access on public.training_sessions as restrictive for all to anon,authenticated
  using(public.legal_required_event_access(club_event_id))
  with check(public.legal_required_event_access(club_event_id));
create policy legal_required_direct_access on public.training_session_items as restrictive for all to anon,authenticated
  using(public.legal_required_session_access(session_id))
  with check(public.legal_required_session_access(session_id));
create policy legal_required_direct_access on public.golf_rounds as restrictive for all to anon,authenticated
  using(public.legal_required_direct_access())
  with check(public.legal_required_direct_access());
create policy legal_required_direct_access on public.golf_round_holes as restrictive for all to anon,authenticated
  using(public.legal_required_direct_access())
  with check(public.legal_required_direct_access());

commit;
