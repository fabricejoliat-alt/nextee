export type StatisticsOrganization = { id: string; name: string; org_type: "club" | "academy" };

/** The caller supplies only affiliations that the server has authorized. */
export function resolvePlayerStatisticsScope(
  requested: string,
  currentId: string,
  organizations: StatisticsOrganization[],
) {
  const selected = requested === "current" ? currentId : requested;
  const ids = selected === "all" ? organizations.map(row => row.id) : [selected];
  if (!ids.length || ids.some(id => !organizations.some(row => row.id === id))) return null;
  return { selected, organizationIds: [...new Set(ids)] };
}

export function statisticsRowInScope(organizationId: string | null, organizationIds: string[], includePersonal: boolean) {
  return organizationId == null ? includePersonal : organizationIds.includes(organizationId);
}
