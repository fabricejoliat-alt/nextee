"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Search, Upload } from "lucide-react";
import { managerLocaleTag, managerFormat } from "@/lib/managerLocale";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerAdministrationFeedback } from "@/lib/managerAdministrationPresentation";
import { useManagerResource } from "@/components/manager/useManagerResource";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import directoryStyles from "@/components/manager/UserDirectory.module.css";
import styles from "@/components/admin/AdminHomeStats.module.css";

type Club = { id: string; name: string };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Member = { id: string; role: string; is_active: boolean | null; player_consent_status: "granted" | "pending" | "refused" | "adult" | null; profiles: { first_name: string | null; last_name: string | null; birth_date: string | null; avatar_url: string | null } | null };
type SeasonRecord = { id: string; club_member_id: string; course_label: string | null; group_id: string | null; registration_status: "draft" | "active" | "waitlist" | "cancelled" | "completed"; membership_status: "pending" | "paid" | "waived" | "overdue"; playing_right_status: "pending" | "paid" | "waived" | "not_applicable" };



function age(value: string | null | undefined) {
  if (!value) return "—";
  const birth = new Date(`${value}T00:00:00`); const now = new Date();
  let result = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) result -= 1;
  return String(result);
}

export default function PlayersManagementPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const consentLabel: Record<NonNullable<Member["player_consent_status"]>, string> = { granted: t("manager.administration.consent.granted"), pending: t("manager.administration.consent.pending"), refused: t("manager.content.declined"), adult: t("manager.administration.consent.adult") };

  const [query, setQuery] = useState(""); const [consentFilter, setConsentFilter] = useState<"all" | NonNullable<Member["player_consent_status"]>>("all");
  const clubsResource = useManagerResource<{ clubs: Club[] }>("/api/manager/my-clubs", "clubs_load_failed");
  const clubs = clubsResource.data?.clubs ?? [];
  const requestedClubId = params.get("club") || "";
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const membersResource = useManagerResource<{ members: Member[] }>(clubId ? `/api/manager/clubs/${clubId}/members` : null, "members_load_failed");
  const seasonsResource = useManagerResource<{ seasons: Season[] }>(clubId ? `/api/manager/clubs/${clubId}/seasons` : null, "seasons_load_failed");
  const seasons = seasonsResource.data?.seasons ?? [];
  const requestedSeasonId = params.get("season") || "";
  const seasonId = seasons.some((season) => season.id === requestedSeasonId) ? requestedSeasonId : seasons.find((season) => season.is_current)?.id ?? seasons[0]?.id ?? "";
  const recordsResource = useManagerResource<{ records: SeasonRecord[] }>(clubId && seasonId ? `/api/manager/clubs/${clubId}/seasons/${seasonId}/records` : null, "records_load_failed");
  const loading = clubsResource.loading || Boolean(clubId && (membersResource.loading || seasonsResource.loading));
  const directoryReady = Boolean(clubId && !loading && !membersResource.error && !seasonsResource.error && membersResource.data && seasonsResource.data);
  const members = useMemo(() => directoryReady ? (membersResource.data?.members ?? []).filter((item) => item.role === "player" && item.is_active !== false) : [], [directoryReady, membersResource.data]);
  const recordsReady = directoryReady && Boolean(seasonId && !recordsResource.loading && !recordsResource.error && recordsResource.data);
  const error = clubsResource.error ? (clubsResource.error === "Forbidden" ? t("manager.settings.forbidden") : t("manager.administration.clubsError"))
    : requestedClubId && clubsResource.data && !clubId ? t("manager.clubUnavailable")
    : membersResource.error ? t("manager.administration.players.loadError")
    : seasonsResource.error ? t("manager.settings.seasons.loadError")
    : recordsResource.error ? t("manager.administration.seasonDataError") : "";
  function selectClub(id: string) {
    if (!clubs.some((club) => club.id === id)) return;
    const next = new URLSearchParams(params.toString()); next.set("club", id); next.delete("season");
    router.replace(`/manager/user-management/players?${next}`, { scroll: false });
  }
  function selectSeason(id: string) {
    const next = new URLSearchParams(params.toString()); next.set("club", clubId); next.set("season", id);
    router.replace(`/manager/user-management/players?${next}`, { scroll: false });
  }

  const recordByMember = useMemo(() => new Map((recordsReady ? recordsResource.data?.records ?? [] : []).map((record) => [record.club_member_id, record])), [recordsReady, recordsResource.data]);
  const rows = useMemo(() => members.map((member) => ({ member, record: recordByMember.get(member.id) })).filter(({ member }) => { const searchable = `${member.profiles?.first_name ?? ""} ${member.profiles?.last_name ?? ""}`.toLocaleLowerCase(locale); return (!query || searchable.includes(query.toLocaleLowerCase(locale))) && (consentFilter === "all" || member.player_consent_status === consentFilter); }).sort((a, b) => `${a.member.profiles?.last_name} ${a.member.profiles?.first_name}`.localeCompare(`${b.member.profiles?.last_name} ${b.member.profiles?.first_name}`, managerLocaleTag(locale))), [members, recordByMember, query, consentFilter, locale]);
  const registeredCount = recordsReady ? members.filter((member) => recordByMember.get(member.id)?.registration_status === "active").length : null;
  const incompleteCount = recordsReady ? members.filter((member) => !member.profiles?.birth_date || !recordByMember.has(member.id)).length : null;
  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.administration.players.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.fields.player")}</h1><p className={styles.lead}>{t("manager.administration.players.lead")}</p></div><div className="user-mgmt-actions">
      <label className="groups-season-nav-select"><select aria-label={t("common.club")} value={clubId} onChange={(event) => selectClub(event.target.value)} disabled={clubsResource.loading || !clubs.length}>{!clubId ? <option value="">{t("manager.chooseClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name || t("common.club")}</option>)}</select></label>
      <label className="groups-season-nav-select"><select aria-label={t("manager.season")} value={seasonId} onChange={(event) => selectSeason(event.target.value)} disabled={!directoryReady || seasons.length === 0}>{seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</option>)}</select></label>
      {clubId ? <Link className="btn" href={`/manager/user-management/players/import?club=${clubId}`}><Upload size={14} />{t("manager.administration.players.import")}</Link> : null}
      {clubId ? <Link className="btn" href={`/manager/user-management/players/new?club=${clubId}${seasonId ? `&season=${seasonId}` : ""}`}><Plus size={14} />{t("manager.administration.players.add")}</Link> : null}
    </div></div>
    {error ? <div role="alert" className={styles.errorAlert}>{managerAdministrationFeedback(t, error)}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.administration.players.loading")} /></section> : !directoryReady ? (clubsResource.data && !clubs.length ? <section className={styles.overview}>{t("manager.noClub")}</section> : null) : <>
      <section className={styles.overview}><div className={styles.statsGrid}><article className={styles.statCard}><span>{t("manager.performance.activeJuniors")}</span><b>{members.length}</b><small>{t("manager.administration.inClub")}</small></article><article className={styles.statCard}><span>{t("manager.administration.registered")}</span><b>{registeredCount ?? "—"}</b><small>{t("manager.administration.inSeason")}</small></article><article className={styles.statCard}><span>{t("manager.administration.incompleteFiles")}</span><b>{incompleteCount ?? "—"}</b><small>{t("manager.administration.players.incompleteHelp")}</small></article></div></section>
      <section className={`${styles.quickPanel} ${directoryStyles.panel}`}><div className={`${styles.sectionHeading} ${directoryStyles.heading}`}><h2>{t("manager.fields.player")}</h2><button className={styles.refreshButton} type="button" onClick={() => { membersResource.reload(); seasonsResource.reload(); recordsResource.reload(); }}><RefreshCw size={14} />{t("manager.refresh")}</button></div><div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 220 }}><span className="user-mgmt-field-label">{t("manager.settings.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }} /><input value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: 33 }} placeholder={t("manager.administration.nameSearch")} /></span></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.administration.consent")}</span><select value={consentFilter} onChange={(event) => setConsentFilter(event.target.value as typeof consentFilter)}><option value="all">{t("manager.administration.allStatuses")}</option><option value="pending">{t("manager.administration.consent.pending")}</option><option value="granted">{t("manager.administration.consent.granted")}</option><option value="refused">{t("manager.content.declined")}</option><option value="adult">{t("manager.administration.consent.adult")}</option></select></label></div><div className="user-mgmt-table-wrap"><table className={`${directoryStyles.table} user-mgmt-table user-mgmt-table--compact user-mgmt-table--players`}><thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th>{t("manager.administration.age")}</th><th>{t("manager.performance.status")}</th><th>{t("manager.administration.consent")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6}><div className="marketplace-empty">{t("manager.administration.players.empty")}</div></td></tr> : rows.map(({ member, record }) => { const active = record?.registration_status === "active"; return <tr key={member.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{member.profiles?.avatar_url ? <img src={member.profiles.avatar_url} alt="" /> : [member.profiles?.first_name, member.profiles?.last_name].map((value) => value?.trim().charAt(0).toUpperCase()).join("") || "—"}</span></td><td><b>{[member.profiles?.last_name, member.profiles?.first_name].filter(Boolean).join(" ") || t("manager.settings.volume.unnamed")}</b></td><td data-label={t("manager.administration.age")}>{age(member.profiles?.birth_date)}</td><td data-label={t("manager.performance.status")}><span className="pill-soft">{!recordsReady ? "—" : active ? t("manager.administration.active") : t("manager.administration.inactive")}</span></td><td data-label={t("manager.administration.consent")}><span className="pill-soft">{member.player_consent_status ? consentLabel[member.player_consent_status] : t("manager.administration.consent.pending")}</span></td><td><Link className="btn" aria-label={managerFormat(t, "manager.administration.editNamed", { name: [member.profiles?.first_name, member.profiles?.last_name].filter(Boolean).join(" ") || t("manager.settings.volume.unnamed") })} href={`/manager/user-management/players/${member.id}?club=${clubId}&season=${seasonId}`}>{t("manager.administration.edit")}</Link></td></tr>; })}</tbody></table></div></section>
    </>}
  </div>;
}
