"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, Flag, Gauge, Plus, RotateCcw, Target } from "lucide-react";
import type { EChartsOption } from "echarts";
import { readPlayerPage } from "@/lib/playerPageRead";
import ActiviteeEChart from "@/components/ui/ActiviteeEChart";
import ActivityDateTile from "@/components/ui/ActivityDateTile";
import { MANAGEMENT_CHART_COLORS } from "@/lib/managementCharts";
import { calculateGolfRoundMetrics, getScoreCategory, scoreToParLabel, type GolfHoleInput } from "@/lib/golfRoundMetrics";
import styles from "./GolfRoundsWorkspace.module.css";
import activityStyles from "@/app/player/golf/trainings/PlayerActivities.module.css";
import trainingStyles from "@/app/player/golf/PlayerGolfTraining.module.css";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { golfRoundPresentation, type MatchPlayRound } from "@/lib/golfRoundPresentation";
import { useRememberedPeriod } from "@/lib/useRememberedPeriod";

export type GolfWorkspaceRound = MatchPlayRound & {
  id: string; start_at: string; round_type: string; competition_name: string | null; course_name: string | null;
  tee_name: string | null; total_score: number | null; total_putts: number | null; fairways_hit: number | null;
  fairways_total: number | null; gir: number | null; score_entry_mode: string | null;
};
export type WorkspaceScorecardHole = GolfHoleInput & { round_id?: string; id?: string; stroke_index?: number | null; note?: string | null };
type Round = GolfWorkspaceRound;
type Hole = WorkspaceScorecardHole;
export type GolfRoundsDataset = { rounds: Round[]; holes: Hole[]; loading: boolean; error?: string | null };
type Period = "3m" | "year" | "all" | "custom";

const roundText = (locale: string, fr: string, en: string, de: string) => pickLocaleText(locale, fr, en, de);
const matchResultLabel = (locale: string, result: MatchPlayRound["om_match_result"]) =>
  result === "won" ? pickLocaleText(locale, "Gagné", "Won", "Gewonnen", "Vinto") : result === "lost" ? pickLocaleText(locale, "Perdu", "Lost", "Verloren", "Perso") : pickLocaleText(locale, "En cours", "In progress", "In Bearbeitung", "In corso");

const scoreClass = (hole: Hole) => {
  const category = getScoreCategory(hole.par, hole.score);
  return category === "eagleOrBetter" ? styles.eagle : category === "birdie" ? styles.birdie : category === "bogey" ? styles.bogey : category === "doubleOrWorse" ? styles.double : "";
};

export function HorizontalScorecard({ holes }: { holes: WorkspaceScorecardHole[] }) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string, de: string) => roundText(locale, fr, en, de);
  const rows = [...holes].sort((a, b) => a.hole_no - b.hole_no);
  const isEighteen = rows.some((hole) => hole.hole_no > 9);
  const front = rows.filter((hole) => hole.hole_no <= 9);
  const back = rows.filter((hole) => hole.hole_no > 9);
  const metrics = calculateGolfRoundMetrics(rows, isEighteen ? 18 : 9);
  const hasPutts = rows.some((hole) => hole.putts != null);
  const hasFairways = rows.some((hole) => typeof hole.fairway_hit === "boolean");
  const hasGir = rows.some((hole) => hole.par != null && hole.score != null && hole.putts != null);
  const columns = [...front, "out" as const, ...back, ...(isEighteen ? ["in" as const] : []), "total" as const];
  const valueFor = (kind: "par" | "score" | "putts", column: Hole | "out" | "in" | "total") => {
    if (typeof column === "object") return column[kind] ?? "—";
    const side = column === "out" ? metrics.front : column === "in" ? metrics.back : metrics;
    return kind === "putts" ? (column === "out" ? calculateGolfRoundMetrics(front, 9).putts.total : column === "in" ? calculateGolfRoundMetrics(back, 9).putts.total : metrics.putts.total) ?? "—" : side[kind] ?? "—";
  };
  const renderRow = (label: string, kind: "par" | "score" | "putts" | "fairway" | "gir") => (
    <tr key={kind}>
      <th scope="row">{label}</th>
      {columns.map((column, index) => {
        const summary = typeof column === "string";
        let value: React.ReactNode = "—";
        if (kind === "par" || kind === "score" || kind === "putts") value = valueFor(kind, column);
        if (!summary && kind === "fairway") value = column.par === 3 ? "-" : column.fairway_hit == null ? "—" : column.fairway_hit ? "✓" : "×";
        if (!summary && kind === "gir") {
          const gir = column.par != null && column.score != null && column.putts != null ? column.score - column.putts <= column.par - 2 : null;
          value = gir == null ? "—" : gir ? "✓" : "×";
        }
        if (summary && (kind === "fairway" || kind === "gir")) {
          const source = column === "out" ? calculateGolfRoundMetrics(front, 9) : column === "in" ? calculateGolfRoundMetrics(back, 9) : metrics;
          const metric = kind === "fairway" ? source.fairways : source.gir;
          value = `${metric.hit}/${metric.opportunities}`;
        }
        return <td key={`${kind}-${index}`} className={summary ? styles.scorecardSummary : undefined}>{kind === "score" && typeof column === "object" ? <span className={`${styles.scoreToken} ${scoreClass(column)}`}>{value}</span> : value}</td>;
      })}
    </tr>
  );

  return (
    <div className={styles.scorecardArea}>
      <div className={styles.tableWrap} tabIndex={0} aria-label={tr("Scorecard horizontale, défilement tactile disponible", "Horizontal scorecard, swipe to scroll", "Horizontale Scorekarte, durch Wischen scrollbar")}>
        <table className={styles.table} style={{ "--scorecard-hole-count": rows.length, "--scorecard-summary-count": isEighteen ? 3 : 2 } as React.CSSProperties}>
          <colgroup>
            <col className={styles.scorecardLabelColumn} />
            {columns.map((column, index) => <col key={index} className={typeof column === "string" ? styles.scorecardSummaryColumn : styles.scorecardHoleColumn} />)}
          </colgroup>
          <tbody>
            <tr><th scope="row">{tr("Trou", "Hole", "Loch")}</th>{columns.map((column, index) => <th key={`hole-${index}`} className={typeof column === "string" ? styles.scorecardSummary : undefined}>{typeof column === "object" ? column.hole_no : column === "out" ? tr("ALLER", "OUT", "HIN") : column === "in" ? tr("RETOUR", "IN", "ZURÜCK") : tr("TOTAL", "TOTAL", "GESAMT")}</th>)}</tr>
            {renderRow("Par", "par")}
            {renderRow("Score", "score")}
            {hasPutts ? renderRow("Putts", "putts") : null}
            {hasFairways ? renderRow("Fairway", "fairway") : null}
            {hasGir ? renderRow("GIR", "gir") : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RoundPerformanceInsights({ roundId, holes }: { roundId: string; holes: WorkspaceScorecardHole[] }) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string, de: string) => roundText(locale, fr, en, de);
  const expected = holes.some((hole) => hole.hole_no > 9) ? 18 : 9;
  const metrics = calculateGolfRoundMetrics(holes, expected);
  const comparable = [...holes].filter((hole) => hole.par != null && hole.score != null).sort((a, b) => a.hole_no - b.hole_no);
  const completePutts = metrics.putts.known >= Math.max(3, Math.ceil(metrics.playedHoles * .7));
  const scoreOption = useMemo<EChartsOption>(() => {
    const progression = comparable.map((_, index) => comparable
      .slice(0, index + 1)
      .reduce((total, hole) => total + (hole.score as number) - (hole.par as number), 0));
    return {
      animation: !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 38, right: 16, top: 24, bottom: 30 },
      tooltip: { trigger: "axis", formatter: (params: unknown) => {
        const index = (params as Array<{ dataIndex?: number }>)?.[0]?.dataIndex ?? 0;
        const hole = comparable[index];
        return hole ? `${roundText(locale, "Trou", "Hole", "Loch")} ${hole.hole_no}<br/>Par ${hole.par} · Score ${hole.score}<br/><b>${roundText(locale, "Score cumulé", "Cumulative score", "Kumuliertes Ergebnis")}: ${scoreToParLabel(progression[index])}</b>` : "";
      } },
      xAxis: { type: "category", boundaryGap: false, data: comparable.map((hole) => String(hole.hole_no)), axisLabel: { color: "#657168" }, name: roundText(locale, "Trou", "Hole", "Loch"), nameLocation: "middle", nameGap: 22 },
      yAxis: { type: "value", minInterval: 1, axisLine: { show: false }, axisLabel: { formatter: (value: number) => scoreToParLabel(-value) }, splitLine: { lineStyle: { color: "#edf0ed" } } },
      series: [{ type: "line", name: roundText(locale, "Score cumulé", "Cumulative score", "Kumuliertes Ergebnis"), data: progression.map((value) => -value), smooth: false, symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#526d50" }, itemStyle: { color: "#526d50", borderColor: "#fff", borderWidth: 2 }, areaStyle: { color: "rgba(137,157,125,.16)" }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#aab7a6", type: "dashed" }, data: [{ yAxis: 0 }] } }],
    };
  }, [comparable, locale]);
  const distributionOption = useMemo<EChartsOption>(() => {
    const values = metrics.distribution;
    return { color: [...MANAGEMENT_CHART_COLORS], grid: { left: 92, right: 26, top: 8, bottom: 20 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, xAxis: { type: "value", minInterval: 1 }, yAxis: { type: "category", data: ["Double +", "Bogey", "Par", "Birdie", "Eagle +"] }, series: [{ type: "bar", label: { show: true, position: "right" }, data: [values.doubleOrWorse, values.bogey, values.par, values.birdie, values.eagleOrBetter], itemStyle: { color: MANAGEMENT_CHART_COLORS[1], borderRadius: 4 } }] };
  }, [metrics.distribution]);
  const puttingOption = useMemo<EChartsOption>(() => ({
    grid: { left: 35, right: 12, top: 20, bottom: 30 }, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: holes.filter(h => h.putts != null).map(h => String(h.hole_no)) }, yAxis: { type: "value", minInterval: 1 },
    series: [{ type: "bar", data: holes.filter(h => h.putts != null).map(h => h.putts), itemStyle: { color: MANAGEMENT_CHART_COLORS[1] }, markLine: { symbol: "none", lineStyle: { color: MANAGEMENT_CHART_COLORS[2] }, data: [{ yAxis: 2, name: "2 putts" }] } }],
  }), [holes]);
  return <div className={styles.insights}>
    <div className={styles.detailTop}>
      <section className={`${trainingStyles.panel} ${styles.performance}`} aria-labelledby={`perf-${roundId}`}>
        <h3 id={`perf-${roundId}`}>{tr("Synthèse de performance", "Performance summary", "Leistungsübersicht")}</h3>
        <div className={styles.metricGrid}>
          <div className={styles.metric}><span>Score</span><strong>{metrics.score ?? "—"} <small>{scoreToParLabel(metrics.toPar)}</small></strong></div>
          <div className={styles.metric}><span>{tr("Aller", "Front nine", "Erste neun")}</span><strong>{metrics.front.score ?? "—"} <small>{scoreToParLabel(metrics.front.toPar)}</small></strong></div>
          <div className={styles.metric}><span>{tr("Retour", "Back nine", "Zweite neun")}</span><strong>{metrics.back.score ?? "—"} <small>{scoreToParLabel(metrics.back.toPar)}</small></strong></div>
          <div className={styles.metric} title={tr("Nombre total de putts renseignés", "Total recorded putts", "Gesamtzahl erfasster Putts")}><span>Putts</span><strong>{metrics.putts.total ?? "—"}</strong></div>
          <div className={styles.metric}><span>{tr("Meilleur trou", "Best hole", "Bestes Loch")}</span><strong>{metrics.bestHole ? `N° ${metrics.bestHole.hole_no}` : "—"}</strong></div>
          <div className={styles.metric}><span>{tr("Trou difficile", "Hardest hole", "Schwierigstes Loch")}</span><strong>{metrics.worstHole ? `N° ${metrics.worstHole.hole_no}` : "—"}</strong></div>
        </div>
      </section>
      <section className={`${trainingStyles.panel} ${styles.performance}`} aria-label={tr("Performance technique", "Technical performance", "Technische Leistung")}>
        <h3>{tr("Performance technique", "Technical performance", "Technische Leistung")}</h3>
        <div className={styles.progressList}>
          {[{ label: "Fairways", made: metrics.fairways.hit, ...metrics.fairways }, { label: "GIR", made: metrics.gir.hit, ...metrics.gir }, { label: "Scrambling", ...metrics.scrambling }].map((value) => <div className={styles.progressLine} key={value.label}>
            <span>{value.label}</span><div className={styles.bar}><i style={{ width: `${value.percentage ?? 0}%` }} /></div><b>{value.made}/{value.opportunities} · {value.percentage == null ? "—" : `${value.percentage}%`}</b>
          </div>)}
        </div>
      </section>
    </div>
    <div className={styles.charts}>
      {comparable.length >= 3 ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>{tr("Évolution du score sur", "Score trend over", "Ergebnisentwicklung über")} {expected} {tr("trous", "holes", "Löcher")}</h3><ActiviteeEChart option={scoreOption} ariaLabel={`${tr("Courbe du score cumulé sur", "Cumulative score chart over", "Kurve des kumulierten Ergebnisses über")} ${expected} ${tr("trous", "holes", "Löcher")}`} height={230} /></section> : null}
      {comparable.length >= 3 ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>{tr("Répartition des résultats", "Score distribution", "Ergebnisverteilung")}</h3><ActiviteeEChart option={distributionOption} ariaLabel={tr("Répartition des résultats", "Score distribution", "Ergebnisverteilung")} height={230} /></section> : null}
      {completePutts ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>{tr("Putting par trou", "Putts per hole", "Putts pro Loch")}</h3><ActiviteeEChart option={puttingOption} ariaLabel={tr("Nombre de putts par trou avec référence à deux putts", "Putts per hole with a two-putt reference", "Putts pro Loch mit Referenzwert von zwei Putts")} height={230} /></section> : <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>Putting</h3><p>{tr("Données insuffisantes pour afficher ce graphique.", "Not enough data to display this chart.", "Nicht genügend Daten für diese Grafik.")}</p></section>}
    </div>
  </div>;
}

function RoundDetail({ round, holes, readOnly = false }: { round: Round; holes: Hole[]; readOnly?: boolean }) {
  const { locale } = useI18n();
  const rows = [...holes].sort((a,b) => a.hole_no-b.hole_no);
  return <div className={styles.detail} onClick={(event) => event.stopPropagation()}>
    {golfRoundPresentation(round, rows).isMatchPlay ? <section className={trainingStyles.panel}>
      <h3>Match play</h3>
      <p>{matchResultLabel(locale, round.om_match_result)}{round.match_score_text?.trim() ? ` · ${round.match_score_text.trim()}` : ""}</p>
    </section> : <><HorizontalScorecard holes={rows} /><RoundPerformanceInsights roundId={round.id} holes={rows} /></>}
    {!readOnly ? <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}><Link className="btn" href={`/player/golf/rounds/${round.id}/edit`}>{roundText(locale, "Modifier", "Edit", "Bearbeiten")}</Link>{round.om_competition_format !== "match_play_individual" ? <Link className="btn" href={`/player/golf/rounds/${round.id}/scorecard`}>{roundText(locale, "Scorecard complète", "Full scorecard", "Vollständige Scorekarte")}</Link> : null}</div> : null}
  </div>;
}

export default function GolfRoundsWorkspace({ navigation, dataset, readOnly = false }: { navigation?: React.ReactNode; dataset?: GolfRoundsDataset; readOnly?: boolean }) {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string, de: string) => roundText(locale, fr, en, de);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-GB";
  const [ownRounds, setRounds] = useState<Round[]>([]); const [ownHoles, setHoles] = useState<Hole[]>([]);
  const [ownLoading, setLoading] = useState(true); const [ownError, setError] = useState<string | null>(null); const [openId, setOpenId] = useState<string | null>(null);
  const { period, setPeriod, from, setFrom, to, setTo } = useRememberedPeriod<Period>(readOnly ? "coach:rounds" : "player:rounds", "year", ["3m", "year", "all", "custom"]); const [course, setCourse] = useState("all"); const [format, setFormat] = useState("all"); const [status, setStatus] = useState("all");
  const rounds = dataset?.rounds ?? ownRounds;
  const holes = dataset?.holes ?? ownHoles;
  const loading = dataset?.loading ?? ownLoading;
  const error = dataset?.error ?? ownError;
  const external = Boolean(dataset);
  useEffect(() => {
    if (external) return;
    let alive = true;
    setLoading(true); setError(null);
    void readPlayerPage<GolfRoundsDataset & { viewerUserId: string; effectiveUserId: string; role: "player" | "parent" }>("/api/player/golf-data?view=rounds").then(data => {
      if (alive) { setRounds(data.rounds); setHoles(data.holes); }
    }).catch(error => {
      if (alive) setError(error instanceof Error ? error.message : roundText(locale, "Impossible de charger les parcours.", "Unable to load rounds.", "Runden konnten nicht geladen werden."));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [external, locale]);
  const holesByRound = useMemo(() => { const map: Record<string,Hole[]> = {}; holes.forEach(h => (map[h.round_id] ??= []).push(h)); return map; }, [holes]);
  const courses = useMemo(() => [...new Set(rounds.map(r => r.course_name).filter(Boolean) as string[])].sort(), [rounds]);
  const filtered = useMemo(() => rounds.filter(round => { const hs = holesByRound[round.id] ?? []; const { metrics, complete, isMatchPlay } = golfRoundPresentation(round, hs); const age = Date.now()-new Date(round.start_at).getTime(); if (period === "3m" && age > 1000*60*60*24*93) return false; if (period === "year" && new Date(round.start_at).getFullYear() !== new Date().getFullYear()) return false; if (period === "custom" && ((from && round.start_at.slice(0,10) < from) || (to && round.start_at.slice(0,10) > to))) return false; if (course !== "all" && round.course_name !== course) return false; if (format !== "all" && (isMatchPlay && hs.length === 0 || String(metrics.expectedHoles) !== format)) return false; if (status !== "all" && (status === "complete") !== complete) return false; return true; }).sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()), [rounds,holesByRound,period,from,to,course,format,status]);
  const aggregate = useMemo(() => { const metrics = filtered.filter(r => r.om_competition_format !== "match_play_individual").map(r => calculateGolfRoundMetrics(holesByRound[r.id] ?? [])); const complete = metrics.filter(m => m.complete && m.score != null); const avgScore = complete.length ? Math.round(complete.reduce((s,m)=>s+(m.score ?? 0),0)/complete.length*10)/10 : null; const totalGir = metrics.reduce((s,m)=>s+m.gir.hit,0), girOpp = metrics.reduce((s,m)=>s+m.gir.opportunities,0); const totalFw = metrics.reduce((s,m)=>s+m.fairways.hit,0), fwOpp = metrics.reduce((s,m)=>s+m.fairways.opportunities,0); return { avgScore, gir: girOpp ? Math.round(totalGir/girOpp*100) : null, fairway: fwOpp ? Math.round(totalFw/fwOpp*100) : null }; }, [filtered,holesByRound]);
  const reset = () => { setPeriod("year"); setCourse("all"); setFormat("all"); setStatus("all"); };
  return <section className={styles.workspace}>
    {navigation}
    <div className={`${activityStyles.controls} ${styles.filters}`}>
      <label className={styles.filterLabel}>{tr("Période", "Period", "Zeitraum")}<select className={styles.filter} value={period} onChange={e=>setPeriod(e.target.value as Period)}><option value="3m">{tr("3 derniers mois", "Last 3 months", "Letzte 3 Monate")}</option><option value="year">{tr("Cette année", "This year", "Dieses Jahr")}</option><option value="all">{tr("Tout l’historique", "All history", "Gesamter Verlauf")}</option><option value="custom">{tr("Période personnalisée", "Custom period", "Benutzerdefinierter Zeitraum")}</option></select></label>
      {period === "custom" ? <><label className={styles.filterLabel}>{tr("Du", "From", "Von")}<input className={styles.filter} type="date" value={from} max={to || undefined} onChange={e=>setFrom(e.target.value)} /></label><label className={styles.filterLabel}>{tr("Au", "To", "Bis")}<input className={styles.filter} type="date" value={to} min={from || undefined} onChange={e=>setTo(e.target.value)} /></label></> : null}
      <label className={styles.filterLabel}>{tr("Parcours", "Course", "Golfplatz")}<select className={styles.filter} value={course} onChange={e=>setCourse(e.target.value)}><option value="all">{tr("Tous les parcours", "All courses", "Alle Golfplätze")}</option>{courses.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className={styles.filterLabel}>{tr("Nombre de trous", "Number of holes", "Anzahl Löcher")}<select className={styles.filter} value={format} onChange={e=>setFormat(e.target.value)}><option value="all">{tr("9 et 18 trous", "9 and 18 holes", "9 und 18 Löcher")}</option><option value="9">{tr("9 trous", "9 holes", "9 Löcher")}</option><option value="18">{tr("18 trous", "18 holes", "18 Löcher")}</option></select></label>
      <label className={styles.filterLabel}>{tr("Statut", "Status", "Status")}<select className={styles.filter} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{tr("Tous", "All", "Alle")}</option><option value="complete">{tr("Terminés", "Completed", "Abgeschlossen")}</option><option value="progress">{tr("En cours", "In progress", "In Bearbeitung")}</option></select></label>
    </div>
    {!readOnly ? <section className={`${activityStyles.plannerSection} ${trainingStyles.creationHeader}`} aria-labelledby="round-shortcut-title"><div className={styles.roundShortcutCopy}><h2 id="round-shortcut-title">{tr("Compléter mon historique", "Complete my history", "Meinen Verlauf vervollständigen")}</h2><p>{tr("Ajoutez une partie et renseignez votre carte de score.", "Add a round and fill in your scorecard.", "Füge eine Runde hinzu und fülle deine Scorekarte aus.")}</p></div><Link className={`${activityStyles.primaryButton} ${trainingStyles.creationAction}`} href="/player/golf/rounds/new"><Plus size={18} aria-hidden="true" />{t("player.newRound")}</Link></section> : null}
    <div className={trainingStyles.kpis} aria-label={tr("Synthèse des parcours", "Round summary", "Rundenübersicht")}><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Flag size={17} /></span><h2>{tr("Parties", "Rounds", "Runden")}</h2></div><strong>{loading ? "…" : filtered.length}</strong><p>{tr("sur la période", "in this period", "in diesem Zeitraum")}</p><small>{tr("Parcours enregistrés", "Recorded rounds", "Erfasste Runden")}</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Gauge size={17} /></span><h2>{tr("Score moyen", "Average score", "Durchschnittliches Ergebnis")}</h2></div><strong>{aggregate.avgScore ?? "—"}</strong><p>{tr("parties terminées", "completed rounds", "abgeschlossene Runden")}</p><small>{tr("Moyenne des scores complets", "Average of complete scores", "Durchschnitt der vollständigen Ergebnisse")}</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Target size={17} /></span><h2>GIR</h2></div><strong>{aggregate.gir == null ? "—" : `${aggregate.gir}%`}</strong><p>{tr("données connues", "known data", "bekannte Daten")}</p><small>{tr("Greens en régulation", "Greens in regulation", "Greens in Regulation")}</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><BarChart3 size={17} /></span><h2>Fairways</h2></div><strong>{aggregate.fairway == null ? "—" : `${aggregate.fairway}%`}</strong><p>{tr("par 4 et par 5", "par 4 and par 5", "Par 4 und Par 5")}</p><small>{tr("Mises en jeu réussies", "Successful tee shots", "Gelungene Abschläge")}</small></article></div>
    <div className={styles.roundShortcutCopy}>
      <h2>{tr("Vos parcours", "Your rounds", "Deine Runden")}</h2>
      <p>{tr("Suivez vos scores et vos statistiques sur la période sélectionnée.", "Track your scores and statistics for the selected period.", "Verfolge deine Ergebnisse und Statistiken im ausgewählten Zeitraum.")}</p>
    </div>
    {error ? <div className={styles.error} role="alert">{error} <button className="btn" onClick={() => location.reload()}><RotateCcw size={14}/> {tr("Réessayer", "Try again", "Erneut versuchen")}</button></div> : loading ? <div className={styles.list}>{[1,2,3].map(i=><div className={styles.skeleton} key={i}/>)}</div> : filtered.length === 0 ? <div className={styles.empty}><strong>{rounds.length ? tr("Aucun résultat", "No results", "Keine Ergebnisse") : readOnly ? tr("Aucun parcours enregistré", "No rounds recorded", "Keine Runden erfasst") : tr("Votre historique commence ici", "Your history starts here", "Dein Verlauf beginnt hier")}</strong><span>{rounds.length ? tr("Modifiez ou réinitialisez les filtres pour retrouver les parties.", "Change or reset the filters to find your rounds.", "Ändere oder setze die Filter zurück, um deine Runden zu finden.") : readOnly ? tr("Les parcours saisis par le joueur apparaîtront ici.", "The player’s rounds will appear here.", "Die Runden des Spielers werden hier angezeigt.") : tr("Ajoutez votre première partie pour suivre vos scores et vos tendances.", "Add your first round to track your scores and trends.", "Füge deine erste Runde hinzu, um Ergebnisse und Entwicklungen zu verfolgen.")}</span>{rounds.length ? <button className="btn" onClick={reset}>{tr("Réinitialiser les filtres", "Reset filters", "Filter zurücksetzen")}</button> : !readOnly ? <Link className={activityStyles.primaryButton} href="/player/golf/rounds/new"><Plus size={18}/> {tr("Ajouter un parcours", "Add a round", "Runde hinzufügen")}</Link> : null}</div> : <div className={styles.list}>{filtered.map(round => { const hs=holesByRound[round.id]??[]; const {metrics,complete,isMatchPlay}=golfRoundPresentation(round,hs); const isOpen=openId===round.id; const teeName=round.tee_name?.replace(/^(tee|départ)\s*:?\s*/i, ""); return <article className={`${styles.roundShell} ${isOpen?styles.expanded:""}`} key={round.id}><button className={`${activityStyles.competitionCard} ${styles.roundCard}`} aria-expanded={isOpen} aria-controls={`detail-${round.id}`} onClick={()=>setOpenId(isOpen?null:round.id)}><ActivityDateTile startsAt={round.start_at} locale={dateLocale} className={`${activityStyles.dateTile} ${styles.roundDate}`} showYear/><span className={styles.content}><span className={styles.titleRow}><strong className={styles.course}>{round.course_name || tr("Parcours sans nom", "Unnamed course", "Golfplatz ohne Namen")}</strong>{isMatchPlay && complete ? <span className={styles.badge}>{matchResultLabel(locale, round.om_match_result)}</span> : !complete?<span className={styles.badgeProgress}>{tr("En cours", "In progress", "In Bearbeitung")}</span>:null}</span>{round.competition_name?.trim() ? <span className={styles.competitionName}>{round.competition_name.trim()}</span> : null}<span className={styles.meta}>{round.round_type === "competition" ? tr("Compétition", "Competition", "Wettkampf") : tr("Entraînement", "Training", "Training")}{isMatchPlay ? " · Match play" : <> · {metrics.expectedHoles} {tr("trous", "holes", "Löcher")}</>}{teeName?` · Tee ${teeName}`:""}</span>{!isMatchPlay ? <span className={styles.quickStats}><span>Putts <b>{metrics.putts.total ?? round.total_putts ?? "—"}</b></span><span>Fairways <b>{metrics.fairways.percentage == null?"—":`${metrics.fairways.percentage}%`}</b></span><span>GIR <b>{metrics.gir.percentage == null?"—":`${metrics.gir.percentage}%`}</b></span></span> : null}</span><span className={styles.roundAside}><span className={`${styles.score} ${isMatchPlay ? styles.matchScore : ""}`}><strong>{isMatchPlay ? round.match_score_text?.trim() || "—" : metrics.score ?? round.total_score ?? "—"}</strong><span>{isMatchPlay ? matchResultLabel(locale, round.om_match_result) : scoreToParLabel(metrics.toPar)}</span></span><span className={styles.chevron}><ChevronDown aria-hidden="true"/></span></span></button>{isOpen?<div id={`detail-${round.id}`}><RoundDetail round={round} holes={hs} readOnly={readOnly}/></div>:null}</article>; })}</div>}
  </section>;
}
