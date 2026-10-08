/** Apply only after checking access to the player. Null means player-owned history. */
export function personalOrOrganizationFilter(column: "club_id" | "organization_id", organizationIds: string[]) {
  const ids = [...new Set(organizationIds)];
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Invalid organization scope");
  }
  return ids.length ? `${column}.is.null,${column}.in.(${ids.join(",")})` : `${column}.is.null`;
}
