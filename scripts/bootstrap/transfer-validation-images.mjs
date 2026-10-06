#!/usr/bin/env node
// Copy only the public Validation illustrations and update matching catalog URLs.
// Requires separate SOURCE_* and TARGET_* Supabase credentials. Dry-run by default.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const bucket = "validation-exercise-images";
const allowedTypes = new Map([
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["png", "image/png"], ["webp", "image/webp"],
]);
function client(prefix) {
  const url = process.env[`${prefix}_SUPABASE_URL`] || (prefix === "SOURCE" ? process.env.SUPABASE_URL : undefined);
  const key = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`] || (prefix === "SOURCE" ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined);
  if (!url || !key) throw new Error(`${prefix}_SUPABASE_URL and ${prefix}_SUPABASE_SERVICE_ROLE_KEY are required`);
  return { url, db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) };
}
const source = client("SOURCE");
const target = client("TARGET");
if (new URL(source.url).host === new URL(target.url).host) throw new Error("Source and target projects must differ");
if (new URL(source.url).host !== "wizbeuuvjibmmuxyynly.supabase.co"
  || new URL(target.url).host !== "soivxpdcilgltbjbpimt.supabase.co") {
  throw new Error("Unexpected source or Zurich target project");
}
const { data: targetBucket, error: bucketError } = await target.db.storage.getBucket(bucket);
if (bucketError || !targetBucket) throw new Error(`Zurich image bucket missing: ${bucketError?.message}`);
if (!targetBucket.public || targetBucket.file_size_limit !== 5242880
  || ["image/jpeg", "image/png", "image/webp"].some(type => !targetBucket.allowed_mime_types?.includes(type))) {
  throw new Error("Zurich image bucket settings differ from the reviewed configuration");
}

async function readCatalog(project) {
  const [sections, exercises] = await Promise.all([
    project.db.from("validation_sections").select("id,slug"),
    project.db.from("validation_exercises").select("id,section_id,external_code,illustration_url"),
  ]);
  if (sections.error) throw sections.error;
  if (exercises.error) throw exercises.error;
  const slugs = new Map(sections.data.map((section) => [section.id, section.slug]));
  return exercises.data.map((row) => ({ ...row, key: `${slugs.get(row.section_id)}:${row.external_code}` }));
}

function sourcePath(value) {
  const url = new URL(value);
  if (url.host !== new URL(source.url).host) throw new Error(`Illustration is outside source project: ${url.host}`);
  const marker = `/storage/v1/object/public/${bucket}/`;
  if (!url.pathname.startsWith(marker)) throw new Error("Unexpected Validation illustration URL");
  const path = decodeURIComponent(url.pathname.slice(marker.length));
  if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("Unsafe illustration path");
  return path;
}

const sourceRows = await readCatalog(source);
const targetRows = await readCatalog(target);
const targetByKey = new Map(targetRows.map((row) => [row.key, row]));
const planned = sourceRows.filter((row) => row.illustration_url).map((row) => {
  const targetRow = targetByKey.get(row.key);
  if (!targetRow) throw new Error(`Target Validation exercise missing: ${row.key}`);
  const path = sourcePath(row.illustration_url);
  const desiredUrl = target.db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  return { key: row.key, path, id: targetRow.id, currentUrl: targetRow.illustration_url, desiredUrl };
});
if (sourceRows.length !== 60 || targetRows.length !== 60 || planned.length !== 40) {
  throw new Error(`Unexpected catalog size: source=${sourceRows.length}, target=${targetRows.length}, illustrated=${planned.length}`);
}
if (new Set(planned.map((row) => row.path)).size !== planned.length) throw new Error("Duplicate illustration path");
if (planned.some((row) => row.currentUrl && row.currentUrl !== row.desiredUrl)) {
  throw new Error("Zurich has an unexpected existing illustration URL; stopped");
}

console.log(JSON.stringify({ source: new URL(source.url).host, target: new URL(target.url).host,
  mode: apply ? "apply" : "dry-run", exercises: targetRows.length, illustrations: planned.length,
  linksToUpdate: planned.filter((row) => row.currentUrl !== row.desiredUrl).length }));
if (!apply) process.exit(0);

let copied = 0;
let linked = 0;
for (const row of planned) {
  const { data: sourceBlob, error: downloadError } = await source.db.storage.from(bucket).download(row.path);
  if (downloadError || !sourceBlob) throw new Error(`Source download failed for ${row.path}: ${downloadError?.message}`);
  const sourceBytes = Buffer.from(await sourceBlob.arrayBuffer());
  const contentType = allowedTypes.get(row.path.split(".").pop()?.toLowerCase());
  if (!contentType || sourceBytes.length === 0 || sourceBytes.length > 5242880) {
    throw new Error(`Unexpected source image type or size: ${row.path}`);
  }
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  // storage.download() wraps a missing-object 404 in StorageUnknownError with
  // message "{}". Use the SDK's HEAD-based exists() first instead.
  const { data: targetExists, error: existsError } = await target.db.storage.from(bucket).exists(row.path);
  if (existsError && ![400, 404].includes(existsError.originalError?.status)) {
    throw new Error(`Target existence check failed for ${row.path}: ${existsError.message}`);
  }
  if (targetExists) {
    const { data: existing, error: existingError } = await target.db.storage.from(bucket).download(row.path);
    if (existingError || !existing) throw new Error(`Target download failed for ${row.path}: ${existingError?.message}`);
    const targetHash = createHash("sha256").update(Buffer.from(await existing.arrayBuffer())).digest("hex");
    if (targetHash !== sourceHash) throw new Error(`Target object differs; refusing overwrite: ${row.path}`);
  } else {
    const { error: uploadError } = await target.db.storage.from(bucket).upload(row.path, sourceBytes,
      { contentType, upsert: false });
    if (uploadError) throw new Error(`Target upload failed for ${row.path}: ${uploadError.message}`);
    copied += 1;
  }
  if (row.currentUrl !== row.desiredUrl) {
    const { error: updateError } = await target.db.from("validation_exercises")
      .update({ illustration_url: row.desiredUrl }).eq("id", row.id);
    if (updateError) throw new Error(`URL update failed for ${row.key}: ${updateError.message}`);
    linked += 1;
  }
}
console.log(JSON.stringify({ copied, linked, verified: planned.length }));
