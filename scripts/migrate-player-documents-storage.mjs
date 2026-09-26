import { createClient } from "@supabase/supabase-js";

const SOURCE_BUCKET = "marketplace";
const DESTINATION_BUCKET = "player-documents";
const apply = process.argv.includes("--apply");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function loadLegacyDocuments() {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const result = await db
      .from("player_dashboard_documents")
      .select("id,organization_id,player_id,storage_bucket,storage_path")
      .eq("storage_bucket", SOURCE_BUCKET)
      .order("created_at", { ascending: true })
      .range(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) break;
  }
  return rows;
}

async function objectInfo(bucket, path) {
  const result = await db.storage.from(bucket).info(path);
  return result.error || !result.data ? null : result.data;
}

async function removeObject(bucket, path) {
  const result = await db.storage.from(bucket).remove([path]);
  if (result.error) throw new Error(result.error.message);
}

function resolveStoragePaths(document) {
  const id = String(document.id ?? "");
  const organizationId = String(document.organization_id ?? "");
  const playerId = String(document.player_id ?? "");
  const sourcePath = String(document.storage_path ?? "");

  const scopedPrefix = `player-documents/${organizationId}/${playerId}/`;
  const scopedName = sourcePath.slice(scopedPrefix.length);
  if (
    id &&
    organizationId &&
    playerId &&
    sourcePath.startsWith(scopedPrefix) &&
    scopedName.length > 0 &&
    !scopedName.includes("/")
  ) {
    return { id, sourcePath, destinationPath: sourcePath, sourceFormat: "scoped" };
  }

  const migratedPrefix = `migrated/${playerId}/${id}/`;
  const migratedName = sourcePath.slice(migratedPrefix.length);
  if (
    id &&
    organizationId &&
    playerId &&
    sourcePath.startsWith(migratedPrefix) &&
    migratedName.length > 0 &&
    !migratedName.includes("/")
  ) {
    return {
      id,
      sourcePath,
      destinationPath: `${scopedPrefix}${id}-${migratedName}`,
      sourceFormat: "legacy-migrated",
    };
  }

  return null;
}

async function migrateDocument(document) {
  const paths = resolveStoragePaths(document);
  if (!paths) {
    return {
      id: String(document.id ?? ""),
      organizationId: String(document.organization_id ?? ""),
      playerId: String(document.player_id ?? ""),
      sourcePath: String(document.storage_path ?? ""),
      status: "invalid-path",
    };
  }
  const { id, sourcePath, destinationPath, sourceFormat } = paths;

  const [sourceInfo, existingDestinationInfo] = await Promise.all([
    objectInfo(SOURCE_BUCKET, sourcePath),
    objectInfo(DESTINATION_BUCKET, destinationPath),
  ]);
  if (!sourceInfo && !existingDestinationInfo) {
    return { id, sourcePath, destinationPath, sourceFormat, status: "missing-object" };
  }
  if (!apply) {
    if (sourceInfo && existingDestinationInfo) {
      return {
        id,
        sourcePath,
        destinationPath,
        sourceFormat,
        status:
          Number(sourceInfo.size ?? 0) === Number(existingDestinationInfo.size ?? 0)
            ? "ready-source-and-destination"
            : "destination-size-mismatch",
      };
    }
    return {
      id,
      sourcePath,
      destinationPath,
      sourceFormat,
      status: sourceInfo ? "ready-to-copy" : "ready-to-reconcile",
    };
  }

  let destinationInfo = existingDestinationInfo;
  if (!destinationInfo) {
    const copyResult = await db.storage
      .from(SOURCE_BUCKET)
      .copy(sourcePath, destinationPath, { destinationBucket: DESTINATION_BUCKET });
    if (copyResult.error) throw new Error(copyResult.error.message);
    destinationInfo = await objectInfo(DESTINATION_BUCKET, destinationPath);
  }
  if (!destinationInfo) throw new Error("Destination object is missing after copy");
  if (sourceInfo && Number(sourceInfo.size ?? 0) !== Number(destinationInfo.size ?? 0)) {
    await removeObject(DESTINATION_BUCKET, destinationPath);
    throw new Error("Destination object size does not match source");
  }

  if (sourceInfo) {
    try {
      await removeObject(SOURCE_BUCKET, sourcePath);
    } catch (error) {
      await removeObject(DESTINATION_BUCKET, destinationPath).catch(() => undefined);
      throw error;
    }
  }

  const updateResult = await db
    .from("player_dashboard_documents")
    .update({ storage_bucket: DESTINATION_BUCKET, storage_path: destinationPath })
    .eq("id", id)
    .eq("storage_bucket", SOURCE_BUCKET)
    .eq("storage_path", sourcePath)
    .select("id")
    .maybeSingle();
  if (updateResult.error || !updateResult.data?.id) {
    const restoreResult = await db.storage
      .from(DESTINATION_BUCKET)
      .copy(destinationPath, sourcePath, { destinationBucket: SOURCE_BUCKET });
    if (!restoreResult.error) {
      await removeObject(DESTINATION_BUCKET, destinationPath).catch(() => undefined);
    }
    throw new Error(updateResult.error?.message ?? "Document metadata was not updated");
  }

  return { id, sourcePath, destinationPath, sourceFormat, status: "migrated" };
}

const documents = await loadLegacyDocuments();
const results = [];
for (const document of documents) {
  try {
    results.push(await migrateDocument(document));
  } catch (error) {
    results.push({
      id: String(document.id ?? ""),
      sourcePath: String(document.storage_path ?? ""),
      status: "failed",
      error: error instanceof Error ? error.message : "Migration failed",
    });
  }
}

const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] ?? 0) + 1;
  return summary;
}, {});

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", total: documents.length, counts, results }, null, 2));
if (
  results.some((result) =>
    ["failed", "invalid-path", "missing-object", "destination-size-mismatch"].includes(result.status)
  )
) {
  process.exitCode = 1;
}
