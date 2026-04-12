"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type ManagedOrg = { id: string; name: string };
type OMRankingRow = {
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
type ProfileAvatarRow = {
  id: string;
  avatar_url: string | null;
  first_name?: string | null;
  last_name?: string | null;
};
type EligiblePlayer = {
  player_id: string;
  full_name: string;
};
type Contest = {
  id: string;
  title: string;
  contest_date: string;
};
type TournamentScoreRow = {
  round_id: string;
  competition_level: string;
  competition_format: string;
  rounds_18_count: number;
  score_gross: number | string;
  score_net: number | string;
  total_points_net: number | string;
  total_points_brut: number | string;
  occurred_on: string;
  calculated_at: string;
};
type RoundMeta = {
  id: string;
  start_at: string;
  competition_name: string | null;
  course_name: string | null;
  total_score: number | null;
  handicap_start: number | null;
  match_score_text: string | null;
  om_match_result: "won" | "lost" | null;
};
type BonusEntryRow = {
  id: string;
  bonus_type: string;
  points_net: number | string;
  points_brut: number | string;
  source_table: string | null;
  source_id: string | null;
  description: string | null;
  occurred_on: string;
  created_at: string;
};
type ClubEventMeta = {
  id: string;
  title: string | null;
  event_type: string | null;
  coach_note: string | null;
};
type PointDetailCard = {
  id: string;
  date: string;
  dateLabel?: string;
  title: string;
  subtitle: string | null;
  pointsNet: number | string;
  pointsBrut: number | string;
};
type RankingDisplayRow = {
  player_id: string;
  full_name: string;
  tournament_points_net: number;
  bonus_points_net: number;
  total_points_net: number;
  rank_net: number;
  tournament_points_brut: number;
  bonus_points_brut: number;
  total_points_brut: number;
  rank_brut: number;
};

function labelByLocale(locale: string, fr: string, en: string, de: string, it: string) {
  if (locale === "fr") return fr;
  if (locale === "de") return de;
  if (locale === "it") return it;
  return en;
}

function fmtActivityDate(isoLike: string, locale: string) {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike).slice(0, 10);
  return new Intl.DateTimeFormat(
    locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(d);
}

function formatResult(locale: string, v: "won" | "lost" | null) {
  if (v === "won") return labelByLocale(locale, "Gagné", "Won", "Gewonnen", "Vinto");
  if (v === "lost") return labelByLocale(locale, "Perdu", "Lost", "Verloren", "Perso");
  return "—";
}

function points(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function toNumber(value: number | string | null | undefined) {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function CoachOrderOfMeritPage() {
  const { locale } = useI18n();
  const todayInZurich = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const yearStartInZurich = useMemo(() => `${todayInZurich.slice(0, 4)}-01-01`, [todayInZurich]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [orgs, setOrgs] = useState<ManagedOrg[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [rankingFrom, setRankingFrom] = useState(yearStartInZurich);
  const [rankingTo, setRankingTo] = useState(todayInZurich);
  const [rankingMode, setRankingMode] = useState<"net" | "brut">("net");
  const [rankingRows, setRankingRows] = useState<OMRankingRow[]>([]);
  const [eligiblePlayers, setEligiblePlayers] = useState<EligiblePlayer[]>([]);
  const [avatarByPlayerId, setAvatarByPlayerId] = useState<Record<string, string | null>>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [pointDetails, setPointDetails] = useState<PointDetailCard[]>([]);

  const txt = useMemo(
    () => ({
      title: labelByLocale(locale, "Ordre du mérite", "Order of Merit", "Order of Merit", "Ordine di merito"),
      organization: labelByLocale(locale, "Organisation", "Organization", "Organisation", "Organizzazione"),
      rankingDateFrom: labelByLocale(locale, "Du", "From", "Von", "Dal"),
      rankingDateTo: labelByLocale(locale, "Au", "To", "Bis", "Al"),
      rankingNet: labelByLocale(locale, "Net", "Net", "Netto", "Netto"),
      rankingBrut: labelByLocale(locale, "Brut", "Gross", "Brutto", "Lordo"),
      rankingTournament: labelByLocale(locale, "Tournois", "Tournaments", "Turniere", "Tornei"),
      rankingBonus: labelByLocale(locale, "Bonus", "Bonus", "Bonus", "Bonus"),
      rankingTotal: labelByLocale(locale, "Total", "Total", "Total", "Totale"),
      rankingEmpty: labelByLocale(locale, "Aucun score OM.", "No OM scores.", "Keine OM-Scores.", "Nessun punteggio OM."),
      noOrg: labelByLocale(locale, "Aucune organisation trouvée.", "No organization found.", "Keine Organisation gefunden.", "Nessuna organizzazione trovata."),
      loading: labelByLocale(locale, "Chargement…", "Loading…", "Laedt…", "Caricamento…"),
      genericError: labelByLocale(locale, "Erreur", "Error", "Fehler", "Errore"),
      summary: labelByLocale(locale, "Résumé du joueur", "Player summary", "Spielerzusammenfassung", "Riepilogo giocatore"),
      summaryAsOf: labelByLocale(locale, "Période", "Period", "Periode", "Periodo"),
      summaryRankNet: labelByLocale(locale, "Classement net", "Net rank", "Netto-Rang", "Classifica netto"),
      summaryRankBrut: labelByLocale(locale, "Classement brut", "Gross rank", "Brutto-Rang", "Classifica lordo"),
      notRanked: labelByLocale(locale, "Pas encore classé.", "Not ranked yet.", "Noch nicht klassiert.", "Non ancora in classifica."),
      period: labelByLocale(
        locale,
        "Période {slot} • meilleurs {limit} tours",
        "Period {slot} • best {limit} rounds",
        "Periode {slot} • beste {limit} Runden",
        "Periodo {slot} • migliori {limit} giri"
      ),
      details: labelByLocale(locale, "Détail des points", "Points details", "Punktedetails", "Dettaglio punti"),
      detailsEmpty: labelByLocale(
        locale,
        "Aucun détail de points.",
        "No points details.",
        "Keine Punktedetails.",
        "Nessun dettaglio punti."
      ),
    }),
    [locale]
  );

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadRanking(orgId: string, fromDate: string, toDate: string) {
    if (!orgId || !fromDate || !toDate) {
      setRankingRows([]);
      return;
    }
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    setRankingLoading(true);
    const r = await supabase.rpc("om_ranking_snapshot", { p_org_id: orgId, p_from: rangeFrom, p_as_of: rangeTo });
    setRankingLoading(false);
    if (r.error) throw new Error(r.error.message);
    setRankingRows((r.data ?? []) as OMRankingRow[]);
  }

  async function loadEligiblePlayers(orgId: string) {
    if (!orgId) {
      setEligiblePlayers([]);
      setAvatarByPlayerId({});
      return;
    }

    const membersRes = await supabase
      .from("club_members")
      .select("user_id,is_performance")
      .eq("club_id", orgId)
      .eq("role", "player")
      .eq("is_active", true)
      .eq("is_performance", true);
    if (membersRes.error) throw new Error(membersRes.error.message);

    const playerIds = Array.from(
      new Set((membersRes.data ?? []).map((row: any) => String(row?.user_id ?? "")).filter(Boolean))
    );
    if (playerIds.length === 0) {
      setEligiblePlayers([]);
      setAvatarByPlayerId({});
      return;
    }

    const profilesRes = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", playerIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const profiles = (profilesRes.data ?? []) as ProfileAvatarRow[];
    const avatarMap: Record<string, string | null> = {};
    const players = profiles
      .map((p) => {
        avatarMap[p.id] = p.avatar_url ?? null;
        const fullName = `${String(p.first_name ?? "").trim()} ${String(p.last_name ?? "").trim()}`.trim() || "—";
        return { player_id: p.id, full_name: fullName };
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    setAvatarByPlayerId(avatarMap);
    setEligiblePlayers(players);
  }

  async function loadPointDetails(playerId: string, orgId: string, fromDate: string, toDate: string) {
    if (!playerId || !orgId || !fromDate || !toDate) {
      setPointDetails([]);
      return;
    }
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    setDetailsLoading(true);

    const [scoreRes, bonusRes] = await Promise.all([
      supabase
        .from("om_tournament_scores")
        .select("round_id,competition_level,competition_format,rounds_18_count,score_gross,score_net,total_points_net,total_points_brut,occurred_on,calculated_at")
        .eq("organization_id", orgId)
        .eq("player_id", playerId)
        .gte("occurred_on", rangeFrom)
        .lte("occurred_on", rangeTo)
        .order("occurred_on", { ascending: false })
        .order("calculated_at", { ascending: false }),
      supabase
        .from("om_bonus_entries")
        .select("id,bonus_type,points_net,points_brut,source_table,source_id,description,occurred_on,created_at")
        .eq("organization_id", orgId)
        .eq("player_id", playerId)
        .gte("occurred_on", rangeFrom)
        .lte("occurred_on", rangeTo)
        .order("occurred_on", { ascending: false }),
    ]);
    setDetailsLoading(false);
    if (scoreRes.error) throw new Error(scoreRes.error.message);
    if (bonusRes.error) throw new Error(bonusRes.error.message);

    const scores = (scoreRes.data ?? []) as TournamentScoreRow[];
    const bonuses = (bonusRes.data ?? []) as BonusEntryRow[];

    const roundIds = Array.from(new Set(scores.map((s) => s.round_id).filter(Boolean)));
    const contestIds = Array.from(
      new Set(
        bonuses
          .filter((b) => b.source_table === "om_internal_contests" && b.source_id)
          .map((b) => String(b.source_id))
      )
    );
    const clubEventIds = Array.from(
      new Set(
        bonuses
          .filter((b) => b.source_table === "club_event_attendees" && b.source_id)
          .map((b) => String(b.source_id))
      )
    );

    let roundById = new Map<string, RoundMeta>();
    if (roundIds.length > 0) {
      const roundsRes = await supabase
        .from("golf_rounds")
        .select("id,start_at,competition_name,course_name,total_score,handicap_start,match_score_text,om_match_result")
        .in("id", roundIds);
      if (roundsRes.error) throw new Error(roundsRes.error.message);
      roundById = new Map<string, RoundMeta>(((roundsRes.data ?? []) as RoundMeta[]).map((r) => [r.id, r]));
    }

    let contestById = new Map<string, Contest>();
    if (contestIds.length > 0) {
      const contestsRes = await supabase.from("om_internal_contests").select("id,title,contest_date").in("id", contestIds);
      if (contestsRes.error) throw new Error(contestsRes.error.message);
      contestById = new Map<string, Contest>(((contestsRes.data ?? []) as Contest[]).map((c) => [c.id, c]));
    }

    let clubEventById = new Map<string, ClubEventMeta>();
    if (clubEventIds.length > 0) {
      const clubEventsRes = await supabase.from("club_events").select("id,title,event_type,coach_note").in("id", clubEventIds);
      if (clubEventsRes.error) throw new Error(clubEventsRes.error.message);
      clubEventById = new Map<string, ClubEventMeta>(((clubEventsRes.data ?? []) as ClubEventMeta[]).map((e) => [e.id, e]));
    }

    const levelLabel = (level: string) => {
      if (level === "club_internal") return labelByLocale(locale, "Tournoi interne", "Internal tournament", "Internes Turnier", "Torneo interno");
      if (level === "club_official") return labelByLocale(locale, "Tournoi club", "Club tournament", "Clubturnier", "Torneo club");
      if (level === "regional") return labelByLocale(locale, "Tournoi régional", "Regional tournament", "Regionalturnier", "Torneo regionale");
      if (level === "national") return labelByLocale(locale, "Tournoi national", "National tournament", "Nationalturnier", "Torneo nazionale");
      if (level === "international") return labelByLocale(locale, "Tournoi international", "International tournament", "Internationales Turnier", "Torneo internazionale");
      return "—";
    };
    const bonusLabel = (bonusType: string) => {
      if (bonusType === "training_presence") return labelByLocale(locale, "Présence entraînement", "Training attendance", "Trainingsteilnahme", "Presenza allenamento");
      if (bonusType === "camp_day_presence") return labelByLocale(locale, "Présence stage/camp", "Camp attendance", "Camp-Teilnahme", "Presenza stage/camp");
      if (bonusType === "competition_participation_club") return labelByLocale(locale, "Participation compétition junior/club", "Junior/club competition participation", "Teilnahme Junior-/Club-Wettkampf", "Partecipazione competizione junior/club");
      if (bonusType === "competition_participation_regional") return labelByLocale(locale, "Participation compétition régionale", "Regional competition participation", "Teilnahme Regionalwettkampf", "Partecipazione competizione regionale");
      if (bonusType === "competition_participation_national") return labelByLocale(locale, "Participation compétition nationale", "National competition participation", "Teilnahme Nationalwettkampf", "Partecipazione competizione nazionale");
      if (bonusType === "competition_participation_international") return labelByLocale(locale, "Participation compétition internationale", "International competition participation", "Teilnahme Internationalwettkampf", "Partecipazione competizione internazionale");
      if (bonusType === "internal_contest_podium") return labelByLocale(locale, "Podium concours interne", "Internal contest podium", "Internes Wettbewerbs-Podium", "Podio concorso interno");
      if (bonusType === "manual_adjustment") return labelByLocale(locale, "Ajustement manuel", "Manual adjustment", "Manuelle Anpassung", "Regolazione manuale");
      return bonusType;
    };

    const scoreGroups = new Map<string, TournamentScoreRow[]>();
    scores.forEach((s) => {
      const round = roundById.get(s.round_id);
      const year = round?.start_at ? String(new Date(round.start_at).getFullYear()) : "";
      const nameKey = (round?.competition_name ?? "").trim().toLowerCase();
      const key =
        s.rounds_18_count > 1
          ? `${s.competition_level}|${s.competition_format}|${s.rounds_18_count}|${year}|${nameKey || s.round_id}`
          : `round:${s.round_id}`;
      const arr = scoreGroups.get(key) ?? [];
      arr.push(s);
      scoreGroups.set(key, arr);
    });

    const scoreCards: PointDetailCard[] = Array.from(scoreGroups.values()).map((arr) => {
      const sorted = [...arr].sort((a, b) => {
        const byOccurredOn = String(b.occurred_on).localeCompare(String(a.occurred_on));
        if (byOccurredOn !== 0) return byOccurredOn;
        return String(b.calculated_at).localeCompare(String(a.calculated_at));
      });
      const s = sorted[0];
      const round = roundById.get(s.round_id);
      const course = round?.course_name?.trim() || "—";
      const competition = round?.competition_name?.trim() || levelLabel(s.competition_level);
      const isMatchPlay = s.competition_format === "match_play_individual";

      const subtitle = isMatchPlay
        ? `${labelByLocale(locale, "Match play", "Match play", "Matchplay", "Match play")} · ${course} · ${labelByLocale(locale, "Score", "Score", "Score", "Score")}: ${round?.match_score_text ?? "—"} · ${labelByLocale(locale, "Résultat", "Result", "Ergebnis", "Risultato")}: ${formatResult(locale, round?.om_match_result ?? null)}`
        : `${levelLabel(s.competition_level)} · ${course} · ${labelByLocale(locale, "Tours", "Rounds", "Runden", "Giri")}: ${s.rounds_18_count}x18`;

      const roundDates = arr
        .map((entry) => roundById.get(entry.round_id)?.start_at)
        .filter((v): v is string => Boolean(v))
        .map((v) => String(v).slice(0, 10))
        .sort();
      const dateStart = roundDates[0] ?? String(round?.start_at ?? s.occurred_on).slice(0, 10);
      const dateEnd = roundDates[roundDates.length - 1] ?? dateStart;
      const dateLabel =
        dateStart === dateEnd
          ? fmtActivityDate(dateStart, locale)
          : `Du ${fmtActivityDate(dateStart, locale)} au ${fmtActivityDate(dateEnd, locale)}`;

      return {
        id: `score-${s.round_id}`,
        date: round?.start_at ?? s.occurred_on,
        dateLabel,
        title: competition,
        subtitle,
        pointsNet: s.total_points_net,
        pointsBrut: s.total_points_brut,
      };
    });

    const bonusCards: PointDetailCard[] = bonuses.map((b) => {
      const contestTitle = b.source_id ? contestById.get(String(b.source_id))?.title : null;
      const clubEvent = b.source_id ? clubEventById.get(String(b.source_id)) : null;
      const eventTitle = clubEvent?.title?.trim() || null;
      const eventNote = clubEvent?.coach_note?.trim() || null;
      const eventNoteLabel = labelByLocale(locale, "Renseignements événement", "Event details", "Event-Informationen", "Dettagli evento");
      const subtitleParts = [
        contestTitle,
        eventTitle,
        eventNote ? `${eventNoteLabel}: ${eventNote}` : null,
        !contestTitle && !eventTitle ? b.description : null,
      ].filter(Boolean) as string[];

      return {
        id: `bonus-${b.id}`,
        date: b.occurred_on,
        dateLabel: fmtActivityDate(b.occurred_on, locale),
        title: bonusLabel(b.bonus_type),
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
        pointsNet: b.points_net,
        pointsBrut: b.points_brut,
      };
    });

    setPointDetails([...scoreCards, ...bonusCards].sort((a, b) => String(b.date).localeCompare(String(a.date))));
  }

  async function loadInitialData() {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/coach/my-clubs", { method: "GET", headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? txt.genericError));

      const nextOrgs: ManagedOrg[] = (Array.isArray(json?.clubs) ? json.clubs : [])
        .map((c: any) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "Club") }))
        .filter((x: ManagedOrg) => Boolean(x.id));
      setOrgs(nextOrgs);

      const nextOrgId = nextOrgs[0]?.id ?? "";
      setOrganizationId(nextOrgId);
      if (!nextOrgId) {
        setRankingRows([]);
        setEligiblePlayers([]);
        setPointDetails([]);
        return;
      }

      await Promise.all([loadEligiblePlayers(nextOrgId), loadRanking(nextOrgId, rankingFrom, rankingTo)]);
    } catch (e: any) {
      setError(String(e?.message ?? txt.genericError));
      setRankingRows([]);
      setEligiblePlayers([]);
      setPointDetails([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      try {
        await Promise.all([loadEligiblePlayers(organizationId), loadRanking(organizationId, rankingFrom, rankingTo)]);
      } catch (e: any) {
        setError(String(e?.message ?? txt.genericError));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, rankingFrom, rankingTo]);

  const periodSlot = rankingRows[0]?.period_slot ?? null;
  const periodLimit = rankingRows[0]?.period_limit ?? null;
  const periodLabel =
    periodSlot && periodLimit ? txt.period.replace("{slot}", String(periodSlot)).replace("{limit}", String(periodLimit)) : null;

  const mergedRows = useMemo<RankingDisplayRow[]>(() => {
    const baseMap = new Map<string, RankingDisplayRow>();

    for (const player of eligiblePlayers) {
      baseMap.set(player.player_id, {
        player_id: player.player_id,
        full_name: player.full_name,
        tournament_points_net: 0,
        bonus_points_net: 0,
        total_points_net: 0,
        rank_net: 0,
        tournament_points_brut: 0,
        bonus_points_brut: 0,
        total_points_brut: 0,
        rank_brut: 0,
      });
    }

    for (const row of rankingRows) {
      baseMap.set(row.player_id, {
        player_id: row.player_id,
        full_name: row.full_name,
        tournament_points_net: toNumber(row.tournament_points_net),
        bonus_points_net: toNumber(row.bonus_points_net),
        total_points_net: toNumber(row.total_points_net),
        rank_net: 0,
        tournament_points_brut: toNumber(row.tournament_points_brut),
        bonus_points_brut: toNumber(row.bonus_points_brut),
        total_points_brut: toNumber(row.total_points_brut),
        rank_brut: 0,
      });
    }

    const all = Array.from(baseMap.values());

    const netSorted = [...all].sort((a, b) => {
      if (b.total_points_net !== a.total_points_net) return b.total_points_net - a.total_points_net;
      return a.full_name.localeCompare(b.full_name);
    });
    const netRankById = new Map<string, number>();
    let currentNetRank = 0;
    let lastNetScore: number | null = null;
    netSorted.forEach((row, index) => {
      if (lastNetScore === null || row.total_points_net !== lastNetScore) currentNetRank = index + 1;
      netRankById.set(row.player_id, currentNetRank);
      lastNetScore = row.total_points_net;
    });

    const brutSorted = [...all].sort((a, b) => {
      if (b.total_points_brut !== a.total_points_brut) return b.total_points_brut - a.total_points_brut;
      return a.full_name.localeCompare(b.full_name);
    });
    const brutRankById = new Map<string, number>();
    let currentBrutRank = 0;
    let lastBrutScore: number | null = null;
    brutSorted.forEach((row, index) => {
      if (lastBrutScore === null || row.total_points_brut !== lastBrutScore) currentBrutRank = index + 1;
      brutRankById.set(row.player_id, currentBrutRank);
      lastBrutScore = row.total_points_brut;
    });

    return all.map((row) => ({
      ...row,
      rank_net: netRankById.get(row.player_id) ?? 0,
      rank_brut: brutRankById.get(row.player_id) ?? 0,
    }));
  }, [eligiblePlayers, rankingRows]);

  const sortedRows = useMemo(() => {
    const rows = [...mergedRows];
    rows.sort((a, b) => {
      if (rankingMode === "net") {
        if (a.rank_net !== b.rank_net) return a.rank_net - b.rank_net;
        return a.full_name.localeCompare(b.full_name);
      }
      if (a.rank_brut !== b.rank_brut) return a.rank_brut - b.rank_brut;
      return a.full_name.localeCompare(b.full_name);
    });
    return rows;
  }, [mergedRows, rankingMode]);

  const selectedRow = useMemo(
    () => sortedRows.find((row) => row.player_id === selectedPlayerId) ?? null,
    [selectedPlayerId, sortedRows]
  );

  useEffect(() => {
    if (!sortedRows.length) {
      setSelectedPlayerId("");
      setPointDetails([]);
      return;
    }
    if (!selectedPlayerId || !sortedRows.some((row) => row.player_id === selectedPlayerId)) {
      setSelectedPlayerId(sortedRows[0].player_id);
    }
  }, [selectedPlayerId, sortedRows]);

  useEffect(() => {
    if (!organizationId || !selectedPlayerId) return;
    (async () => {
      try {
        await loadPointDetails(selectedPlayerId, organizationId, rankingFrom, rankingTo);
      } catch (e: any) {
        setError(String(e?.message ?? txt.genericError));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, selectedPlayerId, rankingFrom, rankingTo]);

  return (
    <div className="player-dashboard-bg" style={{ color: "#1f2937", WebkitTextFillColor: "#1f2937" }}>
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="section-title" style={{ marginBottom: 0, display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Trophy size={18} />
            {txt.title}
          </div>
        </div>

        {loading ? (
          <div className="glass-section">
            <div className="glass-card">
              <ListLoadingBlock label={txt.loading} />
            </div>
          </div>
        ) : (
          <>
            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 10, color: "#1f2937", WebkitTextFillColor: "#1f2937" }}>
                <div style={{ fontWeight: 800 }}>{txt.organization}</div>
                <select
                  className="search-input"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  style={{ width: "100%", color: "#111827", WebkitTextFillColor: "#111827" }}
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {orgs.length === 0 ? <div style={{ opacity: 0.72 }}>{txt.noOrg}</div> : null}
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 10, color: "#1f2937", WebkitTextFillColor: "#1f2937" }}>
                <div style={{ fontWeight: 800 }}>{txt.summary}</div>
                {!selectedRow ? (
                  <div style={{ opacity: 0.72 }}>{txt.notRanked}</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>
                      {txt.summaryAsOf} {fmtActivityDate(rankingFrom, locale)} - {fmtActivityDate(rankingTo, locale)}
                    </div>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                      <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                        <div style={{ fontSize: 12, opacity: 0.72 }}>{txt.summaryRankNet}</div>
                        <div style={{ fontWeight: 900, marginTop: 2, fontSize: 18 }}>#{selectedRow.rank_net}</div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>
                          {txt.rankingTournament}: <strong>{points(selectedRow.tournament_points_net)}</strong> · {txt.rankingBonus}: <strong>{points(selectedRow.bonus_points_net)}</strong>
                        </div>
                        <div style={{ fontSize: 13 }}>
                          {txt.rankingTotal}: <strong>{points(selectedRow.total_points_net)}</strong>
                        </div>
                      </div>
                      <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
                        <div style={{ fontSize: 12, opacity: 0.72 }}>{txt.summaryRankBrut}</div>
                        <div style={{ fontWeight: 900, marginTop: 2, fontSize: 18 }}>#{selectedRow.rank_brut}</div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>
                          {txt.rankingTournament}: <strong>{points(selectedRow.tournament_points_brut)}</strong> · {txt.rankingBonus}: <strong>{points(selectedRow.bonus_points_brut)}</strong>
                        </div>
                        <div style={{ fontSize: 13 }}>
                          {txt.rankingTotal}: <strong>{points(selectedRow.total_points_brut)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 10, color: "#1f2937", WebkitTextFillColor: "#1f2937" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>{txt.rankingDateFrom}</span>
                    <input
                      className="search-input"
                      type="date"
                      value={rankingFrom}
                      onChange={(e) => setRankingFrom(e.target.value)}
                      style={{ color: "#111827", WebkitTextFillColor: "#111827" }}
                    />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>{txt.rankingDateTo}</span>
                    <input
                      className="search-input"
                      type="date"
                      value={rankingTo}
                      onChange={(e) => setRankingTo(e.target.value)}
                      style={{ color: "#111827", WebkitTextFillColor: "#111827" }}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button type="button" className={`btn ${rankingMode === "net" ? "btn-active-om-light" : ""}`} onClick={() => setRankingMode("net")} aria-pressed={rankingMode === "net"} style={{ width: "100%" }}>
                    {txt.rankingNet}
                  </button>
                  <button type="button" className={`btn ${rankingMode === "brut" ? "btn-active-om-light" : ""}`} onClick={() => setRankingMode("brut")} aria-pressed={rankingMode === "brut"} style={{ width: "100%" }}>
                    {txt.rankingBrut}
                  </button>
                </div>
                {periodLabel ? <div style={{ fontSize: 13, opacity: 0.72 }}>{periodLabel}</div> : null}
                {!organizationId || orgs.length === 0 ? (
                  <div style={{ opacity: 0.72 }}>{txt.noOrg}</div>
                ) : rankingLoading ? (
                  <ListLoadingBlock label={txt.loading} />
                ) : sortedRows.length === 0 ? (
                  <div style={{ opacity: 0.72 }}>{txt.rankingEmpty}</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {sortedRows.map((r) => (
                      <button
                        key={r.player_id}
                        type="button"
                        className="marketplace-item"
                        onClick={() => setSelectedPlayerId(r.player_id)}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          textAlign: "left",
                          background: r.player_id === selectedPlayerId ? "rgba(53,72,59,0.08)" : undefined,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <div
                              style={{
                                minWidth: 44,
                                height: 28,
                                borderRadius: 999,
                                border: "1px solid rgba(0,0,0,0.10)",
                                display: "grid",
                                placeItems: "center",
                                fontWeight: 900,
                                fontSize: 13,
                              }}
                            >
                              #{rankingMode === "net" ? r.rank_net : r.rank_brut}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  overflow: "hidden",
                                  background: "rgba(0,0,0,0.08)",
                                  display: "grid",
                                  placeItems: "center",
                                  fontSize: 12,
                                  fontWeight: 800,
                                }}
                              >
                                {avatarByPlayerId[r.player_id] ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={avatarByPlayerId[r.player_id] ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                  <span>{initialsFromName(r.full_name)}</span>
                                )}
                              </div>
                              <div style={{ fontWeight: 800 }}>{r.full_name}</div>
                            </div>
                          </div>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>
                            {rankingMode === "net" ? points(r.total_points_net) : points(r.total_points_brut)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>{txt.details}</div>
                {!organizationId || orgs.length === 0 ? (
                  <div style={{ opacity: 0.72 }}>{txt.noOrg}</div>
                ) : detailsLoading ? (
                  <ListLoadingBlock label={txt.loading} />
                ) : pointDetails.length === 0 ? (
                  <div style={{ opacity: 0.72 }}>{txt.detailsEmpty}</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {pointDetails.map((d) => (
                      <div key={d.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <div style={{ fontWeight: 800 }}>{d.title}</div>
                            <div style={{ fontSize: 12, opacity: 0.75 }}>{d.dateLabel ?? String(d.date).slice(0, 10)}</div>
                          </div>
                          {d.subtitle ? <div style={{ fontSize: 13, opacity: 0.78 }}>{d.subtitle}</div> : null}
                          <div style={{ fontSize: 13, opacity: 0.85 }}>
                            {txt.rankingNet}: <strong>{points(d.pointsNet)}</strong> · {txt.rankingBrut}: <strong>{points(d.pointsBrut)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {error ? (
          <div className="glass-section">
            <div className="marketplace-error">{error}</div>
          </div>
        ) : null}
      </div>
      <style>{`
        .marketplace-page a,
        .marketplace-page a[x-apple-data-detectors],
        .marketplace-page [x-apple-data-detectors] {
          color: inherit !important;
          -webkit-text-fill-color: currentColor !important;
          text-decoration: none !important;
        }
      `}</style>
    </div>
  );
}
