import type { RulesSeasonAttemptScore } from "./rulesLearning";

type Organization = { id: string; is_demo: boolean; org_type: string };
export type SourcedRulesAttemptScore = RulesSeasonAttemptScore & { sourceClubId: string };

/** Filter before scoring and ranking; demo-origin attempts cannot leak via shared memberships. */
export function officialRulesInterclubAttempts(rows: SourcedRulesAttemptScore[], organizations: Organization[]): RulesSeasonAttemptScore[] {
  const officialClubIds = new Set(organizations.filter(org => org.is_demo === false && org.org_type === "club").map(org => org.id));
  return rows.filter(row => officialClubIds.has(row.clubId) && officialClubIds.has(row.sourceClubId));
}
