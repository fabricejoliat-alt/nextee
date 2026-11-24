"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerJuniorFeedback, managerJuniorFormat, managerJuniorDate } from "@/lib/managerJuniorPresentation";
import GolfRoundsWorkspace, { type GolfWorkspaceRound, type WorkspaceScorecardHole } from "@/components/golf/GolfRoundsWorkspace";
import type { TrainingVolumeWeek } from "@/lib/managerTrainingVolume";
import { managerLocaleTag } from "@/lib/managerLocale";
import { managerCount } from "@/lib/managerLocale";
import { managerJuniorStatisticsLabels } from "@/lib/managerJuniorStatisticsPresentation";
import type { StatisticsOrganization } from "@/lib/playerStatisticsScope";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Flag, RefreshCw, Target, TrendingDown } from "lucide-react";
import { Bar, Cell, ComposedChart, Pie, PieChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
type CustomEvaluation = { event_criterion_id: string; respondent_role: string; value_json: unknown; criterion?: { snapshot_name?: string; snapshot_domain_label?: string; snapshot_choices?: Array<{ value: string | number | boolean; label: string }>; snapshot_response_format?: string } | null };
type Stats = {
  scope?: { selected: string; organizations: StatisticsOrganization[]; objectiveMode?: "maximum" | "organization"; objectiveOrganization: { id: string; name: string } };
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
  training: { weekly?: TrainingVolumeWeek[]; byOrigin: Breakdown[]; byCategory: Breakdown[]; feelings: { motivation: number | null; difficulty: number | null; satisfaction: number | null; completed: number } };
  play: { rounds?: GolfWorkspaceRound[]; scorecardHoles?: WorkspaceScorecardHole[]; holes: number; completedRounds: number; frequencyPerMonth: number; averageScore: number | null; averagePutts: number | null; girRate: number | null; girSample: number; fairwayRate: number | null; fairwaySample: number; scramblingRate: number | null; scramblingSample: number; averagePar3: number | null; averagePar4: number | null; averagePar5: number | null; averageFront: number | null; averageBack: number | null; competitionLevels: string[]; orderOfMeritPoints: number; scores: Record<string, number> };
  handicapHistory: Array<{ effectiveDate: string; value: number }>;
  evaluations: { coach: CoachEvaluation[]; custom: CustomEvaluation[]; events: Array<{ id: string; title: string; startsAt?: string }>; perceptionDifferences: Array<{ criterion: string; event: string; startsAt: string; player: number; coach: number; difference: number }> };
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



export default function ManagerPlayerStatistics({ clubId, playerId, seasonRange, initialScope = "current", initialIncludePersonal = true }: { clubId: string; playerId: string; seasonRange?: { from: string; to: string }; initialScope?: string; initialIncludePersonal?: boolean }) {
  const { t, locale } = useI18n();
  const { value } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);

  const sectionTabs: ReadonlyArray<{ value: Section; label: string }> = [
  { value: "overview", label: t("manager.home.overview") },
  { value: "attendance", label: t("manager.performance.attendance") },
  { value: "training", label: t("manager.junior.report.training") },
  { value: "play", label: t("manager.junior.stats.play") },
  { value: "evaluations", label: t("manager.performance.evaluations") },
];
  const [section, setSection] = useState<Section>("overview");
  const [preset, setPreset] = useState<Preset>("season");
  const initial = useMemo(() => rangeFor("season", seasonRange), [seasonRange]);
  const [from, setFrom] = useState(initial.from); const [to, setTo] = useState(initial.to);
  const [comparison, setComparison] = useState("previous"); const [benchmark, setBenchmark] = useState("none");
  const [scopeChoice, setScopeChoice] = useState({ clubId, playerId, selected: initialScope });
  const scope = scopeChoice.clubId === clubId && scopeChoice.playerId === playerId ? scopeChoice.selected : "current";
  const [includePersonal, setIncludePersonal] = useState(initialIncludePersonal);
  const [scopeOptions, setScopeOptions] = useState<{ clubId: string; playerId: string; organizations: StatisticsOrganization[] } | null>(null);
  const organizations = scopeOptions?.clubId === clubId && scopeOptions.playerId === playerId ? scopeOptions.organizations : [];
  const isCurrentScope = scope === "current" || scope === clubId;
  const requestKey = JSON.stringify([clubId, playerId, from, to, comparison, benchmark, scope, includePersonal]);
  const [result, setResult] = useState<{ key: string; data: Stats | null; pending: boolean; error: string }>({ key: "", data: null, pending: true, error: "" });
  const currentResult = result.key === requestKey;
  const stats = currentResult ? result.data : null;
  const error = currentResult ? result.error : "";
  const loading = Boolean(from && to && from <= to && (!currentResult || result.pending));

  const validRange = Boolean(from && to && from <= to);
  function selectPreset(next: Preset) { setPreset(next); if (next !== "custom") { const range = rangeFor(next, seasonRange); setFrom(range.from); setTo(range.to); } }
  useEffect(() => {
    if (!clubId || !playerId || !from || !to || from > to) return;
    const controller = new AbortController();
    void (async () => {
      setResult({ key: requestKey, data: null, pending: true, error: "" });
      try {
        const session = await supabase.auth.getSession(); const token = session.data.session?.access_token;
        const query = new URLSearchParams({ from, to, comparison, benchmark: isCurrentScope ? benchmark : "none", scope, include_personal: String(includePersonal) });
        const response = await fetch(`/api/manager/clubs/${clubId}/players/${playerId}/statistics?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal, cache: "no-store" });
        const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Chargement impossible.");
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, data: json, pending: false, error: "" });
          setScopeOptions({ clubId, playerId, organizations: json.scope?.organizations ?? [] });
        }
      } catch (cause) { if (!controller.signal.aborted) setResult({ key: requestKey, data: null, pending: false, error: cause instanceof Error ? cause.message : "Chargement impossible." }); }
    })();
    return () => controller.abort();
  }, [benchmark, clubId, comparison, from, playerId, to, scope, includePersonal, isCurrentScope, requestKey]);

  return <div className={styles.stack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>{t("manager.administration.statistics")}</h2><p>{t("manager.junior.stats.lead")}</p></div>{stats?.generatedAt ? <span className={styles.updated}>{format("updated", { date: managerJuniorDate(t, locale, stats.generatedAt) })}</span> : null}</div>
      <div className={styles.filters}>
        <label><span>{t("manager.junior.stats.structure")}</span><select value={scope === "current" ? clubId : scope} onChange={(event) => { setScopeChoice({ clubId, playerId, selected: event.target.value }); setBenchmark("none"); }}>
          {organizations.length ? organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {t(`organization.${org.org_type}`)}</option>) : <option value={clubId}>{t("manager.junior.stats.currentStructure")}</option>}
          {organizations.length > 1 ? <option value="all">{t("manager.junior.stats.combinedStructures")}</option> : null}
        </select></label>
        <label><span>{t("manager.performance.period")}</span><select value={preset} onChange={(event) => selectPreset(event.target.value as Preset)}><option value="season">{t("manager.junior.stats.currentSeason")}</option><option value="30d">{t("manager.junior.stats.days30")}</option><option value="3m">{t("common.last3Months")}</option><option value="6m">{t("manager.junior.stats.months6")}</option><option value="12m">{t("manager.junior.stats.months12")}</option><option value="custom">{t("manager.junior.stats.customPeriod")}</option></select></label>
        {preset === "custom" ? <><label><span>{t("coach.form.startDate")}</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label><span>{t("coach.form.endDate")}</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label></> : null}
        <label><span>{t("manager.junior.stats.compareWith")}</span><select value={comparison} onChange={(event) => setComparison(event.target.value)}><option value="previous">{t("manager.performance.previous")}</option><option value="previous_season">{t("manager.junior.stats.previousSeason")}</option><option value="none">{t("manager.junior.stats.noBenchmark")}</option></select></label>
        <label><span>{t("manager.junior.stats.benchmark")}</span><select value={isCurrentScope ? benchmark : "none"} disabled={!isCurrentScope} onChange={(event) => setBenchmark(event.target.value)}><option value="none">{t("manager.junior.stats.noBenchmark")}</option><option value="group">{t("manager.junior.stats.groupMedian")}</option><option value="ftem">{t("manager.junior.stats.sameFtem")}</option><option value="club">{t("manager.junior.stats.clubMedian")}</option></select></label>
      </div>
      <label className={styles.personalChoice}><input type="checkbox" checked={includePersonal} onChange={(event) => setIncludePersonal(event.target.checked)} /><span>{t("manager.junior.stats.includePersonal")}</span></label>
      <p className={styles.caption}>{t("manager.junior.stats.scopeHelp")}{stats?.scope?.objectiveMode === "maximum" ? ` ${t("manager.junior.stats.objectiveMaximum")}` : stats?.scope?.objectiveOrganization ? ` ${format("objectiveStructure", { name: stats.scope.objectiveOrganization.name })}` : ""}</p>
      <div className={styles.period}><CalendarDays size={14} />{format("period", { from: from ? managerJuniorDate(t, locale, from, false) : "—", to: to ? managerJuniorDate(t, locale, to, false) : "—" })}{!validRange ? <b role="alert">{t("manager.junior.stats.invalidPeriod")}</b> : null}</div>
    </section>
    <ManagerStatisticsTabs<Section> items={sectionTabs} value={section} onChange={setSection} ariaLabel={t("manager.junior.stats.sections")} />
    {error ? <div className={styles.error} role="alert"><AlertTriangle size={17} />{managerJuniorFeedback(t, error)}</div> : null}
    {loading ? <section className={campStyles.panel}><ListLoadingBlock label={t("manager.junior.stats.loading")} /></section> : stats && validRange ? <>
      {benchmark !== "none" && !stats.benchmark?.enabled ? <div className={styles.info}><AlertTriangle size={16} />{stats.benchmark?.cohortSize != null && stats.benchmark.cohortSize < 5 ? format("smallCohort", { count: value(stats.benchmark.cohortSize) }) : managerJuniorFeedback(t, stats.benchmark?.reason)}</div> : null}
      {benchmark !== "none" && stats.benchmark?.enabled ? <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.junior.stats.cohort")}</h2><p>{format("cohortHelp", { count: value(stats.benchmark.cohortSize) })}</p></div></div><div className={styles.scoreGrid}><div><span>{t("manager.junior.stats.medianAttendance")}</span><b>{value(stats.benchmark.values?.attendanceRate, " %")}</b></div><div><span>{t("manager.performance.medianRegularity")}</span><b>{value(stats.benchmark.values?.regularityRate, " %")}</b></div><div><span>{t("manager.junior.stats.medianObjective")}</span><b>{value(stats.benchmark.values?.objectiveRate, " %")}</b></div><div><span>{t("manager.junior.stats.medianParticipation")}</span><b>{value(stats.benchmark.values?.participation)}</b></div></div></section> : null}
      {section === "overview" ? <Overview stats={stats} onSelect={setSection} /> : null}
      {section === "attendance" ? <Attendance stats={stats} /> : null}
      {section === "training" ? <Training stats={stats} /> : null}
      {section === "play" ? <Play stats={stats} range={{ from, to }} /> : null}
      {section === "evaluations" ? <Evaluations stats={stats} /> : null}
      <Quality quality={stats.quality} />
    </> : null}
  </div>;
}

function Kpi({ label, main, detail, icon, onClick }: { label: string; main: string; detail: string; icon: React.ReactNode; onClick?: () => void }) { const content = <><span className={styles.kpiIcon}>{icon}</span><span className={styles.kpiLabel}>{label}</span><b>{main}</b><small>{detail}</small></>; return onClick ? <button type="button" className={styles.kpi} onClick={onClick}>{content}</button> : <div className={styles.kpi}>{content}</div>; }
function Overview({ stats, onSelect }: { stats: Stats; onSelect: (section: Section) => void }) {
  const { t, locale } = useI18n();
  const { value, minutes, summary } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
 const o = stats.overview; return <>
  <section className={styles.kpis} aria-label={t("manager.junior.stats.overview")}>
    <Kpi label={t("manager.junior.stats.attendanceIndex")} main={value(o.attendance.rate, " %")} detail={format("attendanceDetail", { present: value(o.attendance.present), total: value(o.attendance.denominator) })} icon={<CheckCircle2 size={18} />} onClick={() => onSelect("attendance")} />
    <Kpi label={t("manager.settings.volume.title")} main={minutes(o.training.minutes)} detail={o.training.objectiveMinutes == null ? t("manager.junior.stats.noObjective") : format("reference", { duration: minutes(o.training.objectiveMinutes) })} icon={<Clock3 size={18} />} onClick={() => onSelect("training")} />
    <Kpi label={t("manager.junior.stats.objective")} main={value(o.training.objectiveRate, " %")} detail={o.training.ftemCode ? `${o.training.ftemCode} · ${o.training.ftemLabel}` : t("manager.junior.stats.noLevel")} icon={<Target size={18} />} onClick={() => onSelect("training")} />
    <Kpi label={t("manager.junior.edit.currentHandicap")} main={value(o.handicap.end)} detail={o.handicap.change == null ? t("manager.junior.stats.noTrend") : format(o.handicap.change > 0 ? "improvement" : "change", { value: value(Math.abs(o.handicap.change)) })} icon={<TrendingDown size={18} />} onClick={() => onSelect("play")} />
    <Kpi label={t("manager.junior.stats.play")} main={`${value(o.play.competitions)} / ${value(o.play.rounds)}`} detail={format("documentedHoles", { count: value(o.play.holes) })} icon={<Flag size={18} />} onClick={() => onSelect("play")} />
    <Kpi label={t("manager.performance.evaluations")} main={`${value(o.evaluations.coachCompleted)} / ${value(o.evaluations.expected)}`} detail={t("manager.junior.stats.coachCompletedDetail")} icon={<CheckCircle2 size={18} />} onClick={() => onSelect("evaluations")} />
  </section>
  <section className={styles.summary}><div><span className={styles.kpiIcon}><CheckCircle2 size={17} /></span><h2>{t("manager.junior.stats.summary")}</h2></div><p>{summary(o)}</p></section>
</>; }
function Attendance({ stats }: { stats: Stats }) {
  const { t, locale } = useI18n();
  const { value, trend, month, eventType } = managerJuniorStatisticsLabels(t, locale);

 const a = stats.attendance; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.performance.attendance")}</h2><p title={t("manager.junior.stats.attendanceFormula")}>{t("manager.junior.stats.attendanceHelp")}</p></div><span className={styles.bigValue}>{value(a.rate, " %")}</span></div><div className={styles.metricGrid}><Kpi label={t("manager.junior.stats.invitations")} main={value(a.invited)} detail={t("manager.junior.stats.usableActivities")} icon={<CalendarDays size={17} />} /><Kpi label={t("manager.content.attendance")} main={value(a.present)} detail={t("manager.junior.stats.finalPresent")} icon={<CheckCircle2 size={17} />} /><Kpi label={t("manager.junior.stats.absences")} main={value(a.absent)} detail={t("manager.junior.stats.unexcused")} icon={<AlertTriangle size={17} />} /><Kpi label={t("manager.junior.stats.excused")} main={value(a.excused)} detail={t("manager.junior.stats.excluded")} icon={<CalendarDays size={17} />} /><Kpi label={t("manager.junior.stats.pending")} main={value(a.pending)} detail={t("manager.junior.stats.dataQuality")} icon={<RefreshCw size={17} />} /></div><p className={styles.caption}>{trend(a.change, t("manager.junior.stats.points"))}</p>{a.monthly?.length ? <div className={styles.chart} role="img" aria-label={t("manager.performance.monthlyAttendance")}><ResponsiveContainer width="100%" height="100%"><LineChart data={a.monthly}><CartesianGrid stroke="#e7ece6" vertical={false} /><XAxis dataKey="month" tickFormatter={month} tick={{ fontSize: 11 }} /><YAxis tickFormatter={input => value(Number(input))} domain={[0, 100]} unit=" %" tick={{ fontSize: 11 }} /><Tooltip labelFormatter={label => month(String(label))} formatter={entry => value(Number(entry), " %")} /><Line dataKey="rate" name={t("manager.performance.attendance")} stroke="#607b5b" strokeWidth={2.5} /></LineChart></ResponsiveContainer></div> : <div className={campStyles.empty}>{t("manager.junior.stats.noMonthly")}</div>}<div className={styles.rows}>{a.byType.map((row) => <div key={row.label}><span>{eventType(row.label)}</span><b>{value(row.present)} / {value(row.invited)}</b></div>)}</div></section>; }
function Training({ stats }: { stats: Stats }) {
  const { t, locale } = useI18n();
  const { value, minutes, trend, category } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
  const count = (key: string, value: number) => managerCount(t, locale, `manager.junior.stats.${key}`, value);
  const o = stats.overview.training; const r = stats.overview.regularity;
  const origins = stats.training.byOrigin.map(row => ({ ...row, label: originLabel(t, row.key) }));
  return <section className={campStyles.panel}>
    <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.report.training")}</h2><p>{t("manager.junior.stats.trainingHelp")}</p></div></div>
    <div className={styles.metricGrid}>
      <Kpi label={t("manager.performance.totalVolume")} main={minutes(o.minutes)} detail={count("sessions", o.sessions)} icon={<Clock3 size={17} />} />
      <Kpi label={t("manager.junior.stats.averageDuration")} main={minutes(o.averageMinutes)} detail={t("manager.junior.stats.perSession")} icon={<Clock3 size={17} />} />
      <Kpi label={t("manager.junior.stats.weeklyAverage")} main={minutes(o.weeklyAverageMinutes)} detail={trend(o.change)} icon={<CalendarDays size={17} />} />
      <Kpi label={t("golfDashboard.consistency")} main={value(r.rate, " %")} detail={format("activeWeeks", { active: value(r.activeWeeks), total: value(r.totalWeeks) })} icon={<Target size={17} />} />
      <Kpi label={t("manager.junior.stats.longestStreak")} main={format("weeks", { count: value(r.longestStreak) })} detail={format("inactiveWeeks", { count: value(r.inactiveWeeks) })} icon={<CheckCircle2 size={17} />} />
      <Kpi label={t("manager.junior.stats.ftemTarget")} main={minutes(o.objectiveMinutes)} detail={o.objectiveMinutes == null ? t("manager.junior.stats.noObjective") : [o.ftemCode, value(o.objectiveRate, " %")].filter(Boolean).join(" · ")} icon={<Target size={17} />} />
    </div>
    <TrainingVolumeChart rows={stats.training.weekly ?? []} />
    <div className={styles.breakdownGrid}>
      <section className={styles.breakdownPanel}><div className={styles.chartHeading}><h3>{t("manager.junior.stats.origins")}</h3><span>{minutes(o.minutes)}</span></div><OriginChart rows={origins} /></section>
      <section className={styles.breakdownPanel}><div className={styles.chartHeading}><h3>{t("manager.junior.stats.categories")}</h3><span>{count("sessions", o.sessions)}</span></div>{stats.training.byCategory.length ? <Bars rows={stats.training.byCategory.map(row => ({ ...row, label: category(row.key) }))} /> : <div className={campStyles.empty}>{t("manager.junior.stats.noCategories")}</div>}</section>
    </div>
    {stats.player.isPerformance ? <><h3>{t("manager.junior.stats.feelings")}</h3><div className={styles.metricGrid}>
      <Kpi label={t("manager.settings.volume.motivation")} main={value(stats.training.feelings.motivation, " / 6")} detail={t("manager.junior.stats.beforeSession")} icon={<MotivationIcon size={18} />} />
      <Kpi label={t("common.difficulty")} main={value(stats.training.feelings.difficulty, " / 6")} detail={t("manager.junior.stats.reportedDifficulty")} icon={<DifficultyIcon size={18} />} />
      <Kpi label={t("common.satisfaction")} main={value(stats.training.feelings.satisfaction, " / 6")} detail={format("evaluatedSessions", { count: value(stats.training.feelings.completed) })} icon={<SatisfactionIcon size={18} />} />
    </div></> : null}
    <p className={styles.caption}>{t("manager.junior.stats.regularityHelp")}</p>
  </section>;
}
const originColors = { club: "#35483b", private: "#65869a", individual: "#9caf8d", other: "#b2aaa0" };
const breakdownColors = ["#55704e", "#78936e", "#65869a", "#a3b297", "#8a9fa5", "#b4a77f"];
function originLabel(t: (key: string) => string, key: string) {
  return key === "club" ? t("manager.junior.stats.organized") : key === "private" ? t("manager.junior.stats.private") : key === "individual" ? t("manager.settings.ai.individual") : t("manager.junior.stats.otherOrigin");
}
function TrainingVolumeChart({ rows }: { rows: TrainingVolumeWeek[] }) {
  const { t, locale } = useI18n();
  const { minutes, value } = managerJuniorStatisticsLabels(t, locale);
  const week = (date: string) => new Intl.DateTimeFormat(managerLocaleTag(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const keys = (["club", "private", "individual", "other"] as const).filter(key => key !== "other" || rows.some(row => row.other > 0));
  return <section className={styles.volumePanel}>
    <div className={styles.chartHeading}><div><h3>{t("manager.junior.stats.volumeChart")}</h3><p>{t("manager.junior.stats.volumeChartHelp")}</p></div><span className={styles.volumeIcon}><Target size={20} /></span></div>
    <div className={styles.chartLegend}>{keys.map(key => <span key={key}><i style={{ background: originColors[key] }} />{originLabel(t, key)}</span>)}<span><i className={styles.dashedKey} />{t("manager.junior.stats.ftemTarget")}</span></div>
    {rows.length ? <div className={styles.volumeChart} role="img" aria-label={t("manager.junior.stats.volumeChart")}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
      <CartesianGrid stroke="#e7ece6" vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="week" tickFormatter={week} tick={{ fontSize: 10, fill: "#7b887e" }} axisLine={false} tickLine={false} minTickGap={28} />
      <YAxis width={48} tickFormatter={input => `${value(Number(input) / 60)} h`} tick={{ fontSize: 10, fill: "#7b887e" }} axisLine={false} tickLine={false} />
      <Tooltip labelFormatter={input => week(String(input))} formatter={(input, name) => [minutes(Number(input)), String(name)]} contentStyle={{ border: "1px solid #e1e8de", borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px #26382b12" }} cursor={{ fill: "#edf3ea88" }} />
      {keys.map(key => <Bar isAnimationActive={false} key={key} dataKey={key} name={originLabel(t, key)} stackId="volume" fill={originColors[key]} maxBarSize={28} radius={[3, 3, 0, 0]} />)}
      <Line isAnimationActive={false} dataKey="objective" name={t("manager.junior.stats.ftemTarget")} type="stepAfter" stroke="#c79837" strokeWidth={2.5} strokeDasharray="6 5" dot={false} connectNulls={false} />
    </ComposedChart></ResponsiveContainer></div> : <div className={campStyles.empty}>{t("manager.junior.stats.noCategories")}</div>}
    {!rows.some(row => row.objective != null) ? <p className={styles.caption}>{t("manager.junior.stats.noObjective")}</p> : null}
  </section>;
}
function OriginChart({ rows }: { rows: Array<Breakdown & { label: string }> }) {
  const { t, locale } = useI18n();
  const { minutes } = managerJuniorStatisticsLabels(t, locale);
  const values = rows.filter(row => row.minutes > 0);
  const total = values.reduce((sum, row) => sum + row.minutes, 0);
  return <div className={styles.originLayout}>
    {total > 0 ? <div className={styles.originDonut} role="img" aria-label={t("manager.junior.stats.origins")}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={values} dataKey="minutes" nameKey="label" innerRadius="67%" outerRadius="90%" paddingAngle={values.length > 1 ? 3 : 0} stroke="none">{values.map(row => <Cell key={row.key} fill={originColors[row.key as keyof typeof originColors] ?? originColors.other} />)}</Pie><Tooltip formatter={input => minutes(Number(input))} contentStyle={{ borderRadius: 10, fontSize: 12 }} /><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className={styles.donutTotal}>{minutes(total)}</text><text x="50%" y="61%" textAnchor="middle" className={styles.donutCaption}>{t("manager.performance.totalVolume")}</text></PieChart></ResponsiveContainer></div> : null}
    <Bars rows={rows} origin />
  </div>;
}
function Bars({ rows, origin = false }: { rows: Array<Breakdown & { label: string }>; origin?: boolean }) {
  const { t, locale } = useI18n();
  const { minutes, value } = managerJuniorStatisticsLabels(t, locale);
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  const count = (input: number) => managerCount(t, locale, "manager.junior.stats.sessions", input);
  return <div className={styles.distributionRows}>{[...rows].sort((a, b) => b.minutes - a.minutes).map((row, index) => {
    const color = origin ? originColors[row.key as keyof typeof originColors] ?? originColors.other : breakdownColors[index % breakdownColors.length];
    const percentage = row.percentage ?? (total ? row.minutes / total * 100 : 0);
    return <div className={styles.distributionRow} key={row.key}>
      <div className={styles.distributionLabel}><span><i style={{ background: color }} />{row.label}</span><b>{value(percentage, " %")}</b></div>
      <div className={styles.distributionTrack}><i style={{ width: `${Math.min(100, Math.max(0, percentage))}%`, background: color }} /></div>
      <div className={styles.distributionMeta}><strong>{minutes(row.minutes)}</strong><span>{count(row.sessions)}</span></div>
    </div>;
  })}</div>;
}
function Play({ stats, range }: { stats: Stats; range: { from: string; to: string } }) {
  const { t, locale } = useI18n();
  const { value } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
 const p = stats.play; const h = stats.overview.handicap; const scoreLabels: Record<string, string> = { eagles: t("manager.junior.stats.eagles"), birdies: t("manager.junior.stats.birdies"), pars: t("manager.junior.stats.pars"), bogeys: t("manager.junior.stats.bogeys"), doublesPlus: t("manager.junior.stats.doublesPlus") }; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.junior.stats.play")}</h2><p>{t("manager.junior.stats.playHelp")}</p></div></div><div className={styles.metricGrid}><Kpi label={t("playerHome.rounds")} main={value(stats.overview.play.rounds)} detail={format("competitionFrequency", { count: value(stats.overview.play.competitions), frequency: value(p.frequencyPerMonth) })} icon={<Flag size={17} />} /><Kpi label={t("manager.junior.stats.holes")} main={value(p.holes)} detail={format("completeRounds", { count: value(p.completedRounds) })} icon={<Target size={17} />} /><Kpi label={t("manager.junior.stats.score18")} main={value(p.averageScore)} detail={format("completeRounds", { count: value(p.completedRounds) })} icon={<Flag size={17} />} /><Kpi label={t("manager.junior.stats.putts18")} main={value(p.averagePutts)} detail={format("completeRounds", { count: value(p.completedRounds) })} icon={<Target size={17} />} /><Kpi label={t("manager.junior.stats.gir")} main={value(p.girRate, " %")} detail={format("documentedHoles", { count: value(p.girSample) })} icon={<CheckCircle2 size={17} />} /><Kpi label={t("golfDashboard.fairwaysHit")} main={value(p.fairwayRate, " %")} detail={format("fairwaySample", { count: value(p.fairwaySample) })} icon={<CheckCircle2 size={17} />} /><Kpi label={t("manager.junior.stats.scrambling")} main={value(p.scramblingRate, " %")} detail={format("opportunities", { count: value(p.scramblingSample) })} icon={<Target size={17} />} /><Kpi label={t("manager.settings.volume.handicap")} main={value(h.end)} detail={h.change == null ? t("manager.performance.insufficient") : format(h.change > 0 ? "improvement" : "change", { value: value(Math.abs(h.change)) })} icon={<TrendingDown size={17} />} /></div><GolfRoundsWorkspace key={`${range.from}:${range.to}:${stats.scope?.selected ?? "current"}`} readOnly listOnly appliedRange={range} dataset={{ rounds: p.rounds ?? [], holes: p.scorecardHoles ?? [], loading: false }} /><h3>{t("manager.junior.stats.holeTypeAverages")}</h3><div className={styles.scoreGrid}><div><span>{t("manager.junior.stats.par3")}</span><b>{value(p.averagePar3)}</b></div><div><span>{t("manager.junior.stats.par4")}</span><b>{value(p.averagePar4)}</b></div><div><span>{t("manager.junior.stats.par5")}</span><b>{value(p.averagePar5)}</b></div><div><span>{t("manager.junior.stats.front")}</span><b>{value(p.averageFront)}</b></div><div><span>{t("manager.junior.stats.back")}</span><b>{value(p.averageBack)}</b></div></div>{p.competitionLevels.length || p.orderOfMeritPoints ? <p className={styles.caption}>{format("competitionLevels", { levels: p.competitionLevels.join(", ") || t("manager.junior.stats.levelsMissing"), points: value(p.orderOfMeritPoints) })}</p> : null}{stats.handicapHistory.length ? <><h3>{t("manager.junior.edit.handicapTrend")}</h3><div className={styles.chart} role="img" aria-label={t("manager.junior.stats.handicapChart")}><ResponsiveContainer width="100%" height="100%"><LineChart data={stats.handicapHistory}><CartesianGrid stroke="#e7ece6" vertical={false} /><XAxis dataKey="effectiveDate" tickFormatter={input => managerJuniorDate(t, locale, String(input), false)} tick={{ fontSize: 11 }} /><YAxis tickFormatter={input => value(Number(input))} domain={([dataMin, dataMax]) => [Number(dataMin) - 1, Number(dataMax) + 1]} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={input => managerJuniorDate(t, locale, String(input), false)} formatter={(entry) => [value(Number(entry)), t("manager.settings.volume.handicap")]} /><Line dataKey="value" name={t("manager.settings.volume.handicap")} stroke="#607b5b" strokeWidth={2.5} /></LineChart></ResponsiveContainer></div></> : <div className={campStyles.empty}>{t("manager.junior.stats.noHandicap")}</div>}<h3>{t("golfDashboard.scoreDistribution")}</h3><div className={styles.scoreGrid}>{Object.entries(p.scores).map(([key, count]) => <div key={key}><span>{scoreLabels[key] ?? key}</span><b>{value(Number(count))}</b></div>)}</div></section>; }
function Evaluations({ stats }: { stats: Stats }) {
  const { t, locale } = useI18n();
  const { value, responseFormat, customResponse } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
 const e = stats.evaluations; const o = stats.overview.evaluations; return <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.performance.evaluations")}</h2><p>{t("manager.junior.stats.evaluationsHelp")}</p></div><span className={styles.bigValue}>{value(o.completionRate, " %")}</span></div><div className={styles.metricGrid}><Kpi label={t("manager.performance.expected")} main={value(o.expected)} detail={t("manager.junior.stats.requiresEvaluation")} icon={<CalendarDays size={17} />} /><Kpi label={t("manager.junior.stats.coachCompleted")} main={value(o.coachCompleted)} detail={format("missing", { count: value(Math.max(0, o.expected - o.coachCompleted)) })} icon={<CheckCircle2 size={17} />} /><Kpi label={t("manager.junior.stats.selfEvaluations")} main={value(o.playerCompleted)} detail={t("manager.junior.stats.juniorFeelings")} icon={<Target size={17} />} /><Kpi label={t("manager.junior.stats.customResponses")} main={value(e.custom.length)} detail={t("manager.junior.stats.separateFormats")} icon={<CheckCircle2 size={17} />} /></div>{e.coach.length ? <div className={`${campStyles.tableWrap} ${styles.evaluationTableWrap}`}><table className={`${campStyles.table} ${styles.dataTable} ${styles.evaluationTable}`}><thead><tr><th>{t("coach.activity.other")}</th><th>{t("coachDebrief.engagement")}</th><th>{t("coachDebrief.attitude")}</th><th>{t("coachDebrief.application")}</th><th>{t("manager.junior.stats.visibleComment")}</th></tr></thead><tbody>{e.coach.map((row, index) => <tr key={`${row.event_id}-${index}`}><td data-label={t("coach.activity.other")}><div className={styles.evaluationActivity}><strong>{e.events.find((event) => event.id === row.event_id)?.title ?? t("coach.activity.other")}</strong>{e.events.find(event => event.id === row.event_id)?.startsAt ? <small>{managerJuniorDate(t, locale, e.events.find(event => event.id === row.event_id)!.startsAt!, false)}</small> : null}</div></td><td data-label={t("coachDebrief.engagement")}><EvaluationScore score={row.engagement} /></td><td data-label={t("coachDebrief.attitude")}><EvaluationScore score={row.attitude} /></td><td data-label={t("coachDebrief.application")}><EvaluationScore score={row.performance} /></td><td data-label={t("manager.junior.stats.visibleComment")}>{row.visible_to_player ? <p className={styles.evaluationComment}>{row.player_note || "—"}</p> : <span className={styles.evaluationBadge}>{t("manager.junior.stats.unpublished")}</span>}</td></tr>)}</tbody></table></div> : <div className={campStyles.empty}>{t("manager.junior.stats.noCoachEvaluations")}</div>}{e.perceptionDifferences.length ? <><h3>{t("manager.junior.stats.perception")}</h3><div className={`${campStyles.tableWrap} ${styles.evaluationTableWrap}`}><table className={`${campStyles.table} ${styles.dataTable} ${styles.evaluationTable}`}><thead><tr><th>{t("manager.junior.stats.criterion")}</th><th>{t("coach.activity.other")}</th><th>{t("manager.performance.junior")}</th><th>{t("manager.performance.coach")}</th><th>{t("manager.junior.stats.difference")}</th></tr></thead><tbody>{e.perceptionDifferences.map((row, index) => <tr key={`${row.startsAt}-${row.criterion}-${index}`}><td data-label={t("manager.junior.stats.criterion")}>{row.criterion}</td><td data-label={t("coach.activity.other")}>{row.event}</td><td data-label={t("manager.performance.junior")}>{value(row.player)}</td><td data-label={t("manager.performance.coach")}>{value(row.coach)}</td><td data-label={t("manager.junior.stats.difference")}>{row.difference > 0 ? "+" : ""}{value(row.difference)}</td></tr>)}</tbody></table></div></> : null}{e.custom.length ? <><h3>{t("manager.administration.criteria.custom")}</h3><div className={`${campStyles.tableWrap} ${styles.evaluationTableWrap}`}><table className={`${campStyles.table} ${styles.dataTable} ${styles.evaluationTable}`}><thead><tr><th>{t("manager.junior.stats.criterion")}</th><th>{t("manager.administration.criteria.domain")}</th><th>{t("manager.junior.stats.respondent")}</th><th>{t("manager.content.answer")}</th><th>{t("manager.administration.criteria.format")}</th></tr></thead><tbody>{e.custom.map((row, index) => <tr key={`${row.event_criterion_id}-${row.respondent_role}-${index}`}><td data-label={t("manager.junior.stats.criterion")}>{row.criterion?.snapshot_name ?? t("manager.junior.stats.criterion")}</td><td data-label={t("manager.administration.criteria.domain")}>{row.criterion?.snapshot_domain_label ?? "—"}</td><td data-label={t("manager.junior.stats.respondent")}>{row.respondent_role === "coach" ? t("manager.performance.coach") : t("manager.performance.junior")}</td><td data-label={t("manager.content.answer")}><span className={styles.responseValue}>{customResponse(row.value_json, row.criterion?.snapshot_choices)}</span></td><td data-label={t("manager.administration.criteria.format")}>{responseFormat(row.criterion?.snapshot_response_format)}</td></tr>)}</tbody></table></div></> : null}<p className={styles.caption}>{t("manager.junior.stats.formatsHelp")}</p></section>; }
function EvaluationScore({ score }: { score: number | null }) {
  const { t, locale } = useI18n();
  const { value } = managerJuniorStatisticsLabels(t, locale);
  return <span className={styles.evaluationScore}><b>{value(score, score == null ? "" : " / 6")}</b><span className={styles.scoreDots} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} data-filled={score != null && index < score} />)}</span></span>;
}
function Quality({ quality }: { quality: Stats["quality"] }) {
  const { t, locale } = useI18n();
  const { value } = managerJuniorStatisticsLabels(t, locale);
  const format = (key: string, values: Record<string, string | number>) => managerJuniorFormat(t, `stats.${key}`, values);
 const rows = [[t("manager.junior.stats.pendingAttendance"), quality.attendancePending], [t("manager.junior.stats.noDuration"), quality.trainingsWithoutDuration], [t("manager.junior.stats.incompletePerformance"), quality.performanceSessionsIncomplete], [t("manager.junior.stats.missingSelf"), quality.playerEvaluationsMissing], [t("manager.junior.stats.missingCoach"), quality.coachEvaluationsMissing], [t("manager.junior.stats.noResult"), quality.competitionsWithoutResult]]; return <section className={styles.quality}><div><span className={`${styles.kpiIcon} ${styles.warningIcon}`}><AlertTriangle size={17} /></span><h2>{t("manager.administration.stats.quality")}</h2></div><div className={styles.qualityGrid}>{rows.map(([label, count]) => <span key={String(label)}><b>{value(Number(count))}</b>{String(label)}</span>)}</div><small>{format("lastData", { date: quality.lastDataAt ? managerJuniorDate(t, locale, quality.lastDataAt, false) : t("manager.junior.stats.noData") })}{quality.lowSample ? t("manager.junior.stats.lowSample") : ""}</small></section>; }
