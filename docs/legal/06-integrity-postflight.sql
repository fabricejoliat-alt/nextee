-- Read-only postflight after 20261021_legal_decision_integrity.sql on isolated TEST.
select current_database() as database_name,
  to_regclass('public.legal_conflict_resolutions') as resolutions_table,
  to_regclass('public.legal_representative_events') as representative_events_table,
  to_regprocedure('public.create_legal_document(text,text,text,text,uuid,text[],text,boolean,uuid)') as create_document_rpc,
  to_regprocedure('public.review_legal_representative(uuid,uuid,uuid,text,text,uuid)') as representative_review_rpc,
  to_regprocedure('public.resolve_legal_withdrawal_conflict(uuid,uuid,uuid,uuid,text)') as resolution_rpc,
  to_regprocedure('public.issue_legal_parent_challenge(uuid,uuid,text,text)') as challenge_rpc,
  to_regprocedure('public.legal_version_matches_document(uuid,uuid)') as metadata_rpc,
  to_regprocedure('public.present_legal_document(uuid,uuid,uuid,text,text)') as presentation_rpc,
  to_regprocedure('public.decide_legal_document(uuid,uuid,text,uuid,text)') as decision_rpc;
select tablename,rowsecurity from pg_tables where schemaname='public'
  and tablename in ('legal_conflict_resolutions','legal_representative_events') order by tablename;
select tgrelid::regclass as evidence_table,tgname from pg_trigger where tgrelid in
  ('public.legal_conflict_resolutions'::regclass,'public.legal_representative_events'::regclass)
  and not tgisinternal order by 1,2;
select count(*) as active_legal_documents from public.legal_documents where active;
select count(*) as unresolved_withdrawals from public.legal_current_state where conflict;
