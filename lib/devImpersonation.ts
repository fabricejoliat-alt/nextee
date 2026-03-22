import type { NextRequest } from "next/server";

function isLocalHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return (
    normalized.startsWith("localhost:") ||
    normalized === "localhost" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("[::1]:") ||
    normalized === "[::1]" ||
    normalized.startsWith("::1:") ||
    normalized === "::1"
  );
}

export function isDevImpersonationEnabled(req?: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.DEV_IMPERSONATION_ENABLED === "false") return false;
  if (!req) return true;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return isLocalHost(host);
}

export function assertDevImpersonationEnabled(req?: NextRequest) {
  if (!isDevImpersonationEnabled(req)) {
    throw new Error("Dev impersonation is disabled.");
  }
}
