export function adminContentSecurityPolicy(nonce: string, storageUrl?: string, development = false) {
  const origin = storageUrl ? new URL(storageUrl).origin : "";
  const websocket = origin.replace(/^http/, "ws");
  return [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
    "font-src 'self' data:", `connect-src 'self' ${origin} ${websocket}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "media-src 'self' blob: https:", "frame-src 'none'", "form-action 'self'",
  ].join("; ");
}
