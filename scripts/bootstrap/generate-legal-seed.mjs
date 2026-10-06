import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = resolve(root, "supabase/bootstrap/legal-catalog-20261006.json");
const output = process.argv[2];
const expectedHash = "dee7d511da8ecf60e850302bcf3ab78a6c3664da7cadf35a3d0bbb252690664c";
if (!output) throw new Error("Private output SQL path required");
const bytes = readFileSync(source);
const actualHash = createHash("sha256").update(bytes).digest("hex");
if (actualHash !== expectedHash) throw new Error("Legal catalog SHA-256 mismatch");
const catalog = JSON.parse(bytes.toString("utf8"));
if (catalog.format !== "activitee-legal-catalog-v1"
  || catalog.platformDocuments?.length !== 3
  || catalog.clubTemplates?.length !== 3) throw new Error("Unexpected legal catalog shape");
for (const item of [...catalog.platformDocuments, ...catalog.clubTemplates]) {
  if (Object.keys(item.translations || {}).sort().join() !== "de,en,fr,it"
    || item.applicability?.status !== "approved") throw new Error("Unexpected legal source item");
}
const quote = value => `'${value.replaceAll("'", "''")}'`;
const payload = quote(bytes.toString("utf8"));
const sql = `-- Imported TEST text is an editorial starting point. No approval or publication is copied.
do $$
declare admin_id uuid;
begin
  if (select count(*) from auth.users) <> 1
    or (select count(*) from public.profiles) <> 1
    or (select count(*) from public.app_admins) <> 1
    or (select count(*) from public.clubs) <> 0
    or (select count(*) from public.legal_documents) <> 0
    or (select count(*) from public.legal_drafts) <> 0
    or (select count(*) from public.legal_versions) <> 0
    or (select count(*) from public.legal_club_templates) <> 0
    or (select count(*) from public.legal_enforcement_control) <> 0 then
    raise exception 'Unexpected Zurich legal import state';
  end if;
  select user_id into strict admin_id from public.app_admins;
  if not exists (select 1 from auth.users where id=admin_id
      and lower(email)='info@activitee.golf' and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id=admin_id) then
    raise exception 'Expected confirmed superadmin missing';
  end if;
end $$;

create temp table _legal_seed_payload (data jsonb not null) on commit drop;
insert into _legal_seed_payload(data) values (${payload}::jsonb);
insert into public.legal_enforcement_control(singleton,enabled) values(true,false);

insert into public.legal_documents (
  document_key,kind,purpose_key,scope,audience_roles,action_kind,
  required,active,required_locales,created_by
)
select item->>'document_key',item->>'kind',item->>'purpose_key','platform',
  array(select jsonb_array_elements_text(item->'audience_roles')),
  item->>'action_kind',(item->>'required')::boolean,false,
  array(select jsonb_array_elements_text(item->'required_locales')),
  (select user_id from public.app_admins)
from _legal_seed_payload, jsonb_array_elements(data->'platformDocuments') item;

insert into public.legal_drafts (
  document_id,source_revision,change_summary,allowed_variables,translations,updated_by
)
select d.id,1,
  'Texte transféré depuis TEST. Vérifier les pays, prestataires, domaines et fonctions avant approbation Zurich.',
  array(select jsonb_array_elements_text(item->'allowed_variables')),
  (select jsonb_object_agg(key,value || jsonb_build_object('status','needs_review','source_revision',1))
   from jsonb_each(item->'translations')),
  (select user_id from public.app_admins)
from _legal_seed_payload, jsonb_array_elements(data->'platformDocuments') item
join public.legal_documents d on d.document_key=item->>'document_key';

insert into public.legal_club_templates (
  purpose_key,kind,audience_roles,action_kind,required,applicability,
  required_locales,allowed_variables,translations,source_catalog_sha256
)
select item->>'purpose_key',item->>'kind',
  array(select jsonb_array_elements_text(item->'audience_roles')),
  item->>'action_kind',(item->>'required')::boolean,
  '{"status":"unapproved"}'::jsonb,
  array(select jsonb_array_elements_text(item->'required_locales')),
  array(select jsonb_array_elements_text(item->'allowed_variables')),
  item->'translations',${quote(expectedHash)}
from _legal_seed_payload, jsonb_array_elements(data->'clubTemplates') item;

do $$ begin
  if (select count(*) from public.legal_documents where scope='platform' and not active) <> 3
    or (select count(*) from public.legal_drafts) <> 3
    or (select count(*) from public.legal_club_templates) <> 3
    or (select count(*) from public.legal_versions) <> 0
    or (select count(*) from public.legal_documents where active) <> 0
    or (select count(*) from public.legal_enforcement_control where singleton and not enabled) <> 1
    or (select count(*) from public.clubs) <> 0 then
    raise exception 'Legal import postflight failed';
  end if;
end $$;
`;
writeFileSync(output, sql, { mode: 0o600, flag: "wx" });
