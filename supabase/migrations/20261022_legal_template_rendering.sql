-- Apply after 20261021_legal_decision_integrity.sql. No activation or real data backfill.
-- Only these server-sourced variables may appear in a published legal text.
create function public.legal_template_variables(p_text text) returns text[]
language sql immutable set search_path=public as $$
  select coalesce(array_agg(matches[1] order by matches[1]),'{}'::text[])
  from regexp_matches(coalesce(p_text,''),'\{\{([a-z_]+)\}\}','g') as t(matches);
$$;
revoke all on function public.legal_template_variables(text) from public,anon,authenticated;
grant execute on function public.legal_template_variables(text) to service_role;

create function public.legal_template_is_valid(p_text text,p_allowed text[]) returns boolean
language sql immutable set search_path=public as $$
  select position('{{' in regexp_replace(coalesce(p_text,''),'\{\{[a-z_]+\}\}','','g'))=0
    and position('}}' in regexp_replace(coalesce(p_text,''),'\{\{[a-z_]+\}\}','','g'))=0
    and not exists(select 1 from unnest(public.legal_template_variables(p_text)) as t(variable)
      where variable <> all(coalesce(p_allowed,'{}'::text[])));
$$;
revoke all on function public.legal_template_is_valid(text,text[]) from public,anon,authenticated;
grant execute on function public.legal_template_is_valid(text,text[]) to service_role;

create function public.set_legal_draft_variables(p_document uuid,p_expected_revision integer,p_variables text[],p_actor uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare dr public.legal_drafts%rowtype; normalized text[]; changed jsonb;
begin
  if not exists(select 1 from public.app_admins a where a.user_id=p_actor) then raise exception 'Platform admin required'; end if;
  if p_variables is null or exists(select 1 from unnest(p_variables) as t(variable)
    where variable is null or variable not in ('child_name','club_name','user_name')) then raise exception 'Unsupported variable'; end if;
  select coalesce(array_agg(distinct variable order by variable),'{}'::text[]) into normalized
    from unnest(p_variables) as t(variable);
  select * into dr from public.legal_drafts where document_id=p_document for update;
  if not found or dr.source_revision is distinct from p_expected_revision then raise exception 'Draft changed; reload'; end if;
  if dr.allowed_variables=normalized then return dr.source_revision; end if;
  select coalesce(jsonb_object_agg(key,value || jsonb_build_object('status','needs_review')),'{}'::jsonb)
    into changed from jsonb_each(dr.translations);
  update public.legal_drafts set allowed_variables=normalized,translations=changed,
    source_revision=dr.source_revision+1,updated_by=p_actor,updated_at=now() where document_id=p_document;
  return dr.source_revision+1;
end $$;
revoke all on function public.set_legal_draft_variables(uuid,integer,text[],uuid) from public,anon,authenticated;
grant execute on function public.set_legal_draft_variables(uuid,integer,text[],uuid) to service_role;

create or replace function public.publish_legal_draft(p_document_id uuid,p_publisher uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; dr public.legal_drafts%rowtype; loc text; tr jsonb; n integer; v uuid; snap jsonb;
  source_variables text[]; translated_variables text[];
begin
  select * into d from public.legal_documents where id=p_document_id for update;
  if not found then raise exception 'Document missing'; end if;
  select * into dr from public.legal_drafts where document_id=p_document_id for update;
  if not found or length(trim(dr.change_summary))=0 then raise exception 'Change summary required'; end if;
  if d.applicability->>'status'<>'approved' or not exists(select 1 from public.legal_rule_revisions rr where rr.document_id=d.id
    and rr.configuration=d.applicability and rr.reviewed_by is not null and rr.reviewed_at is not null
    and rr.revision=(select max(revision) from public.legal_rule_revisions where document_id=d.id)) then raise exception 'Applicability unapproved'; end if;
  if exists(select 1 from unnest(dr.allowed_variables) as t(variable)
    where variable not in ('child_name','club_name','user_name')) then raise exception 'Unsupported variable'; end if;
  if not ('fr'=any(d.required_locales)) then raise exception 'French source required'; end if;
  source_variables:=public.legal_template_variables(
    coalesce(dr.translations->'fr'->>'title','')||coalesce(dr.translations->'fr'->>'body','')||coalesce(dr.translations->'fr'->>'action_label',''));
  foreach loc in array d.required_locales loop
    tr:=dr.translations->loc;
    if loc not in ('fr','en','de','it') or tr is null or tr->>'status'<>'approved'
       or coalesce((tr->>'source_revision')::integer,-1)<>dr.source_revision
       or length(trim(coalesce(tr->>'title','')))=0 or length(trim(coalesce(tr->>'body','')))=0
       or (d.action_kind<>'read' and length(trim(coalesce(tr->>'action_label','')))=0)
    then raise exception 'Missing or unapproved translation: %',loc; end if;
    if not public.legal_template_is_valid(coalesce(tr->>'title',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'body',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'action_label',''),dr.allowed_variables)
    then raise exception 'Invalid placeholder: %',loc; end if;
    translated_variables:=public.legal_template_variables(coalesce(tr->>'title','')||coalesce(tr->>'body','')||coalesce(tr->>'action_label',''));
    if translated_variables<>source_variables then raise exception 'Placeholder mismatch: %',loc; end if;
  end loop;
  select coalesce(max(version_number),0)+1 into n from public.legal_versions where document_id=d.id;
  snap:=jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
    'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
    'required',d.required,'applicability',d.applicability,'required_locales',d.required_locales,
    'allowed_variables',dr.allowed_variables,'translations',dr.translations,'change_summary',dr.change_summary);
  insert into public.legal_versions(document_id,version_number,snapshot,content_sha256,published_by)
  values(d.id,n,snap,encode(digest(snap::text,'sha256'),'hex'),p_publisher) returning id into v;
  return v;
end $$;
revoke all on function public.publish_legal_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_legal_draft(uuid,uuid) to service_role;

create or replace function public.present_legal_document(p_document uuid,p_actor uuid,p_beneficiary uuid,p_role text,p_locale text)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; v public.legal_versions%rowtype; tr jsonb; rendered jsonb; presentation uuid;
  variable text; value text; rendered_title text; rendered_body text; rendered_action text; allowed text[];
begin
  select * into d from public.legal_documents where id=p_document for update;
  if not found or not d.active then raise exception 'Document unavailable'; end if;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not (p_role=any(d.audience_roles)) or not public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then raise exception 'Forbidden'; end if;
  if d.kind='parent_authorization' and p_actor=p_beneficiary then raise exception 'Child beneficiary required'; end if;
  if p_actor<>p_beneficiary and d.kind<>'parent_authorization' and d.kind<>'specific_consent' then raise exception 'Wrong beneficiary'; end if;
  select * into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if not found then raise exception 'No published version'; end if;
  if public.legal_version_matches_document(d.id,v.id) is not true then raise exception 'Published metadata changed'; end if;
  tr:=v.snapshot->'translations'->p_locale;
  if tr is null or tr->>'status'<>'approved' then raise exception 'Locale unavailable'; end if;
  rendered_title:=tr->>'title'; rendered_body:=tr->>'body'; rendered_action:=tr->>'action_label';
  allowed:=array(select jsonb_array_elements_text(v.snapshot->'allowed_variables'));
  if not public.legal_template_is_valid(coalesce(rendered_title,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_body,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_action,''),allowed)
  then raise exception 'Published template invalid'; end if;
  foreach variable in array array['child_name','club_name','user_name'] loop
    if variable=any(public.legal_template_variables(rendered_title||rendered_body||coalesce(rendered_action,''))) then
      case variable
        when 'child_name' then
          if p_actor=p_beneficiary then raise exception 'Child variable requires a child beneficiary'; end if;
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_beneficiary;
        when 'club_name' then
          if d.club_id is null then raise exception 'Club variable requires a club document'; end if;
          select nullif(btrim(name),'') into value from public.clubs where id=d.club_id;
        when 'user_name' then
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_actor;
      end case;
      if value is null or position('{{' in value)>0 or position('}}' in value)>0 then raise exception 'Template value unavailable'; end if;
      rendered_title:=replace(rendered_title,'{{'||variable||'}}',value);
      rendered_body:=replace(rendered_body,'{{'||variable||'}}',value);
      rendered_action:=replace(rendered_action,'{{'||variable||'}}',value);
    end if;
  end loop;
  rendered:=jsonb_build_object('document_id',d.id,'version_id',v.id,'version_number',v.version_number,
    'kind',d.kind,'purpose_key',d.purpose_key,'scope',d.scope,'club_id',d.club_id,'action_kind',d.action_kind,
    'locale',p_locale,'title',rendered_title,'body',rendered_body,'action_label',rendered_action,
    'notice_version_ids','[]'::jsonb);
  insert into public.legal_presentations(actor_id,beneficiary_id,actor_role,authority,document_id,version_id,club_id,locale,rendered_snapshot,rendered_sha256)
  values(p_actor,p_beneficiary,p_role,case when p_actor=p_beneficiary then 'self' else 'verified_representative' end,
    d.id,v.id,d.club_id,p_locale,rendered,encode(digest(rendered::text,'sha256'),'hex')) returning id into presentation;
  return presentation;
end $$;
revoke all on function public.present_legal_document(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.present_legal_document(uuid,uuid,uuid,text,text) to service_role;
