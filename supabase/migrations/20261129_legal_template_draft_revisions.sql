begin;

-- A new document starts its own revision history, independently of the catalog.
create or replace function public.create_club_legal_drafts_from_templates(p_club uuid,p_actor uuid) returns uuid[]
language plpgsql security definer set search_path=public,pg_temp as $$
declare template public.legal_organization_templates%rowtype; doc uuid; result uuid[]:='{}'; begin
  perform public.organization_require_actor(p_actor,null,true);
  if not exists(select 1 from public.organizations where id=p_club and org_type in ('club','academy')) then raise exception 'Club or academy required'; end if;
  perform 1 from public.organizations where id=p_club for update;
  if (select count(*) from public.legal_organization_templates)<>3 then raise exception 'Three organization templates required'; end if;
  if exists(select 1 from public.legal_documents where club_id=p_club and purpose_key in (select purpose_key from public.legal_organization_templates))
    then raise exception 'Organization documents already exist'; end if;
  for template in select * from public.legal_organization_templates order by purpose_key loop
    insert into public.legal_documents(document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active,required_locales,created_by)
      values('activitee_'||regexp_replace(template.purpose_key,'[^a-z0-9]+','_','g')||'_'||replace(p_club::text,'-',''),
        template.kind,template.purpose_key,'organization',p_club,template.audience_roles,template.action_kind,template.required,false,template.required_locales,p_actor)
      returning id into doc;
    insert into public.legal_drafts(document_id,change_summary,allowed_variables,translations,updated_by)
      values(doc,'Organization model: human review of all four languages, audience and account-origin wording required before publication.',template.allowed_variables,
          (select jsonb_object_agg(locale,
            (translation - 'approved_by' - 'approved_at') ||
            jsonb_build_object('status','needs_review','source_revision',1))
           from jsonb_each(template.translations) t(locale,translation)),p_actor);
    result:=array_append(result,doc);
  end loop;
  return result;
end $$;

-- Only pristine, inactive, unpublished drafts copied from the current catalog.
-- Keep all text unchanged and require a human approval for every language.
update public.legal_drafts dr set
  translations=(select jsonb_object_agg(locale,translation || jsonb_build_object('source_revision',dr.source_revision))
    from jsonb_each(dr.translations) t(locale,translation)),
  updated_at=now()
from public.legal_documents d, public.legal_organization_templates template
where d.id=dr.document_id and d.scope='organization' and not d.active
  and d.purpose_key=template.purpose_key and dr.source_revision=1
  and dr.translations=template.translations
  and not exists(select 1 from public.legal_versions v where v.document_id=d.id)
  and exists(select 1 from jsonb_each(dr.translations) t
    where t.value->>'source_revision' is distinct from dr.source_revision::text)
  and not exists(select 1 from jsonb_each(dr.translations) t
    where t.value->>'status' is distinct from 'needs_review'
      or t.value ? 'approved_by' or t.value ? 'approved_at');

commit;
