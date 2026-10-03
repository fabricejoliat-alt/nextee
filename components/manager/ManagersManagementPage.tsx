"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Search } from "lucide-react";
import { managerLocaleTag, managerFormat } from "@/lib/managerLocale";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerAdministrationFeedback } from "@/lib/managerAdministrationPresentation";
import { useManagerResource } from "@/components/manager/useManagerResource";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import directoryStyles from "@/components/manager/UserDirectory.module.css";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type Club = { id: string; name: string };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Manager = { id: string; role: string; is_active: boolean | null; auth_email?: string | null; profiles: { first_name: string | null; last_name: string | null; staff_function: string | null; phone: string | null; avatar_url: string | null } | null };

export default function ManagersManagementPage() {
  const { t, locale } = useI18n();
  const params = useSearchParams(); const router = useRouter();
  const [query, setQuery] = useState("");
  const clubsResource = useManagerResource<{ clubs: Club[] }>("/api/manager/my-clubs", "clubs_load_failed");
  const clubs = clubsResource.data?.clubs ?? [];
  const requestedClubId = params.get("club") ?? "";
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const membersResource = useManagerResource<{ members: Manager[] }>(clubId ? `/api/manager/clubs/${clubId}/members` : null, "members_load_failed");
  const seasonsResource = useManagerResource<{ seasons: Season[] }>(clubId ? `/api/manager/clubs/${clubId}/seasons` : null, "seasons_load_failed");
  const seasons = seasonsResource.data?.seasons ?? [];
  const requestedSeasonId = params.get("season") ?? "";
  const seasonId = seasons.some((season) => season.id === requestedSeasonId) ? requestedSeasonId : seasons.find((season) => season.is_current)?.id ?? seasons[0]?.id ?? "";
  const loading = clubsResource.loading || Boolean(clubId && (membersResource.loading || seasonsResource.loading));
  const ready = Boolean(clubId && !loading && !membersResource.error && !seasonsResource.error && membersResource.data && seasonsResource.data);
  const managers = useMemo(() => ready ? (membersResource.data?.members ?? []).filter((member) => member.role === "manager" && member.is_active !== false) : [], [ready, membersResource.data]);
  const error = clubsResource.error ? (clubsResource.error === "Forbidden" ? t("manager.settings.forbidden") : t("manager.administration.clubsError"))
    : requestedClubId && clubsResource.data && !clubId ? t("manager.clubUnavailable")
    : membersResource.error ? t("manager.administration.managers.loadError")
    : seasonsResource.error ? t("manager.settings.seasons.loadError") : "";
  function selectClub(id: string) { if (!clubs.some((club) => club.id === id)) return; const next = new URLSearchParams(params.toString()); next.set("club", id); next.delete("season"); router.replace(`/manager/user-management/managers?${next}`, { scroll: false }); }
  function selectSeason(id: string) { const next = new URLSearchParams(params.toString()); next.set("club", clubId); next.set("season", id); router.replace(`/manager/user-management/managers?${next}`, { scroll: false }); }
  const rows = useMemo(() => managers.filter((manager) => `${manager.profiles?.first_name ?? ""} ${manager.profiles?.last_name ?? ""} ${manager.profiles?.staff_function ?? ""} ${manager.auth_email ?? ""}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))).sort((left, right) => `${left.profiles?.last_name ?? ""} ${left.profiles?.first_name ?? ""}`.localeCompare(`${right.profiles?.last_name ?? ""} ${right.profiles?.first_name ?? ""}`, managerLocaleTag(locale))), [managers, query, locale]);
  const incompleteCount = managers.filter((manager) => !manager.profiles?.staff_function || !manager.auth_email).length;
  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.administration.managers.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.fields.manager")}</h1><p className={styles.lead}>{t("manager.administration.staffLead")}</p></div><div className={actionStyles.topActions}>
      <label className="groups-season-nav-select"><select aria-label={t("common.club")} value={clubId} onChange={(event) => selectClub(event.target.value)} disabled={clubsResource.loading || !clubs.length}>{!clubId ? <option value="">{t("manager.chooseClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name || t("common.club")}</option>)}</select></label>
      <label className="groups-season-nav-select"><select aria-label={t("manager.season")} value={seasonId} onChange={(event) => selectSeason(event.target.value)} disabled={!ready || seasons.length === 0}>{seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</option>)}</select></label>
      {clubId ? <Link className={actionStyles.primaryButton} href={`/manager/user-management/managers/new?club=${clubId}`}><Plus size={16} />{t("manager.administration.managers.add")}</Link> : null}
    </div></div>
    {error ? <div role="alert" className={actionStyles.errorAlert}>{managerAdministrationFeedback(t, error)}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.administration.managers.loading")} /></section> : !ready ? (clubsResource.data && !clubs.length ? <section className={styles.overview}>{t("manager.noClub")}</section> : null) : <><section className={styles.overview}><div className={styles.statsGrid}><article className={styles.statCard}><span>{t("manager.administration.managers.active")}</span><b>{managers.length}</b><small>{t("manager.administration.inClub")}</small></article><article className={styles.statCard}><span>{t("manager.administration.functionSet")}</span><b>{managers.filter((manager) => Boolean(manager.profiles?.staff_function)).length}</b><small>{t("manager.administration.completeProfiles")}</small></article><article className={styles.statCard}><span>{t("manager.administration.incompleteFiles")}</span><b>{incompleteCount}</b><small>{t("manager.administration.staffIncompleteHelp")}</small></article></div></section><section className={`${styles.quickPanel} ${directoryStyles.panel}`}><div className={`${styles.sectionHeading} ${directoryStyles.heading}`}><h2>{t("manager.fields.manager")}</h2><button className={styles.refreshButton} type="button" onClick={() => { membersResource.reload(); seasonsResource.reload(); }}><RefreshCw size={14} />{t("manager.refresh")}</button></div><div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 240 }}><span className="user-mgmt-field-label">{t("manager.settings.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }} /><input value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: 33 }} placeholder={t("manager.administration.staffSearch")} /></span></label></div><div className="user-mgmt-table-wrap"><table className={`${directoryStyles.table} user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list`}><thead><tr><th aria-label={t("manager.performance.avatar")}/><th>{t("manager.content.manager")}</th><th>{t("manager.profile.function")}</th><th>{t("manager.administration.email")}</th><th>{t("manager.performance.status")}</th><th aria-label={t("manager.content.actions")}/></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6}><div className="marketplace-empty">{t("manager.administration.managers.empty")}</div></td></tr> : rows.map((manager) => { const name = [manager.profiles?.last_name, manager.profiles?.first_name].filter(Boolean).join(" ") || t("manager.settings.volume.unnamed"); const incomplete = !manager.profiles?.staff_function || !manager.auth_email; return <tr key={manager.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{manager.profiles?.avatar_url ? <img src={manager.profiles.avatar_url} alt="" /> : [manager.profiles?.first_name, manager.profiles?.last_name].map((value) => value?.trim().charAt(0).toUpperCase()).join("") || "—"}</span></td><td><b>{name}</b>{incomplete ? <small style={{ display: "block", color: "#ad3d35" }}>{t("manager.administration.incompleteFile")}</small> : null}</td><td data-label={t("manager.profile.function")}>{manager.profiles?.staff_function || "—"}</td><td data-label={t("manager.administration.email")}>{manager.auth_email || "—"}</td><td data-label={t("manager.performance.status")}><span className="pill-soft">{t("manager.administration.active")}</span></td><td><Link className="btn" aria-label={managerFormat(t, "manager.administration.editNamed", { name })} href={`/manager/user-management/managers/${manager.id}?club=${clubId}`}>{t("manager.administration.edit")}</Link></td></tr>; })}</tbody></table></div></section></>}
  </div>;
}
