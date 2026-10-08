"use client";
import PlayersManagementPage from "./PlayersManagementPage";
import OrganizationRosterWorkspace from "./OrganizationRosterWorkspace";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
export default function OrganizationPlayersPage() {
  const scope=useManagerClubSelection(),{t}=useI18n();
  if(scope.loading)return <ListLoadingBlock label={t("common.loading")}/>;
  return scope.clubs.find(row=>row.id===scope.clubId)?.org_type==='academy' ? <OrganizationRosterWorkspace/>:<PlayersManagementPage/>;
}
