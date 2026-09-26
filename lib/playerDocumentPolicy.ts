export const PLAYER_DOCUMENT_BUCKET = "player-documents";
export const LEGACY_PLAYER_DOCUMENT_BUCKET = "marketplace";

export const PLAYER_DOCUMENT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const PLAYER_DOCUMENT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const PLAYER_DOCUMENT_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const PLAYER_DOCUMENT_BUCKET_MAX_BYTES = PLAYER_DOCUMENT_VIDEO_MAX_BYTES;
export const PLAYER_DOCUMENT_SIGNED_URL_TTL_SECONDS = 15 * 60;

export const PLAYER_DOCUMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export const PLAYER_DOCUMENT_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".pdf",
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
].join(",");

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": "application/pdf",
  "application/x-m4v": "video/x-m4v",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

const ALLOWED_MIME_TYPES = new Set<string>(PLAYER_DOCUMENT_ALLOWED_MIME_TYPES);

function fileExtension(fileName: string) {
  return String(fileName ?? "").trim().toLowerCase().split(".").pop() ?? "";
}

export function normalizePlayerDocumentMimeType(mimeType: string | null | undefined, fileName = "") {
  const normalized = String(mimeType ?? "").split(";")[0].trim().toLowerCase();
  const aliased = MIME_ALIASES[normalized] ?? normalized;
  if (aliased && aliased !== "application/octet-stream") return aliased;
  return MIME_BY_EXTENSION[fileExtension(fileName)] ?? "";
}

export function playerDocumentMaxBytesForMime(mimeType: string) {
  if (mimeType.startsWith("video/")) return PLAYER_DOCUMENT_VIDEO_MAX_BYTES;
  if (mimeType.startsWith("image/")) return PLAYER_DOCUMENT_IMAGE_MAX_BYTES;
  return PLAYER_DOCUMENT_FILE_MAX_BYTES;
}

export function validatePlayerDocumentFile(input: {
  fileName: string;
  mimeType: string | null | undefined;
  sizeBytes: number;
}): { ok: true; mimeType: string; maxBytes: number } | { ok: false; error: string } {
  const mimeType = normalizePlayerDocumentMimeType(input.mimeType, input.fileName);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "Type de fichier non autorisé" };
  }

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "Taille de fichier invalide" };
  }

  const maxBytes = playerDocumentMaxBytesForMime(mimeType);
  if (input.sizeBytes > maxBytes) {
    return {
      ok: false,
      error: `Fichier trop volumineux. Limite ${Math.round(maxBytes / (1024 * 1024))} MB pour ce type.`,
    };
  }

  return { ok: true, mimeType, maxBytes };
}

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function playerDocumentSignatureMatches(mimeType: string, bytes: Uint8Array) {
  if (mimeType === "text/plain") return bytes.length > 0 && !bytes.slice(0, 512).includes(0);
  if (bytes.length < 12) return false;
  if (mimeType === "image/jpeg") return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
  if (mimeType === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  if (["image/heic", "image/heif"].includes(mimeType)) {
    return ascii(bytes, 4, 4) === "ftyp" && ["heic", "heix", "hevc", "hevx", "heif", "mif1"].includes(ascii(bytes, 8, 4));
  }
  if (mimeType === "application/pdf") return ascii(bytes, 0, 5) === "%PDF-";
  if (["video/mp4", "video/quicktime", "video/x-m4v"].includes(mimeType)) {
    return ascii(bytes, 4, 4) === "ftyp";
  }
  if (mimeType === "video/webm") return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(mimeType)) {
    return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mimeType.startsWith("application/vnd.openxmlformats-officedocument.")) {
    return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
  }
  return false;
}
