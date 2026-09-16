"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

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
function timeLabel(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function capitalise(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function dateCardParts(date: Date, locale: string) { return { day: capitalise(new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date)), number: date.getDate(), month: capitalise(new Intl.DateTimeFormat(locale, { month: "long" }).format(date)) }; }
function monthLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)); }
function dayLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)); }
function eventTypeLabel(value: EventRow["event_type"], locale: "fr" | "en" | "de" | "it") {
  if (value === "training") return pickLocaleText(locale, "Entraînement", "Training");
  if (value === "interclub") return "Interclub";
  if (value === "camp") return pickLocaleText(locale, "Stage", "Camp");
  if (value === "session") return pickLocaleText(locale, "Séance", "Session");
  return pickLocaleText(locale, "Activité", "Activity");
}
function eventTone(value: EventRow["event_type"]) {
  if (value === "training") return { bg: "rgba(34,197,94,.16)", border: "rgba(34,197,94,.48)", text: "#14532d" };
  if (value === "interclub") return { bg: "rgba(59,130,246,.16)", border: "rgba(59,130,246,.46)", text: "#1e40af" };
  if (value === "camp") return { bg: "rgba(245,158,11,.16)", border: "rgba(245,158,11,.5)", text: "#78350f" };
  if (value === "session") return { bg: "rgba(168,85,247,.16)", border: "rgba(168,85,247,.46)", text: "#581c87" };
  return { bg: "rgba(15,23,42,.08)", border: "rgba(15,23,42,.2)", text: "#1f2937" };
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
  const [pendingEvaluationIds, setPendingEvaluationIds] = useState<Set<string>>(new Set());
  const [canPlan, setCanPlan] = useState(false);
  const [view, setView] = useState<CalendarView>("month");
  const [eventFilter, setEventFilter] = useState<EventFilter>(searchParams.get("view") === "evaluations" ? "evaluations" : "all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [referenceNow] = useState(() => Date.now());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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
        setPendingEvaluationIds(new Set<string>(((home?.pendingEvalEvents ?? []) as Array<{ id?: string }>).map((item) => String(item.id ?? "")).filter(Boolean)));
        setCanPlan(!permissions.error && (permissions.data ?? []).some((row) => Boolean(row.can_manage_assigned_group_planning)));
      } catch (cause) { setError(cause instanceof Error ? cause.message : pickLocaleText(locale, "Chargement impossible.", "Unable to load.")); }
      finally { setLoading(false); }
    })();
  }, [locale]);

  const visibleEvents = useMemo(() => events.filter((event) => event.status === "scheduled" && (eventFilter !== "evaluations" || pendingEvaluationIds.has(event.id)) && (typeFilter === "all" || event.event_type === typeFilter) && (groupFilter === "all" || event.group_id === groupFilter)), [eventFilter, events, groupFilter, pendingEvaluationIds, typeFilter]);
  const eventsByDay = useMemo(() => visibleEvents.reduce<Record<string, EventRow[]>>((result, event) => { const key = ymd(new Date(event.starts_at)); (result[key] ??= []).push(event); return result; }, {}), [visibleEvents]);
  const groups = useMemo(() => Object.entries(groupNames)
    .filter(([, name]) => !name.trim().startsWith("__") && !name.toLocaleLowerCase(dateLocale).includes("archive"))
    .sort((a, b) => a[1].localeCompare(b[1], dateLocale)), [dateLocale, groupNames]);
  const stats = useMemo(() => { const now = new Date(); const scheduled = events.filter((event) => event.status === "scheduled"); return { completed: scheduled.filter((event) => new Date(event.ends_at ?? event.starts_at) < now).length, planned: scheduled.filter((event) => new Date(event.ends_at ?? event.starts_at) >= now).length, total: scheduled.length }; }, [events]);
  const monthDays = useMemo(() => Array.from({ length: new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate() }, (_, index) => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), index + 1)), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index)), [anchorDate]);
  const headerLabel = view === "month" ? monthLabel(anchorDate, dateLocale) : view === "week" ? `${dayLabel(weekDays[0], dateLocale)} – ${dayLabel(weekDays[6], dateLocale)}` : dayLabel(anchorDate, dateLocale);
  const displayedDays = view === "month" ? monthDays : view === "week" ? weekDays : [anchorDate];
  const firstGroupId = groups[0]?.[0] ?? "";
  function movePeriod(direction: -1 | 1) { setSelectedEventId(null); if (view === "month") setAnchorDate((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1)); else if (view === "week") setAnchorDate((date) => addDays(date, direction * 7)); else setAnchorDate((date) => addDays(date, direction)); }

  return <main className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{tr("Coach / Activités", "Coach / Activities")}</nav>
    <div className={styles.topline}><div><h1>{tr("Activités", "Activities")}</h1><p className={styles.lead}>{tr("Consultez et gérez les activités de vos groupes.", "View and manage your group activities.")}</p></div>{canPlan && firstGroupId ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${firstGroupId}/planning/add`}><CalendarDays size={16} aria-hidden="true" />{tr("Ajouter une activité", "Add activity")}</Link> : null}</div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    <section className={styles.overview} aria-label={tr("Indicateurs des activités", "Activity statistics")}><div className={styles.statsGrid}><article className={styles.statCard}><span>{tr("Activités réalisées jusqu’à aujourd’hui", "Activities completed to date")}</span><b>{stats.completed}</b><small>{tr("dans votre périmètre", "in your scope")}</small></article><article className={styles.statCard}><span>{tr("Activités planifiées", "Planned activities")}</span><b>{stats.planned}</b><small>{tr("à venir", "upcoming")}</small></article><article className={styles.statCard}><span>{tr("Activités totales", "Total activities")}</span><b>{stats.total}</b><small>{tr("réalisées et planifiées", "completed and planned")}</small></article></div></section>
    <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{tr("Filtrer les activités", "Filter activities")}</h2><p>{tr("Affinez la liste par vue, type d’activité ou groupe.", "Refine the list by view, activity type or group.")}</p></div></div><div style={{ display: "grid", gap: 12 }}>
      <div style={segmentWrapStyle}><button type="button" onClick={() => setView("month")} style={segmentButtonStyle(view === "month", true)}>{tr("Mois", "Month")}</button><button type="button" onClick={() => setView("week")} style={segmentButtonStyle(view === "week", true)}>{tr("Semaine", "Week")}</button><button type="button" onClick={() => setView("day")} style={segmentButtonStyle(view === "day")}>{tr("Jour", "Day")}</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}><FilterSelect label={tr("Affichage", "Display")} value={eventFilter} onChange={(value) => setEventFilter(value as EventFilter)} options={[["all", tr("Toutes les activités", "All activities")], ["evaluations", tr("Évaluations à faire", "Evaluations to complete")]]} /><FilterSelect label={tr("Type d’activité", "Activity type")} value={typeFilter} onChange={setTypeFilter} options={[["all", tr("Tous les types", "All types")], ["training", tr("Entraînement", "Training")], ["interclub", "Interclub"], ["camp", tr("Stage", "Camp")], ["session", tr("Séance", "Session")], ["event", tr("Événement", "Event")]]} /><FilterSelect label={tr("Groupe", "Group")} value={groupFilter} onChange={setGroupFilter} options={[["all", tr("Tous les groupes", "All groups")], ...groups]} /></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(-1)} aria-label={tr("Période précédente", "Previous period")} title={tr("Période précédente", "Previous period")}><ChevronLeft size={16} aria-hidden="true" /></button><button className={actionStyles.secondaryButton} type="button" onClick={() => setAnchorDate(new Date())}>{tr("Aujourd’hui", "Today")}</button><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(1)} aria-label={tr("Période suivante", "Next period")} title={tr("Période suivante", "Next period")}><ChevronRight size={16} aria-hidden="true" /></button></div><strong style={{ color: "#35483b", fontSize: 16 }}>{headerLabel}</strong></div>
    </div></section>
    {loading ? <section className={styles.quickPanel}><ListLoadingBlock label={tr("Chargement des activités…", "Loading activities…")} /></section> : <section className={styles.quickPanel} style={{ padding: 10 }}><div style={{ display: "grid", gap: 8 }}>{displayedDays.map((date) => <CalendarDay key={ymd(date)} date={date} events={eventsByDay[ymd(date)] ?? []} groupNames={groupNames} locale={locale} dateLocale={dateLocale} isToday={ymd(date) === ymd(new Date(referenceNow))} tall={view === "week"} pendingEvaluationIds={pendingEvaluationIds} selectedEventId={selectedEventId} onSelect={setSelectedEventId} referenceNow={referenceNow} />)}</div></section>}
  </main>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label style={fieldStyle}><span style={fieldLabelStyle}>{label}</span><select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
function CalendarDay({ date, events, groupNames, locale, dateLocale, isToday, tall, pendingEvaluationIds, selectedEventId, onSelect, referenceNow }: { date: Date; events: EventRow[]; groupNames: Record<string, string>; locale: "fr" | "en" | "de" | "it"; dateLocale: string; isToday: boolean; tall: boolean; pendingEvaluationIds: Set<string>; selectedEventId: string | null; onSelect: (value: string | null) => void; referenceNow: number }) {
  const parts = dateCardParts(date, dateLocale);
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  return (
    <article className="manager-calendar-date-card" style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", columnGap: 14, alignItems: "stretch", padding: 10, border: isToday ? "2px solid rgba(34,197,94,.75)" : "1px solid #e4ebe4", borderRadius: 12, background: "#fff" }}>
      <div className="planning-event-date manager-calendar-date-column" style={{ minHeight: tall ? 150 : 110 }}>
        <div className="planning-event-day">{parts.day}</div><div className="planning-event-number">{parts.number}</div><div className="planning-event-month">{parts.month}</div>
      </div>
      <div style={{ display: "grid", alignContent: "center", gap: 7, minWidth: 0, padding: 10 }}>
        {events.length === 0 ? <span style={{ color: "#778178", fontSize: 12, fontWeight: 700 }}>{tr("Aucune activité", "No activity")}</span> : events.map((event) => {
          const needsEvaluation = pendingEvaluationIds.has(event.id);
          const showWarning = needsEvaluation && new Date(event.ends_at ?? event.starts_at).getTime() < referenceNow;
          const tone = eventTone(event.event_type);
          const open = selectedEventId === event.id;
          const groupName = groupNames[event.group_id] ?? tr("Groupe spécifique", "Specific group");
          const customTitle = String(event.title ?? "").trim();
          const title = eventTypeLabel(event.event_type, locale);
          const duration = event.duration_minutes ? `${event.duration_minutes} min` : null;
          return (
            <div key={event.id} style={{ display: "grid", gap: 6 }}>
              <button
                type="button"
                className={`manager-calendar-activity${showWarning ? " manager-calendar-activity-warning" : ""}`}
                onClick={() => onSelect(open ? null : event.id)}
                aria-expanded={open}
                style={{ display: "flex", alignItems: "center", gap: 6, textAlign: "left", border: `1px solid ${tone.border}`, background: tone.bg, color: tone.text, fontSize: 11, fontWeight: 900, padding: "6px 8px", cursor: "pointer" }}
              >
                {showWarning ? <AlertTriangle size={14} aria-hidden="true" style={{ flex: "0 0 auto" }} /> : null}
                <span>{timeLabel(event.starts_at, dateLocale)} · {title} · {customTitle || groupName}{needsEvaluation ? ` · ${tr("À évaluer", "To evaluate")}` : ""}</span>
              </button>
              {open ? (
                <article className="manager-calendar-expanded">
                  <div className="planning-event-title-row">
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                      <h3 className="planning-event-title">{title}{customTitle ? <span className="planning-event-custom-title"> — {customTitle}</span> : null}</h3>
                      <span className="pill-soft">{event.series_id ? tr("Récurrent", "Recurring") : tr("Unique", "Single")}</span>
                      {showWarning ? <span className="pill-soft manager-calendar-warning-pill"><AlertTriangle size={13} aria-hidden="true" />{tr("À évaluer", "To evaluate")}</span> : null}
                    </div>
                    {duration ? <span className="pill-soft">{duration}</span> : null}
                  </div>
                  <div className="manager-calendar-detail-grid">
                    <div><span>{tr("Groupe", "Group")}</span><b>{groupName}</b></div>
                    <div><span>{tr("Type", "Type")}</span><b>{title}</b></div>
                    <div><span>{tr("Horaire", "Schedule")}</span><b>{timeLabel(event.starts_at, dateLocale)}{event.ends_at ? ` — ${timeLabel(event.ends_at, dateLocale)}` : ""}</b></div>
                  </div>
                  {event.coach_note?.trim() ? <p className="manager-calendar-detail-note">{event.coach_note}</p> : null}
                  <div className="planning-event-footer">
                    <span className="planning-event-location"><MapPin size={16} aria-hidden="true" /><span>{event.location_text?.trim() || tr("Lieu non disponible", "Location unavailable")}</span></span>
                    <div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={`/coach/groups/${event.group_id}/planning/${event.id}`}>{tr("Ouvrir", "Open")}</Link></div>
                  </div>
                </article>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

const fieldStyle: React.CSSProperties = { display: "grid", gap: 4 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#53675a" };
const segmentWrapStyle: React.CSSProperties = { display: "inline-flex", width: "fit-content", border: "1px solid #dce5db", borderRadius: 10, overflow: "hidden", background: "#fff" };
function segmentButtonStyle(active: boolean, withBorder = false): React.CSSProperties { return { minHeight: 38, padding: "0 14px", border: 0, borderRight: withBorder ? "1px solid #dce5db" : 0, background: active ? "#35483b" : "#fff", color: active ? "#fff" : "#35483b", fontSize: 12, fontWeight: 750, cursor: "pointer" }; }
