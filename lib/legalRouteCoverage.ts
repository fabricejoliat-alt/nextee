// These are authenticated business surfaces. Recovery, legal decisions, public
// catalogs, service jobs and Admin operations have separate access contracts.
export function legalRouteKind(path: string): "page" | "api" | null {
  if (["/player/consent-required", "/player/help", "/api/player/consent"].includes(path)) return null;
  if (["player", "coach", "manager"].some((role) => path === `/${role}` || path.startsWith(`/${role}/`))) return "page";
  if (["player", "coach", "manager", "parent", "messages", "rules", "etiquette"].some((area) => path.startsWith(`/api/${area}/`))
    || path === "/api/profile/custom-fields") return "api";
  return null;
}
