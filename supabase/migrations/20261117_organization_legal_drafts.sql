begin;
-- Drafts only. Published versions, presentations and decisions stay untouched.
create table public.legal_organization_templates (like public.legal_club_templates including all);
alter table public.legal_organization_templates enable row level security;
revoke all on public.legal_organization_templates from public,anon,authenticated;
grant select on public.legal_organization_templates to service_role;

-- Adapt draft wording, including profiles initially created by another organization.
create function public.organization_template_text(p_text text,p_locale text) returns text
language plpgsql immutable set search_path=public,pg_temp as $$ begin
  p_text:=replace(p_text,'{{club_name}}','{{organization_name}}');
  if p_locale='fr' then
    p_text:=replace(p_text,'Le compte de mon enfant est créé par {{organization_name}}.','Le compte unique de mon enfant est créé par une organisation habilitée ou rattaché à {{organization_name}} lorsqu’il existe déjà.');
    p_text:=replace(replace(replace(replace(replace(p_text,'le club','l’organisation'),'du club','de l’organisation'),'au club','à l’organisation'),'ce club','cette organisation'),'un autre club','une autre organisation');
  elsif p_locale='en' then
    p_text:=replace(p_text,'My child''s account is created by {{organization_name}}.','My child''s single account is created by an authorised organization or affiliated with {{organization_name}} if it already exists.');
    p_text:=regexp_replace(p_text,'\mclub\M','organization','g');
  elsif p_locale='de' then
    p_text:=replace(p_text,'Das Konto meines Kindes wird von {{organization_name}} erstellt.','Das einzige Konto meines Kindes wird von einer berechtigten Organisation erstellt oder, wenn es bereits besteht, {{organization_name}} zugeordnet.');
    p_text:=replace(replace(replace(replace(replace(p_text,'den Club','die Organisation'),'beim Club','bei der Organisation'),'diesem Club','dieser Organisation'),'diesen Club','diese Organisation'),'anderen Club','anderen Organisation');
    p_text:=regexp_replace(p_text,'\mClub\M','Organisation','g');
  elsif p_locale='it' then
    p_text:=replace(p_text,'L''account di mio figlio viene creato da {{organization_name}}.','L''unico account di mio figlio viene creato da un’organizzazione autorizzata oppure, se esiste già, viene affiliato a {{organization_name}}.');
    p_text:=replace(replace(replace(replace(replace(p_text,'del club','dell’organizzazione'),'al club','all’organizzazione'),'il club','l’organizzazione'),'questo club','questa organizzazione'),'un altro club','un’altra organizzazione');
    p_text:=regexp_replace(p_text,'\mclub\M','organizzazione','g');
  end if;
  return p_text;
end $$;
revoke all on function public.organization_template_text(text,text) from public,anon,authenticated;

insert into public.legal_organization_templates
select purpose_key,kind,audience_roles,action_kind,required,applicability,required_locales,
  array(select distinct case when variable='club_name' then 'organization_name' else variable end from unnest(allowed_variables) variable),
  (select jsonb_object_agg(locale,
    jsonb_build_object('title',public.organization_template_text(translation->>'title',locale),
      'body',public.organization_template_text(translation->>'body',locale)||E'\n\n'||case locale
        when 'fr' then 'Le terme « organisation » désigne ici le club ou l’académie indiqué dans ce document. L’enfant conserve un compte unique. Chaque affiliation et chaque autorisation concernent cette organisation ; elles ne donnent pas accès aux données sportives ou aux notes privées d’une autre organisation. Une référence à un club externe ne lui ouvre aucun accès. Un partage depuis un club partenaire exige une demande et sa validation ; il ne remplace pas cette autorisation.'
        when 'en' then 'Here, “organization” means the club or academy named in this document. The child keeps one account. Each affiliation and authorization concerns this organization; it does not grant access to another organization’s sports data or private notes. A reference to an external club grants it no access. Sharing from a partner club requires a request and its approval; it does not replace this authorization.'
        when 'de' then '„Organisation“ bezeichnet hier den in diesem Dokument genannten Club oder die Akademie. Das Kind behält ein einziges Konto. Jede Zugehörigkeit und Genehmigung gilt für diese Organisation; sie gewährt keinen Zugang zu Sportdaten oder privaten Notizen einer anderen Organisation. Eine Referenz auf einen externen Club gewährt diesem keinen Zugang. Die Übernahme aus einem Partnerclub erfordert eine Anfrage und deren Freigabe; sie ersetzt diese Genehmigung nicht.'
        when 'it' then 'Qui «organizzazione» indica il club o l’accademia nominato in questo documento. Il minore mantiene un solo account. Ogni affiliazione e autorizzazione riguarda questa organizzazione e non dà accesso ai dati sportivi o alle note private di un’altra organizzazione. Il riferimento a un club esterno non gli concede accessi. La condivisione da un club partner richiede una richiesta e la sua approvazione, senza sostituire questa autorizzazione.'
      end,
      'action_label',public.organization_template_text(translation->>'action_label',locale),
      'status','needs_review','source_revision',1)) from jsonb_each(translations) t(locale,translation)),
  source_catalog_sha256,created_at from public.legal_club_templates;

insert into public.organization_migration_baseline(object_key,definition)
select 'function:'||p.oid::regprocedure,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_club_legal_drafts_from_templates' on conflict do nothing;
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
      values(doc,'Organization model: human review of all four languages, audience and account-origin wording required before publication.',template.allowed_variables,template.translations,p_actor);
    result:=array_append(result,doc);
  end loop;
  return result;
end $$;

-- Prepare the next platform privacy draft. Never activate or publish it.
insert into public.organization_migration_baseline(object_key,definition)
select 'privacy_draft:'||dr.document_id,to_jsonb(dr)::text from public.legal_drafts dr
join public.legal_documents d on d.id=dr.document_id where d.kind='privacy' and d.scope='platform';
update public.legal_drafts dr set source_revision=dr.source_revision+1,
  change_summary='Clubs, academies, scoped family access and partner identity requests: review required.',
  translations=(select jsonb_object_agg(locale,translation||jsonb_build_object('status','needs_review',
    'source_revision',dr.source_revision+1,'body',(translation->>'body')||E'\n\n'||case locale
      when 'fr' then 'Clubs et académies — Un joueur utilise un compte unique et peut avoir plusieurs affiliations. Les droits du parent et ses autorisations sont gérés séparément pour chaque enfant et chaque organisation. Un administrateur configure les clubs partenaires et les capacités autorisées. La recherche du partenaire actif est limitée au nom du joueur et à son club. Une demande, la validation du club d’origine et l’autorisation propre à l’académie précèdent l’activation. Les notes privées, messages, évaluations et dossiers sportifs conservent leur organisation propriétaire. Une référence de club externe ne donne aucun accès ; lorsque ce club rejoint ActiviTee, une vérification humaine précède le rattachement du profil existant. Les opérations de partage et de rattachement sont tracées. Le retrait ou la fin d’une affiliation ferme les accès de ce périmètre sans effacer automatiquement les preuves ni les accès aux autres organisations. Pour toute demande concernant ces affiliations et données, contactez info@activitee.golf.'
      when 'en' then 'Clubs and academies — A player uses one account and may have several affiliations. Parent rights and authorizations are managed separately for each child and organization. An administrator configures partner clubs and permitted capabilities. Searches within an active partnership are limited to the player’s name and club. A request, source-club approval and the academy’s own authorization precede activation. Private notes, messages, evaluations and sports records retain their owning organization. An external-club reference grants no access; when that club joins ActiviTee, a human review precedes affiliation of the existing profile. Sharing and affiliation actions are logged. Withdrawal or the end of an affiliation closes access for that scope without automatically erasing evidence or access to other organizations. For requests about these affiliations and data, contact info@activitee.golf.'
      when 'de' then 'Clubs und Akademien — Ein Spieler nutzt ein einziges Konto und kann mehreren Organisationen angehören. Elternrechte und Genehmigungen werden für jedes Kind und jede Organisation getrennt verwaltet. Ein Administrator konfiguriert Partnerclubs und erlaubte Funktionen. Die Suche innerhalb einer aktiven Partnerschaft beschränkt sich auf Name und Club des Spielers. Eine Anfrage, die Freigabe des Herkunftsclubs und die eigene Genehmigung für die Akademie gehen der Aktivierung voraus. Private Notizen, Nachrichten, Bewertungen und Sportdaten behalten ihre zuständige Organisation. Die Referenz auf einen externen Club gewährt keinen Zugang; tritt dieser Club ActiviTee bei, erfolgt vor der Zuordnung des bestehenden Profils eine menschliche Prüfung. Freigaben und Zuordnungen werden protokolliert. Widerruf oder Ende einer Zugehörigkeit schließen den Zugang dieses Bereichs, ohne automatisch Nachweise oder Zugänge zu anderen Organisationen zu löschen. Für Anfragen zu diesen Zugehörigkeiten und Daten: info@activitee.golf.'
      when 'it' then 'Club e accademie — Un giocatore utilizza un solo account e può avere più affiliazioni. I diritti e le autorizzazioni del genitore sono gestiti separatamente per ogni figlio e organizzazione. Un amministratore configura i club partner e le funzioni consentite. La ricerca nell’ambito di una collaborazione attiva è limitata al nome del giocatore e al suo club. Una richiesta, l’approvazione del club d’origine e l’autorizzazione specifica dell’accademia precedono l’attivazione. Note private, messaggi, valutazioni e dati sportivi mantengono la propria organizzazione. Un riferimento a un club esterno non concede accessi; quando questo aderisce ad ActiviTee, una verifica umana precede il collegamento del profilo esistente. Condivisioni e affiliazioni sono registrate. La revoca o la fine di un’affiliazione chiude gli accessi di quell’ambito, senza cancellare automaticamente le prove o gli accessi ad altre organizzazioni. Per richieste su queste affiliazioni e dati: info@activitee.golf.'
    end)) from jsonb_each(dr.translations) t(locale,translation)),updated_at=now()
from public.legal_documents d where d.id=dr.document_id and d.kind='privacy' and d.scope='platform';
insert into public.organization_migration_baseline(object_key,definition)
select 'privacy_prepared:'||dr.document_id,to_jsonb(dr)::text from public.legal_drafts dr
join public.legal_documents d on d.id=dr.document_id where d.kind='privacy' and d.scope='platform';
commit;
