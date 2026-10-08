-- Read-only. Run on the target and retain output before considering migration.
begin read only;
select current_database() as database,current_setting('server_version') as postgres_version;
select org_type,count(*) from public.organizations group by org_type order by org_type;
select count(*) as orphan_legacy_clubs from public.clubs c left join public.organizations o on o.id=c.id where o.id is null;
select count(*) as nonclub_legacy_rows from public.clubs c join public.organizations o on o.id=c.id where o.org_type<>'club';
select role,count(*) from public.organization_members group by role order by role;
select count(*) as guardian_identity_links from public.player_guardians;
select 'versions' as evidence,count(*) as rows,encode(extensions.digest(coalesce(string_agg(id::text||content_sha256,'' order by id),''),'sha256'),'hex') as fingerprint from public.legal_versions
union all select 'presentations',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_presentations
union all select 'decisions',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_decisions;
select to_regclass('public.legal_club_templates') is not null as legal_templates_available,
  to_regclass('public.training_volume_default_targets') is not null as ftem_available;
-- Existing columns with two owner identifiers must agree. No silent reassignment.
do $$ declare t record; mismatches bigint; begin
  for t in select table_name from information_schema.columns where table_schema='public' and column_name='club_id'
    and table_name in (select table_name from information_schema.columns where table_schema='public' and column_name='organization_id') loop
    execute format('select count(*) from public.%I where club_id is not null and organization_id is not null and club_id<>organization_id',t.table_name) into mismatches;
    if mismatches<>0 then raise exception 'Conflicting owners in %: %',t.table_name,mismatches; end if;
  end loop;
end $$;
-- A null organization denotes personal history. Only an actual club/event
-- training with missing or conflicting ownership blocks this migration.
do $$ begin
  if exists(select 1 from public.training_sessions s left join public.club_events e on e.id=s.club_event_id
    where (s.session_type='club' and s.club_id is null and s.club_event_id is null)
      or (s.club_event_id is not null and (e.id is null or s.club_id is distinct from e.club_id))) then
    raise exception 'Club/event training ownership requires review';
  end if;
end $$;
rollback;
