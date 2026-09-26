export type PlayerConsentStatus = "granted" | "pending" | "refused" | "adult";

const ALLOWED_STATUSES = new Set<PlayerConsentStatus>(["granted", "adult"]);

export function resolvePlayerConsentStatus(
  statuses: Array<string | null | undefined>
): PlayerConsentStatus {
  const normalized = statuses.map((status) => String(status ?? "").trim().toLowerCase());

  if (normalized.length === 0) return "pending";
  if (normalized.some((status) => status === "refused")) return "refused";
  if (normalized.some((status) => !ALLOWED_STATUSES.has(status as PlayerConsentStatus))) {
    return "pending";
  }
  if (normalized.every((status) => status === "adult")) return "adult";
  return "granted";
}

export function playerConsentAllowsAccess(
  statuses: Array<string | null | undefined>
) {
  const status = resolvePlayerConsentStatus(statuses);
  return status === "granted" || status === "adult";
}
