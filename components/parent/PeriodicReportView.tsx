import { CalendarDays, Clock3, Flag, Target, TrendingDown } from "lucide-react";
import styles from "@/components/manager/ManagerPlayerStatistics.module.css";
import campStyles from "@/app/manager/camps/Camps.module.css";
import { periodicEventTitle } from "@/lib/periodicReports";

export type PublishedReport = {
  id: string;
  club_name: string;
  period_label: string;
  personalized_comment: string | null;
  published_content: {
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

const duration = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;

export function PeriodicReportView({ report, compactHeading = false }: { report: PublishedReport; compactHeading?: boolean }) {
  const content = report.published_content;
  const sections = content.sections ?? {};
  const next = sections.nextPeriod;
  return <div className={styles.stack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><span className={styles.kpiLabel}>{report.club_name}</span>{compactHeading ? <h2>{content.playerName}</h2> : <h1>Rapport périodique · {content.playerName}</h1>}<p>{report.period_label}</p></div></div>
      <div className={styles.summary}><div><CalendarDays size={18} /><h2>Résumé de la période</h2></div><p>{content.summary}</p></div>
    </section>
    <section className={styles.metricGrid}>
      {sections.attendance ? <Card icon={<CalendarDays />} label="Participation au club" main={`${sections.attendance.present} / ${sections.attendance.invited}`} detail={sections.attendance.rate == null ? "Données insuffisantes" : `${sections.attendance.rate} % d’assiduité · ${sections.attendance.excused} absence(s) excusée(s)`} /> : null}
      {sections.training ? <Card icon={<Clock3 />} label="Entraînement" main={duration(sections.training.minutes)} detail={`${sections.training.sessions} séance(s) · régularité ${sections.training.regularityRate ?? "—"} %${sections.training.objectiveRate == null ? "" : ` · ${sections.training.objectiveRate} % du repère FTEM`}`} /> : null}
      {sections.competitions ? <Card icon={<Flag />} label="Compétitions" main={String(sections.competitions.competitions)} detail={`${sections.competitions.rounds} parcours · ${sections.competitions.results} résultat(s)`} /> : null}
      {sections.handicap ? <Card icon={<TrendingDown />} label="Handicap et FTEM" main={String(sections.handicap.end ?? "—")} detail={`${sections.handicap.ftemCode ?? "Niveau indisponible"}${sections.handicap.change == null ? " · évolution indisponible" : ` · progression nette ${sections.handicap.change > 0 ? "+" : ""}${sections.handicap.change}`}`} /> : null}
      {sections.evaluations ? <Card icon={<Target />} label="Évaluations" main={`${sections.evaluations.sample} observation(s)`} detail={`Engagement ${sections.evaluations.engagement ?? "—"} · attitude ${sections.evaluations.attitude ?? "—"} · application ${sections.evaluations.application ?? "—"}`} /> : null}
    </section>
    {sections.upcoming?.length ? <section className={campStyles.panel}><h2>Prochaines activités</h2><div className={styles.rows}>{sections.upcoming.map((event) => <div key={event.id}><span>{periodicEventTitle(event.title, event.type)}</span><b>{new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.startsAt))}</b></div>)}</div></section> : null}
    {(next?.priority || next?.objective || next?.encouragement) ? <section className={campStyles.panel}><h2>Prochaine période</h2><div className={styles.rows}>{next.priority ? <div><span>Priorité</span><b>{next.priority}</b></div> : null}{next.objective ? <div><span>Objectif</span><b>{next.objective}</b></div> : null}{next.encouragement ? <div><span>Encouragement</span><b>{next.encouragement}</b></div> : null}</div></section> : null}
    {(sections.coachComment || report.personalized_comment) ? <section className={campStyles.panel}><h2>Message de l’encadrement</h2><p>{sections.coachComment ?? report.personalized_comment}</p></section> : null}
  </div>;
}

function Card({ icon, label, main, detail }: { icon: React.ReactNode; label: string; main: string; detail: string }) { return <div className={styles.kpi}><span className={styles.kpiIcon}>{icon}</span><span className={styles.kpiLabel}>{label}</span><b>{main}</b><small>{detail}</small></div>; }
