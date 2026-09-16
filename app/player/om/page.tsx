"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Award, CalendarDays, ChevronDown, CircleHelp, Medal, Sparkles, Target, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import styles from "./PlayerOrderOfMerit.module.css";

type Org = { id: string; name: string };
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
type HoleScoreRow = {
  round_id: string | null;
  score: number | string | null;
};
type ClubMemberClubRow = {
  club_id: string | null;
};
type ClubNameRow = {
  id: string | null;
  name: string | null;
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

function labelByLocale(locale: string, fr: string, en: string, de: string, it: string) {
  if (locale === "fr") return fr;
  if (locale === "de") return de;
  if (locale === "it") return it;
  return en;
}

function points(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
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

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function PlayerOrderOfMeritPage() {
  const { locale } = useI18n();
  const todayInZurich = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const yearStartInZurich = useMemo(() => `${todayInZurich.slice(0, 4)}-01-01`, [todayInZurich]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [performanceEnabled, setPerformanceEnabled] = useState(false);

  const [effectiveUserId, setEffectiveUserId] = useState("");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [rankingFrom, setRankingFrom] = useState(yearStartInZurich);
  const [rankingTo, setRankingTo] = useState(todayInZurich);
  const [rankingMode, setRankingMode] = useState<"net" | "brut">("net");
  const [rankingRows, setRankingRows] = useState<OMRankingRow[]>([]);
  const [avatarByPlayerId, setAvatarByPlayerId] = useState<Record<string, string | null>>({});
  const [pointDetails, setPointDetails] = useState<PointDetailCard[]>([]);
  const [showAllDetails, setShowAllDetails] = useState(false);

  const txt = useMemo(
    () => ({
      title: labelByLocale(locale, "Ordre du mérite", "Order of Merit", "Order of Merit", "Ordine di merito"),
      loading: labelByLocale(locale, "Chargement…", "Loading…", "Laedt…", "Caricamento…"),
      organization: labelByLocale(locale, "Organisation", "Organization", "Organisation", "Organizzazione"),
      rankingDateFrom: labelByLocale(locale, "Du", "From", "Von", "Dal"),
      rankingDateTo: labelByLocale(locale, "Au", "To", "Bis", "Al"),
      rankingNet: labelByLocale(locale, "Net", "Net", "Netto", "Netto"),
      rankingBrut: labelByLocale(locale, "Brut", "Gross", "Brutto", "Lordo"),
      rankingPos: labelByLocale(locale, "Rang", "Rank", "Rang", "Posizione"),
      rankingPlayer: labelByLocale(locale, "Joueur", "Player", "Spieler", "Giocatore"),
      rankingTournament: labelByLocale(locale, "Tournois", "Tournaments", "Turniere", "Tornei"),
      rankingBonus: labelByLocale(locale, "Bonus", "Bonus", "Bonus", "Bonus"),
      rankingTotal: labelByLocale(locale, "Total", "Total", "Total", "Totale"),
      rankingEmpty: labelByLocale(locale, "Aucun score OM.", "No OM scores.", "Keine OM-Scores.", "Nessun punteggio OM."),
      mySummary: labelByLocale(locale, "Mon résumé", "My summary", "Meine Zusammenfassung", "Il mio riepilogo"),
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
      contests: labelByLocale(locale, "Concours internes", "Internal contests", "Interne Wettbewerbe", "Concorsi interni"),
      details: labelByLocale(locale, "Détail des points", "Points details", "Punktedetails", "Dettaglio punti"),
      contestDate: labelByLocale(locale, "Date", "Date", "Datum", "Data"),
      contestRank: labelByLocale(locale, "Classement", "Rank", "Rang", "Posizione"),
      contestNote: labelByLocale(locale, "Note", "Note", "Notiz", "Nota"),
      detailsEmpty: labelByLocale(
        locale,
        "Aucun détail de points.",
        "No points details.",
        "Keine Punktedetails.",
        "Nessun dettaglio punti."
      ),
      noContests: labelByLocale(locale, "Aucun résultat de concours.", "No contest result.", "Kein Wettbewerbsergebnis.", "Nessun risultato concorso."),
      noOrg: labelByLocale(locale, "Aucune organisation trouvée.", "No organization found.", "Keine Organisation gefunden.", "Nessuna organizzazione trovata."),
      perfRequired: labelByLocale(
        locale,
        "Le mode performance doit être activé pour participer à l'ordre du mérite.",
        "Performance mode must be enabled to participate in Order of Merit.",
        "Der Performance-Modus muss aktiviert sein, um am Order of Merit teilzunehmen.",
        "La modalità performance deve essere attivata per partecipare all'Ordine di merito."
      ),
      subtitle: labelByLocale(locale, "Ton classement, tes points et leur origine sur une seule page.", "Your ranking, points and their origin on one page.", "Deine Rangliste und Punkte auf einer Seite.", "Classifica e punti in un'unica pagina."),
      fullRanking: labelByLocale(locale, "Classement général", "Full ranking", "Gesamtrangliste", "Classifica generale"),
      methodTitle: labelByLocale(locale, "Comment sont calculés les points ?", "How are points calculated?", "Wie werden Punkte berechnet?", "Come vengono calcolati i punti?"),
      methodLead: labelByLocale(locale, "Le classement additionne les meilleurs résultats en tournoi et les bonus acquis sur la période.", "The ranking adds the best tournament results and bonuses earned over the period.", "Die Rangliste addiert die besten Turnierergebnisse und Boni des Zeitraums.", "La classifica somma i migliori risultati e i bonus del periodo."),
      bestResults: labelByLocale(locale, "Résultats retenus", "Results counted", "Gewertete Ergebnisse", "Risultati conteggiati"),
      bestResultsText: labelByLocale(locale, "5 meilleurs tours jusqu’au 31 mai, 10 jusqu’au 31 juillet, puis 15 jusqu’à la fin de l’année.", "Best 5 rounds through May 31, 10 through July 31, then 15 through year-end.", "Die besten 5, 10 bzw. 15 Runden je nach Jahreszeit.", "I migliori 5, 10 o 15 giri secondo il periodo dell'anno."),
      tournamentFormula: labelByLocale(locale, "Points de tournoi", "Tournament points", "Turnierpunkte", "Punti torneo"),
      formulaText: labelByLocale(locale, "Net : [100 + (Course Rating − score net) × 5] × coefficient, avec un minimum de 0. Brut : [150 + Slope Rating + (Course Rating − score brut) × 5] × coefficient. Sur plusieurs tours, l’algorithme utilise les scores moyens ; sur 9 trous, handicap, Course Rating et Slope Rating sont adaptés.", "Net: [100 + (Course Rating − net score) × 5] × coefficient, with a minimum of 0. Gross: [150 + Slope Rating + (Course Rating − gross score) × 5] × coefficient. Multi-round events use average scores; handicap, Course Rating and Slope Rating are adjusted for 9 holes.", "Netto und Brutto werden aus Score, Course Rating, Slope Rating und Koeffizient berechnet; Mehrfachrunden nutzen den Durchschnitt, 9-Loch-Werte werden angepasst.", "Netto e lordo dipendono da score, Course Rating, Slope Rating e coefficiente; su più giri vale la media e i valori sono adattati su 9 buche."),
      coefficients: labelByLocale(locale, "Coefficient du niveau", "Level coefficient", "Niveau-Koeffizient", "Coefficiente livello"),
      coefficientsText: labelByLocale(locale, "Interne ×0,8 · Club ×1 · Régional ×1,2 · National ×1,4 · International ×1,6.", "Internal ×0.8 · Club ×1 · Regional ×1.2 · National ×1.4 · International ×1.6.", "Intern ×0,8 · Club ×1 · Regional ×1,2 · National ×1,4 · International ×1,6.", "Interno ×0,8 · Club ×1 · Regionale ×1,2 · Nazionale ×1,4 · Internazionale ×1,6."),
      bonusesTitle: labelByLocale(locale, "Bonus", "Bonuses", "Boni", "Bonus"),
      bonusesText: labelByLocale(locale, "2/3/4 tours : +5/+10/+15 net et +10/+20/+30 brut. Tournoi exceptionnel : +100 net, +150 brut. Match play gagné : +10. Présence : +5 par entraînement, +15 par jour de camp. Podium interne : 15/10/5 points.", "2/3/4 rounds: +5/+10/+15 net and +10/+20/+30 gross. Exceptional event: +100 net, +150 gross. Match-play win: +10. Attendance: +5 per training, +15 per camp day. Internal podium: 15/10/5 points.", "Zusatzpunkte für Mehrrundenturniere, besondere Turniere, Matchplay, Anwesenheit und interne Podien.", "Bonus per tornei su più giri, eventi eccezionali, match play, presenze e podi interni."),
      rankingRule: labelByLocale(locale, "Classement", "Ranking", "Rangliste", "Classifica"),
      rankingRuleText: labelByLocale(locale, "Total = points des tournois retenus + bonus. Les classements net et brut sont calculés séparément, du total le plus élevé au plus faible.", "Total = counted tournament points + bonuses. Net and gross rankings are calculated separately, highest total first.", "Total = gewertete Turnierpunkte + Boni; Netto und Brutto werden getrennt gereiht.", "Totale = punti torneo conteggiati + bonus; netto e lordo sono classificati separatamente."),
      pointsSuffix: labelByLocale(locale, "pts", "pts", "Pkt.", "pt"),
      recentActivity: labelByLocale(locale, "Mouvements de points", "Points activity", "Punkteverlauf", "Movimenti punti"),
      showAll: labelByLocale(locale, "Afficher tous les mouvements", "Show all activity", "Alle Bewegungen anzeigen", "Mostra tutti i movimenti"),
      showLess: labelByLocale(locale, "Afficher moins", "Show less", "Weniger anzeigen", "Mostra meno"),
    }),
    [locale]
  );

  async function loadRanking(orgId: string, fromDate: string, toDate: string) {
    if (!orgId || !fromDate || !toDate) {
      setRankingRows([]);
      setAvatarByPlayerId({});
      return;
    }
    const rangeFrom = fromDate <= toDate ? fromDate : toDate;
    const rangeTo = fromDate <= toDate ? toDate : fromDate;
    setRankingLoading(true);
    const r = await supabase.rpc("om_ranking_snapshot", { p_org_id: orgId, p_from: rangeFrom, p_as_of: rangeTo });
    setRankingLoading(false);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as OMRankingRow[];
    setRankingRows(rows);

    const playerIds = Array.from(new Set(rows.map((row) => row.player_id).filter(Boolean)));
    if (playerIds.length === 0) {
      setAvatarByPlayerId({});
      return;
    }
    const profilesRes = await supabase.from("profiles").select("id,avatar_url").in("id", playerIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    const nextMap: Record<string, string | null> = {};
    ((profilesRes.data ?? []) as ProfileAvatarRow[]).forEach((p) => {
      nextMap[p.id] = p.avatar_url ?? null;
    });
    setAvatarByPlayerId(nextMap);
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
    const scoreByRoundId = new Map<string, number>();
    if (roundIds.length > 0) {
      const holesRes = await supabase.from("golf_round_holes").select("round_id,score").in("round_id", roundIds);
      if (holesRes.error) throw new Error(holesRes.error.message);
      ((holesRes.data ?? []) as HoleScoreRow[]).forEach((h) => {
        const rid = String(h?.round_id ?? "");
        const score = typeof h?.score === "number" ? h.score : Number(h?.score);
        if (!rid || !Number.isFinite(score)) return;
        scoreByRoundId.set(rid, (scoreByRoundId.get(rid) ?? 0) + score);
      });
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
      const eventNoteLabel = labelByLocale(
        locale,
        "Renseignements événement",
        "Event details",
        "Event-Informationen",
        "Dettagli evento"
      );
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

    const merged = [...scoreCards, ...bonusCards].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    setPointDetails(merged);
  }

  async function loadInitialData() {
    try {
      const ctx = await resolveEffectivePlayerContext();
      const playerId = ctx.effectiveUserId;
      setEffectiveUserId(playerId);
      const perfEnabled = await isEffectivePlayerPerformanceEnabled(playerId);
      setPerformanceEnabled(perfEnabled);
      if (!perfEnabled) {
        setOrgs([]);
        setOrganizationId("");
        setRankingRows([]);
        setAvatarByPlayerId({});
        setPointDetails([]);
        return;
      }

      const mRes = await supabase
        .from("club_members")
        .select("club_id")
        .eq("user_id", playerId)
        .eq("role", "player")
        .eq("is_active", true);
      if (mRes.error) throw new Error(mRes.error.message);

      const clubIds = Array.from(
        new Set(((mRes.data ?? []) as ClubMemberClubRow[]).map((r) => String(r?.club_id ?? "")).filter(Boolean))
      );
      const clubNameById = new Map<string, string>();
      if (clubIds.length > 0) {
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
        if (clubsRes.error) throw new Error(clubsRes.error.message);
        ((clubsRes.data ?? []) as ClubNameRow[]).forEach((c) => {
          const id = String(c?.id ?? "");
          if (!id) return;
          clubNameById.set(id, String(c?.name ?? "Club"));
        });
      }

      const orgList = clubIds
        .map((id) => ({ id, name: clubNameById.get(id) ?? "Club" }))
        .filter((o: Org) => Boolean(o.id));
      setOrgs(orgList);
      const firstOrg = orgList[0]?.id ?? "";
      setOrganizationId(firstOrg);

      if (firstOrg) {
        await Promise.all([loadRanking(firstOrg, rankingFrom, rankingTo), loadPointDetails(playerId, firstOrg, rankingFrom, rankingTo)]);
      } else {
        setPointDetails([]);
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Error");
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadInitialData();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!organizationId || !effectiveUserId) return;
    (async () => {
      try {
        await Promise.all([loadRanking(organizationId, rankingFrom, rankingTo), loadPointDetails(effectiveUserId, organizationId, rankingFrom, rankingTo)]);
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : "Error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, rankingFrom, rankingTo, effectiveUserId]);

  const meRow = rankingRows.find((r) => r.player_id === effectiveUserId) ?? null;
  const periodSlot = rankingRows[0]?.period_slot ?? null;
  const periodLimit = rankingRows[0]?.period_limit ?? null;
  const periodLabel =
    periodSlot && periodLimit ? txt.period.replace("{slot}", String(periodSlot)).replace("{limit}", String(periodLimit)) : null;

  const sortedRows = [...rankingRows].sort((a, b) => {
    if (rankingMode === "net") {
      if (a.rank_net !== b.rank_net) return a.rank_net - b.rank_net;
      return a.full_name.localeCompare(b.full_name);
    }
    if (a.rank_brut !== b.rank_brut) return a.rank_brut - b.rank_brut;
    return a.full_name.localeCompare(b.full_name);
  });

  const visibleDetails = showAllDetails ? pointDetails : pointDetails.slice(0, 6);

  return <div className="player-dashboard-bg player-om-page">
    <div className="app-shell marketplace-page">
      <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: txt.title }]} />
      <section className="glass-section">
        <div className="marketplace-header">
          <div><h1 className="section-title">{txt.title}</h1><p className="section-subtitle">{txt.subtitle}</p></div>
        </div>
      </section>

      {error ? <div className="marketplace-error" role="alert">{error}</div> : null}
      {loading ? <section className={styles.panel}><ListLoadingBlock label={txt.loading} /></section> : !performanceEnabled ?
        <div className="marketplace-error">{txt.perfRequired}</div> : <div className={styles.page}>
          <section className={`${styles.panel} ${styles.filters}`} aria-label={txt.summaryAsOf}>
            {orgs.length > 1 ? <label className={styles.field}><span>{txt.organization}</span><select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
            <label className={styles.field}><span>{txt.rankingDateFrom}</span><input type="date" value={rankingFrom} onChange={(e) => setRankingFrom(e.target.value)} /></label>
            <label className={styles.field}><span>{txt.rankingDateTo}</span><input type="date" value={rankingTo} onChange={(e) => setRankingTo(e.target.value)} /></label>
            <div className={styles.segmented} aria-label={`${txt.rankingNet} / ${txt.rankingBrut}`}>
              <button type="button" className={rankingMode === "net" ? styles.segmentActive : ""} onClick={() => setRankingMode("net")} aria-pressed={rankingMode === "net"}>{txt.rankingNet}</button>
              <button type="button" className={rankingMode === "brut" ? styles.segmentActive : ""} onClick={() => setRankingMode("brut")} aria-pressed={rankingMode === "brut"}>{txt.rankingBrut}</button>
            </div>
          </section>

          <section className={styles.summarySection} aria-labelledby="my-merit-summary">
            <div className={styles.summaryIdentity}>
              <div className={styles.myAvatar}>
                {meRow && avatarByPlayerId[meRow.player_id] ? <Image src={avatarByPlayerId[meRow.player_id] ?? ""} alt="" fill sizes="56px" unoptimized /> : <span>{initialsFromName(meRow?.full_name ?? "?")}</span>}
              </div>
              <div><span className={styles.eyebrow}>{txt.mySummary}</span><h2 id="my-merit-summary">{meRow?.full_name ?? txt.notRanked}</h2><p><CalendarDays size={14} aria-hidden="true" />{fmtActivityDate(rankingFrom, locale)} — {fmtActivityDate(rankingTo, locale)}</p></div>
            </div>
            {meRow ? <div className={styles.summaryMetrics}>
              <SummaryMetric icon={<Medal size={18} />} label={txt.summaryRankNet} rank={meRow.rank_net} tournament={meRow.tournament_points_net} bonus={meRow.bonus_points_net} total={meRow.total_points_net} txt={txt} active={rankingMode === "net"} />
              <SummaryMetric icon={<Trophy size={18} />} label={txt.summaryRankBrut} rank={meRow.rank_brut} tournament={meRow.tournament_points_brut} bonus={meRow.bonus_points_brut} total={meRow.total_points_brut} txt={txt} active={rankingMode === "brut"} />
            </div> : null}
          </section>

          <div className={styles.mainGrid}>
            <section className={styles.panel} aria-labelledby="full-ranking-title">
              <header className={styles.panelHeader}><div><h2 id="full-ranking-title">{txt.fullRanking}</h2><p>{periodLabel}</p></div><span className={styles.modeBadge}>{rankingMode === "net" ? txt.rankingNet : txt.rankingBrut}</span></header>
              {!organizationId || orgs.length === 0 ? <EmptyState text={txt.noOrg} /> : rankingLoading ? <ListLoadingBlock label={txt.loading} /> : sortedRows.length === 0 ? <EmptyState text={txt.rankingEmpty} /> : <div className={styles.rankingList}>
                {sortedRows.map((row) => {
                  const rank = rankingMode === "net" ? row.rank_net : row.rank_brut;
                  const total = rankingMode === "net" ? row.total_points_net : row.total_points_brut;
                  const tournament = rankingMode === "net" ? row.tournament_points_net : row.tournament_points_brut;
                  const bonus = rankingMode === "net" ? row.bonus_points_net : row.bonus_points_brut;
                  return <div key={row.player_id} className={`${styles.rankingRow} ${row.player_id === effectiveUserId ? styles.rankingRowMe : ""}`}>
                    <span className={`${styles.rank} ${rank <= 3 ? styles.podiumRank : ""}`}>{rank <= 3 ? <Medal size={15} aria-hidden="true" /> : null}#{rank}</span>
                    <div className={styles.avatar}>{avatarByPlayerId[row.player_id] ? <Image src={avatarByPlayerId[row.player_id] ?? ""} alt="" fill sizes="38px" unoptimized /> : <span>{initialsFromName(row.full_name)}</span>}</div>
                    <div className={styles.player}><strong>{row.full_name}</strong><small>{txt.rankingTournament} {points(tournament)} · {txt.rankingBonus} {points(bonus)}</small></div>
                    <div className={styles.total}><strong>{points(total)}</strong><span>{txt.pointsSuffix}</span></div>
                  </div>;
                })}
              </div>}
            </section>

            <aside className={`${styles.panel} ${styles.method}`} aria-labelledby="method-title">
              <header className={styles.panelHeader}><div><span className={styles.headerIcon}><CircleHelp size={18} aria-hidden="true" /></span><h2 id="method-title">{txt.methodTitle}</h2><p>{txt.methodLead}</p></div></header>
              <MethodItem icon={<Award size={16} />} title={txt.bestResults} text={txt.bestResultsText} />
              <MethodItem icon={<Target size={16} />} title={txt.tournamentFormula} text={txt.formulaText} />
              <MethodItem icon={<Trophy size={16} />} title={txt.coefficients} text={txt.coefficientsText} />
              <MethodItem icon={<Sparkles size={16} />} title={txt.bonusesTitle} text={txt.bonusesText} />
              <MethodItem icon={<Medal size={16} />} title={txt.rankingRule} text={txt.rankingRuleText} />
            </aside>
          </div>

          <section className={styles.panel} aria-labelledby="points-detail-title">
            <header className={styles.panelHeader}><div><h2 id="points-detail-title">{txt.recentActivity}</h2><p>{txt.details}</p></div></header>
            {!organizationId || orgs.length === 0 ? <EmptyState text={txt.noOrg} /> : detailsLoading ? <ListLoadingBlock label={txt.loading} /> : pointDetails.length === 0 ? <EmptyState text={txt.detailsEmpty} /> : <>
              <div className={styles.detailsList}>{visibleDetails.map((detail) => <article key={detail.id} className={styles.detailRow}>
                <time dateTime={String(detail.date).slice(0, 10)}>{detail.dateLabel ?? String(detail.date).slice(0, 10)}</time>
                <div><strong>{detail.title}</strong>{detail.subtitle ? <p>{detail.subtitle}</p> : null}</div>
                <div className={styles.detailPoints}><span>{txt.rankingNet}<b>{points(detail.pointsNet)}</b></span><span>{txt.rankingBrut}<b>{points(detail.pointsBrut)}</b></span></div>
              </article>)}</div>
              {pointDetails.length > 6 ? <button type="button" className={styles.moreButton} onClick={() => setShowAllDetails((current) => !current)}>{showAllDetails ? txt.showLess : txt.showAll}<ChevronDown size={15} className={showAllDetails ? styles.chevronUp : ""} aria-hidden="true" /></button> : null}
            </>}
          </section>
        </div>}
    </div>
  </div>;
}

function SummaryMetric({ icon, label, rank, tournament, bonus, total, txt, active }: { icon: ReactNode; label: string; rank: number; tournament: number | string; bonus: number | string; total: number | string; txt: Record<string, string>; active: boolean }) {
  return <article className={`${styles.summaryMetric} ${active ? styles.summaryMetricActive : ""}`}><div className={styles.metricTop}><span>{icon}</span><small>{label}</small><b>#{rank}</b></div><div className={styles.metricTotal}>{points(total)} <span>{txt.pointsSuffix}</span></div><p>{txt.rankingTournament} <strong>{points(tournament)}</strong> · {txt.rankingBonus} <strong>{points(bonus)}</strong></p></article>;
}

function MethodItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className={styles.methodItem}><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}
