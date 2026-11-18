import { validatePlayerDocumentFile } from "./playerDocumentPolicy.ts";
import type { DocumentUploadProgress } from "./uploadDocumentWithProgress.ts";

/** Keep the activity and junior fixed throughout the signed upload reservation. */
export async function uploadCoachActivityDocument(input: {
  playerId: string;
  eventId: string;
  organizationId: string;
  token: string;
  file: File;
  name: string;
}, dependencies: {
  fetch: typeof fetch;
  transfer: (url: string, file: File, mimeType: string, progress: (percent: number) => void) => Promise<void>;
  progress: (state: DocumentUploadProgress) => void;
}) {
  if (!input.playerId || !input.eventId || !input.organizationId || !input.token || !input.name.trim()) {
    throw new Error("Informations du document incomplètes.");
  }
  const validation = validatePlayerDocumentFile({ fileName: input.file.name, mimeType: input.file.type, sizeBytes: input.file.size });
  if (validation.ok === false) throw new Error(validation.error);
  const endpoint = `/api/coach/players/${encodeURIComponent(input.playerId)}/documents?organization_id=${encodeURIComponent(input.organizationId)}`;
  const metadata = {
    organization_id: input.organizationId,
    club_event_id: input.eventId,
    coach_only: false,
    original_name: input.file.name,
    mime_type: validation.mimeType,
    size_bytes: input.file.size,
  };
  async function post(body: Record<string, unknown>) {
    const response = await dependencies.fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload.error ?? "Envoi impossible. Réessayez."));
    return payload;
  }
  dependencies.progress({ phase: "preparing", percent: 0 });
  const reservation = await post({ ...metadata, action: "prepare" });
  if (!reservation.upload_url || !reservation.path || !reservation.reservation_token || !reservation.mime_type) {
    throw new Error("Préparation de l’envoi impossible.");
  }
  dependencies.progress({ phase: "uploading", percent: 0 });
  await dependencies.transfer(reservation.upload_url, input.file, reservation.mime_type,
    percent => dependencies.progress({ phase: "uploading", percent }));
  dependencies.progress({ phase: "finalizing", percent: 100 });
  const result = await post({
    ...metadata,
    action: "finalize",
    mime_type: reservation.mime_type,
    storage_path: reservation.path,
    reservation_token: reservation.reservation_token,
    file_name: input.name.trim(),
  });
  if (!result.document?.id) throw new Error("Enregistrement du document non confirmé.");
  dependencies.progress({ phase: "complete", percent: 100 });
  return result.document;
}
