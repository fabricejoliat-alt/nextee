import { CalendarDays, Clock3, Flag, Target, TrendingDown } from "lucide-react";
import styles from "@/components/manager/ManagerPlayerStatistics.module.css";
import campStyles from "@/app/manager/camps/Camps.module.css";
import { periodicReportLabels } from "@/lib/periodicReportPresentation";
import { periodicEventTitle } from "@/lib/periodicReports";

export type PublishedReport = {
  id: string;
  club_name: string;
  period_label: string;
  personalized_comment: string | null;
  published_content: {
    locale?: string;
    playerName: string;
    summary: string;
    sections?: {
      attendance?: { present: number; invited: number; absent: number; excused: number; rate: number | null } | null;
      training?: { minutes: number; sessions: number; regularityRate?: number | null; objectiveRate?: number | null } | null;
      competitions?: { competitions: number; rounds: number; results: number } | null;
      handicap?: { end: number | null; change: number | null; ftemCode?: string | null; ftemLabel?: string | null } | null;
      evaluations?: { sample: number; engagement: number | null; attitude: number | null; application: number | null } | null;
      upcoming?: Array<{ id: string; title: string; type?: string | null; startsAt: string }> | null;
      nextPeriod?: { priority?: string | null; objective?: string | null; encouragement?: string | null } | null;
      coachComment?: string | null;
    };
  };
};


export function PeriodicReportView({ report, compactHeading = false, locale: requestedLocale }: { report: PublishedReport; compactHeading?: boolean; locale?: string }) {
  const content = report.published_content;
  const { t, number, format, duration, date, locale } = periodicReportLabels(requestedLocale ?? content.locale);
  const sections = content.sections ?? {};
  const next = sections.nextPeriod;
  return <div className={styles.stack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><span className={styles.kpiLabel}>{report.club_name}</span>{compactHeading ? <h2>{content.playerName}</h2> : <h1>{t("title")} · {content.playerName}</h1>}<p>{report.period_label}</p></div></div>
      <div className={styles.summary}><div><CalendarDays size={18} /><h2>{t("summary")}</h2></div><p>{content.summary}</p></div>
    </section>
    <section className={styles.metricGrid}>
      {sections.attendance ? <Card icon={<CalendarDays />} label={t("participation")} main={`${number(sections.attendance.present)} / ${number(sections.attendance.invited)}`} detail={sections.attendance.rate == null ? t("insufficient") : format("attendance", { rate: number(sections.attendance.rate), excused: number(sections.attendance.excused) })} /> : null}
      {sections.training ? <Card icon={<Clock3 />} label={t("training")} main={duration(sections.training.minutes)} detail={format("trainingDetail", { sessions: number(sections.training.sessions), rate: number(sections.training.regularityRate) }) + (sections.training.objectiveRate == null ? "" : format("objective", { rate: number(sections.training.objectiveRate) }))} /> : null}
      {sections.competitions ? <Card icon={<Flag />} label={t("competitions")} main={number(sections.competitions.competitions)} detail={format("competitionDetail", { rounds: number(sections.competitions.rounds), results: number(sections.competitions.results) })} /> : null}
      {sections.handicap ? <Card icon={<TrendingDown />} label={t("handicap")} main={number(sections.handicap.end)} detail={(sections.handicap.ftemCode ?? t("noLevel")) + (sections.handicap.change == null ? t("noChange") : format(sections.handicap.change > 0 ? "improvement" : "change", { value: number(Math.abs(sections.handicap.change)) }))} /> : null}
      {sections.evaluations ? <Card icon={<Target />} label={t("evaluations")} main={format("observations", { count: number(sections.evaluations.sample) })} detail={format("evaluationDetail", { engagement: number(sections.evaluations.engagement), attitude: number(sections.evaluations.attitude), application: number(sections.evaluations.application) })} /> : null}
    </section>
    {sections.upcoming?.length ? <section className={campStyles.panel}><h2>{t("upcoming")}</h2><div className={styles.rows}>{sections.upcoming.map(event => <div key={event.id}><span>{periodicEventTitle(event.title, event.type, locale)}</span><b>{date(event.startsAt)}</b></div>)}</div></section> : null}
    {(next?.priority || next?.objective || next?.encouragement) ? <section className={campStyles.panel}><h2>{t("next")}</h2><div className={styles.rows}>{next.priority ? <div><span>{t("priority")}</span><b>{next.priority}</b></div> : null}{next.objective ? <div><span>{t("goal")}</span><b>{next.objective}</b></div> : null}{next.encouragement ? <div><span>{t("encouragement")}</span><b>{next.encouragement}</b></div> : null}</div></section> : null}
    {(sections.coachComment || report.personalized_comment) ? <section className={campStyles.panel}><h2>{t("coachMessage")}</h2><p>{sections.coachComment ?? report.personalized_comment}</p></section> : null}
  </div>;
}

function Card({ icon, label, main, detail }: { icon: React.ReactNode; label: string; main: string; detail: string }) { return <div className={styles.kpi}><span className={styles.kpiIcon}>{icon}</span><span className={styles.kpiLabel}>{label}</span><b>{main}</b><small>{detail}</small></div>; }
