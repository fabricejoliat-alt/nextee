"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerCalendarText } from "@/lib/i18n/managerCalendarMessages";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import { CalendarDays, ChevronLeft, ChevronRight, Trash2, MapPin, Pencil } from "lucide-react";

type CalendarView = "month" | "week" | "day";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | "competition" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
  competition_level: "internal" | "club" | "regional" | "national" | "international" | null;
  competition_category: "u10" | "u12" | "u14" | "u16" | "u18" | "all" | null;
  external_registration_url: string | null;
  competition_note: string | null;
};

type ManagedClub = { id: string; name: string | null };
type CalendarGroupRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  is_archived: boolean;
  head_coach_user_id: string | null;
  head_coach_name: string | null;
};
type EventCoachRow = {
  event_id: string;
  coach_id: string;
  coach_name: string | null;
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#53675a",
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday start
  return addDays(x, -diff);
}

function endOfWeek(d: Date) {
  return endOfDay(addDays(startOfWeek(d), 6));
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dateTimeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function monthLabel(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
}

function dayHeaderLabel(d: Date, locale: string) {
  const raw = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(d);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function dateCardParts(date: Date, locale: string) {
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date);
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return {
    day: capitalize(format({ weekday: "long" })),
    month: capitalize(format({ month: "long" })),
    number: date.getDate(),
  };
}

function eventTypeLabel(v: EventRow["event_type"], locale: string) {
  const l = locale as "fr" | "en" | "de" | "it";
  if (v === "training") return managerCalendarText(l, "Entraînement", "Training");
  if (v === "interclub") return managerCalendarText(l, "Interclub", "Interclub");
  if (v === "camp") return managerCalendarText(l, "Stage", "Camp");
  if (v === "session") return managerCalendarText(l, "Séance", "Session");
  if (v === "competition") return managerCalendarText(l, "Compétition", "Competition");
  return managerCalendarText(l, "Activité", "Activity");
}

function eventTypeColor(v: EventRow["event_type"]) {
  if (v === "training") return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.48)", text: "rgba(20,83,45,1)" };
  if (v === "interclub") return { bg: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.46)", text: "rgba(30,64,175,1)" };
  if (v === "camp") return { bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.50)", text: "rgba(120,53,15,1)" };
  if (v === "session") return { bg: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.46)", text: "rgba(88,28,135,1)" };
  if (v === "competition") return { bg: "rgba(217,164,65,0.18)", border: "rgba(181,126,24,0.52)", text: "rgba(105,69,10,1)" };
  return { bg: "rgba(15,23,42,0.10)", border: "rgba(15,23,42,0.24)", text: "rgba(15,23,42,1)" };
}

function competitionLevelLabel(value: EventRow["competition_level"], locale: string) {
  if (value === "internal") return managerCalendarText(locale, "Tournoi interne", "Internal tournament");
  if (value === "club") return managerCalendarText(locale, "Tournoi Club", "Club tournament");
  if (value === "regional") return managerCalendarText(locale, "Régional", "Regional");
  if (value === "national") return managerCalendarText(locale, "National", "National");
  if (value === "international") return managerCalendarText(locale, "International", "International");
  return "—";
}

function competitionCategoryLabel(value: EventRow["competition_category"], locale: string) {
  return value === "all" ? managerCalendarText(locale, "Tous", "All") : String(value ?? "—").toUpperCase();
}

function eventPeriodLabel(event: EventRow, locale: string) {
  if (!event.ends_at) return dateTimeLabel(event.starts_at, locale);
  if (event.event_type === "competition") {
    const format = (iso: string) => new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
    return `${format(event.starts_at)} — ${format(event.ends_at)}`;
  }
  return `${dateTimeLabel(event.starts_at, locale)} — ${dateTimeLabel(event.ends_at, locale)}`;
}

function eventSpansMultipleDays(event: EventRow) {
  if (!event.ends_at) return false;
  const dateKey = (iso: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return dateKey(event.starts_at) !== dateKey(event.ends_at);
}

function eventTimeOrPeriodLabel(event: EventRow, locale: string) {
  return event.event_type === "competition" ? eventPeriodLabel(event, locale) : timeLabel(event.starts_at, locale);
}

function overlapsDay(e: EventRow, d: Date) {
  const s = new Date(e.starts_at).getTime();
  const eTime = new Date(e.ends_at ?? e.starts_at).getTime();
  const ds = startOfDay(d).getTime();
  const de = endOfDay(d).getTime();
  return s <= de && eTime >= ds;
}

export default function CoachCalendarPage() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => managerCalendarText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";

  const [pending, setPending] = useState(true);
  const [loadedPeriod, setLoadedPeriod] = useState("");
  const [revision, setRevision] = useState(0);
  const [activityStats, setActivityStats] = useState({ completed: 0, planned: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [groupHeadCoachNames, setGroupHeadCoachNames] = useState<Record<string, string>>({});
  const [coachNamesByEventId, setCoachNamesByEventId] = useState<Record<string, string[]>>({});
  const [groupFilterOptions, setGroupFilterOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [attendeeByEvent, setAttendeeByEvent] = useState<Record<string, string[]>>({});
  const [playerNameById, setPlayerNameById] = useState<Record<string, string>>({});
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [playerFilter, setPlayerFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");

  const [view, setView] = useState<CalendarView>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const from = (view === "month" ? startOfMonth(anchorDate) : view === "week" ? startOfWeek(anchorDate) : startOfDay(anchorDate)).toISOString();
  const to = (view === "month" ? endOfMonth(anchorDate) : view === "week" ? endOfWeek(anchorDate) : endOfDay(anchorDate)).toISOString();
  const periodKey = `${from}|${to}`;
  const loading = pending || loadedPeriod !== periodKey;

  const filteredEvents = useMemo(() => {
    let list = events;
    if (groupFilter !== "all") {
      list = list.filter((e) => e.group_id === groupFilter);
    }
    if (playerFilter !== "all") {
      list = list.filter((e) => (attendeeByEvent[e.id] ?? []).includes(playerFilter));
    }
    if (eventTypeFilter !== "all") {
      list = list.filter((event) => event.event_type === eventTypeFilter);
    }
    return list;
  }, [events, groupFilter, playerFilter, eventTypeFilter, attendeeByEvent]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setPending(true); setError(null); setSelectedEventId(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error(tr("Session invalide.", "Invalid session"));
        const query = new URLSearchParams({ from, to });
        const response = await fetch(`/api/manager/events/calendar?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? tr("Erreur chargement", "Loading error"));
        if (controller.signal.aborted) return;
        setEvents(json.events ?? []); setActivityStats(json.stats ?? { completed: 0, planned: 0, total: 0 });
        const groups = (json.groups ?? []) as CalendarGroupRow[];
        setGroupNames(Object.fromEntries(groups.map((group) => [group.id, group.name || tr("Groupe", "Group")])));
        setGroupHeadCoachNames(Object.fromEntries(groups.map((group) => [group.id, group.head_coach_name ?? ""])));
        setGroupFilterOptions(groups.filter((group) => !group.is_archived).map((group) => ({ id: group.id, label: [group.name || tr("Groupe", "Group"), group.head_coach_name ? `(${group.head_coach_name})` : ""].filter(Boolean).join(" ") })).sort((a, b) => a.label.localeCompare(b.label, dateLocale)));
        const coaches: Record<string, string[]> = {};
        for (const row of (json.event_coaches ?? []) as EventCoachRow[]) if (row.coach_name) coaches[row.event_id] = [...new Set([...(coaches[row.event_id] ?? []), row.coach_name])];
        setCoachNamesByEventId(coaches);
        setClubNames(Object.fromEntries(((json.clubs ?? []) as ManagedClub[]).map((club) => [club.id, club.name || "Club"])));
        const attendees: Record<string, string[]> = {};
        for (const row of (json.attendees ?? []) as Array<{ event_id: string; player_id: string }>) attendees[row.event_id] = [...new Set([...(attendees[row.event_id] ?? []), row.player_id])];
        setAttendeeByEvent(attendees);
        setPlayerNameById(Object.fromEntries(((json.players ?? []) as Array<{ id: string; name: string }>).map((player) => [player.id, player.name])));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : tr("Erreur chargement", "Loading error")); setEvents([]);
      } finally {
        if (!controller.signal.aborted) { setLoadedPeriod(`${from}|${to}`); setPending(false); }
      }
    })();
    return () => controller.abort();
  // Labels and requests both follow the visible calendar period and language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, locale, revision]);

  function eventMetaLabel(e: EventRow) {
    const eventTitle = String(e.title ?? "").trim();
    const groupName = groupNames[e.group_id] ?? tr("Groupe", "Group");
    const base = eventTitle || groupName;
    const head = String(groupHeadCoachNames[e.group_id] ?? "").trim();
    const extra = (coachNamesByEventId[e.id] ?? []).filter((name) => name !== head);
    const allCoachNames = [head, ...extra].filter(Boolean);
    return allCoachNames.length > 0 ? `${base} (${allCoachNames.join(", ")})` : base;
  }

  useEffect(() => {
    if (groupFilter === "all") return;
    if (!groupFilterOptions.some((g) => g.id === groupFilter)) {
      setGroupFilter("all");
    }
  }, [groupFilter, groupFilterOptions]);

  const daysInMonthGrid = useMemo(() => {
    const first = startOfMonth(anchorDate);
    const last = endOfMonth(anchorDate);
    const from = startOfWeek(first);
    const to = endOfWeek(last);
    const out: Date[] = [];
    for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [anchorDate]);

  const weekDays = useMemo(() => {
    const from = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchorDate]);

  const dayEvents = useMemo(
    () =>
      filteredEvents
        .filter((e) => overlapsDay(e, anchorDate))
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [anchorDate, filteredEvents]
  );

  const eventsByYmd = useMemo(() => {
    const map: Record<string, EventRow[]> = {};
    for (const e of filteredEvents) {
      const start = startOfDay(new Date(Math.max(Date.parse(e.starts_at), Date.parse(from))));
      const end = startOfDay(new Date(Math.min(Date.parse(e.ends_at ?? e.starts_at), Date.parse(to))));
      for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
        const k = ymd(d);
        if (!map[k]) map[k] = [];
        map[k].push(e);
      }
    }
    Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()));
    return map;
  }, [filteredEvents, from, to]);

  function goPrev() {
    if (view === "month") setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else if (view === "week") setAnchorDate((d) => addDays(d, -7));
    else setAnchorDate((d) => addDays(d, -1));
  }

  function goNext() {
    if (view === "month") setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else if (view === "week") setAnchorDate((d) => addDays(d, 7));
    else setAnchorDate((d) => addDays(d, 1));
  }

  function goToday() {
    setAnchorDate(new Date());
  }

  const weekRangeLabel = useMemo(() => {
    const from = startOfWeek(anchorDate);
    const to = addDays(from, 6);
    return `${dayHeaderLabel(from, dateLocale)} - ${dayHeaderLabel(to, dateLocale)}`;
  }, [anchorDate, dateLocale]);

  const headerLabel =
    view === "month" ? monthLabel(anchorDate, dateLocale) : view === "week" ? weekRangeLabel : dayHeaderLabel(anchorDate, dateLocale);
  const todayKey = ymd(new Date());
  const segmentWrapStyle: React.CSSProperties = {
    display: "inline-flex",
    border: "1px solid rgba(0,0,0,0.14)",
    borderRadius: 10,
    overflow: "hidden",
    background: "rgba(255,255,255,0.78)",
  };
  const segmentBtnStyle = (active: boolean, rightBorder = false): React.CSSProperties => ({
    border: "none",
    borderRight: rightBorder ? "1px solid rgba(0,0,0,0.12)" : "none",
    borderRadius: 0,
    background: active ? "#35483b" : "#fff",
    color: active ? "#fff" : "#35483b",
    fontWeight: 900,
    fontSize: 12,
    lineHeight: 1.1,
    padding: "7px 10px",
    cursor: "pointer",
  });
  const canDeleteEvent = (e: EventRow) => !e.series_id;

  async function deleteEvent(eventId: string) {
    if (!eventId || deletingEventId) return;
    const ok = window.confirm(tr("Supprimer cette activité ?", "Delete this activity?"));
    if (!ok) return;

    setDeletingEventId(eventId);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error(tr("Session invalide.", "Invalid session"));

      const res = await fetch(`/api/manager/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? tr("Suppression impossible.", "Could not delete activity.")));

      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setRevision((value) => value + 1);
      setSelectedEventId((prev) => (prev === eventId ? null : prev));
      setAttendeeByEvent((prev) => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("Suppression impossible.", "Could not delete activity."));
    } finally {
      setDeletingEventId(null);
    }
  }

  function renderEventDetail(event: EventRow) {
    const isCompetition = event.event_type === "competition";
    const showScheduleCard = !isCompetition || eventSpansMultipleDays(event);
    const isSpecific = groupNames[event.group_id] === "Groupe spécifique" || event.title?.trim() === "Activité spécifique";
    const title = eventTypeLabel(event.event_type, locale);
    const duration = !isCompetition && event.duration_minutes ? `${event.duration_minutes} min` : null;
    const customTitle = event.title?.trim() || "";
    return (
      <article className="manager-calendar-expanded">
        <div className="planning-event-title-row">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <h3 className="planning-event-title">
              {title}
              {customTitle ? <span className="planning-event-custom-title"> — {customTitle}</span> : null}
            </h3>
            <span className="pill-soft">{event.series_id ? tr("Récurrent", "Recurring") : tr("Unique", "Single")}</span>
            {isSpecific ? <span className="pill-soft planning-event-type">{tr("Activité spécifique", "Specific activity")}</span> : null}
          </div>
          {duration ? <span className="pill-soft">{duration}</span> : null}
        </div>

        <div className="manager-calendar-detail-grid">
          <div><span>{tr("Groupe", "Group")}</span><b>{groupNames[event.group_id] ?? tr("Groupe spécifique", "Specific group")}</b></div>
          {!isCompetition ? <div><span>{tr("Club", "Club")}</span><b>{clubNames[event.club_id] ?? tr("Club", "Club")}</b></div> : null}
          {showScheduleCard ? <div><span>{isCompetition ? tr("Période", "Period") : tr("Horaire", "Schedule")}</span><b>{isCompetition ? eventPeriodLabel(event, dateLocale) : `${timeLabel(event.starts_at, dateLocale)}${event.ends_at ? ` — ${timeLabel(event.ends_at, dateLocale)}` : ""}`}</b></div> : null}
          {isCompetition ? <div><span>{tr("Niveau", "Level")}</span><b>{competitionLevelLabel(event.competition_level, locale)}</b></div> : null}
          {isCompetition ? <div><span>{tr("Catégorie", "Category")}</span><b>{competitionCategoryLabel(event.competition_category, locale)}</b></div> : null}
        </div>

        {(isCompetition ? event.competition_note : event.coach_note) ? <p className="manager-calendar-detail-note">{isCompetition ? event.competition_note : event.coach_note}</p> : null}

        {isCompetition && event.external_registration_url ? (
          <a className={actionStyles.primaryButton} href={event.external_registration_url} target="_blank" rel="noreferrer noopener" style={{ justifySelf: "start" }}>
            {tr("S’inscrire sur la plateforme externe", "Register on the external platform")}
          </a>
        ) : null}

        <div className="planning-event-footer">
          <span className="planning-event-location"><MapPin size={16} aria-hidden="true" /><span>{event.location_text?.trim() || tr("Lieu non disponible", "Location unavailable")}</span></span>
          <div className="user-mgmt-card-actions">
            {!isCompetition ? <Link className={actionStyles.secondaryButton} href={`/manager/groups/${event.group_id}/planning/${event.id}`}>{tr("Ouvrir", "Open")}</Link> : null}
            <Link className={actionStyles.secondaryButton} href={isCompetition ? `/manager/events/new?event=${event.id}` : `/manager/groups/${event.group_id}/planning/${event.id}/edit`}><Pencil size={16} aria-hidden="true" />{tr("Éditer", "Edit")}</Link>
            {canDeleteEvent(event) ? <button type="button" className={actionStyles.dangerButton} onClick={() => void deleteEvent(event.id)} disabled={deletingEventId === event.id}><Trash2 size={16} aria-hidden="true" />{deletingEventId === event.id ? tr("Suppression…", "Deleting...") : tr("Supprimer", "Delete")}</button> : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className={styles.page}>
      <nav aria-label={tr("Fil d’Ariane", "Breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        {tr("Gestion des activités / Activités", "Activity management / Activities")}
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{tr("Activités", "Activities")}</h1>
          <p className={styles.lead}>{tr("Consultez et gérez les activités de vos groupes.", "View and manage your group activities.")}</p>
        </div>
        <Link className={actionStyles.primaryButton} href="/manager/events/new">
          <CalendarDays size={16} aria-hidden="true" />
          {tr("Ajouter une activité", "Add activity")}
        </Link>
      </div>

      {error && <div className={actionStyles.errorAlert} role="alert">{error}</div>}

      <section className={styles.overview} aria-label={tr("Indicateurs des activités", "Activity statistics")}>
        <div className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>{tr("Activités réalisées jusqu’à aujourd’hui", "Activities completed to date")}</span>
            <b>{activityStats.completed}</b>
            <small>{tr("depuis le début de l’historique du club", "across the club history")}</small>
          </article>
          <article className={styles.statCard}>
            <span>{tr("Activités planifiées", "Planned activities")}</span>
            <b>{activityStats.planned}</b>
            <small>{tr("à venir", "upcoming")}</small>
          </article>
          <article className={styles.statCard}>
            <span>{tr("Activités totales", "Total activities")}</span>
            <b>{activityStats.total}</b>
            <small>{tr("réalisées et planifiées", "completed and planned")}</small>
          </article>
        </div>
      </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{tr("Filtrer les activités", "Filter activities")}</h2>
              <p>{tr("Affinez la liste par vue, type d’activité, groupe ou junior.", "Refine the list by view, activity type, group or junior.")}</p>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={segmentWrapStyle}>
                <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")} style={segmentBtnStyle(view === "month", true)}>{tr("Mois", "Month")}</button>
                <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")} style={segmentBtnStyle(view === "week", true)}>{tr("Semaine", "Week")}</button>
                <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")} style={segmentBtnStyle(view === "day")}>{tr("Jour", "Day")}</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>{tr("Type d’activité", "Activity type")}</span>
                <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} className="input">
                  <option value="all">{tr("Tous les types", "All types")}</option>
                  <option value="training">{tr("Entraînement", "Training")}</option>
                  <option value="interclub">Interclub</option>
                  <option value="competition">{tr("Compétition", "Competition")}</option>
                  <option value="camp">{tr("Stage", "Camp")}</option>
                  <option value="session">{tr("Séance", "Session")}</option>
                  <option value="event">{tr("Événement", "Event")}</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>{tr("Groupe", "Group")}</span>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="input"
                >
                  <option value="all">{tr("Tous les groupes", "All groups")}</option>
                  {groupFilterOptions.map((g) => (
                      <option key={g.id} value={g.id}>{g.label}</option>
                    ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>{tr("Junior", "Junior")}</span>
                <select
                  value={playerFilter}
                  onChange={(e) => setPlayerFilter(e.target.value)}
                  className="input"
                >
                  <option value="all">{tr("Tous les joueurs", "All players")}</option>
                  {Object.entries(playerNameById)
                    .sort((a, b) => a[1].localeCompare(b[1], dateLocale))
                    .map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <button className="btn" onClick={goPrev} aria-label={tr("Précédent", "Previous")}>
                  <ChevronLeft size={16} />
                </button>
                <button className="btn" onClick={goToday}>{tr("Aujourd’hui", "Today")}</button>
                <button className="btn" onClick={goNext} aria-label={tr("Suivant", "Next")}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#35483b" }}>{headerLabel}</div>
            </div>
          </div>
        </section>

          {loading ? (
            <section className={styles.quickPanel}><ListLoadingBlock label={tr("Chargement...", "Loading...")} /></section>
          ) : (
            <>
              {view === "month" ? (
                <section className={styles.quickPanel} style={{ padding: 10 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {daysInMonthGrid
                      .filter((d) => d.getMonth() === anchorDate.getMonth())
                      .map((d) => {
                        const k = ymd(d);
                        const isToday = k === todayKey;
                        const list = eventsByYmd[k] ?? [];
                        return (
                          <div
                            key={k}
                            className="manager-calendar-date-card"
                            style={{
                              border: isToday ? "2px solid rgba(34,197,94,0.75)" : "1px solid rgba(0,0,0,0.10)",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.76)",
                              padding: 10,
                              display: "grid",
                              gridTemplateColumns: "110px minmax(0, 1fr)",
                              columnGap: 14,
                              alignItems: "stretch",
                              boxShadow: isToday ? "0 0 0 2px rgba(34,197,94,0.16) inset" : undefined,
                            }}
                          >
                            {(() => { const date = dateCardParts(d, dateLocale); return <div className="planning-event-date manager-calendar-date-column" style={{ minHeight: 110 }}><div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.number}</div><div className="planning-event-month">{date.month}</div></div>; })()}
                            <div style={{ display: "grid", alignContent: "center", gap: 6, minWidth: 0, padding: 10 }}>
                            {list.length > 0
                              ? list.map((e) => {
                                  const tone = eventTypeColor(e.event_type);
                                  const isSelected = selectedEventId === e.id;
                                  return (
                                    <div key={e.id} style={{ display: "grid", gap: 6 }}>
                                      <button
                                        type="button"
                                        className="manager-calendar-activity"
                                        aria-expanded={isSelected}
                                        onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                                        style={{
                                          textAlign: "left",
                                          border: `1px solid ${tone.border}`,
                                          borderRadius: 8,
                                          background: tone.bg,
                                          color: tone.text,
                                          fontSize: 11,
                                          fontWeight: 900,
                                          padding: "5px 7px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        {eventTimeOrPeriodLabel(e, dateLocale)} · {eventTypeLabel(e.event_type, locale)} · {eventMetaLabel(e)}
                                      </button>
                                      {isSelected ? renderEventDetail(e) : null}
                                    </div>
                                  );
                                })
                              : <span style={{ color: "#778178", fontSize: 12, fontWeight: 700 }}>{tr("Aucune activité", "No activity")}</span>}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              ) : null}

              {view === "week" ? (
                <section className={styles.quickPanel} style={{ padding: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                    {weekDays.map((d) => {
                      const k = ymd(d);
                      const isToday = k === todayKey;
                      const list = eventsByYmd[k] ?? [];
                      return (
                        <div
                          key={k}
                          className="manager-calendar-date-card"
                          style={{
                            border: isToday ? "2px solid rgba(34,197,94,0.75)" : "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.76)",
                            padding: 8,
                            minHeight: 170,
                            display: "grid",
                            gridTemplateColumns: "110px minmax(0, 1fr)",
                            columnGap: 14,
                            alignItems: "stretch",
                            boxShadow: isToday ? "0 0 0 2px rgba(34,197,94,0.16) inset" : undefined,
                          }}
                        >
                          {(() => { const date = dateCardParts(d, dateLocale); return <div className="planning-event-date manager-calendar-date-column" style={{ minHeight: 150 }}><div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.number}</div><div className="planning-event-month">{date.month}</div></div>; })()}
                          <div style={{ display: "grid", alignContent: "center", gap: 6, minWidth: 0, padding: 10 }}>
                          {list.length > 0 ? list.map((e) => {
                            const tone = eventTypeColor(e.event_type);
                            const isSelected = selectedEventId === e.id;
                            return (
                              <div key={e.id} style={{ display: "grid", gap: 6 }}>
                                <button
                                  type="button"
                                  className="manager-calendar-activity"
                                  aria-expanded={isSelected}
                                  onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                                  style={{
                                    textAlign: "left",
                                    border: `1px solid ${tone.border}`,
                                    borderRadius: 8,
                                    background: tone.bg,
                                    color: tone.text,
                                    fontSize: 11,
                                    fontWeight: 900,
                                    padding: "4px 6px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {eventTimeOrPeriodLabel(e, dateLocale)} · {eventTypeLabel(e.event_type, locale)} · {eventMetaLabel(e)}
                                </button>
                                {isSelected ? renderEventDetail(e) : null}
                              </div>
                            );
                          }) : <span style={{ color: "#778178", fontSize: 12, fontWeight: 700 }}>{tr("Aucune activité", "No activity")}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {view === "day" ? (
                <section className={styles.quickPanel} style={{ padding: 12, display: "grid", gap: 10 }}>
                  {dayEvents.length === 0 ? (
                    <div className="manager-calendar-date-card" style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", columnGap: 14, alignItems: "stretch", border: "1px solid #e4ebe4", borderRadius: 12, padding: 10, background: "#fff" }}>
                      {(() => { const date = dateCardParts(anchorDate, dateLocale); return <div className="planning-event-date manager-calendar-date-column" style={{ minHeight: 120 }}><div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.number}</div><div className="planning-event-month">{date.month}</div></div>; })()}
                      <div style={{ display: "grid", alignContent: "center", padding: 10, fontSize: 12, fontWeight: 800, color: "#778178" }}>{tr("Aucune activité ce jour.", "No activity this day.")}</div>
                    </div>
                  ) : (
                    dayEvents.map((e) => {
                      const tone = eventTypeColor(e.event_type);
                      const isSelected = selectedEventId === e.id;
                      return (
                        <div key={e.id} className="manager-calendar-date-card" style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", columnGap: 14, alignItems: "stretch", border: "1px solid #e4ebe4", borderRadius: 12, padding: 10, background: "#fff" }}>
                          {(() => { const date = dateCardParts(anchorDate, dateLocale); return <div className="planning-event-date manager-calendar-date-column" style={{ minHeight: 120 }}><div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.number}</div><div className="planning-event-month">{date.month}</div></div>; })()}
                          <div style={{ display: "grid", alignContent: "center", gap: 6, minWidth: 0 }}>
                          <button
                            type="button"
                            className="manager-calendar-activity"
                            aria-expanded={isSelected}
                            onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                            style={{
                              textAlign: "left",
                              border: `1px solid ${tone.border}`,
                              borderRadius: 12,
                              background: tone.bg,
                              color: tone.text,
                              padding: 10,
                              display: "grid",
                              gap: 4,
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 950 }}>{eventTimeOrPeriodLabel(e, dateLocale)} · {eventTypeLabel(e.event_type, locale)}</div>
                            <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.85 }}>{eventMetaLabel(e)}</div>
                          </button>
                          {isSelected ? renderEventDetail(e) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>
              ) : null}
            </>
          )}
    </main>
  );
}
