-- Read-only TEST preflight for 20261104_legal_shared_draft_text.sql.
select current_database() as database_name,
  (select enabled from public.legal_enforcement_control limit 1) as enforcement_enabled,
  (select count(*) from public.legal_documents where active) as active_documents,
  (select count(*) from public.legal_documents where document_key ~ '^activitee_') as activitee_documents,
  (select count(*) from public.legal_versions v join public.legal_documents d on d.id=v.document_id
    where d.document_key ~ '^activitee_') as activitee_versions;

select d.purpose_key, count(*) as club_documents, count(distinct d.club_id) as distinct_clubs,
  count(distinct d.kind) as kinds, count(distinct dr.source_revision) as revisions,
  count(distinct dr.allowed_variables) as variable_sets,
  count(distinct jsonb_build_object('title',dr.translations->'fr'->>'title',
    'body',dr.translations->'fr'->>'body','action_label',dr.translations->'fr'->>'action_label')) as french_texts
from public.legal_documents d join public.legal_drafts dr on dr.document_id=d.id
where d.scope='club' and d.document_key ~ '^activitee_'
  and d.purpose_key in ('service.parent_authorization','coaching.rewrite','coaching.ai')
group by d.purpose_key order by d.purpose_key;

select to_regprocedure('public.save_legal_draft_text_checked(jsonb,text,text,text,text,text,uuid)')
  as existing_save_function,
  to_regprocedure('public.approve_legal_draft_translation_checked(uuid,text,jsonb,uuid)')
  as existing_approval_function;
