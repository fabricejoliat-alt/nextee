-- Read-only, after applying the migration to isolated TEST.
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'legal_%' order by tablename;
select table_name, privilege_type, grantee from information_schema.role_table_grants
  where table_schema='public' and table_name like 'legal_%' and grantee in ('anon','authenticated','service_role')
  order by table_name, grantee, privilege_type;
select proname, proacl from pg_proc join pg_namespace n on n.oid=pg_proc.pronamespace
  where n.nspname='public' and proname in ('publish_legal_draft','present_legal_document','decide_legal_document','legal_actor_allowed');
select tgrelid::regclass as evidence_table, tgname from pg_trigger
  where tgrelid in ('public.legal_versions'::regclass,'public.legal_presentations'::regclass,'public.legal_decisions'::regclass)
  and not tgisinternal order by 1,2;
select count(*) as newly_active_documents from public.legal_documents where active;
select count(*) as legacy_refs from public.legal_legacy_references;
select count(*) as original_legacy_rows from public.player_consent_history;
select count(*) as legacy_current_refs from public.legal_legacy_current_refs;
select count(*) as original_current_rows from public.player_consents;
-- Estimate only when a reviewed document has been activated; never infer acceptance from legacy statuses.
select d.document_key, count(distinct m.user_id) as potentially_affected_active_members
from public.legal_documents d join public.club_members m on m.is_active and m.role::text=any(d.audience_roles)
  and (d.scope='platform' or m.club_id=d.club_id)
where d.active group by d.document_key order by d.document_key;
