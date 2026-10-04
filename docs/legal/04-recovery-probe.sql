-- Read-only probe on the same target database after ERROR 42883.
select current_database() as database_name,
  to_regclass('public.legal_documents') as legal_documents,
  to_regclass('public.legal_presentations') as legal_presentations,
  to_regclass('public.legal_decisions') as legal_decisions,
  to_regprocedure('public.legal_actor_allowed(uuid,uuid,uuid,text)') as actor_function,
  to_regprocedure('public.present_legal_document(uuid,uuid,uuid,text,text)') as presentation_function,
  to_regprocedure('public.decide_legal_document(uuid,uuid,text,uuid,text)') as decision_function;
