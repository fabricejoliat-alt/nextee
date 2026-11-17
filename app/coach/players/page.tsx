"use client";
import { useRetainedLoading } from "@/lib/useRetainedLoading";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { organizationFetch as fetch } from "@/lib/organizationFetch";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { coachUiErrorKey, coachCaughtErrorKey } from "@/lib/coachUiErrors";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import styles from "@/app/manager/camps/Camps.module.css";
import playerListStyles from "./CoachPlayersPage.module.css";

type Club = { id: string; name: string | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; sex: string | null };
type Player = Profile & { can_access_details: boolean; club_ids: string[]; club_names: string[] };

function name(profile: Pick<Profile, "first_name" | "last_name">) { return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "—"; }
function initials(profile: Profile) { return `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() || "J"; }

export default function CoachPlayersPage() {
  const { locale, t } = useI18n();
  const [reload, setReload] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]); const [clubs, setClubs] = useState<Club[]>([]); const [loading, setLoading] = useRetainedLoading(); const [error, setError] = useState(""); const [query, setQuery] = useState(""); const [clubFilter, setClubFilter] = useState("all"); const [sexFilter, setSexFilter] = useState("all");
  useEffect(() => { let active = true; void (async () => {
    setLoading(true); setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("coach.error.session");
      const response = await fetch("/api/coach/directory?view=players", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(coachUiErrorKey(response.status, body, "coach.error.load"));
      if (active) { setClubs(body.clubs ?? []); setPlayers(body.players ?? []); }

    } catch (cause) { if (active) { setError(coachCaughtErrorKey(cause, "coach.error.load")); setPlayers([]); } } finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [reload, setLoading]);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase(locale); return players.filter((player) => (clubFilter === "all" || player.club_ids.includes(clubFilter)) && (sexFilter === "all" || (sexFilter === "none" ? !player.sex : player.sex === sexFilter)) && (!q || `${name(player)} ${player.club_names.join(" ")}`.toLocaleLowerCase(locale).includes(q))).sort((a, b) => name(a).localeCompare(name(b), locale)); }, [players, query, clubFilter, sexFilter, locale]);
  return <main className={styles.page}>
    <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><span>/</span><strong>{t("coach.nav.players")}</strong></nav>
    <header className={styles.topline}><div><h1>{t("coach.nav.players")}</h1><p className={styles.lead}>{t("coach.players.intro")}</p></div></header>
    {error ? <div className={styles.alertError} role="alert">{t(error)} <button type="button" className={styles.secondary} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>{t("coach.players.list")}</h2><p>{loading ? t("common.loading") : error ? "—" : coachText(t, filtered.length === 1 ? "coach.players.one" : "coach.players.count", { count: filtered.length })}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>{t("coach.directory.search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("coach.players.search")} /></label>
        {clubs.length > 1 ? <label className={styles.field}><span>{t("organization.context")}</span><select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}><option value="all">{t("coach.directory.allClubs")}</option>{[...clubs].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", locale)).map((club) => <option key={club.id} value={club.id}>{club.name || t("organization.context")}</option>)}</select></label> : null}
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
                {player.can_access_details ? <Link className={`${styles.iconButton} ${playerListStyles.viewButton}`} href={`/coach/players/${player.id}?returnTo=${encodeURIComponent("/coach/players")}`} aria-label={coachText(t, "coach.directory.viewNamed", { name: playerName })} title={t("coach.directory.view")}>
                  <Eye size={18} aria-hidden="true" />
                </Link> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  </main>;
}
