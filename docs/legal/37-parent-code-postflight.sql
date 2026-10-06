-- READ ONLY. Supabase TEST wizbeuuvjibmmuxyynly, after 20261108 and TEST toggle.
select 'control_row_present' item,exists(select 1 from public.legal_parent_code_control where singleton) ok
union all select 'test_code_temporarily_disabled',exists(select 1 from public.legal_parent_code_control where singleton and not required)
union all select 'control_rls_on',exists(select 1 from pg_class where oid='public.legal_parent_code_control'::regclass and relrowsecurity)
union all select 'client_read_denied',not has_table_privilege('authenticated','public.legal_parent_code_control','select')
  and not has_table_privilege('anon','public.legal_parent_code_control','select')
union all select 'client_write_denied',not has_table_privilege('authenticated','public.legal_parent_code_control','update')
  and not has_table_privilege('anon','public.legal_parent_code_control','update')
union all select 'service_read_allowed',has_table_privilege('service_role','public.legal_parent_code_control','select')
union all select 'waiver_scoped_to_parent_access',position('service.parent_authorization' in
  pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure))>0
union all select 'waiver_recorded_in_evidence',position('temporarily_waived' in
  pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure))>0
union all select 'verified_email_still_required',position('Verified parent email required' in
  pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure))>0
union all select 'challenge_rpc_still_present',to_regprocedure('public.issue_legal_parent_challenge(uuid,uuid,text,text)') is not null
order by item;
