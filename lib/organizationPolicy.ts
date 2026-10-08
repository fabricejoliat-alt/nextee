export type OrganizationType = "club" | "academy" | "federation";
export type OrganizationStatus = "pending" | "active" | "suspended" | "ended";
export type OrganizationAccessSummary = {
  organization_id: string; name: string; org_type: OrganizationType;
  player_id: string; accessible: boolean; reason: string | null;
};

export function requestedOrganizationId(url: string) {
  const parsed = new URL(url);
  return parsed.searchParams.get("organization_id") ?? parsed.searchParams.get("organization") ?? parsed.searchParams.get("organizationId") ?? parsed.searchParams.get("club_id")
    ?? parsed.searchParams.get("club") ?? parsed.pathname.match(/\/(?:clubs|organizations)\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;
}

export function organizationGateBlocks(rows: OrganizationAccessSummary[], requested?: string | null) {
  return requested ? !rows.some(row => row.organization_id === requested && row.accessible)
    : !rows.some(row => row.accessible);
}
