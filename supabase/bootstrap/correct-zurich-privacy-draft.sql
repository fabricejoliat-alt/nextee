-- One-time correction of the inactive Zurich privacy draft only.
-- The TEST catalog remains unchanged; this does not approve or publish text.
do $correction$
declare
  target record;
  actor_id uuid;
  locale text;
  old_sentence text;
  new_sentence text;
  body text;
  changed jsonb := '{}'::jsonb;
begin
  if (select count(*) from public.clubs) <> 0
    or (select count(*) from public.app_admins) <> 1
    or (select count(*) from public.legal_versions) <> 0
    or (select count(*) from public.legal_enforcement_control where enabled) <> 0 then
    raise exception 'Zurich privacy draft preflight failed';
  end if;

  select user_id into strict actor_id from public.app_admins;
  select d.id, d.active, dr.source_revision, dr.translations
    into strict target
    from public.legal_documents d
    join public.legal_drafts dr on dr.document_id = d.id
   where d.scope = 'platform'
     and d.document_key = 'activitee_notice_donnees_personnelles'
   for update of d, dr;
  if target.active or target.source_revision <> 1
    or (select count(*) from jsonb_object_keys(target.translations)) <> 4 then
    raise exception 'Zurich privacy draft is no longer the imported inactive draft';
  end if;

  foreach locale in array array['fr','en','de','it'] loop
    old_sentence := case locale
      when 'fr' then 'Le projet de production est configuré en Irlande.'
      when 'en' then 'The production project is configured in Ireland.'
      when 'de' then 'Das Produktionsprojekt ist für Irland konfiguriert.'
      when 'it' then 'Il progetto di produzione è configurato in Irlanda.'
    end;
    new_sentence := case locale
      when 'fr' then 'Le projet Supabase de cette application est configuré dans la région de Zurich (eu-central-2).'
      when 'en' then 'The Supabase project for this application is configured in the Zurich region (eu-central-2).'
      when 'de' then 'Das Supabase-Projekt dieser Anwendung ist für die Region Zürich (eu-central-2) konfiguriert.'
      when 'it' then 'Il progetto Supabase di questa applicazione è configurato nella regione di Zurigo (eu-central-2).'
    end;
    body := target.translations -> locale ->> 'body';
    if body is null or target.translations -> locale ->> 'status' <> 'needs_review'
      or (target.translations -> locale ->> 'source_revision')::integer <> 1
      or (length(body) - length(replace(body, old_sentence, ''))) <> length(old_sentence) then
      raise exception 'Privacy text changed or expected sentence missing in %', locale;
    end if;
    changed := changed || jsonb_build_object(locale,
      (target.translations -> locale) || jsonb_build_object(
        'body', replace(body, old_sentence, new_sentence),
        'status', 'needs_review', 'source_revision', 2));
  end loop;

  update public.legal_drafts
     set translations = changed,
         source_revision = 2,
         change_summary = 'Correction de la région Supabase pour le projet Zurich ; relecture des quatre langues et vérification des autres prestataires avant publication.',
         updated_by = actor_id,
         updated_at = now()
   where document_id = target.id and source_revision = 1;
  if not found then raise exception 'Privacy draft changed during correction'; end if;
end $correction$;

select d.document_key, d.active, dr.source_revision,
       (select count(*) from jsonb_each(dr.translations) tr
         where tr.value ->> 'status' = 'needs_review'
           and (tr.value ->> 'source_revision')::integer = dr.source_revision
           and tr.value ->> 'body' like '%(eu-central-2)%') as locales_to_review,
       (select count(*) from public.legal_versions) as published_versions,
       (select count(*) from public.clubs) as clubs
  from public.legal_documents d
  join public.legal_drafts dr on dr.document_id = d.id
 where d.document_key = 'activitee_notice_donnees_personnelles';
