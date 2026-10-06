-- READ ONLY. Run on Supabase TEST wizbeuuvjibmmuxyynly after 20261105.
select 'control_still_disabled' item,
  (select enabled=false from public.legal_enforcement_control where singleton) ok
union all select 'inactive_constraint_removed',
  not exists(select 1 from pg_constraint where conrelid='public.legal_enforcement_control'::regclass
    and conname='legal_enforcement_control_inactive')
union all select 'no_active_document',
  not exists(select 1 from public.legal_documents where active)
union all select 'audience_rpc_service_only',
  to_regprocedure('public.configure_legal_audience(uuid,jsonb,uuid)') is not null
  and not has_function_privilege('authenticated','public.configure_legal_audience(uuid,jsonb,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.configure_legal_audience(uuid,jsonb,uuid)','EXECUTE')
union all select 'activation_rpc_service_only',
  to_regprocedure('public.set_legal_activation(text,uuid,boolean,boolean,uuid,uuid)') is not null
  and not has_function_privilege('authenticated','public.set_legal_activation(text,uuid,boolean,boolean,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.set_legal_activation(text,uuid,boolean,boolean,uuid,uuid)','EXECUTE')
union all select 'audit_table_private',
  (select relrowsecurity from pg_class where oid='public.legal_activation_events'::regclass)
  and not has_table_privilege('authenticated','public.legal_activation_events','SELECT')
order by item;

select target,document_id,previous_enabled,enabled,actor_id,created_at
from public.legal_activation_events order by created_at desc limit 10;
