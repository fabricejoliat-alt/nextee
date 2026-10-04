-- TEST-ONLY on an isolated database after the migration. Transaction rolls back fixtures.
begin;
do $$
declare doc uuid; v uuid; reviewed uuid:=gen_random_uuid(); failed boolean:=false;
begin
  insert into public.legal_documents(document_key,kind,purpose_key,scope,audience_roles,action_kind)
  values('fixture-terms-'||replace(gen_random_uuid()::text,'-',''),'terms','fixture','platform',array['player'],'accept')
  returning id into doc;
  perform public.review_legal_applicability(doc,reviewed,
    '{"status":"approved","rule":"all_members","jurisdiction":"fixture-only"}'::jsonb,
    'Fixture only, no real legal approval or activation');
  insert into public.legal_drafts(document_id,source_revision,change_summary,translations)
  values(doc,1,'Fixture initial version',
    jsonb_build_object(
      'fr',jsonb_build_object('title','Fixture FR','body','Texte fictif FR','action_label','Accepter','status','approved','source_revision',1),
      'en',jsonb_build_object('title','Fixture EN','body','Fictional EN','action_label','Accept','status','approved','source_revision',1),
      'de',jsonb_build_object('title','Fixture DE','body','Fiktiver DE','action_label','Akzeptieren','status','approved','source_revision',1),
      'it',jsonb_build_object('title','Fixture IT','body','Fittizio IT','action_label','Accettare','status','approved','source_revision',1)));
  v:=public.publish_legal_draft(doc,reviewed);
  if not exists(select 1 from public.legal_versions where id=v and snapshot->'translations'->'fr'->>'body'='Texte fictif FR') then
    raise exception 'Published snapshot missing';
  end if;
  begin
    update public.legal_versions set content_sha256='changed' where id=v;
  exception when others then failed:=true;
  end;
  if not failed then raise exception 'Version mutation was accepted'; end if;
  if exists(select 1 from public.legal_documents where id=doc and active) then raise exception 'Fixture unexpectedly active'; end if;
end $$;
rollback;
