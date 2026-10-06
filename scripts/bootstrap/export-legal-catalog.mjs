#!/usr/bin/env node
// Export only published legal text and applicability for a fresh installation.
// User IDs, club IDs, signatures, presentations and decisions are never exported.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
if (!output) throw new Error("Choose --out=/absolute/path/catalog.json");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function textOnly(translations) {
  return Object.fromEntries(["fr", "en", "de", "it"].map((locale) => {
    const entry = translations?.[locale];
    if (!entry || entry.status !== "approved") {
      throw new Error(`Published version lacks approved ${locale} translation`);
    }
    return [locale, {
      title: entry.title,
      body: entry.body,
      action_label: entry.action_label,
    }];
  }));
}

const { data: documents, error: documentsError } = await db.from("legal_documents")
  .select("id,document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active,applicability,required_locales")
  .eq("active", true);
if (documentsError) throw documentsError;
const { data: versions, error: versionsError } = await db.from("legal_versions")
  .select("document_id,version_number,snapshot,content_sha256")
  .order("version_number", { ascending: false });
if (versionsError) throw versionsError;
const latest = new Map();
for (const version of versions) if (!latest.has(version.document_id)) latest.set(version.document_id, version);

function entry(document) {
  const version = latest.get(document.id);
  if (!version) throw new Error(`Active document lacks a published version: ${document.document_key}`);
  const snapshot = version.snapshot;
  const result = {
    kind: document.kind,
    purpose_key: document.purpose_key,
    audience_roles: document.audience_roles,
    action_kind: document.action_kind,
    required: document.required,
    applicability: document.applicability,
    required_locales: document.required_locales,
    allowed_variables: snapshot.allowed_variables,
    translations: textOnly(snapshot.translations),
  };
  if (JSON.stringify(canonical(snapshot.applicability)) !== JSON.stringify(canonical(document.applicability))) {
    throw new Error(`Published applicability differs from active document: ${document.document_key}`);
  }
  return result;
}

const platformDocuments = (documents ?? []).filter((document) => document.scope === "platform")
  .map((document) => ({ document_key: document.document_key, ...entry(document) }))
  .sort((a, b) => a.document_key.localeCompare(b.document_key));
if (platformDocuments.length !== 3) throw new Error(`Expected 3 active platform documents, found ${platformDocuments.length}`);

const clubDocuments = (documents ?? []).filter((document) => document.scope === "club");
const clubPurposes = [...new Set(clubDocuments.map((document) => document.purpose_key))].sort();
if (clubPurposes.length !== 3 || clubDocuments.length !== 9) {
  throw new Error(`Expected 3 club purposes and 9 active documents, found ${clubPurposes.length} and ${clubDocuments.length}`);
}
const clubTemplates = clubPurposes.map((purpose) => {
  const variants = clubDocuments.filter((document) => document.purpose_key === purpose).map(entry);
  const first = JSON.stringify(canonical(variants[0]));
  if (variants.length !== 3 || variants.some((item) => JSON.stringify(canonical(item)) !== first)) {
    throw new Error(`Published club documents differ for ${purpose}`);
  }
  return variants[0];
});

const payload = { format: "activitee-legal-catalog-v1", platformDocuments, clubTemplates };
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
await writeFile(output, serialized, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  output,
  platformDocuments: platformDocuments.length,
  clubTemplates: clubTemplates.length,
  sha256: createHash("sha256").update(serialized).digest("hex"),
}));
