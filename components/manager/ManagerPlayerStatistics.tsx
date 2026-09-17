"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Flag, RefreshCw, Target, TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import campStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/components/manager/ManagerPlayerStatistics.module.css";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import { DifficultyIcon, MotivationIcon, SatisfactionIcon } from "@/components/evaluations/StandardEvaluationIcons";

type Section = "overview" | "attendance" | "training" | "play" | "evaluations";
type Preset = "30d" | "season" | "3m" | "6m" | "12m" | "custom";
type Breakdown = { key: string; label?: string; minutes: number; sessions: number; percentage?: number };
type CoachEvaluation = { event_id: string; engagement: number | null; attitude: number | null; performance: number | null; visible_to_player: boolean; player_note: string | null };
type CustomEvaluation = { event_criterion_id: string; respondent_role: string; value_json: unknown; criterion?: { snapshot_name?: string; snapshot_domain_label?: string; snapshot_response_format?: string } | null };
type Stats = {
  generatedAt?: string;
  summary: string;
  player: { isPerformance: boolean };
  benchmark?: { enabled: boolean; reason?: string; cohortSize?: number; values?: { attendanceRate: number | null; regularityRate: number | null; objectiveRate: number | null; participation: number | null } };
  overview: {
    attendance: { rate: number | null; present: number; denominator: number };
    training: { minutes: number; sessions: number; averageMinutes: number | null; weeklyAverageMinutes: number | null; objectiveMinutes: number | null; objectiveRate: number | null; ftemCode: string | null; ftemLabel: string | null; change: number | null };
    regularity: { rate: number | null; activeWeeks: number; totalWeeks: number; longestStreak: number; inactiveWeeks: number };
    handicap: { end: number | null; change: number | null };
    play: { competitions: number; rounds: number; holes: number; results: number };
    evaluations: { coachCompleted: number; playerCompleted: number; expected: number; completionRate: number | null };
  };
  attendance: { rate: number | null; change: number | null; invited: number; present: number; absent: number; excused: number; pending: number; monthly: Array<{ month: string; rate: number | null }>; byType: Array<{ label: string; present: number; invited: number }> };
  training: { byOrigin: Breakdown[]; byCategory: Breakdown[]; feelings: { motivation: number | null; difficulty: number | null; satisfaction: number | null; completed: number } };
  play: { holes: number; completedRounds: number; frequencyPerMonth: number; averageScore: number | null; averagePutts: number | null; girRate: number | null; girSample: number; fairwayRate: number | null; fairwaySample: number; scramblingRate: number | null; scramblingSample: number; averagePar3: number | null; averagePar4: number | null; averagePar5: number | null; averageFront: number | null; averageBack: number | null; competitionLevels: string[]; orderOfMeritPoints: number; scores: Record<string, number> };
  handicapHistory: Array<{ effectiveDate: string; value: number }>;
  evaluations: { coach: CoachEvaluation[]; custom: CustomEvaluation[]; events: Array<{ id: string; title: string }>; perceptionDifferences: Array<{ criterion: string; event: string; startsAt: string; player: number; coach: number; difference: number }> };
  quality: { attendancePending: number; trainingsWithoutDuration: number; performanceSessionsIncomplete: number; playerEvaluationsMissing: number; coachEvaluationsMissing: number; competitionsWithoutResult: number; lastDataAt: string | null; lowSample: boolean };
};

function ymd(date: Date) { return date.toISOString().slice(0, 10); }
function rangeFor(preset: Preset, seasonRange?: { from: string; to: string }) {
  const to = new Date(); const from = new Date(to);
  if (preset === "season" && seasonRange) return { from: seasonRange.from, to: seasonRange.to > ymd(to) ? ymd(to) : seasonRange.to };
  if (preset === "season") from.setUTCMonth(0, 1);
  else if (preset === "30d") from.setUTCDate(from.getUTCDate() - 29);
  else { from.setUTCMonth(from.getUTCMonth() - Number(preset.slice(0, -1))); from.setUTCDate(from.getUTCDate() + 1); }
  return { from: ymd(from), to: ymd(to) };
}
function minutes(value: number | null | undefined) {
  if (value == null) return "Données insuffisantes";
  const hours = Math.floor(value / 60); const rest = Math.round(value % 60);
  return hours ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
}
function value(value: number | null | undefined, suffix = "") { return value == null ? "—" : `${Number(value).toLocaleString("fr-CH")}${suffix}`; }
function trend(value: number | null | undefined, unit = " %") { if (value == null) return "Pas de comparaison disponible"; return `${value > 0 ? "+" : ""}${value.toLocaleString("fr-CH")}${unit} par rapport à la période comparée`; }
const sectionTabs: ReadonlyArray<{ value: Section; label: string }> = [
  { value: "overview", label: "Vue d’ensemble" },
  { value: "attendance", label: "Assiduité" },
  { value: "training", label: "Entraînements" },
  { value: "play", label: "Compétitions et parcours" },
  { value: "evaluations", label: "Évaluations" },
];

export default function ManagerPlayerStatistics({ clubId, playerId, seasonRange }: { clubId: string; playerId: string; seasonRange?: { from: string; to: string } }) {
  const [section, setSection] = useState<Section>("overview");
  const [preset, setPreset] = useState<Preset>("season");
  const initial = useMemo(() => rangeFor("season", seasonRange), [seasonRange]);
  const [from, setFrom] = useState(initial.from); const [to, setTo] = useState(initial.to);
  const [comparison, setComparison] = useState("previous"); const [benchmark, setBenchmark] = useState("none");
  const [stats, setStats] = useState<Stats | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  function selectPreset(next: Preset) { setPreset(next); if (next !== "custom") { const range = rangeFor(next, seasonRange); setFrom(range.from); setTo(range.to); } }
  useEffect(() => {
    if (!clubId || !playerId || !from || !to || from > to) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const session = await supabase.auth.getSession(); const token = session.data.session?.access_token;
        const query = new URLSearchParams({ from, to, comparison, benchmark });
        const response = await fetch(`/api/manager/clubs/${clubId}/players/${playerId}/statistics?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal, cache: "no-store" });
        const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Chargement impossible."); setStats(json);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [benchmark, clubId, comparison, from, playerId, to]);

  return <div className={styles.stack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>Statistiques</h2><p>Analyse des données enregistrées pour le junior et la période sélectionnée.</p></div>{stats?.generatedAt ? <span className={styles.updated}>Actualisé le {new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "short" }).format(new Date(stats.generatedAt))}</span> : null}</div>
      <div className={styles.filters}>
        <label><span>Période</span><select value={preset} onChange={(event) => selectPreset(event.target.value as Preset)}><option value="season">Saison en cours</option><option value="30d">30 derniers jours</option><option value="3m">3 derniers mois</option><option value="6m">6 derniers mois</option><option value="12m">12 derniers mois</option><option value="custom">Période personnalisée</option></select></label>
        {preset === "custom" ? <><label><span>Date de début</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label><span>Date de fin</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label></> : null}
        <label><span>Comparer avec</span><select value={comparison} onChange={(event) => setComparison(event.target.value)}><option value="previous">Période précédente</option><option value="previous_season">Saison précédente</option><option value="none">Aucune comparaison</option></select></label>
        <label><span>Benchmark</span><select value={benchmark} onChange={(event) => setBenchmark(event.target.value)}><option value="none">Aucune comparaison</option><option value="group">Médiane du groupe</option><option value="ftem">Même niveau FTEM</option><option value="club">Médiane du club</option></select></label>
      </div>
      <div className={styles.period}><CalendarDays size={14} />Du {new Intl.DateTimeFormat("fr-CH").format(new Date(`${from}T12:00:00`))} au {new Intl.DateTimeFormat("fr-CH").format(new Date(`${to}T12:00:00`))}{from > to ? <b role="alert">La date de fin doit suivre la date de début.</b> : null}</div>
    </section>
    <ManagerStatisticsTabs<Section> items={sectionTabs} value={section} onChange={setSection} ariaLabel="Sections statistiques" />
    {error ? <div className={styles.error} role="alert"><AlertTriangle size={17} />{error}</div> : null}
    {loading ? <section className={campStyles.panel}><ListLoadingBlock label="Chargement des statistiques…" /></section> : stats ? <>
      {benchmark !== "none" && !stats.benchmark?.enabled ? <div className={styles.info}><AlertTriangle size={16} />{stats.benchmark?.reason}</div> : null}
      {benchmark !== "none" && stats.benchmark?.enabled ? <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Repères de cohorte</h2><p>Médianes anonymisées calculées sur exactement la même période · {stats.benchmark.cohortSize} juniors.</p></div></div><div className={styles.scoreGrid}><div><span>Assiduité médiane</span><b>{value(stats.benchmark.values?.attendanceRate, " %")}</b></div><div><span>Régularité médiane</span><b>{value(stats.benchmark.values?.regularityRate, " %")}</b></div><div><span>Objectif FTEM médian</span><b>{value(stats.benchmark.values?.objectiveRate, " %")}</b></div><div><span>Participations médianes</span><b>{value(stats.benchmark.values?.participation)}</b></div></div></section> : null}
      {section === "overview" ? <Overview stats={stats} onSelect={setSection} /> : null}
      {section === "attendance" ? <Attendance stats={stats} /> : null}
      {section === "training" ? <Training stats={stats} /> : null}
      {section === "play" ? <Play stats={stats} /> : null}
      {section === "evaluations" ? <Evaluations stats={stats} /> : null}
      <Quality quality={stats.quality} />
    </> : null}
  </div>;
}

function Kpi({ label, main, detail, icon, onClick }: { label: string; main: string; detail: string; icon: React.ReactNode; onClick?: () => void }) { const content = <><span className={styles.kpiIcon}>{icon}</span><span className={styles.kpiLabel}>{label}</span><b>{main}</b><small>{detail}</small></>; return onClick ? <button type="button" className={styles.kpi} onClick={onClick}>{content}</button> : <div className={styles.kpi}>{content}</div>; }
function Overview({ stats, onSelect }: { stats: Stats; onSelect: (section: Section) => void }) { const o = stats.overview; return <>
  <section className={styles.kpis} aria-label="Vue d’ensemble statistique">
    <Kpi label="Indice d’assiduité" main={value(o.attendance.rate, " %")} detail={`${o.attendance.present} présence(s) sur ${o.attendance.denominator} comptabilisée(s)`} icon={<CheckCircle2 size={18} />} onClick={() => onSelect("attendance")} />
    <Kpi label="Volume d’entraînement" main={minutes(o.training.minutes)} detail={o.training.objectiveMinutes == null ? "Objectif FTEM indisponible" : `${minutes(o.training.objectiveMinutes)} de repère`} icon={<Clock3 size={18} />} onClick={() => onSelect("training")} />
    <Kpi label="Objectif FTEM" main={value(o.training.objectiveRate, " %")} detail={o.training.ftemCode ? `${o.training.ftemCode} · ${o.training.ftemLabel}` : "Niveau non déterminé"} icon={<Target size={18} />} onClick={() => onSelect("training")} />
    <Kpi label="Handicap actuel" main={value(o.handicap.end)} detail={o.handicap.change == null ? "Évolution indisponible" : `${o.handicap.change > 0 ? "Progression" : "Évolution"} de ${Math.abs(o.handicap.change).toLocaleString("fr-CH")}`} icon={<TrendingDown size={18} />} onClick={() => onSelect("play")} />
    <Kpi label="Compétitions et parcours" main={`${o.play.competitions} / ${o.play.rounds}`} detail={`${o.play.holes} trous documentés`} icon={<Flag size={18} />} onClick={() => onSelect("play")} />
    <Kpi label="Évaluations" main={`${o.evaluations.coachCompleted} / ${o.evaluations.expected}`} detail="évaluations coach complétées" icon={<CheckCircle2 size={18} />} onClick={() => onSelect("evaluations")} />
  </section>
  <section className={styles.summary}><div><span className={styles.kpiIcon}><CheckCircle2 size={17} /></span><h2>Synthèse de la période</h2></div><p>{stats.summary}</p></section>
</>; }
function Attendance({ stats }: { stats: Stats }) { const a = stats.attendance; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Assiduité</h2><p title="Présences ÷ (présences + absences non excusées) × 100. Les absences excusées et présences à confirmer sont exclues du dénominateur.">Activités passées du club auxquelles le junior était convié.</p></div><span className={styles.bigValue}>{value(a.rate, " %")}</span></div><div className={styles.metricGrid}><Kpi label="Invitations" main={String(a.invited)} detail="activités exploitables" icon={<CalendarDays size={17} />} /><Kpi label="Présences" main={String(a.present)} detail="statut final présent" icon={<CheckCircle2 size={17} />} /><Kpi label="Absences" main={String(a.absent)} detail="non excusées" icon={<AlertTriangle size={17} />} /><Kpi label="Excusées" main={String(a.excused)} detail="hors dénominateur" icon={<CalendarDays size={17} />} /><Kpi label="À confirmer" main={String(a.pending)} detail="qualité des données" icon={<RefreshCw size={17} />} /></div><p className={styles.caption}>{trend(a.change, " point(s)")}</p>{a.monthly?.length ? <div className={styles.chart} role="img" aria-label="Évolution mensuelle de l’assiduité"><ResponsiveContainer width="100%" height="100%"><LineChart data={a.monthly}><CartesianGrid stroke="#e7ece6" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} unit=" %" tick={{ fontSize: 11 }} /><Tooltip /><Line dataKey="rate" name="Assiduité" stroke="#607b5b" strokeWidth={2.5} /></LineChart></ResponsiveContainer></div> : <div className={campStyles.empty}>Aucune évolution mensuelle disponible.</div>}<div className={styles.rows}>{a.byType.map((row) => <div key={row.label}><span>{row.label}</span><b>{row.present} / {row.invited}</b></div>)}</div></section>; }
function Training({ stats }: { stats: Stats }) { const o = stats.overview.training; const r = stats.overview.regularity; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Entraînements</h2><p>Volume et régularité calculés à partir des séances enregistrées, sans double comptage des séances liées à un événement.</p></div></div><div className={styles.metricGrid}><Kpi label="Volume total" main={minutes(o.minutes)} detail={`${o.sessions} séance(s)`} icon={<Clock3 size={17} />} /><Kpi label="Durée moyenne" main={minutes(o.averageMinutes)} detail="par séance" icon={<Clock3 size={17} />} /><Kpi label="Moyenne hebdomadaire" main={minutes(o.weeklyAverageMinutes)} detail={trend(o.change)} icon={<CalendarDays size={17} />} /><Kpi label="Régularité" main={value(r.rate, " %")} detail={`${r.activeWeeks} semaine(s) active(s) sur ${r.totalWeeks}`} icon={<Target size={17} />} /><Kpi label="Plus longue série" main={`${r.longestStreak} sem.`} detail={`${r.inactiveWeeks} semaine(s) sans activité enregistrée`} icon={<CheckCircle2 size={17} />} /></div><h3>Répartition par origine</h3><Bars rows={stats.training.byOrigin.map((row) => ({ label: row.key === "club" ? "Club" : row.key === "private" ? "Privé" : "Individuel", ...row }))} /><h3>Répartition des activités</h3>{stats.training.byCategory.length ? <Bars rows={stats.training.byCategory.map((row) => ({ label: row.key, ...row }))} /> : <div className={campStyles.empty}>Aucune catégorie détaillée sur cette période.</div>}{stats.player.isPerformance ? <><h3>Ressenti déclaré par le junior</h3><div className={styles.metricGrid}><Kpi label="Motivation" main={value(stats.training.feelings.motivation, " / 6")} detail="ressenti avant la séance" icon={<MotivationIcon size={18} />} /><Kpi label="Difficulté" main={value(stats.training.feelings.difficulty, " / 6")} detail="difficulté déclarée" icon={<DifficultyIcon size={18} />} /><Kpi label="Satisfaction" main={value(stats.training.feelings.satisfaction, " / 6")} detail={`${stats.training.feelings.completed} séance(s) évaluée(s)`} icon={<SatisfactionIcon size={18} />} /></div></> : null}<p className={styles.caption}>La régularité repose uniquement sur les activités enregistrées et ne signifie pas qu’aucun entraînement réel n’a eu lieu.</p></section>; }
function Bars({ rows }: { rows: Array<Breakdown & { label: string }> }) { return <div className={styles.bars}>{rows.map((row) => <div key={row.label}><div><span>{row.label}</span><b>{minutes(row.minutes)} · {row.sessions} séance(s)</b></div><span className={styles.track}><i style={{ width: `${Math.min(100, row.percentage ?? 0)}%` }} /></span></div>)}</div>; }
function Play({ stats }: { stats: Stats }) { const p = stats.play; const h = stats.overview.handicap; const scoreLabels: Record<string, string> = { eagles: "Eagles", birdies: "Birdies", pars: "Pars", bogeys: "Bogeys", doublesPlus: "Doubles et +" }; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Compétitions et parcours</h2><p>Résultats enregistrés par le junior sur la période, avec l’échantillon réellement exploitable.</p></div></div><div className={styles.metricGrid}><Kpi label="Parcours" main={String(stats.overview.play.rounds)} detail={`${stats.overview.play.competitions} compétition(s) · ${p.frequencyPerMonth} par mois`} icon={<Flag size={17} />} /><Kpi label="Trous documentés" main={String(p.holes)} detail={`${p.completedRounds} parcours complet(s)`} icon={<Target size={17} />} /><Kpi label="Score moyen sur 18" main={value(p.averageScore)} detail={`sur ${p.completedRounds} parcours complet(s)`} icon={<Flag size={17} />} /><Kpi label="Putts moyens sur 18" main={value(p.averagePutts)} detail={`sur ${p.completedRounds} parcours complet(s)`} icon={<Target size={17} />} /><Kpi label="GIR" main={value(p.girRate, " %")} detail={`sur ${p.girSample} trous documentés`} icon={<CheckCircle2 size={17} />} /><Kpi label="Fairways touchés" main={value(p.fairwayRate, " %")} detail={`sur ${p.fairwaySample} départs de par 4/5`} icon={<CheckCircle2 size={17} />} /><Kpi label="Scrambling" main={value(p.scramblingRate, " %")} detail={`sur ${p.scramblingSample} opportunité(s)`} icon={<Target size={17} />} /><Kpi label="Handicap" main={value(h.end)} detail={h.change == null ? "Données insuffisantes" : `${h.change > 0 ? "Progression" : "Évolution"} nette : ${h.change > 0 ? "+" : ""}${h.change}`} icon={<TrendingDown size={17} />} /></div><h3>Moyennes par type de trou</h3><div className={styles.scoreGrid}><div><span>Par 3</span><b>{value(p.averagePar3)}</b></div><div><span>Par 4</span><b>{value(p.averagePar4)}</b></div><div><span>Par 5</span><b>{value(p.averagePar5)}</b></div><div><span>Aller</span><b>{value(p.averageFront)}</b></div><div><span>Retour</span><b>{value(p.averageBack)}</b></div></div>{p.competitionLevels.length || p.orderOfMeritPoints ? <p className={styles.caption}>Niveaux de compétition : {p.competitionLevels.join(", ") || "non renseignés"} · Points Ordre du mérite : {p.orderOfMeritPoints}</p> : null}{stats.handicapHistory.length ? <><h3>Évolution du handicap</h3><div className={styles.chart} role="img" aria-label="Courbe chronologique du handicap avec les valeurs les plus basses placées en bas"><ResponsiveContainer width="100%" height="100%"><LineChart data={stats.handicapHistory}><CartesianGrid stroke="#e7ece6" vertical={false} /><XAxis dataKey="effectiveDate" tick={{ fontSize: 11 }} /><YAxis domain={([dataMin, dataMax]) => [Number(dataMin) - 1, Number(dataMax) + 1]} tick={{ fontSize: 11 }} /><Tooltip formatter={(entry) => [entry, "Handicap"]} /><Line dataKey="value" name="Handicap" stroke="#607b5b" strokeWidth={2.5} /></LineChart></ResponsiveContainer></div></> : <div className={campStyles.empty}>Aucun historique de handicap sur cette période.</div>}<h3>Répartition des scores</h3><div className={styles.scoreGrid}>{Object.entries(p.scores).map(([key, count]) => <div key={key}><span>{scoreLabels[key] ?? key}</span><b>{String(count)}</b></div>)}</div></section>; }
function Evaluations({ stats }: { stats: Stats }) { const e = stats.evaluations; const o = stats.overview.evaluations; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Évaluations</h2><p>Évaluations historiques, auto-évaluations et critères personnalisés.</p></div><span className={styles.bigValue}>{value(o.completionRate, " %")}</span></div><div className={styles.metricGrid}><Kpi label="Attendues" main={String(o.expected)} detail="activités nécessitant une évaluation" icon={<CalendarDays size={17} />} /><Kpi label="Coach complétées" main={String(o.coachCompleted)} detail={`${Math.max(0, o.expected - o.coachCompleted)} manquante(s)`} icon={<CheckCircle2 size={17} />} /><Kpi label="Auto-évaluations" main={String(o.playerCompleted)} detail="ressenti du junior" icon={<Target size={17} />} /><Kpi label="Réponses personnalisées" main={String(e.custom.length)} detail="formats affichés séparément" icon={<CheckCircle2 size={17} />} /></div>{e.coach.length ? <div className={campStyles.tableWrap}><table className={campStyles.table}><thead><tr><th>Activité</th><th>Engagement</th><th>Attitude</th><th>Application</th><th>Commentaire visible</th></tr></thead><tbody>{e.coach.map((row, index) => <tr key={`${row.event_id}-${index}`}><td>{e.events.find((event) => event.id === row.event_id)?.title ?? "Activité"}</td><td>{value(row.engagement)}</td><td>{value(row.attitude)}</td><td>{value(row.performance)}</td><td>{row.visible_to_player ? row.player_note || "—" : "Non publié"}</td></tr>)}</tbody></table></div> : <div className={campStyles.empty}>Aucune évaluation coach sur cette période.</div>}{e.perceptionDifferences.length ? <><h3>Différence de perception</h3><div className={campStyles.tableWrap}><table className={campStyles.table}><thead><tr><th>Critère</th><th>Activité</th><th>Junior</th><th>Coach</th><th>Écart</th></tr></thead><tbody>{e.perceptionDifferences.map((row, index) => <tr key={`${row.startsAt}-${row.criterion}-${index}`}><td>{row.criterion}</td><td>{row.event}</td><td>{value(row.player)}</td><td>{value(row.coach)}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td></tr>)}</tbody></table></div></> : null}{e.custom.length ? <><h3>Critères personnalisés</h3><div className={campStyles.tableWrap}><table className={campStyles.table}><thead><tr><th>Critère</th><th>Domaine</th><th>Répondant</th><th>Réponse</th><th>Format</th></tr></thead><tbody>{e.custom.map((row, index) => <tr key={`${row.event_criterion_id}-${row.respondent_role}-${index}`}><td>{row.criterion?.snapshot_name ?? "Critère"}</td><td>{row.criterion?.snapshot_domain_label ?? "—"}</td><td>{row.respondent_role === "coach" ? "Coach" : "Junior"}</td><td>{typeof row.value_json === "boolean" ? row.value_json ? "Oui" : "Non" : String(row.value_json ?? "—")}</td><td>{row.criterion?.snapshot_response_format ?? "—"}</td></tr>)}</tbody></table></div></> : null}<p className={styles.caption}>Les réponses de formats incompatibles ne sont jamais agrégées dans une moyenne globale. Lorsqu’un même critère est rempli par le junior et le coach, les deux perceptions restent présentées séparément.</p></section>; }
function Quality({ quality }: { quality: Stats["quality"] }) { const rows = [["Présences à confirmer", quality.attendancePending], ["Entraînements sans durée", quality.trainingsWithoutDuration], ["Séances Performance incomplètes", quality.performanceSessionsIncomplete], ["Auto-évaluations manquantes", quality.playerEvaluationsMissing], ["Évaluations coach manquantes", quality.coachEvaluationsMissing], ["Compétitions sans résultat", quality.competitionsWithoutResult]]; return <section className={styles.quality}><div><span className={`${styles.kpiIcon} ${styles.warningIcon}`}><AlertTriangle size={17} /></span><h2>Qualité des données</h2></div><div className={styles.qualityGrid}>{rows.map(([label, count]) => <span key={String(label)}><b>{String(count)}</b>{String(label)}</span>)}</div><small>Dernière donnée enregistrée : {quality.lastDataAt ? new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium" }).format(new Date(quality.lastDataAt)) : "aucune"}.{quality.lowSample ? " Certaines tendances reposent sur un faible échantillon." : ""}</small></section>; }
