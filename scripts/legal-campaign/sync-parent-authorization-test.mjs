import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2] ?? '--check';
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (new URL(url).host !== 'wizbeuuvjibmmuxyynly.supabase.co') throw Error('Only Supabase TEST is allowed');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const purpose = 'service.parent_authorization';
const key = 'activitee_autorisation_parentale_sion';
const texts = {};
const fr = await readFile('docs/legal/drafts.md', 'utf8');
const frSection = fr.split('### A. Autorisation d’usage pour un enfant\n\n')[1]?.split('\n### B. Notice junior')[0];
const frMatch = frSection?.match(/^\*\*Titre : (.+)\*\*\n\n([\s\S]*?)\n\n\*\*Actions de présentation : ([^/]+) \/ Refuser\.\*\*/);
if (!frMatch) throw Error('French parent text could not be parsed');
texts.fr = { title: frMatch[1], body: frMatch[2].trim(), action_label: frMatch[3] };
for (const locale of ['en', 'de', 'it']) {
  const file = await readFile(`docs/legal/translations/${locale}.md`, 'utf8');
  const block = file.split(`<!-- key:${key} -->\n`)[1]?.split('\n<!-- key:', 1)[0];
  const match = block?.match(/^Title: (.+)\nAction: (.+)\n\n([\s\S]*?)\s*$/);
  if (!match) throw Error(`${locale} parent text could not be parsed`);
  texts[locale] = { title: match[1], action_label: match[2], body: match[3].trim() };
}
const newParagraph = {
  fr: 'Pour ces fonctions, le club et ActiviTee traitent les informations nécessaires au compte et au suivi sportif de mon enfant',
  en: "For these features, the club and ActiviTee process the information needed for my child's account",
  de: 'Für diese Funktionen verarbeiten der Club und ActiviTee die für das Konto',
  it: "Per queste funzioni, il club e ActiviTee trattano le informazioni necessarie all'account",
};
const oldBodies = {};
for (const locale of Object.keys(texts)) {
  const paragraph = texts[locale].body.split('\n\n').find((part) => part.startsWith(newParagraph[locale]));
  if (!paragraph) throw Error(`${locale} new paragraph missing`);
  oldBodies[locale] = texts[locale].body.replace(`${paragraph}\n\n`, '').trim();
}
const assert = (result) => { if (result.error) throw result.error; return result.data; };
const documents = assert(await db.from('legal_documents').select('id,document_key,club_id,active,purpose_key,kind,scope')
  .eq('purpose_key', purpose).like('document_key', 'activitee_%'));
const clubs = new Map([
  ['activitee_autorisation_parentale_sion', 'ec516bee-09fb-4ff9-8ca6-7131918c5cb0'],
  ['activitee_autorisation_parentale_augusta', 'd6135ac9-2ab1-4ac8-bc95-a8c8cd71c33b'],
  ['activitee_autorisation_parentale_performance_valais', '229b431a-1c84-4a0f-8101-f8089ebbd829'],
]);
if (documents.length !== 3 || documents.some((doc) => clubs.get(doc.document_key) !== doc.club_id ||
  doc.kind !== 'parent_authorization' || doc.scope !== 'club')) throw Error('Document inventory or scope changed');
const beforeVersions = assert(await db.from('legal_versions').select('id,document_id,version_number').in('document_id', documents.map((d) => d.id)));
const admin = assert(await db.from('app_admins').select('user_id').limit(1)).at(0)?.user_id;
if (!admin) throw Error('No platform admin');
async function readDrafts() {
  const drafts = assert(await db.from('legal_drafts').select('document_id,source_revision,translations,allowed_variables')
    .in('document_id', documents.map((d) => d.id)));
  if (drafts.length !== 3 || drafts.some((draft) => !['child_name', 'club_name'].every((v) => draft.allowed_variables.includes(v))))
    throw Error('Draft inventory or variables changed');
  return drafts;
}
let drafts = await readDrafts();
const state = {};
for (const locale of ['fr', 'en', 'de', 'it']) {
  const current = drafts.map((draft) => draft.translations[locale]);
  const same = current.every((tr) => tr.title === current[0].title && tr.body === current[0].body
    && tr.action_label === current[0].action_label);
  if (!same) throw Error(`Club drafts differ for ${locale}`);
  const tr = current[0];
  if (tr.title !== texts[locale].title || tr.action_label !== texts[locale].action_label) throw Error(`${locale} title or action drifted`);
  if (tr.body !== oldBodies[locale] && tr.body !== texts[locale].body) throw Error(`${locale} body drifted`);
  state[locale] = tr.body === texts[locale].body ? 'current' : 'needs_update';
}
console.log(JSON.stringify({ project: new URL(url).host, mode, purpose, documents: documents.length,
  active: documents.filter((d) => d.active).length, versions: beforeVersions.length, state }));
if (mode === '--check') process.exit(0);
for (const locale of ['fr', 'en', 'de', 'it']) {
  if (state[locale] === 'current') continue;
  const expected = Object.fromEntries(drafts.map((draft) => [draft.document_id,
    { source_revision: draft.source_revision, translations: draft.translations }]));
  assert(await db.rpc('save_legal_draft_text_checked', {
    p_expected: expected, p_group_purpose: purpose, p_locale: locale,
    p_title: texts[locale].title, p_body: texts[locale].body,
    p_action_label: texts[locale].action_label, p_actor: admin,
  }));
  drafts = await readDrafts();
  if (drafts.some((draft) => draft.translations[locale].body !== texts[locale].body ||
    draft.translations[locale].status !== 'needs_review')) throw Error(`${locale} readback failed`);
}
const afterVersions = assert(await db.from('legal_versions').select('id,document_id,version_number').in('document_id', documents.map((d) => d.id)));
if (JSON.stringify(afterVersions) !== JSON.stringify(beforeVersions)) throw Error('Published versions changed');
console.log(JSON.stringify({ updated: Object.keys(state).filter((locale) => state[locale] === 'needs_update'),
  drafts: drafts.length, review: Object.fromEntries(['fr', 'en', 'de', 'it'].map((locale) =>
    [locale, drafts.every((draft) => draft.translations[locale].status === 'needs_review')])) }));
