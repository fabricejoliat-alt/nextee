-- Atomic text save for one legal draft or all ActiviTee club drafts of one purpose.
-- Does not approve, publish, activate, or create a legal decision.
create function public.save_legal_draft_text_checked(
  p_expected jsonb, p_group_purpose text, p_locale text,
  p_title text, p_body text, p_action_label text, p_actor uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  row_item record;
  expected_count integer;
  touched integer := 0;
  original_revision integer;
  next_revision integer;
  changed jsonb;
  result jsonb := '{}'::jsonb;
  common_revision integer;
  common_kind text;
  common_action text;
  common_roles text[];
  common_required boolean;
  common_locales text[];
  common_variables text[];
  common_text jsonb;
  current_text jsonb;
begin
  if not exists(select 1 from public.app_admins where user_id=p_actor) then raise exception 'Platform admin required'; end if;
  if p_locale not in ('fr','en','de','it') or jsonb_typeof(p_expected) is distinct from 'object'
    or p_title is null or p_body is null or p_action_label is null then raise exception 'Invalid draft save'; end if;
  select count(*) into expected_count from jsonb_object_keys(p_expected);
  if expected_count < 1 or (p_group_purpose is null and expected_count <> 1)
    or (p_group_purpose is not null and p_group_purpose not in
      ('service.parent_authorization','coaching.rewrite','coaching.ai')) then raise exception 'Invalid draft group'; end if;

  for row_item in
    select d.id, d.kind, d.action_kind, d.audience_roles, d.required, d.required_locales,
      dr.source_revision, dr.translations, dr.allowed_variables
    from public.legal_documents d
    join public.legal_drafts dr on dr.document_id=d.id
    where (p_group_purpose is null and p_expected ? (d.id::text))
      or (p_group_purpose is not null and d.scope='club' and d.document_key ~ '^activitee_'
        and d.purpose_key=p_group_purpose)
    order by d.id
    for update of d,dr
  loop
    if not (p_expected ? (row_item.id::text))
      or jsonb_typeof(p_expected -> (row_item.id::text)) is distinct from 'object'
      or ((p_expected -> (row_item.id::text))->>'source_revision')::integer is distinct from row_item.source_revision
      or (p_expected -> (row_item.id::text))->'translations' is distinct from row_item.translations
    then raise exception 'Draft changed; reload'; end if;

    current_text := jsonb_build_object(
      'title',coalesce(row_item.translations->p_locale->>'title',''),
      'body',coalesce(row_item.translations->p_locale->>'body',''),
      'action_label',coalesce(row_item.translations->p_locale->>'action_label',''));
    if p_group_purpose is not null then
      if touched=0 then
        common_revision:=row_item.source_revision;
        common_kind:=row_item.kind; common_action:=row_item.action_kind;
        common_roles:=row_item.audience_roles; common_required:=row_item.required;
        common_locales:=row_item.required_locales; common_variables:=row_item.allowed_variables;
        common_text:=current_text;
      elsif row_item.source_revision is distinct from common_revision
        or row_item.kind is distinct from common_kind or row_item.action_kind is distinct from common_action
        or row_item.audience_roles is distinct from common_roles or row_item.required is distinct from common_required
        or row_item.required_locales is distinct from common_locales
        or row_item.allowed_variables is distinct from common_variables
        or current_text is distinct from common_text then raise exception 'Club drafts differ; review separately'; end if;
    end if;

    original_revision:=row_item.source_revision;
    next_revision:=original_revision + case when p_locale='fr' then 1 else 0 end;
    changed:=row_item.translations;
    if p_locale='fr' then
      select coalesce(jsonb_object_agg(key,value || jsonb_build_object('status','needs_review')),'{}'::jsonb)
      into changed from jsonb_each(changed);
    end if;
    changed:=jsonb_set(changed,array[p_locale],jsonb_build_object(
      'title',btrim(p_title),'body',btrim(p_body),'action_label',btrim(p_action_label),
      'status','needs_review','source_revision',next_revision),true);
    update public.legal_drafts set translations=changed,source_revision=next_revision,
      updated_by=p_actor,updated_at=now() where document_id=row_item.id;
    result:=result || jsonb_build_object(row_item.id::text,next_revision);
    touched:=touched+1;
  end loop;
  if touched <> expected_count then raise exception 'Draft group changed; reload'; end if;
  return result;
end $$;
revoke all on function public.save_legal_draft_text_checked(jsonb,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_legal_draft_text_checked(jsonb,text,text,text,text,text,uuid) to service_role;

-- Approve exactly the translation reviewed by the administrator, without a large URL filter.
create function public.approve_legal_draft_translation_checked(
  p_document uuid, p_locale text, p_expected jsonb, p_actor uuid
) returns boolean language plpgsql security definer set search_path=public as $$
declare draft public.legal_drafts%rowtype; current_text jsonb;
begin
  if not exists(select 1 from public.app_admins where user_id=p_actor) then raise exception 'Platform admin required'; end if;
  if p_locale not in ('fr','en','de','it') or jsonb_typeof(p_expected) is distinct from 'object'
    then raise exception 'Invalid translation review'; end if;
  select * into draft from public.legal_drafts where document_id=p_document for update;
  if not found then raise exception 'Draft missing'; end if;
  current_text:=draft.translations->p_locale;
  if current_text is null or current_text is distinct from p_expected
    or (current_text->>'source_revision')::integer is distinct from draft.source_revision
    or nullif(btrim(current_text->>'title'),'') is null
    or nullif(btrim(current_text->>'body'),'') is null
    then raise exception 'Translation changed; reload and review'; end if;
  update public.legal_drafts set translations=jsonb_set(draft.translations,array[p_locale],
    current_text || jsonb_build_object('status','approved','approved_by',p_actor,'approved_at',now()),false),
    updated_by=p_actor,updated_at=now() where document_id=p_document;
  return true;
end $$;
revoke all on function public.approve_legal_draft_translation_checked(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.approve_legal_draft_translation_checked(uuid,text,jsonb,uuid) to service_role;
