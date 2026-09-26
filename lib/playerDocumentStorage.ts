/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PlayerDocumentUploadReservation } from "@/lib/playerDocumentUpload";
import {
  LEGACY_PLAYER_DOCUMENT_BUCKET,
  PLAYER_DOCUMENT_BUCKET,
  PLAYER_DOCUMENT_SIGNED_URL_TTL_SECONDS,
  normalizePlayerDocumentMimeType,
  playerDocumentSignatureMatches,
  validatePlayerDocumentFile,
} from "@/lib/playerDocumentPolicy";

type DocumentStorageRow = {
  storage_bucket?: string | null;
  storage_path: string;
};

const ALLOWED_BUCKETS = new Set([PLAYER_DOCUMENT_BUCKET, LEGACY_PLAYER_DOCUMENT_BUCKET]);

export function playerDocumentStorageBucket(value: string | null | undefined) {
  const bucket = String(value ?? "").trim() || LEGACY_PLAYER_DOCUMENT_BUCKET;
  if (!ALLOWED_BUCKETS.has(bucket)) throw new Error("Invalid player document bucket");
  return bucket;
}

export async function signPlayerDocumentRows<T extends DocumentStorageRow>(
  supabaseAdmin: any,
  rows: T[]
): Promise<Array<T & { public_url: string; signed_url: string; url_expires_at: string }>> {
  const signedByKey = new Map<string, string>();
  const pathsByBucket = new Map<string, string[]>();

  for (const row of rows) {
    const bucket = playerDocumentStorageBucket(row.storage_bucket);
    const paths = pathsByBucket.get(bucket) ?? [];
    if (!paths.includes(row.storage_path)) paths.push(row.storage_path);
    pathsByBucket.set(bucket, paths);
  }

  for (const [bucket, paths] of pathsByBucket.entries()) {
    if (paths.length === 0) continue;
    const signedRes = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrls(paths, PLAYER_DOCUMENT_SIGNED_URL_TTL_SECONDS);
    if (signedRes.error) throw new Error(signedRes.error.message);
    for (const item of signedRes.data ?? []) {
      const path = String(item.path ?? "").trim();
      const signedUrl = String(item.signedUrl ?? "").trim();
      if (!path || !signedUrl || item.error) {
        throw new Error(String(item.error ?? "Unable to sign player document URL"));
      }
      signedByKey.set(`${bucket}:${path}`, signedUrl);
    }
  }

  const expiresAt = new Date(Date.now() + PLAYER_DOCUMENT_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return rows.map((row) => {
    const bucket = playerDocumentStorageBucket(row.storage_bucket);
    const signedUrl = signedByKey.get(`${bucket}:${row.storage_path}`) ?? "";
    if (!signedUrl) throw new Error("Unable to sign player document URL");
    return {
      ...row,
      public_url: signedUrl,
      signed_url: signedUrl,
      url_expires_at: expiresAt,
    };
  });
}

export async function validatePlayerDocumentEventLink(
  supabaseAdmin: any,
  organizationId: string,
  playerId: string,
  clubEventId: string | null
) {
  if (!clubEventId) return null;
  const [eventRes, attendeeRes] = await Promise.all([
    supabaseAdmin.from("club_events").select("id,club_id").eq("id", clubEventId).maybeSingle(),
    supabaseAdmin
      .from("club_event_attendees")
      .select("event_id")
      .eq("event_id", clubEventId)
      .eq("player_id", playerId)
      .maybeSingle(),
  ]);
  if (eventRes.error) return eventRes.error.message;
  if (attendeeRes.error) return attendeeRes.error.message;
  if (String(eventRes.data?.club_id ?? "") !== organizationId) {
    return "L’activité n’appartient pas à cette organisation";
  }
  if (!attendeeRes.data?.event_id) return "Le joueur n’est pas inscrit à cette activité";
  return null;
}

export async function persistPlayerDocumentUploadReservation(
  supabaseAdmin: any,
  reservation: PlayerDocumentUploadReservation
) {
  const insertRes = await supabaseAdmin.from("player_document_upload_reservations").insert({
    id: reservation.reservationId,
    storage_bucket: reservation.bucket,
    storage_path: reservation.storagePath,
    organization_id: reservation.organizationId,
    player_id: reservation.playerId,
    uploaded_by: reservation.uploadedBy,
    original_name: reservation.originalName,
    mime_type: reservation.mimeType,
    size_bytes: reservation.sizeBytes,
    club_event_id: reservation.clubEventId,
    coach_only: reservation.coachOnly,
    expires_at: new Date(reservation.expiresAt).toISOString(),
  });
  if (insertRes.error) throw new Error(insertRes.error.message);
}

export async function requirePendingPlayerDocumentUploadReservation(
  supabaseAdmin: any,
  reservation: PlayerDocumentUploadReservation
) {
  const result = await supabaseAdmin
    .from("player_document_upload_reservations")
    .select("id,storage_bucket,storage_path,organization_id,player_id,uploaded_by,original_name,mime_type,size_bytes,club_event_id,coach_only,expires_at,finalized_at")
    .eq("id", reservation.reservationId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data;
  if (!row) return "Upload reservation not found";
  if (row.finalized_at) return "Upload already finalized";
  if (new Date(String(row.expires_at)).getTime() < Date.now()) return "Upload reservation expired";

  const matches =
    String(row.storage_bucket) === reservation.bucket &&
    String(row.storage_path) === reservation.storagePath &&
    String(row.organization_id) === reservation.organizationId &&
    String(row.player_id) === reservation.playerId &&
    String(row.uploaded_by) === reservation.uploadedBy &&
    String(row.original_name) === reservation.originalName &&
    String(row.mime_type) === reservation.mimeType &&
    Number(row.size_bytes) === reservation.sizeBytes &&
    (row.club_event_id ? String(row.club_event_id) : null) === reservation.clubEventId &&
    Boolean(row.coach_only) === reservation.coachOnly;
  return matches ? null : "Upload reservation does not match persisted state";
}

export async function finalizePlayerDocumentUploadReservation(
  supabaseAdmin: any,
  reservationId: string
) {
  const result = await supabaseAdmin
    .from("player_document_upload_reservations")
    .update({ finalized_at: new Date().toISOString() })
    .eq("id", reservationId)
    .is("finalized_at", null);
  if (result.error) throw new Error(result.error.message);
}

export async function discardPlayerDocumentUploadReservation(
  supabaseAdmin: any,
  reservationId: string
) {
  const result = await supabaseAdmin
    .from("player_document_upload_reservations")
    .delete()
    .eq("id", reservationId)
    .is("finalized_at", null);
  if (result.error) throw new Error(result.error.message);
}

async function readObjectPrefix(supabaseAdmin: any, bucket: string, storagePath: string) {
  const signedRes = await supabaseAdmin.storage.from(bucket).createSignedUrl(storagePath, 60);
  if (signedRes.error || !signedRes.data?.signedUrl) {
    throw new Error(signedRes.error?.message ?? "Unable to inspect uploaded object");
  }
  const response = await fetch(signedRes.data.signedUrl, { headers: { Range: "bytes=0-511" }, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Unable to inspect uploaded object");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < 512) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = 512 - length;
      const chunk = value.length > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function inspectUploadedPlayerDocument(
  supabaseAdmin: any,
  input: { bucket: string; storagePath: string; originalName: string; mimeType: string; sizeBytes: number }
): Promise<{ ok: true; mimeType: string; sizeBytes: number } | { ok: false; error: string; cleanup: boolean }> {
  const infoRes = await supabaseAdmin.storage.from(input.bucket).info(input.storagePath);
  if (infoRes.error || !infoRes.data) {
    return { ok: false, error: "Uploaded object not found", cleanup: false };
  }

  const actualSize = Number(infoRes.data.size ?? 0);
  const actualMime = normalizePlayerDocumentMimeType(
    infoRes.data.contentType ?? infoRes.data.metadata?.mimetype ?? infoRes.data.metadata?.contentType,
    input.originalName
  );
  const validation = validatePlayerDocumentFile({
    fileName: input.originalName,
    mimeType: actualMime,
    sizeBytes: actualSize,
  });
  if (validation.ok === false) return { ok: false, error: validation.error, cleanup: true };
  if (validation.mimeType !== input.mimeType || actualSize !== input.sizeBytes) {
    return { ok: false, error: "Uploaded object metadata does not match the reservation", cleanup: true };
  }

  try {
    const bytes = await readObjectPrefix(supabaseAdmin, input.bucket, input.storagePath);
    if (!playerDocumentSignatureMatches(actualMime, bytes)) {
      return { ok: false, error: "File content does not match its declared type", cleanup: true };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to inspect uploaded object",
      cleanup: false,
    };
  }

  return { ok: true, mimeType: actualMime, sizeBytes: actualSize };
}

export async function removePlayerDocumentObject(supabaseAdmin: any, bucket: string, storagePath: string) {
  const removeRes = await supabaseAdmin.storage.from(playerDocumentStorageBucket(bucket)).remove([storagePath]);
  return removeRes.error ? removeRes.error.message : null;
}
