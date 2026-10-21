-- Platform superadmins do not need personal document acknowledgements to operate.
-- Keep the legal gate for every other account and preserve existing decisions.
begin;

create or replace function public.legal_required_direct_access(p_club uuid default null)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare gate_enabled boolean; actor uuid := auth.uid();
begin
  select enabled into gate_enabled from public.legal_enforcement_control where singleton=true;
  if not found then return false; end if;
  if not gate_enabled then return true; end if;
  if actor is null then return false; end if;

  -- is_app_admin checks the authenticated identity and the existing MFA gate.
  -- This exempts only personal legal acknowledgements, never editorial approval.
  if public.is_app_admin(actor) then return true; end if;

  return not exists (
    select 1 from public.legal_documents d
    where d.active and d.required and d.kind in ('terms','privacy','junior_notice')
      and (d.scope='platform' or (p_club is not null and d.scope in ('club','organization') and d.club_id=p_club))
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
end $$;

-- CREATE OR REPLACE preserves the function's existing owner and execute grants.
commit;
