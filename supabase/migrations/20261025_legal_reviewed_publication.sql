-- Inactive publication review guard. Apply only after 20261022 on isolated TEST.
-- The review snapshot is compared under the same document lock as publication.
create function public.publish_legal_draft_checked(p_document_id uuid,p_publisher uuid,p_expected jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.legal_documents%rowtype; dr public.legal_drafts%rowtype; latest uuid; actual jsonb;
begin
  if p_expected is null or jsonb_typeof(p_expected)<>'object' then raise exception 'Publication review required'; end if;
  if not exists(select 1 from public.app_admins a where a.user_id=p_publisher) then raise exception 'Platform admin required'; end if;
  select * into d from public.legal_documents where id=p_document_id for update;
  if not found then raise exception 'Document missing'; end if;
  select * into dr from public.legal_drafts where document_id=p_document_id for update;
  if not found then raise exception 'Draft missing'; end if;
  select id into latest from public.legal_versions where document_id=p_document_id order by version_number desc limit 1;
  actual:=jsonb_build_object(
    'document',jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
      'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
      'required',d.required,'active',d.active,'applicability',d.applicability,'required_locales',d.required_locales),
    'draft',jsonb_build_object('source_revision',dr.source_revision,'change_summary',dr.change_summary,
      'allowed_variables',dr.allowed_variables,'translations',dr.translations),
    'latest_version_id',latest);
  if actual is distinct from p_expected then raise exception 'Publication preview changed; reload and review'; end if;
  return public.publish_legal_draft(p_document_id,p_publisher);
end $$;
revoke all on function public.publish_legal_draft_checked(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_legal_draft_checked(uuid,uuid,jsonb) to service_role;
