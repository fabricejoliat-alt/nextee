"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Eye, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import activityStyles from "./CoachCalendarActivities.module.css";

type CalendarView = "month" | "week" | "day";
type EventFilter = "all" | "evaluations";
type EventRow = {
  id: string; group_id: string; camp_id: string | null; club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null; camp_day_index: number | null; starts_at: string; ends_at: string | null;
  duration_minutes: number | null; location_text: string | null; coach_note: string | null;
  series_id: string | null; status: string;
};

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date: Date, amount: number) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function startOfWeek(date: Date) { const day = startOfDay(date); return addDays(day, -((day.getDay() + 6) % 7)); }
function ymd(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function capitalise(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function monthLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)); }
function dayLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)); }
function eventTypeLabel(value: EventRow["event_type"], locale: "fr" | "en" | "de" | "it") {
  if (value === "training") return pickLocaleText(locale, "Entraînement", "Training");
  if (value === "interclub") return "Interclub";
  if (value === "camp") return pickLocaleText(locale, "Stage", "Camp");
  if (value === "session") return pickLocaleText(locale, "Séance", "Session");
  return pickLocaleText(locale, "Activité", "Activity");
}

export default function CoachCalendarPage() {
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [pendingEvaluationIds, setPendingEvaluationIds] = useState<Set<string>>(new Set());
  const [canPlan, setCanPlan] = useState(false);
  const [view, setView] = useState<CalendarView>("month");
  const [eventFilter, setEventFilter] = useState<EventFilter>(searchParams.get("view") === "evaluations" ? "evaluations" : "all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [referenceNow] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      setLoading(true); setError(null);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token ?? "";
        const userId = session.data.session?.user.id ?? "";
        if (!token || !userId) throw new Error(pickLocaleText(locale, "Session invalide.", "Invalid session."));
        const [calendarResponse, homeResponse, permissions] = await Promise.all([
          fetch("/api/coach/events/calendar", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
          fetch("/api/coach/home", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
          supabase.from("club_members").select("can_manage_assigned_group_planning").eq("user_id", userId).eq("role", "coach").eq("is_active", true),
        ]);
        const calendar = await calendarResponse.json().catch(() => ({}));
        const home = await homeResponse.json().catch(() => ({}));
        if (!calendarResponse.ok) throw new Error(String(calendar?.error ?? pickLocaleText(locale, "Chargement impossible.", "Unable to load.")));
        if (!homeResponse.ok) throw new Error(String(home?.error ?? pickLocaleText(locale, "Chargement impossible.", "Unable to load.")));
        setEvents((calendar?.events ?? []) as EventRow[]);
        setGroupNames((calendar?.groupNameById ?? {}) as Record<string, string>);
        setClubNames((calendar?.clubNameById ?? {}) as Record<string, string>);
        setPendingEvaluationIds(new Set<string>(((home?.pendingEvalEvents ?? []) as Array<{ id?: string }>).map((item) => String(item.id ?? "")).filter(Boolean)));
        setCanPlan(!permissions.error && (permissions.data ?? []).some((row) => Boolean(row.can_manage_assigned_group_planning)));
      } catch (cause) { setError(cause instanceof Error ? cause.message : pickLocaleText(locale, "Chargement impossible.", "Unable to load.")); }
      finally { setLoading(false); }
    })();
  }, [locale]);

  const visibleEvents = useMemo(() => events.filter((event) => event.status === "scheduled" && (eventFilter !== "evaluations" || pendingEvaluationIds.has(event.id)) && (typeFilter === "all" || event.event_type === typeFilter) && (groupFilter === "all" || event.group_id === groupFilter)), [eventFilter, events, groupFilter, pendingEvaluationIds, typeFilter]);
  const groups = useMemo(() => Object.entries(groupNames)
    .filter(([, name]) => !name.trim().startsWith("__") && !name.toLocaleLowerCase(dateLocale).includes("archive"))
    .sort((a, b) => a[1].localeCompare(b[1], dateLocale)), [dateLocale, groupNames]);
  const stats = useMemo(() => { const now = new Date(); const scheduled = events.filter((event) => event.status === "scheduled"); return { completed: scheduled.filter((event) => new Date(event.ends_at ?? event.starts_at) < now).length, planned: scheduled.filter((event) => new Date(event.ends_at ?? event.starts_at) >= now).length, total: scheduled.length }; }, [events]);
  const monthDays = useMemo(() => Array.from({ length: new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate() }, (_, index) => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), index + 1)), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index)), [anchorDate]);
  const headerLabel = view === "month" ? monthLabel(anchorDate, dateLocale) : view === "week" ? `${dayLabel(weekDays[0], dateLocale)} – ${dayLabel(weekDays[6], dateLocale)}` : dayLabel(anchorDate, dateLocale);
  const displayedDays = view === "month" ? monthDays : view === "week" ? weekDays : [anchorDate];
  const firstGroupId = groups[0]?.[0] ?? "";
  function movePeriod(direction: -1 | 1) { if (view === "month") setAnchorDate((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1)); else if (view === "week") setAnchorDate((date) => addDays(date, direction * 7)); else setAnchorDate((date) => addDays(date, direction)); }

  return <main className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{tr("Coach / Activités", "Coach / Activities")}</nav>
    <div className={styles.topline}><div><h1>{tr("Activités", "Activities")}</h1><p className={styles.lead}>{tr("Consultez et gérez les activités de vos groupes.", "View and manage your group activities.")}</p></div>{canPlan && firstGroupId ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${firstGroupId}/planning/add`}><CalendarDays size={16} aria-hidden="true" />{tr("Ajouter une activité", "Add activity")}</Link> : null}</div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    <section className={styles.overview} aria-label={tr("Indicateurs des activités", "Activity statistics")}><div className={styles.statsGrid}><article className={styles.statCard}><span>{tr("Activités réalisées jusqu’à aujourd’hui", "Activities completed to date")}</span><b>{stats.completed}</b><small>{tr("dans votre périmètre", "in your scope")}</small></article><article className={styles.statCard}><span>{tr("Activités planifiées", "Planned activities")}</span><b>{stats.planned}</b><small>{tr("à venir", "upcoming")}</small></article><article className={styles.statCard}><span>{tr("Activités totales", "Total activities")}</span><b>{stats.total}</b><small>{tr("réalisées et planifiées", "completed and planned")}</small></article></div></section>
    <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{tr("Filtrer les activités", "Filter activities")}</h2><p>{tr("Affinez la liste par vue, type d’activité ou groupe.", "Refine the list by view, activity type or group.")}</p></div></div><div style={{ display: "grid", gap: 12 }}>
      <div style={segmentWrapStyle}><button type="button" onClick={() => setView("month")} style={segmentButtonStyle(view === "month", true)}>{tr("Mois", "Month")}</button><button type="button" onClick={() => setView("week")} style={segmentButtonStyle(view === "week", true)}>{tr("Semaine", "Week")}</button><button type="button" onClick={() => setView("day")} style={segmentButtonStyle(view === "day")}>{tr("Jour", "Day")}</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}><FilterSelect label={tr("Affichage", "Display")} value={eventFilter} onChange={(value) => setEventFilter(value as EventFilter)} options={[["all", tr("Toutes les activités", "All activities")], ["evaluations", tr("Activités à évaluer", "Activities to evaluate")]]} /><FilterSelect label={tr("Type d’activité", "Activity type")} value={typeFilter} onChange={setTypeFilter} options={[["all", tr("Tous les types", "All types")], ["training", tr("Entraînement", "Training")], ["interclub", "Interclub"], ["camp", tr("Stage", "Camp")], ["session", tr("Séance", "Session")], ["event", tr("Événement", "Event")]]} /><FilterSelect label={tr("Groupe", "Group")} value={groupFilter} onChange={setGroupFilter} options={[["all", tr("Tous les groupes", "All groups")], ...groups]} /></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(-1)} aria-label={tr("Période précédente", "Previous period")} title={tr("Période précédente", "Previous period")}><ChevronLeft size={16} aria-hidden="true" /></button><button className={actionStyles.secondaryButton} type="button" onClick={() => setAnchorDate(new Date())}>{tr("Aujourd’hui", "Today")}</button><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(1)} aria-label={tr("Période suivante", "Next period")} title={tr("Période suivante", "Next period")}><ChevronRight size={16} aria-hidden="true" /></button></div><strong style={{ color: "#35483b", fontSize: 16 }}>{headerLabel}</strong></div>
    </div></section>
    {loading ? <section className={styles.quickPanel}><ListLoadingBlock label={tr("Chargement des activités…", "Loading activities…")} /></section> : <section className={`${styles.quickPanel} ${activityStyles.panel}`}><div className={activityStyles.list}>{visibleEvents.filter((event) => displayedDays.some((date) => ymd(date) === ymd(new Date(event.starts_at)))).map((event) => {
      const startsAt = new Date(event.starts_at);
      const needsEvaluation = pendingEvaluationIds.has(event.id);
      const isPast = new Date(event.ends_at ?? event.starts_at).getTime() < referenceNow;
      const href = `/coach/groups/${event.group_id}/planning/${event.id}`;
      const customTitle = String(event.title ?? "").trim();
      const typeLabel = eventTypeLabel(event.event_type, locale);
      const groupName = groupNames[event.group_id] ?? tr("Groupe spécifique", "Specific group");
      const activityTitle = `${typeLabel}${event.event_type === "training" ? ` • ${groupName}` : ""}${customTitle ? ` · ${customTitle}` : ""}`;
      const dateDay = new Intl.DateTimeFormat(dateLocale, { weekday: "short" }).format(startsAt).replace(".", "");
      const dateMonth = new Intl.DateTimeFormat(dateLocale, { month: "short" }).format(startsAt).replace(".", "");
      const activityTime = new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(startsAt);
      return <article className={`${dashboardStyles.activityItem} ${activityStyles.activity}`} key={event.id}>
        <div className={dashboardStyles.activityDate} aria-label={new Intl.DateTimeFormat(dateLocale, { dateStyle: "full", timeStyle: "short" }).format(startsAt)}>
          <span>{dateDay}</span><b>{startsAt.getDate()}</b><span>{dateMonth}</span><time dateTime={event.starts_at}>{activityTime}</time>
        </div>
        <div className={dashboardStyles.activityBody}>
          <Link className={dashboardStyles.activityTitle} href={href}>{activityTitle}</Link>
          <span className={dashboardStyles.activityMeta}>{groupName} · {clubNames[event.club_id] ?? tr("Club non renseigné", "Club not provided")}</span>
          <span className={`planning-event-location ${dashboardStyles.activityLocation}`}><MapPin size={14} aria-hidden="true" /><span>{event.location_text || tr("Lieu à confirmer", "Location to be confirmed")}</span></span>
        </div>
        <div className={activityStyles.actions}>
          {needsEvaluation && isPast ? <Link className={`${activityStyles.iconAction} ${activityStyles.evaluationAction}`} href={`${href}#expected-players`} aria-label={tr(`Évaluer ${customTitle || typeLabel}`, `Evaluate ${customTitle || typeLabel}`)} title={tr("À évaluer", "To evaluate")}><ClipboardCheck size={17} aria-hidden="true" /></Link> : null}
          <Link className={activityStyles.iconAction} href={href} aria-label={tr(`Ouvrir ${customTitle || typeLabel}`, `Open ${customTitle || typeLabel}`)} title={tr("Ouvrir l’activité", "Open activity")}><Eye size={15} aria-hidden="true" /></Link>
        </div>
      </article>;
    })}{!visibleEvents.some((event) => displayedDays.some((date) => ymd(date) === ymd(new Date(event.starts_at)))) ? <div className="marketplace-empty">{tr("Aucune activité sur cette période.", "No activity in this period.")}</div> : null}</div></section>}
  </main>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label style={fieldStyle}><span style={fieldLabelStyle}>{label}</span><select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
const fieldStyle: React.CSSProperties = { display: "grid", gap: 4 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#53675a" };
const segmentWrapStyle: React.CSSProperties = { display: "inline-flex", width: "fit-content", border: "1px solid #dce5db", borderRadius: 10, overflow: "hidden", background: "#fff" };
function segmentButtonStyle(active: boolean, withBorder = false): React.CSSProperties { return { minHeight: 38, padding: "0 14px", border: 0, borderRight: withBorder ? "1px solid #dce5db" : 0, background: active ? "#35483b" : "#fff", color: active ? "#fff" : "#35483b", fontSize: 12, fontWeight: 750, cursor: "pointer" }; }
