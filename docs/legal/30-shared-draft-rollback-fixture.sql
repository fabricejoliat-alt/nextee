-- TEST only: transactional fixture proving the two service-only text RPCs.
-- The fixture and all edits disappear at ROLLBACK. No publication or decision.
begin;
do $$
declare
  actor_id uuid;
  fixture_id uuid;
  original_translations jsonb;
  saved jsonb;
  german jsonb;
begin
  select user_id into actor_id from public.app_admins order by user_id limit 1;
  if actor_id is null then raise exception 'No TEST platform admin'; end if;
  if exists(select 1 from public.legal_documents where document_key='legalqa_draft_save_20261006')
    then raise exception 'Fixture key already exists'; end if;
  insert into public.legal_documents(document_key,kind,purpose_key,scope,audience_roles,action_kind,created_by)
  values('legalqa_draft_save_20261006','terms','legalqa.draft_save','platform',array['admin'],'accept',actor_id)
  returning id into fixture_id;
  original_translations:=jsonb_build_object('fr',jsonb_build_object(
    'title','Texte fictif','body','Contenu fictif','action_label','Continuer',
    'status','needs_review','source_revision',1));
  insert into public.legal_drafts(document_id,translations,updated_by)
  values(fixture_id,original_translations,actor_id);

  saved:=public.save_legal_draft_text_checked(
    jsonb_build_object(fixture_id::text,jsonb_build_object('source_revision',1,'translations',original_translations)),
    null,'de','Fiktive Übersetzung',repeat('Fiktiver Testtext. ',1600),'Weiter',actor_id);
  if saved->>(fixture_id::text) <> '1' then raise exception 'Draft revision mismatch'; end if;
  select translations->'de' into german from public.legal_drafts where document_id=fixture_id;
  if german->>'status'<>'needs_review' or length(german->>'body')<20000
    then raise exception 'Long translation save failed'; end if;
  if not public.approve_legal_draft_translation_checked(fixture_id,'de',german,actor_id)
    then raise exception 'Translation approval failed'; end if;
  select translations->'de' into german from public.legal_drafts where document_id=fixture_id;
  if german->>'status'<>'approved' or german->>'approved_by'<>actor_id::text
    then raise exception 'Approval readback failed'; end if;
end $$;
rollback;

select count(*)=0 as fixture_absent_after_rollback
from public.legal_documents where document_key='legalqa_draft_save_20261006';
