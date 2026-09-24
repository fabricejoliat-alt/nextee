"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, MapPin } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import campsStyles from "@/app/manager/camps/Camps.module.css";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import activityStyles from "../PlayerActivities.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import styles from "./PlayerTrainingsToComplete.module.css";

type SessionRow = {
  id: string;
  start_at: string;
  club_event_id: string | null;
  location_text: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
};

type SessionItemRow = {
  session_id: string;
  minutes: number;
};

type EventAttendeeRow = {
  event_id: string | null;
  status: "expected" | "present" | "absent" | "excused" | "not_registered" | null;
};

type ClubNameRow = {
  id: string;
  name: string | null;
};

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

type Row = IncompleteEvent | IncompleteSession;

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
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
        const perfEnabled = await isEffectivePlayerPerformanceEnabled(uid);
        setPerformanceEnabled(perfEnabled);
        if (!perfEnabled) {
          setRows([]);
          setClubNameById({});
          setGroupNameById({});
          setEventById({});
          setLoading(false);
          return;
        }

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,club_event_id,location_text,motivation,difficulty,satisfaction")
          .eq("user_id", uid)
          .order("start_at", { ascending: false });
        if (sRes.error) throw new Error(sRes.error.message);
        const sessions = (sRes.data ?? []) as SessionRow[];

        const sessionIds = sessions.map((s) => s.id);
        const itemMap: Record<string, SessionItemRow[]> = {};
        if (sessionIds.length > 0) {
          const itemsRes = await supabase
            .from("training_session_items")
            .select("session_id,minutes")
            .in("session_id", sessionIds);
          if (itemsRes.error) throw new Error(itemsRes.error.message);
          for (const row of (itemsRes.data ?? []) as SessionItemRow[]) {
            if (!itemMap[row.session_id]) itemMap[row.session_id] = [];
            itemMap[row.session_id].push(row);
          }
        }

        const completeSessionIds = new Set<string>();
        for (const s of sessions) {
          const items = itemMap[s.id] ?? [];
          const hasPoste = items.some((it) => (it.minutes ?? 0) > 0);
          const hasSensations =
            typeof s.motivation === "number" &&
            typeof s.difficulty === "number" &&
            typeof s.satisfaction === "number";
          if (hasPoste && hasSensations) completeSessionIds.add(s.id);
        }

        const nowTs = Date.now();
        const completedEventIds = new Set(
          sessions
            .filter((s) => completeSessionIds.has(s.id))
            .map((s) => s.club_event_id)
            .filter((x): x is string => !!x)
        );
        const eventIdsWithAnySession = new Set(
          sessions.map((s) => s.club_event_id).filter((x): x is string => !!x)
        );

        const aRes = await supabase
          .from("club_event_attendees")
          .select("event_id,status")
          .eq("player_id", uid);
        if (aRes.error) throw new Error(aRes.error.message);
        const attendanceMap: Record<string, "expected" | "present" | "absent" | "excused" | "not_registered" | null> = {};
        ((aRes.data ?? []) as EventAttendeeRow[]).forEach((row) => {
          const eventId = String(row.event_id ?? "").trim();
          if (!eventId) return;
          attendanceMap[eventId] = row.status ?? null;
        });

        const incompletePastSessions: IncompleteSession[] = sessions
          .filter((s) => new Date(s.start_at).getTime() < nowTs)
          .filter((s) => {
            if (!s.club_event_id) return true;
            const status = attendanceMap[s.club_event_id] ?? null;
            return status !== "absent" && status !== "excused" && status !== "not_registered";
          })
          .filter((s) => !completeSessionIds.has(s.id))
          .map((s) => ({
            kind: "session",
            id: s.id,
            starts_at: s.start_at,
            club_event_id: s.club_event_id,
            location_text: s.location_text ?? null,
          }));
        const eventIds = Array.from(
          new Set(
            ((aRes.data ?? []) as EventAttendeeRow[])
              .map((r) => String(r.event_id ?? "").trim())
              .filter((v) => v.length > 0)
          )
        );

        let events: PlannedEventRow[] = [];
        if (eventIds.length > 0) {
          const eRes = await supabase
            .from("club_events")
            .select("id,event_type,starts_at,ends_at,duration_minutes,location_text,status,club_id,group_id,requires_evaluation")
            .in("id", eventIds);
          if (eRes.error) throw new Error(eRes.error.message);
          events = (eRes.data ?? []) as PlannedEventRow[];
        }
        const byEventId: Record<string, PlannedEventRow> = {};
        events.forEach((ev) => {
          byEventId[ev.id] = ev;
        });
        setEventById(byEventId);

        const clubIds = Array.from(
          new Set(events.map((ev) => String(ev.club_id ?? "").trim()).filter((v) => v.length > 0))
        );
        if (clubIds.length > 0) {
          const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
          if (!cRes.error) {
            const map: Record<string, string> = {};
            (cRes.data ?? []).forEach((c: ClubNameRow) => {
              map[String(c.id)] = String(c.name ?? "").trim() || t("common.club");
            });
            setClubNameById(map);
          } else {
            setClubNameById({});
          }
        } else {
          setClubNameById({});
        }

        const groupIds = Array.from(
          new Set(events.map((ev) => String(ev.group_id ?? "").trim()).filter((v) => v.length > 0))
        );
        if (groupIds.length > 0) {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token ?? "";
          if (token) {
            const query = new URLSearchParams({ ids: groupIds.join(","), child_id: uid });
            const gRes = await fetch(`/api/player/group-names?${query.toString()}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const gJson = await gRes.json().catch(() => ({}));
            if (gRes.ok) {
              const map: Record<string, string> = {};
              ((gJson?.groups ?? []) as Array<{ id: string; name: string | null }>).forEach((g) => {
                map[g.id] = g.name ?? "Groupe";
              });
              setGroupNameById(map);
            } else {
              setGroupNameById({});
            }
          } else {
            setGroupNameById({});
          }
        } else {
          setGroupNameById({});
        }

        const incompleteEvents: IncompleteEvent[] = events
          .filter((ev) => ev.status === "scheduled")
          .filter((ev) => ev.requires_evaluation)
          .filter((ev) => ev.event_type === "training" || ev.event_type === "camp")
          .filter((ev) => new Date(ev.starts_at).getTime() < nowTs)
          .filter((ev) => {
            const status = attendanceMap[ev.id] ?? null;
            return status !== "absent" && status !== "excused" && status !== "not_registered";
          })
          .filter((ev) => !completedEventIds.has(ev.id))
          .filter((ev) => !eventIdsWithAnySession.has(ev.id))
          .map((ev) => ({
            kind: "event",
            id: ev.id,
            event_type: ev.event_type === "camp" ? "camp" : "training",
            starts_at: ev.starts_at,
            ends_at: ev.ends_at,
            duration_minutes: ev.duration_minutes,
            location_text: ev.location_text,
            club_id: ev.club_id,
            group_id: ev.group_id,
          }));

        const evaluationEventIds = new Set(events.filter((event) => event.requires_evaluation).map((event) => event.id));
        const merged = [
          ...incompleteEvents,
          ...incompletePastSessions.filter((session) => !session.club_event_id || evaluationEventIds.has(session.club_event_id)),
        ].sort(
          (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
        );
        setRows(merged);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t("common.errorLoading");
        setError(message);
        setRows([]);
        setClubNameById({});
        setGroupNameById({});
        setEventById({});
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  return (
    <div className={`player-dashboard-bg ${styles.page}`}>
      <div className={`app-shell ${styles.shell}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: pickLocaleText(locale, "Mes activités", "My activities"), href: "/player/golf/trainings" }, { label: pickLocaleText(locale, "À évaluer", "To evaluate") }]} />

        <header className={campsStyles.topline}>
          <div>
            <h1>{pickLocaleText(locale, "Activités à évaluer", "Activities to evaluate")}</h1>
            <p className={campsStyles.lead}>{pickLocaleText(locale, "Complétez la structure réalisée et partagez votre ressenti.", "Complete the activity structure and share your feedback.")}</p>
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
                  return <EvaluationActivityCard key={`event-${row.id}`} start={row.starts_at} type={type} title={`${type} · ${groupName}`} organizer={clubName} location={row.location_text} href={`/player/golf/trainings/new?club_event_id=${row.id}`} locale={locale}/>;
                }

                const linkedEvent = row.club_event_id ? eventById[row.club_event_id] : null;
                const clubName = linkedEvent?.club_id ? clubNameById[linkedEvent.club_id] ?? t("common.club") : pickLocaleText(locale, "Activité personnelle", "Personal activity");
                const groupName = linkedEvent?.group_id ? groupNameById[linkedEvent.group_id] ?? pickLocaleText(locale, "Groupe", "Group") : null;
                const type = linkedEvent?.event_type === "camp" ? pickLocaleText(locale, "Stage", "Camp") : pickLocaleText(locale, "Entraînement", "Training");
                return <EvaluationActivityCard key={`session-${row.id}`} start={linkedEvent?.starts_at ?? row.starts_at} type={type} title={groupName ? `${type} · ${groupName}` : pickLocaleText(locale, "Entraînement personnel", "Personal training")} organizer={clubName} location={row.location_text ?? linkedEvent?.location_text ?? null} href={`/player/golf/trainings/${row.id}/edit`} locale={locale}/>;
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
