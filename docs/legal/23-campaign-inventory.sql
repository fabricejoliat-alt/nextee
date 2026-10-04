-- Read-only campaign snapshot. Run only on TEST wizbeuuvjibmmuxyynly.
-- No row contents from profiles, auth.users, messages or business tables.
with inventory as (
 select 'environment'::text category,'TEST'::text item,jsonb_build_object(
  'database',current_database(),'user',current_user,'at',now(),
  'sql_enabled',(select enabled from public.legal_enforcement_control where singleton),
  'active_documents',(select count(*) from public.legal_documents where active),
  'versions',(select count(*) from public.legal_versions),
  'decisions',(select count(*) from public.legal_decisions)) details
 union all
 select 'relation',c.relname,jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,
  'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
  'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
  'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
  'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
  'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid)) from pg_constraint k where k.conrelid=c.oid),
  'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'cmd',p.polcmd,
    'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)))
    from pg_policy p where p.polrelid=c.oid),
  'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) and c.relkind in ('r','p','v')
 union all
 select 'function',p.oid::regprocedure::text,jsonb_build_object('definer',p.prosecdef,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
 union all
 select 'bucket',id,jsonb_build_object('public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)
 from storage.buckets
)
select category,item,details from inventory order by category,item;
