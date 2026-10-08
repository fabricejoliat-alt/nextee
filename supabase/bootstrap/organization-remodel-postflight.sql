begin read only;
do $$ begin
  if exists(select 1 from public.clubs c join public.organizations o on o.id=c.id where o.org_type<>'club')
    or exists(select 1 from pg_constraint where contype='f' and confrelid='public.clubs'::regclass)
    or exists(select 1 from public.organization_members m full join public.club_members c
      on c.club_id=m.organization_id and c.user_id=m.user_id and c.role::text=m.role
      where coalesce(m.role,c.role::text) in ('manager','coach','player','parent') and
        (m.organization_id is null or c.id is null or m.is_active is distinct from coalesce(c.is_active,false)
          or m.player_consent_status is distinct from c.player_consent_status))
    or exists(select 1 from public.academy_roster_entries r where r.status='active'
      and not public.organization_player_authorized(r.academy_id,r.player_id))
    or exists(select 1 from public.player_guardian_scopes s left join public.player_guardians g
      on g.player_id=s.player_id and g.guardian_user_id=s.guardian_user_id where g.player_id is null)
    or exists(select 1 from public.training_sessions s left join public.club_events e on e.id=s.club_event_id
      where (s.session_type='club' and s.club_id is null) or
        (s.club_event_id is not null and (e.id is null or s.club_id is distinct from e.club_id)))
    or exists(select 1 from public.player_validation_attempts where organization_id is not null) then
    raise exception 'Organization postflight failed; transaction must be rolled back';
  end if;
end $$;
select 'nonclub_clubs' as check_name,count(*) as violations from public.clubs c join public.organizations o on o.id=c.id where o.org_type<>'club'
union all select 'legacy_club_foreign_keys',count(*) from pg_constraint where contype='f' and confrelid='public.clubs'::regclass
union all select 'projection_mismatches',count(*) from public.organization_members m full join public.club_members c
  on c.club_id=m.organization_id and c.user_id=m.user_id and c.role::text=m.role
  where coalesce(m.role,c.role::text) in ('manager','coach','player','parent') and
    (m.organization_id is null or c.id is null or m.is_active is distinct from coalesce(c.is_active,false)
      or m.player_consent_status is distinct from c.player_consent_status)
union all select 'active_rosters_without_authorization',count(*) from public.academy_roster_entries r
  where r.status='active' and not public.organization_player_authorized(r.academy_id,r.player_id)
union all select 'guardian_scopes_without_family_identity',count(*) from public.player_guardian_scopes s
  left join public.player_guardians g on g.player_id=s.player_id and g.guardian_user_id=s.guardian_user_id where g.player_id is null;
select 'versions' as evidence,count(*) as rows,encode(extensions.digest(coalesce(string_agg(id::text||content_sha256,'' order by id),''),'sha256'),'hex') as fingerprint from public.legal_versions
union all select 'presentations',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_presentations
union all select 'decisions',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_decisions;
select 'personal_trainings' as history_type,count(*) as records from public.training_sessions where club_id is null
union all select 'personal_rounds',count(*) from public.golf_rounds where club_id is null
union all select 'personal_activities',count(*) from public.player_activity_events where organization_id is null
union all select 'personal_camps',count(*) from public.player_camps where organization_id is null
union all select 'player_validations',count(*) from public.player_validation_attempts where organization_id is null;
select count(*) as organization_templates from public.legal_organization_templates;
select count(*) as ftem_defaults from public.training_volume_default_targets;
select count(*) as organizations from public.organizations;
select role,count(*) from public.organization_members group by role order by role;
select count(*) as nonadmin_profiles from public.profiles p where not exists(select 1 from public.app_admins a where a.user_id=p.id);
rollback;
