import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourcePath = process.argv[2];
const outputPath = process.argv[3];
if (!sourcePath || !outputPath) throw Error('Usage: prepare-translations.mjs source-fr.json output.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (source.revision !== 'FR-2026-10-05-r6' || source.documents?.length !== 12) throw Error('Unexpected French source');
const canonicalKeys = source.documents.slice(0, 6).map((doc) => doc.key);
const normalize = (body) => {
  const lines = body.trim().split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\|[-| ]+\|$/.test(line) || /^\| (Provider and function|Data \||Dienstleister und Funktion|Daten \||Fornitore e funzione|Dati \|)/.test(line)) continue;
    if (/^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.length !== 2) throw Error('Malformed table row');
      out.push(cells[0], cells[1].replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 : $2'), '');
      continue;
    }
    out.push(line
      .replace(/^- \*\*([^*]+)\*\*/, '• $1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 : $2'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
const extract = (markdown, locale) => {
  const entries = [...markdown.matchAll(/<!-- key:([^ ]+) -->\nTitle: ([^\n]+)\nAction: ([^\n]+)\n\n([\s\S]*?)(?=\n<!-- key:|$)/g)];
  if (entries.length !== 6) throw Error(`${locale}: expected 6 canonical blocks, got ${entries.length}`);
  const result = {};
  for (const [, key, title, action_label, rawBody] of entries) {
    if (!canonicalKeys.includes(key) || result[key]) throw Error(`${locale}: unexpected or repeated key ${key}`);
    result[key] = { title, action_label, body: normalize(rawBody) };
  }
  return result;
};
const locales = {};
for (const locale of ['en', 'de', 'it']) {
  locales[locale] = extract(await readFile(new URL(`../../docs/legal/translations/${locale}.md`, import.meta.url), 'utf8'), locale);
}
const expectedDigits = (value) => (value.match(/\b\d+\b/g) ?? []).sort().join(',');
const expectedPlaceholders = (value) => (value.match(/\{\{[a-z_]+\}\}/g) ?? []).sort().join(',');
const urls = (value) => (value.match(/https?:\/\/[^\s)]+/g) ?? []).map((v) => v.replace(/[.,]$/, '')
  .replace('https://www.edoeb.admin.ch/en/right-to-information', 'https://www.edoeb.admin.ch/fr/droit-dacces')
  .replace('https://www.edoeb.admin.ch/de/auskunftsrecht', 'https://www.edoeb.admin.ch/fr/droit-dacces')
  .replace('https://www.edoeb.admin.ch/it/diritto-daccesso', 'https://www.edoeb.admin.ch/fr/droit-dacces')).sort().join(',');
const mapKey = (key) => canonicalKeys.find((canonical) => key === canonical || key.replace(/_(augusta|performance_valais)$/, '_sion') === canonical);
const translations = [];
for (const doc of source.documents) {
  const canonical = mapKey(doc.key);
  if (!canonical) throw Error(`No canonical text for ${doc.key}`);
  const item = { key: doc.key, source_revision: source.revision, locales: {} };
  const frText = `${doc.title}\n${doc.body}\n${doc.action_label}`;
  for (const locale of ['en', 'de', 'it']) {
    const translation = locales[locale][canonical];
    const text = `${translation.title}\n${translation.body}\n${translation.action_label}`;
    if (expectedPlaceholders(text) !== expectedPlaceholders(frText)) throw Error(`${doc.key} ${locale}: placeholders differ`);
    if (expectedDigits(text) !== expectedDigits(frText)) throw Error(`${doc.key} ${locale}: numbers differ (${expectedDigits(text)} vs ${expectedDigits(frText)})`);
    if (urls(text) !== urls(frText)) throw Error(`${doc.key} ${locale}: URLs differ`);
    if (doc.body.includes('info@activitee.golf') && (text.match(/info@activitee\.golf/g) ?? []).length !== (frText.match(/info@activitee\.golf/g) ?? []).length) throw Error(`${doc.key} ${locale}: email count differs`);
    if (canonical.endsWith('conditions_utilisation') && [...translation.body.matchAll(/^\d+\./gm)].length !== 10) throw Error(`${doc.key} ${locale}: terms section count`);
    if (canonical.endsWith('notice_donnees_personnelles') && [...translation.body.matchAll(/^\d+\./gm)].length !== 10) throw Error(`${doc.key} ${locale}: privacy section count`);
    if (translation.body.length < doc.body.length * 0.7) throw Error(`${doc.key} ${locale}: text unexpectedly short`);
    item.locales[locale] = { ...translation, status: 'needs_review', sha256: createHash('sha256').update(text).digest('hex') };
  }
  translations.push(item);
}
await writeFile(outputPath, JSON.stringify({ source_revision: source.revision, source_sha256: source.source_sha256, translations }, null, 2));
console.log(JSON.stringify({ documents: translations.length, locales: translations.reduce((n, x) => n + Object.keys(x.locales).length, 0), lengths: source.documents.slice(0,6).map((doc) => ({ key: doc.key, fr: doc.body.length, ...Object.fromEntries(['en','de','it'].map((locale) => [locale, locales[locale][doc.key].body.length])) })) }, null, 2));
