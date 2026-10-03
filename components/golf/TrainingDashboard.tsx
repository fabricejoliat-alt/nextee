"use client";
import Link from "next/link";
import { useMemo, useState, useEffect, useId } from "react";
import type { EChartsOption } from "echarts";
import { Activity, CalendarCheck2, ArrowRight, ClipboardList, MessageSquareText, Target, CheckCircle2 } from "lucide-react";
import ActiviteeEChart from "@/components/ui/ActiviteeEChart";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { coachDateLocale } from "@/lib/i18n/coachMessages";
import trainingStyles from "@/app/player/golf/PlayerGolfTraining.module.css";

export type TrainingDashboardSession = { id: string; start_at: string; total_minutes: number | null; session_type: "club" | "private" | "individual"; satisfaction: number | null };
export type TrainingDashboardItem = { session_id: string; category: string; minutes: number };
type Props = {
 sessions: TrainingDashboardSession[]; items: TrainingDashboardItem[]; prevSessions: TrainingDashboardSession[]; prevItems: TrainingDashboardItem[];
 rounds: { start_at: string; total_score: number | null }[];
 fromDate: string; toDate: string; totalMinutes: number; displayedTrainingCount: number; overviewObjective: number;
 overviewFtemPercent: number | null; trainingVolumeTarget: { ftem_code: string } | null; trainingVolumeMotivation: string | null;
 weeklyObjectiveMinutes: number; objectiveForWeek?: (week: string) => number; compareLabel: string | null; periodLabel: string;
 trainingAttendanceOverview: { rate: number | null; present: number; total: number; trend: number | null };
 loading: boolean; pendingEvaluationCount: number;
 latestCoachEvaluation: { player_note: string | null; title: string | null; starts_at: string } | null;
 calendarHref: string; pendingHref: string; onEvaluationsClick: () => void;
};
const isoToYMD = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function weekStartMonday(date: Date) { const result = new Date(date); result.setHours(0, 0, 0, 0); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; }
function avg(values: (number | null)[]) { const known = values.filter((value): value is number => value != null && Number.isFinite(value)); return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length * 10) / 10 : null; }
function shortDate(iso: string, locale: string) { return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso)); }
function ProgressDonut({ percent, size = 156 }: { percent: number; size?: number }) {
  const p = Math.max(0, Math.min(100, percent));
  const gradientId = useId();
  const view = 120;
  const center = view / 2;
  const r = 44;
  const c = 2 * Math.PI * r;
  const [animatedP, setAnimatedP] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedP(p), 60);
    return () => clearTimeout(t);
  }, [p]);
  const dashOffset = c - (animatedP / 100) * c;
  const done = p >= 100;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`} aria-label={`Progression ${Math.round(p)}%`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(40,146,89,1)" />
          <stop offset="100%" stopColor="rgba(16,94,51,1)" />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={r} strokeWidth="12" className="donut-bg" fill="rgba(255,255,255,0.22)" />
      <circle
        cx={center}
        cy={center}
        r={r}
        strokeWidth="12"
        stroke={`url(#${gradientId})`}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={dashOffset}
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.9, 0.2, 1)" }}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text x={center} y={center + 6} textAnchor="middle" className="donut-label">
        {Math.round(p)}%
      </text>
      {done ? (
        <g>
          <circle cx={center} cy={center + 28} r={10} fill="rgba(16,94,51,0.18)" />
          <path
            d={`M${center - 5} ${center + 28} l3 3 l7 -8`}
            fill="none"
            stroke="rgba(16,94,51,0.95)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </svg>
  );
}


export default function TrainingDashboard({
 sessions, items, prevSessions, prevItems, rounds, fromDate, toDate, totalMinutes, displayedTrainingCount, overviewObjective,
 overviewFtemPercent, trainingVolumeTarget, trainingVolumeMotivation, weeklyObjectiveMinutes, objectiveForWeek, compareLabel, periodLabel,
 trainingAttendanceOverview, loading, pendingEvaluationCount, latestCoachEvaluation, calendarHref, pendingHref, onEvaluationsClick,
}: Props) {
 const { locale, t } = useI18n();
 const dateLocale = coachDateLocale(locale);
  const sessionMinutesById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => map.set(item.session_id, (map.get(item.session_id) ?? 0) + Number(item.minutes ?? 0)));
    sessions.forEach((session) => {
      if (!map.has(session.id)) map.set(session.id, Number(session.total_minutes ?? 0));
    });
    return map;
  }, [items, sessions]);

  const previousTrainingMinutes = useMemo(() => {
    const structured = prevItems.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
    return structured > 0 ? structured : prevSessions.reduce((sum, session) => sum + Number(session.total_minutes ?? 0), 0);
  }, [prevItems, prevSessions]);
  const volumeDelta = previousTrainingMinutes > 0 ? Math.round(((totalMinutes - previousTrainingMinutes) / previousTrainingMinutes) * 100) : null;

  const trainingWeeklyRows = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const first = weekStartMonday(new Date(`${fromDate}T12:00:00`));
    const last = new Date(`${toDate}T23:59:59`);
    const rows: Array<{ week: string; label: string; club: number; private: number; individual: number; total: number; objective: number | null }> = [];
    for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const row = { week: isoToYMD(weekStart), label: new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(weekStart), club: 0, private: 0, individual: 0, total: 0, objective: null as number | null };
      sessions.forEach((session) => {
        const time = new Date(session.start_at).getTime();
        if (time < weekStart.getTime() || time >= weekEnd.getTime()) return;
        const minutes = sessionMinutesById.get(session.id) ?? 0;
        row[session.session_type] += minutes;
        row.total += minutes;
      });
      const objective = objectiveForWeek?.(row.week) ?? weeklyObjectiveMinutes;
      row.objective = objective > 0 ? objective : null;
      rows.push(row);
    }
    return rows;
  }, [dateLocale, fromDate, objectiveForWeek, sessionMinutesById, sessions, toDate, weeklyObjectiveMinutes]);

  const regularity = useMemo(() => {
    const active = trainingWeeklyRows.map((row) => row.total > 0);
    let best = 0;
    let running = 0;
    active.forEach((value) => { running = value ? running + 1 : 0; best = Math.max(best, running); });
    let current = 0;
    for (let index = active.length - 1; index >= 0 && active[index]; index -= 1) current += 1;
    return { active: active.filter(Boolean).length, current, best, total: active.length };
  }, [trainingWeeklyRows]);

  const sectorRows = useMemo(() => {
    const previous = new Map<string, number>();
    prevItems.forEach((item) => previous.set(item.category, (previous.get(item.category) ?? 0) + Number(item.minutes ?? 0)));
    const sessionCategories = new Map<string, Set<string>>();
    items.forEach((item) => {
      const categories = sessionCategories.get(item.session_id) ?? new Set<string>();
      categories.add(item.category);
      sessionCategories.set(item.session_id, categories);
    });
    const minutesByCat: Record<string, number> = {};
    items.forEach((item) => { minutesByCat[item.category] = (minutesByCat[item.category] ?? 0) + item.minutes; });
    return Object.entries(minutesByCat).map(([category, minutes]) => {
      const sessionIds = [...sessionCategories.entries()].filter(([, categories]) => categories.has(category)).map(([id]) => id);
      const satisfaction = avg(sessions.filter((session) => sessionIds.includes(session.id)).map((session) => session.satisfaction));
      const previousMinutes = previous.get(category) ?? 0;
      return {
        category,
        label: t(`cat.${category}`),
        minutes,
        percent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
        sessions: sessionIds.length,
        satisfaction,
        delta: previousMinutes > 0 ? Math.round(((minutes - previousMinutes) / previousMinutes) * 100) : null,
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }, [items, prevItems, sessions, t, totalMinutes]);

  const trainingVolumeOption = useMemo<EChartsOption>(() => ({
    animationDuration: 900,
    color: ["#35483b", "#899d7d", "#65869a", "#d9a441"],
    grid: { left: 12, right: 14, top: 24, bottom: 54, containLabel: true },
    legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: "#657168", fontSize: 10, fontWeight: 600 } },
    tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: "#e2e7e1", borderWidth: 1, textStyle: { color: "#17211b", fontWeight: 600 } },
    xAxis: { type: "category", data: trainingWeeklyRows.map((row) => row.label), axisTick: { show: false }, axisLine: { lineStyle: { color: "rgba(53,72,59,.12)" } }, axisLabel: { color: "#7d8780", fontSize: 10 } },
    yAxis: { type: "value", name: "min", axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "rgba(53,72,59,.08)" } }, axisLabel: { color: "#7d8780", fontSize: 10 } },
    series: [
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Club", "Club"), data: trainingWeeklyRows.map((row) => row.club), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Cours privé", "Private lesson"), data: trainingWeeklyRows.map((row) => row.private) },
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Individuel", "Individual"), data: trainingWeeklyRows.map((row) => row.individual) },
      { type: "line", name: pickLocaleText(locale, "Objectif FTEM", "FTEM goal"), data: trainingWeeklyRows.map((row) => row.objective), symbol: "none", lineStyle: { width: 2, type: "dashed", color: "#d9a441" } },
    ],
  }), [locale, trainingWeeklyRows]);

  const sectorChartOption = useMemo<EChartsOption>(() => ({
    animationDuration: 900,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#fff", borderColor: "#e2e7e1", borderWidth: 1 },
    xAxis: { type: "value", axisLabel: { color: "#7d8780", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(53,72,59,.08)" } } },
    yAxis: { type: "category", inverse: true, data: sectorRows.map((row) => row.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#526158", fontSize: 11, fontWeight: 700 } },
    series: [{ type: "bar", data: sectorRows.map((row) => ({ value: row.minutes, itemStyle: { color: "#899d7d", borderRadius: [0, 7, 7, 0] }, label: { show: true, position: "right", formatter: `${row.percent}%`, color: "#526158", fontWeight: 700 } })), barMaxWidth: 22 }],
  }), [sectorRows]);

  const regularityOption = useMemo<EChartsOption>(() => {
    const rows = trainingWeeklyRows.slice(-12);
    const maximum = Math.max(1, ...rows.map((row) => row.total));
    return {
      animationDuration: 700,
      grid: { left: 8, right: 8, top: 32, bottom: 28, containLabel: true },
      tooltip: { formatter: (params: unknown) => { const point = params as { data?: number[] | { value?: number[] } }; const value = Array.isArray(point.data) ? point.data : point.data?.value; const index = Number(value?.[0] ?? 0); return `${rows[index]?.label ?? ""}<br/><b>${rows[index]?.total ?? 0} min</b>`; } },
      visualMap: { min: 0, max: maximum, show: false, inRange: { color: ["#f0f3ef", "#cbd8c7", "#789071", "#35483b"] } },
      xAxis: { type: "category", data: rows.map((row) => row.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#7d8780", fontSize: 10 } },
      yAxis: { type: "category", data: [pickLocaleText(locale, "Volume", "Volume")], axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#657168", fontSize: 10 } },
      series: [{ type: "heatmap", data: rows.map((row, index) => ({ value: [index, 0, row.total], label: { color: row.total / maximum >= 0.52 ? "#ffffff" : "#304438" } })), label: { show: true, formatter: (params: unknown) => `${(params as { value?: number[] }).value?.[2] ?? 0}`, fontSize: 10, fontWeight: 800 }, itemStyle: { borderColor: "#fff", borderWidth: 5, borderRadius: 9 } }],
    };
  }, [locale, trainingWeeklyRows]);

  const trainingRoundObservation = useMemo(() => {
    if (rounds.length < 4 || sessions.length < 6) return null;
    const samples = rounds
      .filter((round) => typeof round.total_score === "number")
      .map((round) => {
        const end = new Date(round.start_at).getTime();
        const start = end - 14 * 86400000;
        const preceding = sessions.filter((session) => {
          const time = new Date(session.start_at).getTime();
          return time >= start && time < end;
        });
        return { score: Number(round.total_score), sessions: preceding.length, minutes: preceding.reduce((sum, session) => sum + (sessionMinutesById.get(session.id) ?? 0), 0) };
      });
    const regular = samples.filter((sample) => sample.sessions >= 2);
    const lighter = samples.filter((sample) => sample.sessions < 2);
    if (regular.length < 2 || lighter.length < 2) return null;
    const regularScore = Math.round((regular.reduce((sum, sample) => sum + sample.score, 0) / regular.length) * 10) / 10;
    const lighterScore = Math.round((lighter.reduce((sum, sample) => sum + sample.score, 0) / lighter.length) * 10) / 10;
    const averageMinutes = Math.round(regular.reduce((sum, sample) => sum + sample.minutes, 0) / regular.length);
    return { sampleSize: samples.length, regularScore, lighterScore, difference: Math.round((regularScore - lighterScore) * 10) / 10, averageMinutes };
  }, [rounds, sessionMinutesById, sessions]);


 return <div className={trainingStyles.dashboard}>
              <section className={trainingStyles.trainingSummaryGrid} aria-label={pickLocaleText(locale, "Repères d’entraînement", "Training benchmarks")}>
                <article className={`${trainingStyles.kpi} ${trainingStyles.volumeKpi}`}>
                  <div className={trainingStyles.kpiTitle}><span><Activity size={17} /></span><h2>{pickLocaleText(locale, "Volume d’entraînement", "Training volume")}</h2></div>
                  <div className={trainingStyles.volumeKpiContent}>
                    {overviewFtemPercent == null ? <div className={trainingStyles.volumeNoGoal}><strong>{totalMinutes} min</strong><p>{pickLocaleText(locale, "Objectif FTEM indisponible", "FTEM goal unavailable")}</p></div> : <div className={trainingStyles.ftemDonut}><ProgressDonut percent={overviewFtemPercent} size={132} /></div>}
                    <div className={trainingStyles.volumeKpiDetails}>
                      <strong>{totalMinutes} min</strong>
                      <p>{pickLocaleText(locale, "sur", "of")} {overviewObjective || "—"} min · {trainingVolumeTarget?.ftem_code ?? "FTEM"}</p>
                      <div className={trainingStyles.metrics}><span>{displayedTrainingCount} {pickLocaleText(locale, displayedTrainingCount === 1 ? "séance" : "séances", displayedTrainingCount === 1 ? "session" : "sessions")}</span>{overviewFtemPercent != null ? <span>{Math.max(0, overviewObjective - totalMinutes)} min {pickLocaleText(locale, "restantes", "remaining")}</span> : null}</div>
                      {trainingVolumeMotivation ? <p className={trainingStyles.volumeMotivation}>{trainingVolumeMotivation}</p> : null}
                      <small className={volumeDelta == null ? "" : volumeDelta >= 0 ? trainingStyles.positive : trainingStyles.caution}>{volumeDelta == null ? pickLocaleText(locale, "Pas de période comparable", "No comparable period") : `${volumeDelta > 0 ? "+" : ""}${volumeDelta}% · ${compareLabel}`}</small>
                    </div>
                  </div>
                </article>

                <article className={`${trainingStyles.kpi} ${trainingStyles.attendanceKpi}`}>
                  <div className={trainingStyles.kpiTitle}><span><CalendarCheck2 size={17} /></span><h2>{pickLocaleText(locale, "Assiduité", "Attendance")}</h2></div>
                  <strong>{trainingAttendanceOverview.rate == null ? "—" : `${trainingAttendanceOverview.rate}%`}</strong>
                  <p>{trainingAttendanceOverview.present} {pickLocaleText(locale, trainingAttendanceOverview.present === 1 ? "entraînement suivi" : "entraînements suivis", trainingAttendanceOverview.present === 1 ? "training attended" : "trainings attended")} / {trainingAttendanceOverview.total}</p>
                  {trainingAttendanceOverview.rate != null ? <div className={trainingStyles.progress}><span style={{ width: `${trainingAttendanceOverview.rate}%` }} /></div> : null}
                  <small className={trainingAttendanceOverview.trend == null ? "" : trainingAttendanceOverview.trend >= 0 ? trainingStyles.positive : trainingStyles.caution}>{trainingAttendanceOverview.trend == null ? pickLocaleText(locale, "Pas de période comparable", "No comparable period") : `${trainingAttendanceOverview.trend > 0 ? "+" : ""}${trainingAttendanceOverview.trend} pts · ${compareLabel}`}</small>
                </article>
              </section>

              <div className={trainingStyles.split}>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume et rythme hebdomadaire", "Weekly volume and rhythm")}</h2><p>{periodLabel} · {pickLocaleText(locale, "volumes empilés par origine", "volume stacked by source")}</p></div><Link href={calendarHref}>{pickLocaleText(locale, "Voir le calendrier", "View calendar")}<ArrowRight size={14} /></Link></div>
                  {loading ? <div className={trainingStyles.empty}>{t("common.loading")}</div> : trainingWeeklyRows.length ? <ActiviteeEChart height={310} ariaLabel={pickLocaleText(locale, "Volume hebdomadaire par origine et objectif FTEM", "Weekly volume by source and FTEM goal")} option={trainingVolumeOption} /> : <div className={trainingStyles.empty}>{t("common.noData")}</div>}
                </section>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Points d’attention", "Points of attention")}</h2><p>{pickLocaleText(locale, "Actions utiles liées à vos séances.", "Useful actions related to your sessions.")}</p></div></div>
                  <div className={trainingStyles.attentionList}>
                    {pendingEvaluationCount ? <Link href={pendingHref}><span><ClipboardList size={16} /></span><div><b>{pendingEvaluationCount} {pickLocaleText(locale, pendingEvaluationCount === 1 ? "activité à évaluer" : "activités à évaluer", pendingEvaluationCount === 1 ? "activity to evaluate" : "activities to evaluate")}</b><small>{pickLocaleText(locale, "Compléter mon ressenti", "Complete my feedback")}</small></div><ArrowRight size={14} /></Link> : null}
                    {latestCoachEvaluation?.player_note ? <button type="button" onClick={onEvaluationsClick}><span><MessageSquareText size={16} /></span><div><b>{pickLocaleText(locale, "Nouveau retour du coach", "New coach feedback")}</b><small>{latestCoachEvaluation.title || shortDate(latestCoachEvaluation.starts_at, dateLocale)}</small></div><ArrowRight size={14} /></button> : null}
                    {overviewFtemPercent != null && overviewFtemPercent < 100 ? <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span><Target size={16} /></span><div><b>{pickLocaleText(locale, "Objectif FTEM à poursuivre", "Keep pursuing the FTEM goal")}</b><small>{Math.max(0, overviewObjective - totalMinutes)} min {pickLocaleText(locale, "restantes", "remaining")}</small></div><ArrowRight size={14} /></button> : null}
                    {!pendingEvaluationCount && !latestCoachEvaluation?.player_note && !(overviewFtemPercent != null && overviewFtemPercent < 100) ? <div className={trainingStyles.empty}><CheckCircle2 size={20} />{pickLocaleText(locale, "Tout est à jour pour le moment.", "Everything is up to date for now.")}</div> : null}
                  </div>
                </section>
              </div>

              <div className={trainingStyles.twoPanels}>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Répartition des secteurs travaillés", "Training area breakdown")}</h2><p>{pickLocaleText(locale, "Durée et part du volume total.", "Duration and share of total volume.")}</p></div></div>
                  {sectorRows.length ? <ActiviteeEChart height={Math.max(250, sectorRows.length * 42)} ariaLabel={pickLocaleText(locale, "Répartition du volume par secteur", "Volume breakdown by training area")} option={sectorChartOption} /> : <div className={trainingStyles.empty}>{pickLocaleText(locale, "Aucun secteur documenté sur cette période.", "No training area documented for this period.")}</div>}
                </section>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Régularité sur 12 semaines", "Consistency over 12 weeks")}</h2><p>{regularity.current} {pickLocaleText(locale, "semaine(s) dans la série actuelle", "week(s) in the current streak")}</p></div></div>
                  {trainingWeeklyRows.length ? <ActiviteeEChart height={250} ariaLabel={pickLocaleText(locale, "Intensité du volume sur les douze dernières semaines", "Training volume intensity over the last twelve weeks")} option={regularityOption} /> : <div className={trainingStyles.empty}>{t("common.noData")}</div>}
                </section>
              </div>


              {sectorRows.length ? <section className={trainingStyles.panel}>
                <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Analyse par secteur", "Analysis by training area")}</h2><p>{pickLocaleText(locale, "Les tendances ne sont affichées qu’avec une période comparable.", "Trends are only shown with a comparable period.")}</p></div></div>
                <div className={trainingStyles.tableWrap}><table className={trainingStyles.table}><thead><tr><th>{pickLocaleText(locale, "Secteur", "Area")}</th><th>{pickLocaleText(locale, "Volume", "Volume")}</th><th>{pickLocaleText(locale, "Séances", "Sessions")}</th><th>{pickLocaleText(locale, "Satisfaction", "Satisfaction")}</th><th>{pickLocaleText(locale, "Tendance volume", "Volume trend")}</th></tr></thead><tbody>{sectorRows.map((row) => <tr key={row.category}><td data-label={pickLocaleText(locale, "Secteur", "Area")}><b>{row.label}</b></td><td data-label={pickLocaleText(locale, "Volume", "Volume")}>{row.minutes} min · {row.percent}%</td><td data-label={pickLocaleText(locale, "Séances", "Sessions")}>{row.sessions}</td><td data-label={pickLocaleText(locale, "Satisfaction", "Satisfaction")}>{row.satisfaction == null ? "—" : `${row.satisfaction}/6`}</td><td data-label={pickLocaleText(locale, "Tendance", "Trend")}>{row.delta == null ? "—" : `${row.delta > 0 ? "+" : ""}${row.delta}%`}</td></tr>)}</tbody></table></div>
              </section> : null}

              {trainingRoundObservation ? <section className={trainingStyles.panel}><div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Relation entraînement–parcours", "Training–round relationship")}</h2><p>{pickLocaleText(locale, "Observation descriptive sur les 14 jours précédant un parcours.", "Descriptive observation over the 14 days preceding a round.")}</p></div></div><p className={trainingStyles.observation}>{pickLocaleText(locale, `Sur ${trainingRoundObservation.sampleSize} parcours, les périodes comprenant au moins deux séances (${trainingRoundObservation.averageMinutes} min en moyenne) sont associées à un score moyen de ${trainingRoundObservation.regularScore}, contre ${trainingRoundObservation.lighterScore} pour les autres périodes. Écart observé : ${trainingRoundObservation.difference > 0 ? "+" : ""}${trainingRoundObservation.difference} coup(s). Cette association ne démontre pas un lien de causalité.`, `Across ${trainingRoundObservation.sampleSize} rounds, periods with at least two sessions (${trainingRoundObservation.averageMinutes} average minutes) are associated with an average score of ${trainingRoundObservation.regularScore}, compared with ${trainingRoundObservation.lighterScore} for other periods. Observed difference: ${trainingRoundObservation.difference > 0 ? "+" : ""}${trainingRoundObservation.difference} stroke(s). This association does not establish causality.`)}</p></section> : null}


 </div>;
}
