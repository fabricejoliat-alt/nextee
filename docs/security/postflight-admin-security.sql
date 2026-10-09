-- Read-only. Run after the transaction, then complete a real Admin MFA login.
select current_database() as database, current_user as executor;
select r.rolname, s.setdatabase, setting
from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting
where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
select n.nspname,c.relname,c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='admin_security_events';
select schemaname,tablename,policyname,permissive,roles,cmd
from pg_policies where policyname like 'application_%gate' or policyname like 'admin_bootstrap_%'
order by schemaname,tablename,policyname;
select has_function_privilege('authenticated','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute') as ordinary_can_append,
  has_function_privilege('service_role','public.record_admin_security_event(uuid,uuid,text,text,text,integer)','execute') as server_can_append,
  has_table_privilege('service_role','public.admin_security_events','delete') as server_can_delete,
  has_table_privilege('service_role','public.admin_security_events','update') as server_can_rewrite;
-- Expected: false / true / false / false.
select (select count(*) from public.app_admins) as admins,
  (select count(*) from public.organizations) as organizations,
  (select count(*) from public.legal_versions) as legal_versions;

-- After a real reversible Admin change, the same request_id must have
-- 'started' and 'succeeded' events. No request body or password is stored.
select occurred_at,actor_id,request_id,action,target_id,phase,http_status
from public.admin_security_events order by occurred_at desc limit 20;
