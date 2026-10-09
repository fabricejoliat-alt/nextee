export const ADMIN_VERIFICATION_SECONDS = 15 * 60;

/** Only pass claims returned by Supabase's signature-verifying getClaims(). */
export function adminAssurance(claims: Record<string, unknown> | null, actorId: string, now = Date.now()) {
  if (!claims || claims.sub !== actorId || claims.aal !== "aal2") return { mfa: false, recent: false };
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  const lastMfa = Math.max(0, ...methods.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return 0;
    const method = entry as { method?: unknown; timestamp?: unknown };
    return method.method === "totp" && typeof method.timestamp === "number" ? method.timestamp : 0;
  }));
  const age = now / 1000 - lastMfa;
  return { mfa: true, recent: lastMfa > 0 && age >= -30 && age <= ADMIN_VERIFICATION_SECONDS };
}

export function isLegacyManagerAdminRoute(path: string) {
  return /^\/api\/admin\/clubs\/[^/]+\/(create-member|add-existing-member|add-existing-member-preview)\/?$/.test(path)
    || /^\/api\/admin\/organizations\/[^/]+\/group-assignments\/?$/.test(path);
}

export function initialPasswordRequired(user: { app_metadata?: Record<string, unknown> }) {
  return user.app_metadata?.initial_password_required === true;
}
