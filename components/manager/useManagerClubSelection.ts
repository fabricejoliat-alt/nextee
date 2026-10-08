"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useManagerResource } from "./useManagerResource";
export type ManagerClub = { id: string; name: string | null; org_type?: "club" | "academy" | "federation" };

export function useManagerClubSelection() {
  const { t } = useI18n();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const resource = useManagerResource<{ clubs: ManagerClub[] }>("/api/manager/my-clubs", t("manager.loadError"));
  const clubs = resource.data?.clubs ?? [];
  const requested = params.get("club");
  const clubId = requested ? clubs.find((club) => club.id === requested)?.id ?? "" : clubs[0]?.id ?? "";
  function setClubId(id: string) {
    if (!clubs.some((club) => club.id === id)) return;
    const query = new URLSearchParams(params.toString());
    query.set("club", id); query.delete("season");
    router.replace(`${pathname}?${query}`, { scroll: false });
  }
  return { clubs, clubId, setClubId, loading: resource.loading,
    error: resource.error || (resource.data && requested && !clubId ? t("manager.clubUnavailable") : "") };
}
