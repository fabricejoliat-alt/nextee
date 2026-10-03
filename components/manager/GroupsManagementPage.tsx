"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerGroupFeedback, managerGroupFormat } from "@/lib/managerGroupPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type Club = { id: string; name: string | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type Group = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null; clubs?: Club | null };
type GroupRow = Group & { categories: string[]; players: Profile[]; coaches: Profile[] };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };

function nameOf(profile?: Profile | null) { return [profile?.last_name, profile?.first_name].filter(Boolean).join(" ") || "—"; }
function initials(profile?: Profile | null) { return [profile?.first_name, profile?.last_name].map((value) => value?.trim().charAt(0).toUpperCase()).join("") || "—"; }
function Avatar({ profile }: { profile?: Profile | null }) { return <span className="user-mgmt-member-avatar" aria-hidden="true">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile)}</span>; }
async function authHeaders() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }

export default function GroupsManagementPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedClubId = searchParams.get("club") ?? "";
  const loadVersion = useRef(0);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [hideArchived, setHideArchived] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function selectClub(nextId: string) {
    if (nextId === clubId) return;
    ++loadVersion.current;
    setClubId(nextId);
    setGroups([]);
    setSeasons([]);
    setSeasonId("");
    setCategory("");
    setLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("club", nextId);
    params.delete("season");
    router.replace(`/manager/groups?${params.toString()}`);
  }

  async function load(id: string, requestedSeasonId = seasonId) {
    const version = ++loadVersion.current;
    if (!id) { setGroups([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: seasonData, error: seasonError } = await supabase.from("club_seasons").select("id,name,starts_on,ends_on,is_current").eq("club_id", id).order("starts_on", { ascending: true });
      if (version !== loadVersion.current) return;
      if (seasonError) throw seasonError;
      const nextSeasons = (seasonData ?? []) as Season[];
      const activeSeasonId = nextSeasons.some((season) => season.id === requestedSeasonId) ? requestedSeasonId : nextSeasons.find((season) => season.is_current)?.id ?? nextSeasons[0]?.id ?? "";
      setSeasons(nextSeasons); setSeasonId(activeSeasonId);
      let groupQuery = supabase.from("coach_groups").select("id,club_id,name,is_active,head_coach_user_id,clubs:clubs(id,name)").eq("club_id", id);
      if (activeSeasonId) groupQuery = groupQuery.eq("club_season_id", activeSeasonId);
      const { data: groupData, error: groupError } = await groupQuery.order("name", { ascending: true });
      if (version !== loadVersion.current) return;
      if (groupError) throw groupError;
      const base = (groupData ?? []).map((group: any) => ({ ...group, clubs: Array.isArray(group.clubs) ? group.clubs[0] ?? null : group.clubs ?? null })) as Group[];
      const ids = base.map((group) => group.id);
      if (!ids.length) { setGroups([]); return; }
      const [categories, players, coaches] = await Promise.all([
        supabase.from("coach_group_categories").select("group_id,category").in("group_id", ids),
        supabase.from("coach_group_players").select("group_id,profiles:player_user_id(id,first_name,last_name,avatar_url)").in("group_id", ids),
        supabase.from("coach_group_coaches").select("group_id,profiles:coach_user_id(id,first_name,last_name,avatar_url)").in("group_id", ids),
      ]);
      if (categories.error) throw categories.error; if (players.error) throw players.error; if (coaches.error) throw coaches.error;
      const categoriesByGroup = new Map<string, string[]>(); const playersByGroup = new Map<string, Profile[]>(); const coachesByGroup = new Map<string, Profile[]>();
      (categories.data ?? []).forEach((row: any) => categoriesByGroup.set(String(row.group_id), [...(categoriesByGroup.get(String(row.group_id)) ?? []), String(row.category)]));
      (players.data ?? []).forEach((row: any) => { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; if (profile) playersByGroup.set(String(row.group_id), [...(playersByGroup.get(String(row.group_id)) ?? []), profile as Profile]); });
      (coaches.data ?? []).forEach((row: any) => { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; if (profile) coachesByGroup.set(String(row.group_id), [...(coachesByGroup.get(String(row.group_id)) ?? []), profile as Profile]); });
      const headIds = Array.from(new Set(base.map((group) => group.head_coach_user_id).filter((coachId): coachId is string => Boolean(coachId))));
      const headProfiles = headIds.length ? await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", headIds) : { data: [], error: null };
      if (version !== loadVersion.current) return;
      if (headProfiles.error) throw headProfiles.error;
      const headById = new Map(((headProfiles.data ?? []) as Profile[]).map((profile) => [profile.id, profile]));
      setGroups(base.map((group) => {
        const coaches = [...(coachesByGroup.get(group.id) ?? [])];
        const head = group.head_coach_user_id && headById.get(group.head_coach_user_id);
        if (head && !coaches.some((coach) => coach.id === head.id)) coaches.push(head);
        return { ...group, categories: Array.from(new Set(categoriesByGroup.get(group.id) ?? [])).sort((a, b) => a.localeCompare(b, managerLocaleTag(locale))), players: (playersByGroup.get(group.id) ?? []).sort((a, b) => nameOf(a).localeCompare(nameOf(b), managerLocaleTag(locale))), coaches: coaches.sort((a, b) => nameOf(a).localeCompare(nameOf(b), managerLocaleTag(locale))) };
      }));
    } catch (cause) { if (version === loadVersion.current) setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : t("manager.groups.loadError")); } finally { if (version === loadVersion.current) setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(json.error ?? t("manager.administration.clubsError"));
        const next = (json.clubs ?? []) as Club[];
        const initial = next.some((club) => club.id === requestedClubId) ? requestedClubId : next[0]?.id ?? "";
        setClubs(next);
        setClubId(initial);
        await load(initial, "");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : t("manager.administration.clubsError"));
        setLoading(false);
      }
    })();
    // This request version belongs to the data loader, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; ++loadVersion.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedClubId]);

  const categories = useMemo(() => Array.from(new Set(groups.flatMap((group) => group.categories))).sort((a, b) => a.localeCompare(b, managerLocaleTag(locale))), [groups, locale]);
  const scopeReady = !clubs.some((club) => club.id === requestedClubId) || clubId === requestedClubId;
  const rows = useMemo(() => groups.filter((group) => { const haystack = `${group.name} ${group.categories.join(" ")} ${group.players.map(nameOf).join(" ")} ${group.coaches.map(nameOf).join(" ")}`.toLocaleLowerCase(); return (!hideArchived || group.is_active) && (!query || haystack.includes(query.toLocaleLowerCase())) && (!category || group.categories.includes(category)); }).sort((a, b) => a.name.localeCompare(b.name, managerLocaleTag(locale))), [groups, query, category, hideArchived, locale]);
  const active = groups.filter((group) => group.is_active).length; const players = groups.reduce((count, group) => count + group.players.length, 0);
  return <div className={`${styles.page} ${groupStyles.page} groups-management-page`}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.groups.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.content.groups")}</h1><p className={styles.lead}>{t("manager.groups.lead")}</p></div><div className={actionStyles.topActions}>{clubs.length > 1 ? <label className="groups-season-nav-select"><select aria-label={t("manager.groups.club")} value={clubId} onChange={event => selectClub(event.target.value)}>{clubs.map(club => <option key={club.id} value={club.id}>{club.name ?? "—"}</option>)}</select></label> : null}<label className="groups-season-nav-select"><select aria-label={t("manager.season")} value={seasonId} onChange={(event) => { setSeasonId(event.target.value); void load(clubId, event.target.value); }} disabled={!clubId || seasons.length === 0}>{seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.groups.currentSeason") : ""}</option>)}</select></label>{scopeReady ? <Link className={actionStyles.primaryButton} href={`/manager/groups/new${clubId ? `?organizationId=${encodeURIComponent(clubId)}${seasonId ? `&season=${encodeURIComponent(seasonId)}` : ""}` : ""}`}><Plus size={16} />{t("coachGroups.createGroup")}</Link> : null}</div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{managerGroupFeedback(t, error)}</div> : null}
    {loading || !scopeReady ? <section className={styles.overview}><ListLoadingBlock label={t("manager.groups.loading")} /></section> : <><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>{t("manager.groups.selectedSeason")}</h2><p>{t("manager.groups.seasonHelp")}</p></div><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.season")}</span><select value={seasonId} onChange={(event) => { setSeasonId(event.target.value); void load(clubId, event.target.value); }} disabled={!clubId || seasons.length === 0}>{seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.groups.currentSeason") : ""}</option>)}</select></label></div><div className={styles.statsGrid}><article className={styles.statCard}><span>{t("manager.groups.activeGroups")}</span><b>{active}</b><small>{t("manager.administration.inClub")}</small></article><article className={styles.statCard}><span>{t("manager.groups.assignedJuniors")}</span><b>{players}</b><small>{t("manager.groups.inGroups")}</small></article><article className={styles.statCard}><span>{t("manager.groups.withoutJuniors")}</span><b>{groups.filter((group) => group.is_active && group.players.length === 0).length}</b><small>{t("manager.groups.toComplete")}</small></article></div></section><section className={styles.quickPanel}><div className={styles.sectionHeading}><h2>{t("manager.content.groups")}</h2></div><div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}><label className="user-mgmt-checkbox-label"><input type="checkbox" checked={hideArchived} onChange={(event) => setHideArchived(event.target.checked)} /><span>{t("manager.groups.hideArchived")}</span></label></div><div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 240 }}><span className="user-mgmt-field-label">{t("manager.settings.search")}</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }} /><input value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: 33 }} placeholder={t("manager.groups.search")} /></span></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.groups.category")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("manager.groups.allCategories")}</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--groups"><thead><tr><th>{t("manager.performance.group")}</th><th>{t("coach.group.categories")}</th><th>{t("manager.fields.player")}</th><th>{t("manager.fields.coach")}</th><th>{t("manager.performance.status")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "left" }}><div className="marketplace-empty">{t("manager.groups.empty")}</div></td></tr> : rows.map((group) => <tr key={group.id}><td><b>{group.name}</b></td><td data-label={t("coach.group.categories")}>{group.categories.length ? <div className="user-mgmt-chip-list">{group.categories.map((item) => <span className="pill-soft" key={item}>{item}</span>)}</div> : "—"}</td><td data-label={t("manager.fields.player")}>{group.players.length ? <div className="user-mgmt-avatar-stack">{group.players.slice(0, 4).map((profile) => <Avatar profile={profile} key={profile.id} />)}<span>{group.players.length}</span></div> : "—"}</td><td data-label={t("manager.fields.coach")}>{group.coaches.length ? <div className="user-mgmt-avatar-stack">{group.coaches.slice(0, 3).map((profile) => <Avatar profile={profile} key={profile.id} />)}<span>{group.coaches.length}</span></div> : "—"}</td><td data-label={t("manager.performance.status")}><span className="pill-soft">{group.is_active ? t("manager.administration.active") : t("manager.administration.inactive")}</span></td><td><Link className="btn" aria-label={managerGroupFormat(t, "editNamed", { name: group.name })} title={managerGroupFormat(t, "editNamed", { name: group.name })} href={`/manager/groups/${group.id}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>{t("manager.administration.edit")}</Link></td></tr>)}</tbody></table></div></section></>}
  </div>;
}
