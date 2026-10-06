-- Club legal text is kept without a club until a platform admin explicitly
-- instantiates draft documents for a real club. Nothing is auto-published.
do $$ begin
  if (select count(*) from auth.users) <> 1
    or (select count(*) from public.profiles) <> 1
    or (select count(*) from public.app_admins) <> 1
    or (select count(*) from public.clubs) <> 0
    or (select count(*) from public.legal_documents) <> 0
    or (select count(*) from public.legal_enforcement_control) <> 0
    or to_regclass('public.legal_club_templates') is not null then
    raise exception 'Expected the single-admin, club-free Zurich base before legal import';
  end if;
end $$;

create table public.legal_club_templates (
  purpose_key text primary key,
  kind text not null,
  audience_roles text[] not null,
  action_kind text not null,
  required boolean not null,
  applicability jsonb not null,
  required_locales text[] not null,
  allowed_variables text[] not null,
  translations jsonb not null,
  source_catalog_sha256 text not null check (source_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.legal_club_templates enable row level security;
revoke all on public.legal_club_templates from public, anon, authenticated;
grant select on public.legal_club_templates to service_role;

create function public.create_club_legal_drafts_from_templates(p_club uuid, p_actor uuid)
returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
declare
  template public.legal_club_templates%rowtype;
  document_id uuid;
  created_ids uuid[] := '{}'::uuid[];
begin
  if not exists (select 1 from public.app_admins where user_id=p_actor) then
    raise exception 'Platform admin required';
  end if;
  if not exists (select 1 from public.clubs where id=p_club) then
    raise exception 'Club missing';
  end if;
  if (select count(*) from public.legal_club_templates) <> 3 then
    raise exception 'Three club templates required';
  end if;
  if exists (
    select 1 from public.legal_documents
    where scope='club' and club_id=p_club
      and purpose_key in (select purpose_key from public.legal_club_templates)
  ) then
    raise exception 'Club legal documents already exist';
  end if;

  for template in select * from public.legal_club_templates order by purpose_key loop
    insert into public.legal_documents (
      document_key, kind, purpose_key, scope, club_id, audience_roles,
      action_kind, required, active, required_locales, created_by
    ) values (
      'activitee_' || regexp_replace(template.purpose_key,'[^a-z0-9]+','_','g')
        || '_' || replace(p_club::text,'-',''),
      template.kind, template.purpose_key, 'club', p_club,
      template.audience_roles, template.action_kind, template.required,
      false, template.required_locales, p_actor
    ) returning id into document_id;

    insert into public.legal_drafts (
      document_id, source_revision, change_summary, allowed_variables,
      translations, updated_by
    ) values (
      document_id, 1,
      'Modèle transféré du catalogue TEST ; relecture, approbation et publication requises pour ce club.',
      template.allowed_variables,
      (select jsonb_object_agg(key, value || jsonb_build_object('status','needs_review','source_revision',1))
       from jsonb_each(template.translations)),
      p_actor
    );
    created_ids := array_append(created_ids,document_id);
  end loop;
  return created_ids;
end $$;
revoke all on function public.create_club_legal_drafts_from_templates(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.create_club_legal_drafts_from_templates(uuid,uuid)
  to service_role;
