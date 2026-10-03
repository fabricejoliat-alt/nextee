"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { managerHeaders, useManagerResource } from "./useManagerResource";

export type PerformanceSeason = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
export const performanceHeaders = managerHeaders;

export function usePerformanceContext() {
  const { t } = useI18n();
  const scope = useManagerClubSelection();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const resource = useManagerResource<{ seasons: PerformanceSeason[] }>(scope.clubId ? `/api/manager/clubs/${scope.clubId}/seasons` : null, t("manager.loadError"));
  const seasons = resource.data?.seasons ?? [];
  const requested = params.get("season");
  const seasonId = requested ? seasons.find((season) => season.id === requested)?.id ?? "" : seasons.find((season) => season.is_current)?.id ?? seasons[0]?.id ?? "";
  function setSeasonId(id: string) {
    if (!seasons.some((season) => season.id === id)) return;
    const query = new URLSearchParams(params.toString()); query.set("club", scope.clubId); query.set("season", id);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }
  return { ...scope, seasons, seasonId, setSeasonId, loading: scope.loading || resource.loading,
    error: scope.error || resource.error || (resource.data && requested && !seasonId ? t("manager.seasonUnavailable") : "") };
}
