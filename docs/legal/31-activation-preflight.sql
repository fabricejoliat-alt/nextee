-- READ ONLY. Run on Supabase TEST wizbeuuvjibmmuxyynly before 20261105.
select 'control_disabled' item,
  (select enabled=false from public.legal_enforcement_control where singleton) ok
union all select 'inactive_constraint_present',
  exists(select 1 from pg_constraint where conrelid='public.legal_enforcement_control'::regclass
    and conname='legal_enforcement_control_inactive')
union all select 'no_active_document',
  not exists(select 1 from public.legal_documents where active)
union all select 'publication_rpc_present',
  to_regprocedure('public.publish_legal_draft_checked(uuid,uuid,jsonb)') is not null
union all select 'version_match_rpc_present',
  to_regprocedure('public.legal_version_matches_document(uuid,uuid)') is not null
union all select 'coverage_gate_present',
  to_regprocedure('public.legal_required_direct_access(uuid)') is not null
order by item;

select document_key,kind,scope,club_id,required,active,
  applicability->>'status' as audience_status,
  (select max(version_number) from public.legal_versions where document_id=d.id) as latest_version
from public.legal_documents d where document_key like 'activitee_%'
order by document_key;
