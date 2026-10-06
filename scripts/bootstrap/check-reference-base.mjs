#!/usr/bin/env node
// Read-only inventory for a source project or a club-free production candidate.
// Run with: node --env-file=.env.local scripts/bootstrap/check-reference-base.mjs --mode=source
import { createClient } from "@supabase/supabase-js";

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
if (mode !== "source" && mode !== "target") {
  throw new Error("Choose --mode=source or --mode=target");
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const projectHost = new URL(url).host;
const errors = [];
const counts = {};

async function count(table) {
  const { count: value, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) {
    errors.push(`${table}: ${error.message}`);
    return null;
  }
  counts[table] = value;
  return value;
}

for (const table of [
  "clubs", "organizations", "club_members", "profiles", "app_admins",
  "coach_groups", "club_seasons", "club_events", "club_camps", "club_news",
  "club_trainings", "player_guardians", "notifications", "rules_quiz_attempts",
  "app_translations", "legal_documents", "legal_drafts", "legal_versions",
  "rules_seasons", "rules_series", "rules_cards", "rules_card_versions", "rules_questions",
  "etiquette_themes", "etiquette_cards", "etiquette_card_versions",
  "validation_sections", "validation_exercises", "training_volume_targets",
]) await count(table);

const { data: documents, error: legalError } = await db.from("legal_documents")
  .select("scope,active,club_id,document_key");
if (legalError) errors.push(`legal_documents detail: ${legalError.message}`);
const legal = { platformActive: 0, clubActive: 0, clubTotal: 0, qaTotal: 0 };
for (const document of documents ?? []) {
  if (document.scope === "platform" && document.active) legal.platformActive += 1;
  if (document.scope === "club") {
    legal.clubTotal += 1;
    if (document.active) legal.clubActive += 1;
  }
  if (document.document_key?.startsWith("legalqa_")) legal.qaTotal += 1;
}

const { data: illustrations, error: imageError } = await db.from("validation_exercises")
  .select("illustration_url");
if (imageError) errors.push(`validation_exercises illustrations: ${imageError.message}`);
const imageUrls = (illustrations ?? []).map((row) => row.illustration_url).filter(Boolean);
const foreignImageHosts = [...new Set(imageUrls.flatMap((value) => {
  try {
    const host = new URL(value).host;
    return host === projectHost ? [] : [host];
  } catch {
    return ["invalid-or-relative-url"];
  }
}))];

const { data: imageObjects, error: bucketError } = await db.storage
  .from("validation-exercise-images").list("", { limit: 1000 });
if (bucketError) errors.push(`validation-exercise-images bucket: ${bucketError.message}`);

const auth = { users: null };
if (mode === "target") {
  let page = 1;
  let total = 0;
  while (true) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { errors.push(`auth users: ${error.message}`); break; }
    total += data.users.length;
    if (data.users.length < 1000) { auth.users = total; break; }
    page += 1;
  }
}

const checks = mode === "target" ? {
  noClubs: ["clubs", "organizations", "club_members", "coach_groups", "club_seasons",
    "club_events", "club_camps", "club_news", "club_trainings", "player_guardians",
    "notifications", "rules_quiz_attempts"].every((table) => counts[table] === 0),
  onlySuperadmin: counts.app_admins === 1 && counts.profiles === 1 && auth.users === 1,
  legalPlatformReady: legal.platformActive >= 3,
  noClubLegalRecords: legal.clubTotal === 0 && legal.qaTotal === 0,
  rulesReady: counts.rules_series >= 12 && counts.rules_cards >= 72 && counts.rules_questions >= 216,
  etiquetteReady: counts.etiquette_themes >= 12 && counts.etiquette_cards >= 36,
  validationsReady: counts.validation_sections >= 4 && counts.validation_exercises >= 60,
  illustrationsReady: imageUrls.length >= 40 && (imageObjects?.length ?? 0) >= 40 && foreignImageHosts.length === 0,
  noClubFtemRows: counts.training_volume_targets === 0,
} : {};

console.log(JSON.stringify({
  mode, projectHost, counts, legal,
  illustrations: { referenced: imageUrls.length, bucketRootObjects: imageObjects?.length ?? null, foreignHosts: foreignImageHosts },
  auth, checks, errors,
}, null, 2));
if (errors.length || Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
