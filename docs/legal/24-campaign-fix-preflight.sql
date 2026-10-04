-- READ ONLY. TEST wizbeuuvjibmmuxyynly; export ALL rows. No activation.
-- Postflight is structural evidence only; business proof is in campaign-report-2026-10-04.md.
with functions as (
 select p.oid,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
 'publish_legal_draft','present_legal_document','decide_legal_document','issue_legal_parent_challenge',
 'recompute_golf_round_stats','sync_org_player_performance_from_groups','ensure_event_thread_for_event',
 'sync_event_thread_participants','pick_event_thread_actor_user_id',
 'copy_manager_event_structure_v1_business','remove_manager_parent_v1','save_manager_camp_v1',
 'update_manager_event_occurrence_v1_business','update_manager_event_series_v1_business')
)
select 'control' as category,'environment' as item,jsonb_build_object('enabled',enabled,
 'active_documents',(select count(*) from public.legal_documents where active),
 'pgcrypto_schema',(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'),
 'digest_exists',to_regprocedure('extensions.digest(text,text)') is not null) as evidence
from public.legal_enforcement_control where singleton
union all
select 'function',signature,jsonb_build_object('definition_md5',md5(definition),
 'anon_execute',has_function_privilege('anon',oid,'execute'),
 'authenticated_execute',has_function_privilege('authenticated',oid,'execute'),
 'service_execute',has_function_privilege('service_role',oid,'execute'),
 'qualified_digest',definition like '%extensions.digest(%',
 'retry_code_present',definition like '%40001%','http_conflict_present',definition like '%PT409%') from functions
union all
select 'policy',policyname,jsonb_build_object('permissive',permissive,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check)
from pg_policies where schemaname='public' and tablename='marketplace_items'
order by category,item;
