"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, ChevronDown, Flag, Gauge, Plus, RotateCcw, Target } from "lucide-react";
import type { EChartsOption } from "echarts";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import ActiviteeEChart from "@/components/ui/ActiviteeEChart";
import ActivityDateTile from "@/components/ui/ActivityDateTile";
import { MANAGEMENT_CHART_COLORS } from "@/lib/managementCharts";
import { calculateGolfRoundMetrics, getScoreCategory, scoreToParLabel, type GolfHoleInput } from "@/lib/golfRoundMetrics";
import styles from "./GolfRoundsWorkspace.module.css";
import activityStyles from "@/app/player/golf/trainings/PlayerActivities.module.css";
import trainingStyles from "@/app/player/golf/PlayerGolfTraining.module.css";

type Round = {
  id: string; start_at: string; round_type: string; competition_name: string | null; course_name: string | null;
  tee_name: string | null; total_score: number | null; total_putts: number | null; fairways_hit: number | null;
  fairways_total: number | null; gir: number | null; score_entry_mode: string | null;
};
type Hole = GolfHoleInput & { round_id: string; id?: string; stroke_index?: number | null; note?: string | null };
type Period = "3m" | "year" | "all";

const locale = "fr-CH";
const scoreClass = (hole: Hole) => {
  const category = getScoreCategory(hole.par, hole.score);
  return category === "eagleOrBetter" ? styles.eagle : category === "birdie" ? styles.birdie : category === "bogey" ? styles.bogey : category === "doubleOrWorse" ? styles.double : "";
};

function HorizontalScorecard({ holes }: { holes: Hole[] }) {
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
        if (!summary && kind === "fairway") value = column.par === 3 ? "N/A" : column.fairway_hit == null ? "—" : column.fairway_hit ? "✓" : "×";
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
      <div className={styles.scrollHint} aria-hidden="true">Glissez horizontalement pour voir les 18 trous →</div>
      <div className={styles.tableWrap} tabIndex={0} aria-label="Scorecard horizontale, défilement tactile disponible">
        <table className={styles.table}>
          <tbody>
            <tr><th scope="row">Trou</th>{columns.map((column, index) => <th key={`hole-${index}`} className={typeof column === "string" ? styles.scorecardSummary : undefined}>{typeof column === "object" ? column.hole_no : column === "out" ? "ALLER" : column === "in" ? "RETOUR" : "TOTAL"}</th>)}</tr>
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

function RoundDetail({ round, holes }: { round: Round; holes: Hole[] }) {
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
        return hole ? `Trou ${hole.hole_no}<br/>Par ${hole.par} · Score ${hole.score}<br/><b>Score cumulé : ${scoreToParLabel(progression[index])}</b>` : "";
      } },
      xAxis: { type: "category", boundaryGap: false, data: comparable.map((hole) => String(hole.hole_no)), axisLabel: { color: "#657168" }, name: "Trou", nameLocation: "middle", nameGap: 22 },
      yAxis: { type: "value", minInterval: 1, axisLine: { show: false }, axisLabel: { formatter: (value: number) => scoreToParLabel(-value) }, splitLine: { lineStyle: { color: "#edf0ed" } } },
      series: [{ type: "line", name: "Score cumulé", data: progression.map((value) => -value), smooth: false, symbol: "circle", symbolSize: 7, lineStyle: { width: 3, color: "#526d50" }, itemStyle: { color: "#526d50", borderColor: "#fff", borderWidth: 2 }, areaStyle: { color: "rgba(137,157,125,.16)" }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#aab7a6", type: "dashed" }, data: [{ yAxis: 0 }] } }],
    };
  }, [comparable]);
  const distributionOption = useMemo<EChartsOption>(() => {
    const values = metrics.distribution;
    return { color: [...MANAGEMENT_CHART_COLORS], grid: { left: 92, right: 26, top: 8, bottom: 20 }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, xAxis: { type: "value", minInterval: 1 }, yAxis: { type: "category", data: ["Double +", "Bogey", "Par", "Birdie", "Eagle +"] }, series: [{ type: "bar", label: { show: true, position: "right" }, data: [values.doubleOrWorse, values.bogey, values.par, values.birdie, values.eagleOrBetter], itemStyle: { color: MANAGEMENT_CHART_COLORS[1], borderRadius: 4 } }] };
  }, [metrics.distribution]);
  const puttingOption = useMemo<EChartsOption>(() => ({
    grid: { left: 35, right: 12, top: 20, bottom: 30 }, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: holes.filter(h => h.putts != null).map(h => String(h.hole_no)) }, yAxis: { type: "value", minInterval: 1 },
    series: [{ type: "bar", data: holes.filter(h => h.putts != null).map(h => h.putts), itemStyle: { color: MANAGEMENT_CHART_COLORS[1] }, markLine: { symbol: "none", lineStyle: { color: MANAGEMENT_CHART_COLORS[2] }, data: [{ yAxis: 2, name: "2 putts" }] } }],
  }), [holes]);
  const rows = [...holes].sort((a,b) => a.hole_no-b.hole_no);
  return <div className={styles.detail} onClick={(event) => event.stopPropagation()}>
    <div className={styles.detailTop}>
      <section className={`${trainingStyles.panel} ${styles.performance}`} aria-labelledby={`perf-${round.id}`}>
        <h3 id={`perf-${round.id}`}>Synthèse de performance</h3>
        <div className={styles.metricGrid}>
          <div className={styles.metric}><span>Score</span><strong>{metrics.score ?? "—"} <small>{scoreToParLabel(metrics.toPar)}</small></strong></div>
          <div className={styles.metric}><span>Aller</span><strong>{metrics.front.score ?? "—"} <small>{scoreToParLabel(metrics.front.toPar)}</small></strong></div>
          <div className={styles.metric}><span>Retour</span><strong>{metrics.back.score ?? "—"} <small>{scoreToParLabel(metrics.back.toPar)}</small></strong></div>
          <div className={styles.metric} title="Nombre total de putts renseignés"><span>Putts</span><strong>{metrics.putts.total ?? "—"}</strong></div>
          <div className={styles.metric}><span>Meilleur trou</span><strong>{metrics.bestHole ? `N° ${metrics.bestHole.hole_no}` : "—"}</strong></div>
          <div className={styles.metric}><span>Trou difficile</span><strong>{metrics.worstHole ? `N° ${metrics.worstHole.hole_no}` : "—"}</strong></div>
        </div>
      </section>
      <section className={`${trainingStyles.panel} ${styles.performance}`} aria-label="Performance technique">
        <h3>Performance technique</h3>
        <div className={styles.progressList}>
          {[{ label: "Fairways", made: metrics.fairways.hit, ...metrics.fairways }, { label: "GIR", made: metrics.gir.hit, ...metrics.gir }, { label: "Scrambling", ...metrics.scrambling }].map((value) => <div className={styles.progressLine} key={value.label}>
            <span>{value.label}</span><div className={styles.bar}><i style={{ width: `${value.percentage ?? 0}%` }} /></div><b>{value.made}/{value.opportunities} · {value.percentage == null ? "—" : `${value.percentage}%`}</b>
          </div>)}
        </div>
      </section>
    </div>
    <HorizontalScorecard holes={rows} />
    <div className={styles.charts}>
      {comparable.length >= 3 ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>Évolution du score sur {expected} trous</h3><ActiviteeEChart option={scoreOption} ariaLabel={`Courbe du score cumulé au fil des ${expected} trous`} height={230} /></section> : null}
      {comparable.length >= 3 ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>Répartition des résultats</h3><ActiviteeEChart option={distributionOption} ariaLabel={`Répartition: ${metrics.distribution.eagleOrBetter} eagle ou mieux, ${metrics.distribution.birdie} birdies, ${metrics.distribution.par} pars, ${metrics.distribution.bogey} bogeys, ${metrics.distribution.doubleOrWorse} doubles ou plus`} height={230} /></section> : null}
      {completePutts ? <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>Putting par trou</h3><ActiviteeEChart option={puttingOption} ariaLabel="Nombre de putts par trou avec référence à deux putts" height={230} /></section> : <section className={`${trainingStyles.panel} ${styles.chartCard}`}><h3>Putting</h3><p>Données insuffisantes pour afficher ce graphique.</p></section>}
    </div>
    <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}><Link className="btn" href={`/player/golf/rounds/${round.id}/edit`}>Modifier</Link><Link className="btn" href={`/player/golf/rounds/${round.id}/scorecard`}>Scorecard complète</Link></div>
  </div>;
}

export default function GolfRoundsWorkspace({ navigation }: { navigation?: React.ReactNode }) {
  const [rounds, setRounds] = useState<Round[]>([]); const [holes, setHoles] = useState<Hole[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [openId, setOpenId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("year"); const [course, setCourse] = useState("all"); const [format, setFormat] = useState("all"); const [status, setStatus] = useState("all");
  useEffect(() => { let alive = true; (async () => { try { setLoading(true); const { effectiveUserId } = await resolveEffectivePlayerContext(); const r = await supabase.from("golf_rounds").select("id,start_at,round_type,competition_name,course_name,tee_name,total_score,total_putts,fairways_hit,fairways_total,gir,score_entry_mode").eq("user_id", effectiveUserId).order("start_at", { ascending: false }); if (r.error) throw r.error; const list = (r.data ?? []) as Round[]; const ids = list.map(item => item.id); const h = ids.length ? await supabase.from("golf_round_holes").select("round_id,id,hole_no,par,score,putts,fairway_hit,stroke_index,note").in("round_id", ids).order("hole_no") : { data: [], error: null }; if (h.error) throw h.error; if (alive) { setRounds(list); setHoles((h.data ?? []) as Hole[]); } } catch (cause: unknown) { if (alive) setError(cause instanceof Error ? cause.message : "Impossible de charger les parcours."); } finally { if (alive) setLoading(false); } })(); return () => { alive = false; }; }, []);
  const holesByRound = useMemo(() => { const map: Record<string,Hole[]> = {}; holes.forEach(h => (map[h.round_id] ??= []).push(h)); return map; }, [holes]);
  const courses = useMemo(() => [...new Set(rounds.map(r => r.course_name).filter(Boolean) as string[])].sort(), [rounds]);
  const filtered = useMemo(() => rounds.filter(round => { const hs = holesByRound[round.id] ?? []; const metrics = calculateGolfRoundMetrics(hs); const age = Date.now()-new Date(round.start_at).getTime(); if (period === "3m" && age > 1000*60*60*24*93) return false; if (period === "year" && new Date(round.start_at).getFullYear() !== new Date().getFullYear()) return false; if (course !== "all" && round.course_name !== course) return false; if (format !== "all" && String(metrics.expectedHoles) !== format) return false; if (status !== "all" && (status === "complete") !== metrics.complete) return false; return true; }), [rounds,holesByRound,period,course,format,status]);
  const aggregate = useMemo(() => { const metrics = filtered.map(r => calculateGolfRoundMetrics(holesByRound[r.id] ?? [])); const complete = metrics.filter(m => m.complete && m.score != null); const avgScore = complete.length ? Math.round(complete.reduce((s,m)=>s+(m.score ?? 0),0)/complete.length*10)/10 : null; const totalGir = metrics.reduce((s,m)=>s+m.gir.hit,0), girOpp = metrics.reduce((s,m)=>s+m.gir.opportunities,0); const totalFw = metrics.reduce((s,m)=>s+m.fairways.hit,0), fwOpp = metrics.reduce((s,m)=>s+m.fairways.opportunities,0); return { avgScore, gir: girOpp ? Math.round(totalGir/girOpp*100) : null, fairway: fwOpp ? Math.round(totalFw/fwOpp*100) : null }; }, [filtered,holesByRound]);
  const reset = () => { setPeriod("year"); setCourse("all"); setFormat("all"); setStatus("all"); };
  return <section className={styles.workspace}>
    {navigation}
    <div className={`${activityStyles.controls} ${styles.filters}`}><label className={styles.filterLabel}>Période<select className={styles.filter} value={period} onChange={e=>setPeriod(e.target.value as Period)}><option value="3m">3 derniers mois</option><option value="year">Cette année</option><option value="all">Tout l’historique</option></select></label><label className={styles.filterLabel}>Parcours<select className={styles.filter} value={course} onChange={e=>setCourse(e.target.value)}><option value="all">Tous les parcours</option>{courses.map(value=><option key={value}>{value}</option>)}</select></label><label className={styles.filterLabel}>Nombre de trous<select className={styles.filter} value={format} onChange={e=>setFormat(e.target.value)}><option value="all">9 et 18 trous</option><option value="9">9 trous</option><option value="18">18 trous</option></select></label><label className={styles.filterLabel}>Statut<select className={styles.filter} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Tous</option><option value="complete">Terminés</option><option value="progress">En cours</option></select></label></div>
    <section className={activityStyles.plannerSection} aria-labelledby="round-shortcut-title"><div className={activityStyles.plannerHeading}><h2 id="round-shortcut-title">Compléter mon historique</h2><p>Ajoutez une partie et renseignez votre carte de score.</p></div><div className={activityStyles.plannerShortcuts}><Link className={activityStyles.plannerShortcut} href="/player/golf/rounds/new"><span><Plus size={19} /></span><strong>Ajouter un parcours</strong><ArrowRight size={16} /></Link></div></section>
    <div className={trainingStyles.kpis} aria-label="Synthèse des parcours"><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Flag size={17} /></span><h2>Parties</h2></div><strong>{loading ? "…" : filtered.length}</strong><p>sur la période</p><small>Parcours enregistrés</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Gauge size={17} /></span><h2>Score moyen</h2></div><strong>{aggregate.avgScore ?? "—"}</strong><p>parties terminées</p><small>Moyenne des scores complets</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><Target size={17} /></span><h2>GIR</h2></div><strong>{aggregate.gir == null ? "—" : `${aggregate.gir}%`}</strong><p>données connues</p><small>Greens en régulation</small></article><article className={trainingStyles.kpi}><div className={trainingStyles.kpiTitle}><span><BarChart3 size={17} /></span><h2>Fairways</h2></div><strong>{aggregate.fairway == null ? "—" : `${aggregate.fairway}%`}</strong><p>par 4 et par 5</p><small>Mises en jeu réussies</small></article></div>
    {error ? <div className={styles.error} role="alert">{error} <button className="btn" onClick={() => location.reload()}><RotateCcw size={14}/> Réessayer</button></div> : loading ? <div className={styles.list}>{[1,2,3].map(i=><div className={styles.skeleton} key={i}/>)}</div> : filtered.length === 0 ? <div className={styles.empty}><strong>{rounds.length ? "Aucun résultat" : "Votre historique commence ici"}</strong><span>{rounds.length ? "Modifiez ou réinitialisez les filtres pour retrouver vos parties." : "Ajoutez votre première partie pour suivre vos scores et vos tendances."}</span>{rounds.length ? <button className="btn" onClick={reset}>Réinitialiser les filtres</button> : <Link className={activityStyles.primaryButton} href="/player/golf/rounds/new"><Plus size={18}/> Ajouter un parcours</Link>}</div> : <div className={styles.list}>{filtered.map(round => { const hs=holesByRound[round.id]??[]; const metrics=calculateGolfRoundMetrics(hs); const isOpen=openId===round.id; const teeName=round.tee_name?.replace(/^(tee|départ)\s*:?\s*/i, ""); return <article className={`${styles.roundShell} ${isOpen?styles.expanded:""}`} key={round.id}><button className={`${activityStyles.competitionCard} ${styles.roundCard}`} aria-expanded={isOpen} aria-controls={`detail-${round.id}`} onClick={()=>setOpenId(isOpen?null:round.id)}><ActivityDateTile startsAt={round.start_at} locale={locale} className={`${activityStyles.dateTile} ${styles.roundDate}`} showYear/><span className={styles.content}><span className={styles.titleRow}><strong className={styles.course}>{round.course_name || round.competition_name || "Parcours sans nom"}</strong>{!metrics.complete?<span className={styles.badgeProgress}>En cours</span>:null}</span><span className={styles.meta}>{round.round_type === "competition" ? "Compétition" : "Entraînement"} · {metrics.expectedHoles} trous{teeName?` · Tee ${teeName}`:""}</span><span className={styles.quickStats}><span>Putts <b>{metrics.putts.total ?? round.total_putts ?? "—"}</b></span><span>Fairways <b>{metrics.fairways.percentage == null?"—":`${metrics.fairways.percentage}%`}</b></span><span>GIR <b>{metrics.gir.percentage == null?"—":`${metrics.gir.percentage}%`}</b></span></span></span><span className={styles.roundAside}><span className={styles.score}><strong>{metrics.score ?? round.total_score ?? "—"}</strong><span>{scoreToParLabel(metrics.toPar)}</span></span><span className={styles.chevron}><ChevronDown aria-hidden="true"/></span></span></button>{isOpen?<div id={`detail-${round.id}`}><RoundDetail round={round} holes={hs}/></div>:null}</article>; })}</div>}
  </section>;
}
