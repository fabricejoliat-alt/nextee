"use client";

import { readPlayerPage } from "@/lib/playerPageRead";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, MapPin } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import activityStyles from "../PlayerActivities.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import styles from "./PlayerTrainingsToComplete.module.css";

type PlannedEventRow = {
  id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
  status: "scheduled" | "cancelled";
  requires_evaluation: boolean;
};

type IncompleteEvent = {
  kind: "event";
  id: string;
  event_type: "training" | "camp";
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
};

type IncompleteSession = {
  kind: "session";
  id: string;
  starts_at: string;
  club_event_id: string | null;
  location_text: string | null;
};

type Row = (IncompleteEvent | IncompleteSession) & { href: string };
type PendingPayload = {
  viewerUserId: string; effectiveUserId: string; role: "player" | "parent";
  rows: Row[]; performanceEnabled: boolean; clubNameById: Record<string, string>;
  groupNameById: Record<string, string>; eventById: Record<string, PlannedEventRow>;
};

function dateLocale(locale: string) {
  return locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
}

export default function PlayerTrainingsToCompletePage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [eventById, setEventById] = useState<Record<string, PlannedEventRow>>({});
  const [performanceEnabled, setPerformanceEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    void readPlayerPage<PendingPayload>("/api/player/golf-data?view=pending").then(data => {
      if (!alive) return;
      setRows(data.rows); setPerformanceEnabled(data.performanceEnabled);
      setClubNameById(data.clubNameById); setGroupNameById(data.groupNameById); setEventById(data.eventById);
    }).catch(error => {
      if (!alive) return;
      setError(error instanceof Error ? error.message : "Unable to load evaluations");
      setRows([]); setClubNameById({}); setGroupNameById({}); setEventById({});
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className={`player-dashboard-bg ${styles.page}`}>
      <div className={`app-shell ${styles.shell}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: pickLocaleText(locale, "Mes activités", "My activities"), href: "/player/golf/trainings" }, { label: pickLocaleText(locale, "À évaluer", "To evaluate") }]} />

        <header className={playerUiStyles.topline}>
          <div>
            <h1>{pickLocaleText(locale, "Activités à évaluer", "Activities to evaluate")}</h1>
            <p className={playerUiStyles.lead}>{pickLocaleText(locale, "Complétez la structure réalisée et partagez votre ressenti.", "Complete the activity structure and share your feedback.")}</p>
          </div>
          <Link className={styles.backButton} href="/player/golf/trainings">
            <ArrowLeft size={15} aria-hidden="true" />
            {pickLocaleText(locale, "Retour aux activités", "Back to activities")}
          </Link>
        </header>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <section className={activityStyles.calendarSection} aria-labelledby="evaluation-list-title">
          <div className={activityStyles.agendaPanel}>
            <div className={activityStyles.agendaHeading}>
              <h2 id="evaluation-list-title">
                {pickLocaleText(locale, "À évaluer", "To evaluate")}
                {!loading && performanceEnabled ? ` · ${rows.length}` : ""}
              </h2>
            </div>

          {loading ? <EvaluationListSkeleton label={t("common.loading")} /> : !performanceEnabled ? (
            <div className={activityStyles.empty}>
              <AlertCircle size={22} aria-hidden="true" />
              <strong>{pickLocaleText(locale, "Évaluations indisponibles", "Evaluations unavailable")}</strong>
              <span>{pickLocaleText(locale, "Le mode performance doit être activé pour évaluer les activités.", "Performance mode must be enabled to evaluate activities.")}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className={activityStyles.empty}>
              <CheckCircle2 size={24} aria-hidden="true" />
              <strong>{pickLocaleText(locale, "Vous êtes à jour", "You're up to date")}</strong>
              <span>{pickLocaleText(locale, "Aucune activité ne nécessite une évaluation.", "No activity needs an evaluation.")}</span>
            </div>
          ) : (
            <div className={activityStyles.agenda}>
              {rows.map((row) => {
                if (row.kind === "event") {
                  const clubName = row.club_id ? clubNameById[row.club_id] ?? t("common.club") : t("common.club");
                  const groupName = row.group_id ? groupNameById[row.group_id] ?? pickLocaleText(locale, "Groupe", "Group") : pickLocaleText(locale, "Groupe", "Group");
                  const type = row.event_type === "camp" ? pickLocaleText(locale, "Stage", "Camp") : pickLocaleText(locale, "Entraînement", "Training");
                  return <EvaluationActivityCard key={`event-${row.id}`} start={row.starts_at} type={type} title={`${type} · ${groupName}`} organizer={clubName} location={row.location_text} href={row.href} locale={locale}/>;
                }

                const linkedEvent = row.club_event_id ? eventById[row.club_event_id] : null;
                const clubName = linkedEvent?.club_id ? clubNameById[linkedEvent.club_id] ?? t("common.club") : pickLocaleText(locale, "Activité personnelle", "Personal activity");
                const groupName = linkedEvent?.group_id ? groupNameById[linkedEvent.group_id] ?? pickLocaleText(locale, "Groupe", "Group") : null;
                const type = linkedEvent?.event_type === "camp" ? pickLocaleText(locale, "Stage", "Camp") : pickLocaleText(locale, "Entraînement", "Training");
                return <EvaluationActivityCard key={`session-${row.id}`} start={linkedEvent?.starts_at ?? row.starts_at} type={type} title={groupName ? `${type} · ${groupName}` : pickLocaleText(locale, "Entraînement personnel", "Personal training")} organizer={clubName} location={row.location_text ?? linkedEvent?.location_text ?? null} href={row.href} locale={locale}/>;
              })}
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}

function EvaluationActivityCard({ start, type, title, organizer, location, href, locale }: { start: string; type: string; title: string; organizer: string; location: string | null; href: string; locale: string }) {
  const activityDate = new Date(start);
  const intlLocale = dateLocale(locale);
  const dateDay = new Intl.DateTimeFormat(intlLocale, { weekday: "short" }).format(activityDate).replace(".", "");
  const dateMonth = new Intl.DateTimeFormat(intlLocale, { month: "short" }).format(activityDate).replace(".", "");
  const time = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }).format(activityDate);
  const evaluateLabel = pickLocaleText(locale, "Évaluer", "Evaluate");
  const detailLabel = title.startsWith(`${type} · `) ? title.slice(type.length + 3) : title;
  return <article className={`${dashboardStyles.activityItem} ${activityStyles.dashboardActivity}`}>
    <div className={dashboardStyles.activityDate} aria-label={new Intl.DateTimeFormat(intlLocale, { dateStyle: "full", timeStyle: "short" }).format(activityDate)}>
      <span>{dateDay}</span><b>{activityDate.getDate()}</b><span>{dateMonth}</span><time dateTime={start}>{time}</time>
    </div>
    <div className={dashboardStyles.activityBody}>
      <Link className={dashboardStyles.activityTitle} href={href}>{type}</Link>
      <span className={dashboardStyles.activityMeta}>{detailLabel} · {organizer}</span>
      {location ? <span className={`planning-event-location ${dashboardStyles.activityLocation}`}><MapPin size={14} aria-hidden="true"/><span>{location}</span></span> : null}
    </div>
    <div className={activityStyles.activityAction}>
      <Link className={`${activityStyles.activityIconAction} ${activityStyles.evaluationIconAction}`} href={href} aria-label={`${evaluateLabel} ${title}`} title={pickLocaleText(locale, "À évaluer", "To evaluate")}><ClipboardCheck size={17} aria-hidden="true"/></Link>
    </div>
  </article>;
}

function EvaluationListSkeleton({ label }: { label: string }) {
  return <div className={activityStyles.calendarSkeleton} aria-live="polite" aria-busy="true" aria-label={label}>{Array.from({ length: 3 }, (_, index) => <div className={activityStyles.calendarSkeletonRow} key={index}><span className={activityStyles.calendarSkeletonDate}/><div><span/><span/><span/></div><span className={activityStyles.calendarSkeletonAction}/></div>)}</div>;
}
