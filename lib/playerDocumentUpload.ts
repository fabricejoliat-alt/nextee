import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const RESERVATION_VERSION = 1;
// Supabase signed upload URLs are valid for two hours. Keep the application
// reservation aligned with that window and delay cleanup slightly to avoid a
// boundary race with an upload that started just before expiry.
export const DOCUMENT_UPLOAD_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
export const DOCUMENT_UPLOAD_CLEANUP_GRACE_MS = 10 * 60 * 1000;

export type PlayerDocumentUploadReservation = {
  reservationId: string;
  version: number;
  bucket: string;
  storagePath: string;
  organizationId: string;
  playerId: string;
  uploadedBy: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  clubEventId: string | null;
  coachOnly: boolean;
  expiresAt: number;
};

type ReservationInput = Omit<PlayerDocumentUploadReservation, "version" | "expiresAt">;
export type PlayerDocumentUploadReservationInput = Omit<ReservationInput, "reservationId">;

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(`player-document-upload:${encodedPayload}`).digest("base64url");
}

export function playerDocumentPathPrefix(organizationId: string, playerId: string) {
  return `player-documents/${organizationId}/${playerId}/`;
}

export function buildPlayerDocumentObjectPath(
  organizationId: string,
  playerId: string,
  originalName: string
) {
  const safeName = String(originalName || "document")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120) || "document";
  return `${playerDocumentPathPrefix(organizationId, playerId)}${Date.now()}-${randomUUID()}-${safeName}`;
}

export function isOwnedPlayerDocumentPath(
  storagePath: string,
  organizationId: string,
  playerId: string
) {
  const prefix = playerDocumentPathPrefix(organizationId, playerId);
  const suffix = storagePath.slice(prefix.length);
  return storagePath.startsWith(prefix) && suffix.length > 0 && !suffix.includes("/");
}

export function createPlayerDocumentUploadReservation(
  input: PlayerDocumentUploadReservationInput,
  secret: string,
  now = Date.now()
) {
  return issuePlayerDocumentUploadReservation(input, secret, now).token;
}

export function issuePlayerDocumentUploadReservation(
  input: PlayerDocumentUploadReservationInput,
  secret: string,
  now = Date.now()
) {
  const payload: PlayerDocumentUploadReservation = {
    ...input,
    reservationId: randomUUID(),
    version: RESERVATION_VERSION,
    expiresAt: now + DOCUMENT_UPLOAD_RESERVATION_TTL_MS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    reservation: payload,
  };
}

export function verifyPlayerDocumentUploadReservation(
  token: string,
  expected: PlayerDocumentUploadReservationInput,
  secret: string,
  now = Date.now()
): { ok: true; reservation: PlayerDocumentUploadReservation } | { ok: false; error: string } {
  const [encodedPayload, providedSignature, extra] = String(token ?? "").split(".");
  if (!encodedPayload || !providedSignature || extra) {
    return { ok: false, error: "Invalid upload reservation" };
  }

  const expectedSignature = sign(encodedPayload, secret);
  const expectedBytes = Buffer.from(expectedSignature);
  const providedBytes = Buffer.from(providedSignature);
  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return { ok: false, error: "Invalid upload reservation" };
  }

  let reservation: PlayerDocumentUploadReservation;
  try {
    reservation = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid upload reservation" };
  }

  if (reservation.version !== RESERVATION_VERSION || reservation.expiresAt < now) {
    return { ok: false, error: "Upload reservation expired" };
  }

  const matches =
    reservation.bucket === expected.bucket &&
    reservation.storagePath === expected.storagePath &&
    reservation.organizationId === expected.organizationId &&
    reservation.playerId === expected.playerId &&
    reservation.uploadedBy === expected.uploadedBy &&
    reservation.originalName === expected.originalName &&
    reservation.mimeType === expected.mimeType &&
    reservation.sizeBytes === expected.sizeBytes &&
    reservation.clubEventId === expected.clubEventId &&
    reservation.coachOnly === expected.coachOnly;

  return matches
    ? { ok: true, reservation }
    : { ok: false, error: "Upload reservation does not match this document" };
}
