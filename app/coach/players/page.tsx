"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey } from "@/lib/coachUiErrors";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import styles from "@/app/manager/camps/Camps.module.css";
import playerListStyles from "./CoachPlayersPage.module.css";

type Club = { id: string; name: string | null };
type Membership = { club_id: string; user_id: string; role: string | null; is_active: boolean | null; can_transfer_players_between_club_groups?: boolean | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; sex: string | null };
type Player = Profile & { club_ids: string[]; club_names: string[] };

function name(profile: Pick<Profile, "first_name" | "last_name">) { return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "—"; }
function initials(profile: Profile) { return `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() || "J"; }

export default function CoachPlayersPage() {
  const { locale, t } = useI18n();
  const [reload, setReload] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]); const [clubs, setClubs] = useState<Club[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState(""); const [clubFilter, setClubFilter] = useState("all"); const [sexFilter, setSexFilter] = useState("all");
  useEffect(() => { let active = true; void (async () => {
    setLoading(true); setError("");
    try {
      const auth = await supabase.auth.getUser(); if (!auth.data.user) throw new Error("coach.error.session"); const userId = auth.data.user.id;
      const membershipsResult = await supabase.from("club_members").select("club_id,user_id,role,is_active,can_transfer_players_between_club_groups").eq("user_id", userId).eq("role", "coach").eq("is_active", true);
      if (membershipsResult.error) throw new Error(membershipsResult.error.message);
      const memberships = (membershipsResult.data ?? []) as Membership[]; const clubIds = [...new Set(memberships.map((row) => row.club_id))];
      if (!clubIds.length) { if (active) { setPlayers([]); setClubs([]); } return; }
      const [clubsResult, linksResult, headGroupsResult] = await Promise.all([
        supabase.from("clubs").select("id,name").in("id", clubIds),
        supabase.from("coach_group_coaches").select("group_id").eq("coach_user_id", userId),
        supabase.from("coach_groups").select("id").in("club_id", clubIds).eq("head_coach_user_id", userId),
      ]);
      if (clubsResult.error || linksResult.error || headGroupsResult.error) throw new Error(clubsResult.error?.message ?? linksResult.error?.message ?? headGroupsResult.error?.message);
      const clubList = (clubsResult.data ?? []) as Club[]; if (active) setClubs(clubList);
      const groupIds = [...new Set([...(linksResult.data ?? []).map((row) => row.group_id), ...(headGroupsResult.data ?? []).map((row) => row.id)])];
      const assignedResult = groupIds.length ? await supabase.from("coach_group_players").select("player_user_id").in("group_id", groupIds) : { data: [], error: null };
      if (assignedResult.error) throw new Error(assignedResult.error.message);
      const assignedIds = new Set((assignedResult.data ?? []).map((row) => row.player_user_id));
      const transferableClubs = new Set(memberships.filter((row) => row.can_transfer_players_between_club_groups).map((row) => row.club_id));
      const playerMembersResult = await supabase.from("club_members").select("club_id,user_id,role,is_active").in("club_id", clubIds).eq("role", "player").eq("is_active", true);
      if (playerMembersResult.error) throw new Error(playerMembersResult.error.message);
      const playerMembers = ((playerMembersResult.data ?? []) as Membership[]).filter((row) => assignedIds.has(row.user_id) || transferableClubs.has(row.club_id));
      const playerIds = [...new Set(playerMembers.map((row) => row.user_id))];
      if (!playerIds.length) { if (active) setPlayers([]); return; }
      const profilesResult = await supabase.from("profiles").select("id,first_name,last_name,avatar_url,handicap,sex").in("id", playerIds); if (profilesResult.error) throw new Error(profilesResult.error.message);
      const clubNames = new Map(clubList.map((club) => [club.id, club.name ?? ""]));
      const memberClubs = new Map<string, Set<string>>(); playerMembers.forEach((row) => { const current = memberClubs.get(row.user_id) ?? new Set<string>(); current.add(row.club_id); memberClubs.set(row.user_id, current); });
      if (active) setPlayers(((profilesResult.data ?? []) as Profile[]).map((profile) => { const ids = [...(memberClubs.get(profile.id) ?? [])]; return { ...profile, club_ids: ids, club_names: ids.map((id) => clubNames.get(id) ?? "") }; }));
    } catch (cause) { if (active) { setError(coachCaughtErrorKey(cause, "coach.error.load")); setPlayers([]); } } finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [reload]);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase(locale); return players.filter((player) => (clubFilter === "all" || player.club_ids.includes(clubFilter)) && (sexFilter === "all" || (sexFilter === "none" ? !player.sex : player.sex === sexFilter)) && (!q || `${name(player)} ${player.club_names.join(" ")}`.toLocaleLowerCase(locale).includes(q))).sort((a, b) => name(a).localeCompare(name(b), locale)); }, [players, query, clubFilter, sexFilter, locale]);
  return <main className={styles.page}>
    <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><span>/</span><strong>{t("coach.nav.players")}</strong></nav>
    <header className={styles.topline}><div><h1>{t("coach.nav.players")}</h1><p className={styles.lead}>{t("coach.players.intro")}</p></div></header>
    {error ? <div className={styles.alertError} role="alert">{t(error)} <button type="button" className={styles.secondary} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>{t("coach.players.list")}</h2><p>{loading ? t("common.loading") : error ? "—" : coachText(t, filtered.length === 1 ? "coach.players.one" : "coach.players.count", { count: filtered.length })}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>{t("coach.directory.search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("coach.players.search")} /></label>
        {clubs.length > 1 ? <label className={styles.field}><span>{t("coach.directory.club")}</span><select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}><option value="all">{t("coach.directory.allClubs")}</option>{[...clubs].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", locale)).map((club) => <option key={club.id} value={club.id}>{club.name || t("coach.directory.club")}</option>)}</select></label> : null}
        <label className={styles.field}><span>{t("coach.directory.gender")}</span><select value={sexFilter} onChange={(event) => setSexFilter(event.target.value)}><option value="all">{t("coach.directory.all")}</option><option value="male">{t("coach.directory.male")}</option><option value="female">{t("coach.directory.female")}</option><option value="other">{t("coach.directory.other")}</option><option value="none">{t("coach.directory.undefined")}</option></select></label>
      </div>
      {loading ? <CoachListSkeleton label={t("coach.players.loading")} /> : error ? null : !filtered.length ? <div className={styles.empty}><UserRound size={21} aria-hidden="true" />{t("coach.players.empty")}</div> : (
        <ul className={playerListStyles.list} role="list" aria-label={t("coach.players.list")}>
          {filtered.map((player) => {
            const playerName = name(player);
            const handicap = typeof player.handicap === "number" && Number.isFinite(player.handicap)
              ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(player.handicap)
              : t("coach.directory.noData");
            return (
              <li key={player.id} className={playerListStyles.row}>
                <span className={`${styles.avatar} ${playerListStyles.avatar}`} aria-hidden="true">
                  {player.avatar_url ? <img src={player.avatar_url} alt="" /> : initials(player)}
                </span>
                <div className={playerListStyles.identity}>
                  <b>{playerName}</b>{" "}
                  <span className={playerListStyles.handicap} aria-label={`${t("coach.directory.handicap")} : ${handicap}`}>({handicap})</span>
                </div>
                <Link className={`${styles.iconButton} ${playerListStyles.viewButton}`} href={`/coach/players/${player.id}?returnTo=${encodeURIComponent("/coach/players")}`} aria-label={coachText(t, "coach.directory.viewNamed", { name: playerName })} title={t("coach.directory.view")}>
                  <Eye size={18} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  </main>;
}
