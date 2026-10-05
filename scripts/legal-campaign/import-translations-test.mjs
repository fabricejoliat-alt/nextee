import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db, safety, assertOk } from './context.mjs';

const mode = process.argv[2] ?? '--check';
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const source = JSON.parse(await readFile('/private/tmp/activitee-legal-drafts-import.json', 'utf8'));
const ready = JSON.parse(await readFile('/private/tmp/activitee-legal-translations-ready.json', 'utf8'));
let previous = { translations: [] };
try { previous = JSON.parse(await readFile('/private/tmp/activitee-legal-translations-previous.json', 'utf8')); } catch {}
if (ready.source_revision !== source.revision || ready.source_sha256 !== source.source_sha256) throw Error('Translation source mismatch');
const itemByKey = new Map(ready.translations.map((item) => [item.key, item]));
const previousByKey = new Map(previous.translations.map((item) => [item.key, item]));
if (itemByKey.size !== 12 || source.documents.length !== 12) throw Error('Expected exactly 12 documents');
await safety();
const active = await db.from('legal_documents').select('id', { head: true, count: 'exact' }).eq('active', true);
if (active.error) throw active.error;
const gate = assertOk(await db.from('legal_enforcement_control').select('enabled').single());
if (active.count !== 0 || gate.enabled !== false) throw Error('TEST safety state changed');
const keys = source.documents.map((item) => item.key);
const documents = assertOk(await db.from('legal_documents').select('id,document_key,active,club_id').in('document_key', keys));
if (documents.length !== 12 || documents.some((doc) => doc.active)) throw Error('Draft document inventory changed');
const drafts = assertOk(await db.from('legal_drafts').select('document_id,source_revision,translations,allowed_variables,updated_by,updated_at').in('document_id', documents.map((doc) => doc.id)));
if (drafts.length !== 12) throw Error('Draft row inventory changed');
const draftById = new Map(drafts.map((draft) => [draft.document_id, draft]));
const expectedClubs = {
  sion: 'ec516bee-09fb-4ff9-8ca6-7131918c5cb0',
  augusta: 'd6135ac9-2ab1-4ac8-bc95-a8c8cd71c33b',
  performance_valais: '229b431a-1c84-4a0f-8101-f8089ebbd829',
};
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const evidence = { project: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host, mode, at: new Date().toISOString(), gate: gate.enabled, active_documents: active.count, source_revision: source.revision, source_sha256: source.source_sha256, rows: [] };
for (const document of documents) {
  const sourceDoc = source.documents.find((item) => item.key === document.document_key);
  const item = itemByKey.get(document.document_key);
  const draft = draftById.get(document.id);
  const club = Object.entries(expectedClubs).find(([suffix]) => document.document_key.endsWith('_' + suffix));
  if (!draft || !item || !sourceDoc || (club ? document.club_id !== club[1] : document.club_id !== null)) throw Error(`Scope mismatch: ${document.document_key}`);
  const fr = draft.translations?.fr;
  if (!fr || fr.title !== sourceDoc.title || fr.body !== sourceDoc.body || fr.action_label !== sourceDoc.action_label || fr.source_revision !== draft.source_revision || fr.status !== 'needs_review') throw Error(`French source changed: ${document.document_key}`);
  const allowed = new Set(draft.allowed_variables ?? []);
  const generated = {};
  const changed = [];
  for (const locale of ['en', 'de', 'it']) {
    const tr = item.locales[locale];
    const variables = [...`${tr.title}${tr.body}${tr.action_label}`.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]);
    if (variables.some((variable) => !allowed.has(variable))) throw Error(`Variable not allowed: ${document.document_key} ${locale}`);
    generated[locale] = { title: tr.title, body: tr.body, action_label: tr.action_label, status: 'needs_review', source_revision: draft.source_revision };
    const current = draft.translations?.[locale];
    if (current && hash(current) !== hash(generated[locale])) {
      const old = previousByKey.get(document.document_key)?.locales?.[locale];
      const prior = old && { title: old.title, body: old.body, action_label: old.action_label, status: 'needs_review', source_revision: draft.source_revision };
      if (!prior || hash(current) !== hash(prior)) throw Error(`Existing translation differs: ${document.document_key} ${locale}`);
      changed.push(locale);
    }
  }
  const missing = ['en', 'de', 'it'].filter((locale) => !draft.translations?.[locale]);
  evidence.rows.push({ document_key: document.document_key, document_id: document.id, club_id: document.club_id, revision: draft.source_revision, fr_sha256: hash(fr), missing_before: missing, changed_before: changed, translation_sha256: Object.fromEntries(['en','de','it'].map((locale) => [locale, hash(generated[locale])])) });
  if (mode === '--apply' && (missing.length || changed.length)) {
    const fresh = assertOk(await db.from('legal_drafts').select('source_revision,translations,updated_at').eq('document_id', document.id).single());
    if (fresh.source_revision !== draft.source_revision || hash(fresh.translations) !== hash(draft.translations) || fresh.updated_at !== draft.updated_at)
      throw Error(`Draft changed before write: ${document.document_key}`);
    const translations = { ...draft.translations, ...generated };
    let saved;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await db.from('legal_drafts').update({ translations, updated_by: draft.updated_by, updated_at: new Date().toISOString() })
        .eq('document_id', document.id).eq('source_revision', draft.source_revision)
        .eq('updated_at', draft.updated_at).select('document_id');
      if (!response.error) { saved = response.data; break; }
      if (!String(response.error.message).includes('fetch failed') || attempt === 4) throw Error(`${document.document_key}: ${response.error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
    if (saved.length !== 1) throw Error(`Concurrent update: ${document.document_key}`);
    console.log(`updated ${document.document_key}: ${[...missing, ...changed].join(',')}`);
  }
}
if (mode === '--apply') {
  const after = assertOk(await db.from('legal_drafts').select('document_id,source_revision,translations').in('document_id', documents.map((doc) => doc.id)));
  for (const row of after) {
    const original = drafts.find((draft) => draft.document_id === row.document_id);
    const item = evidence.rows.find((entry) => entry.document_id === row.document_id);
    if (row.source_revision !== original.source_revision || hash(row.translations.fr) !== item.fr_sha256) throw Error(`French source changed after write: ${item.document_key}`);
    for (const locale of ['en','de','it']) if (hash(row.translations[locale]) !== item.translation_sha256[locale]) throw Error(`Readback mismatch: ${item.document_key} ${locale}`);
  }
  await safety();
  const activeAfter = await db.from('legal_documents').select('id', { head: true, count: 'exact' }).eq('active', true);
  if (activeAfter.error) throw activeAfter.error;
  if (activeAfter.count !== 0) throw Error('Document activated unexpectedly');
  evidence.readback = { drafts: after.length, translations: after.length * 3, active_documents: activeAfter.count, gate: false };
}
await writeFile(`docs/legal/evidence/20261005-translations-${mode.slice(2)}-test.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ mode, project: evidence.project, documents: evidence.rows.length, missing: evidence.rows.reduce((n, row) => n + row.missing_before.length, 0), changed: evidence.rows.reduce((n, row) => n + row.changed_before.length, 0), readback: evidence.readback ?? null }));
