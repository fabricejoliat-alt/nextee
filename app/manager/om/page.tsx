"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Eye, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "./OrderOfMerit.module.css";

type RankingMode = "net" | "brut";
type ManagedClub = { id: string; name: string };
type ProfileAvatar = { id: string; avatar_url: string | null };
type RankingRow = {
  player_id: string;
  full_name: string;
  tournament_points_net: number | string;
  bonus_points_net: number | string;
  total_points_net: number | string;
  rank_net: number;
  tournament_points_brut: number | string;
  bonus_points_brut: number | string;
  total_points_brut: number | string;
  rank_brut: number;
  period_slot: number;
  period_limit: number;
};
type TournamentScore = {
  round_id: string;
  competition_level: string;
  competition_format: string;
  rounds_18_count: number;
  total_points_net: number | string;
  total_points_brut: number | string;
  occurred_on: string;
  calculated_at: string;
};
type RoundMeta = { id: string; start_at: string; competition_name: string | null; course_name: string | null };
type BonusEntry = {
  id: string;
  bonus_type: string;
  points_net: number | string;
  points_brut: number | string;
  description: string | null;
  occurred_on: string;
};
type PointDetail = {
  id: string;
  date: string;
  sortOccurredOn: string;
  sortCalculatedAt: string;
  sortRoundId: string;
  title: string;
  subtitle: string | null;
  pointsNet: number;
  pointsBrut: number;
  includedNet: boolean;
  includedBrut: boolean;
  isBonus: boolean;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPoints(value: number | string | null | undefined) {
  return numberValue(value).toFixed(2);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function levelLabel(value: string) {
  if (value === "club_internal") return "Tournoi interne";
  if (value === "club_official") return "Tournoi club";
  if (value === "regional") return "Tournoi régional";
  if (value === "national") return "Tournoi national";
  if (value === "international") return "Tournoi international";
  return "Tournoi";
}

function bonusLabel(value: string) {
  if (value === "training_presence") return "Présence à un entraînement";
  if (value === "camp_day_presence") return "Présence à un stage/camp";
  if (value === "competition_participation_club") return "Participation à une compétition junior/club";
  if (value === "competition_participation_regional") return "Participation à une compétition régionale";
  if (value === "competition_participation_national") return "Participation à une compétition nationale";
  if (value === "competition_participation_international") return "Participation à une compétition internationale";
  if (value === "internal_contest_podium") return "Podium d'un concours interne";
  if (value === "manual_adjustment") return "Ajustement manuel";
  return value.replaceAll("_", " ");
}

export default function ManagerOrderOfMeritPage() {
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const yearStart = useMemo(() => `${today.slice(0, 4)}-01-01`, [today]);
  const [loading, setLoading] = useState(true);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clubs, setClubs] = useState<ManagedClub[]>([]);
  const [clubId, setClubId] = useState("");
  const [fromDate, setFromDate] = useState(yearStart);
  const [toDate, setToDate] = useState(today);
  const [mode, setMode] = useState<RankingMode>("net");
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [avatarByPlayerId, setAvatarByPlayerId] = useState<Record<string, string | null>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<RankingRow | null>(null);
  const [details, setDetails] = useState<PointDetail[]>([]);

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadClubs() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { clubs?: ManagedClub[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Impossible de charger les clubs.");
      const nextClubs = Array.isArray(payload.clubs)
        ? payload.clubs.map((club) => ({ id: String(club.id), name: String(club.name ?? "Club") })).filter((club) => club.id)
        : [];
      setClubs(nextClubs);
      setClubId((current) => current || nextClubs[0]?.id || "");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Impossible de charger les clubs.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRanking() {
    if (!clubId || !fromDate || !toDate) {
      setRows([]);
      setAvatarByPlayerId({});
      return;
    }
    setRankingLoading(true);
    setError(null);
    setSelectedPlayer(null);
    setDetails([]);
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    const response = await supabase.rpc("om_ranking_snapshot", { p_org_id: clubId, p_from: rangeFrom, p_as_of: rangeTo });
    setRankingLoading(false);
    if (response.error) {
      setError(response.error.message);
      setRows([]);
      setAvatarByPlayerId({});
      return;
    }
    const nextRows = (response.data ?? []) as RankingRow[];
    setRows(nextRows);
    const playerIds = Array.from(new Set(nextRows.map((row) => row.player_id).filter(Boolean)));
    if (playerIds.length === 0) {
      setAvatarByPlayerId({});
      return;
    }
    const profilesResponse = await supabase.from("profiles").select("id,avatar_url").in("id", playerIds);
    if (profilesResponse.error) {
      setAvatarByPlayerId({});
      return;
    }
    setAvatarByPlayerId(Object.fromEntries(((profilesResponse.data ?? []) as ProfileAvatar[]).map((profile) => [profile.id, profile.avatar_url])));
  }

  async function loadDetails(player: RankingRow) {
    if (!clubId) return;
    setSelectedPlayer(player);
    setDetailsLoading(true);
    setError(null);
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    const [scoresResponse, bonusesResponse] = await Promise.all([
      supabase.from("om_tournament_scores")
        .select("round_id,competition_level,competition_format,rounds_18_count,total_points_net,total_points_brut,occurred_on,calculated_at")
        .eq("organization_id", clubId).eq("player_id", player.player_id).gte("occurred_on", rangeFrom).lte("occurred_on", rangeTo)
        .order("occurred_on", { ascending: false }).order("calculated_at", { ascending: false }),
      supabase.from("om_bonus_entries")
        .select("id,bonus_type,points_net,points_brut,description,occurred_on")
        .eq("organization_id", clubId).eq("player_id", player.player_id).gte("occurred_on", rangeFrom).lte("occurred_on", rangeTo)
        .order("occurred_on", { ascending: false }),
    ]);
    if (scoresResponse.error || bonusesResponse.error) {
      setDetailsLoading(false);
      setError(scoresResponse.error?.message ?? bonusesResponse.error?.message ?? "Impossible de charger le détail.");
      return;
    }

    const scores = (scoresResponse.data ?? []) as TournamentScore[];
    const bonuses = (bonusesResponse.data ?? []) as BonusEntry[];
    const roundIds = Array.from(new Set(scores.map((score) => score.round_id).filter(Boolean)));
    let roundById = new Map<string, RoundMeta>();
    if (roundIds.length > 0) {
      const roundsResponse = await supabase.from("golf_rounds").select("id,start_at,competition_name,course_name").in("id", roundIds);
      if (roundsResponse.error) {
        setDetailsLoading(false);
        setError(roundsResponse.error.message);
        return;
      }
      roundById = new Map(((roundsResponse.data ?? []) as RoundMeta[]).map((round) => [round.id, round]));
    }

    const scoreGroups = new Map<string, TournamentScore[]>();
    scores.forEach((score) => {
      const round = roundById.get(score.round_id);
      const year = round?.start_at ? new Date(round.start_at).getFullYear() : "";
      const competitionName = round?.competition_name?.trim().toLocaleLowerCase("fr") || score.round_id;
      const key = score.rounds_18_count > 1
        ? `${score.competition_level}|${score.competition_format}|${score.rounds_18_count}|${year}|${competitionName}`
        : score.round_id;
      scoreGroups.set(key, [...(scoreGroups.get(key) ?? []), score]);
    });

    const tournamentDetails: PointDetail[] = Array.from(scoreGroups.entries()).map(([groupKey, group]) => {
      const score = [...group].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.calculated_at.localeCompare(a.calculated_at) || a.round_id.localeCompare(b.round_id))[0];
      const round = roundById.get(score.round_id);
      return {
        id: `score:${groupKey}`,
        date: round?.start_at ?? score.occurred_on,
        sortOccurredOn: score.occurred_on,
        sortCalculatedAt: score.calculated_at,
        sortRoundId: score.round_id,
        title: round?.competition_name?.trim() || levelLabel(score.competition_level),
        subtitle: [levelLabel(score.competition_level), round?.course_name].filter(Boolean).join(" · ") || null,
        pointsNet: numberValue(score.total_points_net),
        pointsBrut: numberValue(score.total_points_brut),
        includedNet: false,
        includedBrut: false,
        isBonus: false,
      };
    });

    const limit = player.period_limit;
    const tournamentTieBreak = (a: PointDetail, b: PointDetail) => b.sortOccurredOn.localeCompare(a.sortOccurredOn) || b.sortCalculatedAt.localeCompare(a.sortCalculatedAt) || a.sortRoundId.localeCompare(b.sortRoundId);
    const includedNetIds = new Set([...tournamentDetails].sort((a, b) => b.pointsNet - a.pointsNet || tournamentTieBreak(a, b)).slice(0, limit).map((detail) => detail.id));
    const includedBrutIds = new Set([...tournamentDetails].sort((a, b) => b.pointsBrut - a.pointsBrut || tournamentTieBreak(a, b)).slice(0, limit).map((detail) => detail.id));
    tournamentDetails.forEach((detail) => {
      detail.includedNet = includedNetIds.has(detail.id);
      detail.includedBrut = includedBrutIds.has(detail.id);
    });
    const bonusDetails: PointDetail[] = bonuses.map((bonus) => ({
      id: `bonus:${bonus.id}`,
      date: bonus.occurred_on,
      sortOccurredOn: bonus.occurred_on,
      sortCalculatedAt: "",
      sortRoundId: "",
      title: bonusLabel(bonus.bonus_type),
      subtitle: bonus.description,
      pointsNet: numberValue(bonus.points_net),
      pointsBrut: numberValue(bonus.points_brut),
      includedNet: true,
      includedBrut: true,
      isBonus: true,
    }));
    setDetails([...tournamentDetails, ...bonusDetails].sort((a, b) => b.date.localeCompare(a.date)));
    setDetailsLoading(false);
  }

  useEffect(() => {
    void loadClubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, fromDate, toDate]);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const rankDifference = mode === "net" ? a.rank_net - b.rank_net : a.rank_brut - b.rank_brut;
    return rankDifference || a.full_name.localeCompare(b.full_name, "fr");
  }), [mode, rows]);
  const periodLimit = rows[0]?.period_limit ?? 0;
  const tournamentTotal = rows.reduce((sum, row) => sum + numberValue(mode === "net" ? row.tournament_points_net : row.tournament_points_brut), 0);
  const bonusTotal = rows.reduce((sum, row) => sum + numberValue(mode === "net" ? row.bonus_points_net : row.bonus_points_brut), 0);

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d'Ariane">
        <Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Ordre du mérite</span><ChevronRight size={13} /><span>Classement</span>
      </nav>
      <div className={styles.topline}><div><h1>Classement</h1><p className={styles.lead}>Consultez le classement de l’ordre du mérite et vérifiez le calcul des points de chaque joueur.</p></div></div>
      {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
      <section className={styles.stats} aria-label="Statistiques du classement">
        <div className={styles.stat}><span>Joueurs classés</span><b>{rows.length}</b></div>
        <div className={styles.stat}><span>Meilleurs résultats</span><b>{periodLimit || "—"}</b></div>
        <div className={styles.stat}><span>Points tournois</span><b>{formatPoints(tournamentTotal)}</b></div>
        <div className={styles.stat}><span>Points bonus</span><b>{formatPoints(bonusTotal)}</b></div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Classement de l’ordre du mérite</h2><p>{sortedRows.length} joueur{sortedRows.length > 1 ? "s" : ""} classé{sortedRows.length > 1 ? "s" : ""} sur la période.</p></div></div>
        <div className={styles.toolbar}>
          <label className={styles.field}><span>Du</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className={styles.field}><span>Au</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          <div className={styles.segmented} aria-label="Mode de classement"><button type="button" className={`${styles.segment} ${mode === "net" ? styles.segmentActive : ""}`} aria-pressed={mode === "net"} onClick={() => setMode("net")}>Net</button><button type="button" className={`${styles.segment} ${mode === "brut" ? styles.segmentActive : ""}`} aria-pressed={mode === "brut"} onClick={() => setMode("brut")}>Brut</button></div>
        </div>
        {clubs.length > 1 ? <label className={styles.field} style={{ maxWidth: 300 }}><span>Club</span><select value={clubId} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label> : null}
        {loading || rankingLoading ? <ListLoadingBlock label="Chargement du classement..." /> : sortedRows.length === 0 ? <div className={styles.empty}>Aucun point n’a encore été attribué sur cette période.</div> : (
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Rang</th><th>Joueur</th><th>Tournois</th><th>Bonus</th><th>Total</th><th>Actions</th></tr></thead><tbody>{sortedRows.map((row) => <tr key={row.player_id}>
            <td data-label="Rang"><span className={styles.rank}>#{mode === "net" ? row.rank_net : row.rank_brut}</span></td>
            <td data-label="Joueur"><div className={styles.playerCell}><span className={styles.avatar} aria-hidden="true" style={avatarByPlayerId[row.player_id] ? { backgroundImage: `url(${avatarByPlayerId[row.player_id]})` } : undefined}>{avatarByPlayerId[row.player_id] ? null : initialsFromName(row.full_name)}</span><b>{row.full_name}</b></div></td>
            <td data-label="Tournois">{formatPoints(mode === "net" ? row.tournament_points_net : row.tournament_points_brut)}</td>
            <td data-label="Bonus">{formatPoints(mode === "net" ? row.bonus_points_net : row.bonus_points_brut)}</td>
            <td data-label="Total"><strong>{formatPoints(mode === "net" ? row.total_points_net : row.total_points_brut)}</strong></td>
            <td data-label="Actions"><div className={styles.actions}><button type="button" className={styles.iconButton} title="Voir le détail" aria-label={`Voir le détail des points de ${row.full_name}`} onClick={() => void loadDetails(row)}><Eye size={15} /></button></div></td>
          </tr>)}</tbody></table></div>
        )}
        {selectedPlayer ? <div className={styles.detailPanel}>
          <div className={styles.detailHeader}><div><h3>Détail des points de {selectedPlayer.full_name}</h3><p>Les {selectedPlayer.period_limit} meilleurs résultats sont retenus séparément en net et en brut. Tous les bonus de la période sont ajoutés.</p></div><button type="button" className={styles.iconButton} aria-label="Fermer le détail" title="Fermer" onClick={() => setSelectedPlayer(null)}><X size={15} /></button></div>
          <div className={styles.detailTotals}><div className={styles.detailTotal}><span>Points tournois {mode}</span><b>{formatPoints(mode === "net" ? selectedPlayer.tournament_points_net : selectedPlayer.tournament_points_brut)}</b></div><div className={styles.detailTotal}><span>Bonus {mode}</span><b>{formatPoints(mode === "net" ? selectedPlayer.bonus_points_net : selectedPlayer.bonus_points_brut)}</b></div><div className={styles.detailTotal}><span>Total {mode}</span><b>{formatPoints(mode === "net" ? selectedPlayer.total_points_net : selectedPlayer.total_points_brut)}</b></div></div>
          {detailsLoading ? <ListLoadingBlock label="Chargement du détail..." /> : details.length === 0 ? <div className={styles.empty}>Aucun détail disponible.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Date</th><th>Origine</th><th>Net</th><th>Brut</th><th>Calcul {mode}</th></tr></thead><tbody>{details.map((detail) => {
            const included = mode === "net" ? detail.includedNet : detail.includedBrut;
            return <tr key={detail.id}><td data-label="Date">{formatDate(detail.date)}</td><td data-label="Origine"><div className={styles.titleCell}><b>{detail.title}</b>{detail.subtitle ? <span className={styles.muted}>{detail.subtitle}</span> : null}</div></td><td data-label="Net">{formatPoints(detail.pointsNet)}</td><td data-label="Brut">{formatPoints(detail.pointsBrut)}</td><td data-label={`Calcul ${mode}`}><span className={`${styles.badge} ${detail.isBonus ? styles.badgeBonus : included ? "" : styles.badgeMuted}`}>{detail.isBonus ? "Bonus ajouté" : included ? "Retenu" : "Non retenu"}</span></td></tr>;
          })}</tbody></table></div>}
        </div> : null}
      </section>
    </main>
  );
}
