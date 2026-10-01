"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Eye, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale } from "@/lib/i18n/coachMessages";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import activityStyles from "./CoachCalendarActivities.module.css";
import { coachCalendarActionHref, coachCalendarActionState, coachEventEndMs, type CoachCalendarActionState } from "@/lib/coachCalendar";

type CalendarView = "month" | "week" | "day";
type EventFilter = "all" | "evaluations";
type EventRow = {
  id: string; group_id: string; camp_id: string | null; club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null; camp_day_index: number | null; starts_at: string; ends_at: string | null;
  duration_minutes: number | null; location_text: string | null; coach_note: string | null;
  series_id: string | null; status: string; requires_evaluation?: boolean;
};

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date: Date, amount: number) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function startOfWeek(date: Date) { const day = startOfDay(date); return addDays(day, -((day.getDay() + 6) % 7)); }
function ymd(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function capitalise(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function monthLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)); }
function dayLabel(date: Date, locale: string) { return capitalise(new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)); }
function eventTypeLabel(value: EventRow["event_type"], t: (key: string) => string) {
  return t(`coach.activity.${value ?? "other"}`);
}

export default function CoachCalendarPage() {
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();
  const dateLocale = coachDateLocale(locale);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [trainingEvaluationCompleteByEventId, setTrainingEvaluationCompleteByEventId] = useState<Record<string, boolean>>({});
  const [canPlan, setCanPlan] = useState(false);
  const [view, setView] = useState<CalendarView>("month");
  const [eventFilter, setEventFilter] = useState<EventFilter>(searchParams.get("view") === "evaluations" ? "evaluations" : "all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [referenceNow] = useState(() => Date.now());

  const [reload, setReload] = useState(0);
  const requestedView = searchParams.get("view");
  useEffect(() => { setEventFilter(requestedView === "evaluations" ? "evaluations" : "all"); }, [requestedView]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError(null);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token ?? "";
        const userId = session.data.session?.user.id ?? "";
        if (!token || !userId) throw new Error("coach.error.session");
        const [calendarResponse, permissions] = await Promise.all([
          fetch("/api/coach/events/calendar", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }),
          supabase.from("club_members").select("can_manage_assigned_group_planning").eq("user_id", userId).eq("role", "coach").eq("is_active", true),
        ]);
        const calendar = await calendarResponse.json().catch(() => ({}));
        if (!calendarResponse.ok) throw new Error(calendarResponse.status === 401 ? "coach.error.session" : calendarResponse.status === 403 ? "coach.error.forbidden" : "coach.error.load");
        if (!active) return;
        setEvents((calendar?.events ?? []) as EventRow[]);
        setGroupNames((calendar?.groupNameById ?? {}) as Record<string, string>);
        setClubNames((calendar?.clubNameById ?? {}) as Record<string, string>);
        setTrainingEvaluationCompleteByEventId((calendar?.trainingEvaluationCompleteByEventId ?? {}) as Record<string, boolean>);
        setCanPlan(!permissions.error && (permissions.data ?? []).some((row) => Boolean(row.can_manage_assigned_group_planning)));
      } catch (cause) { if (active) { setError(cause instanceof Error && cause.message.startsWith("coach.error.") ? cause.message : "coach.error.load"); setEvents([]); setCanPlan(false); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [reload]);

  const pendingEvaluationIds = useMemo(() => new Set(events
    .filter((event) => coachCalendarActionState(event, trainingEvaluationCompleteByEventId[event.id] === true, referenceNow) === "needs_evaluation")
    .map((event) => event.id)), [events, referenceNow, trainingEvaluationCompleteByEventId]);
  const visibleEvents = useMemo(() => events.filter((event) => event.status === "scheduled" && (eventFilter !== "evaluations" || pendingEvaluationIds.has(event.id)) && (typeFilter === "all" || event.event_type === typeFilter) && (groupFilter === "all" || event.group_id === groupFilter)), [eventFilter, events, groupFilter, pendingEvaluationIds, typeFilter]);
  const groups = useMemo(() => Object.entries(groupNames)
    .filter(([, name]) => !name.trim().startsWith("__") && !name.toLocaleLowerCase(dateLocale).includes("archive"))
    .sort((a, b) => a[1].localeCompare(b[1], dateLocale)), [dateLocale, groupNames]);
  const stats = useMemo(() => { const scheduled = events.filter((event) => event.status === "scheduled"); return { completed: scheduled.filter((event) => coachEventEndMs(event) <= referenceNow).length, planned: scheduled.filter((event) => coachEventEndMs(event) > referenceNow).length, total: scheduled.length }; }, [events, referenceNow]);
  const monthDays = useMemo(() => Array.from({ length: new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate() }, (_, index) => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), index + 1)), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index)), [anchorDate]);
  const headerLabel = view === "month" ? monthLabel(anchorDate, dateLocale) : view === "week" ? `${dayLabel(weekDays[0], dateLocale)} – ${dayLabel(weekDays[6], dateLocale)}` : dayLabel(anchorDate, dateLocale);
  const displayedDays = view === "month" ? monthDays : view === "week" ? weekDays : [anchorDate];
  const firstGroupId = groups[0]?.[0] ?? "";
  function movePeriod(direction: -1 | 1) { if (view === "month") setAnchorDate((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1)); else if (view === "week") setAnchorDate((date) => addDays(date, direction * 7)); else setAnchorDate((date) => addDays(date, direction)); }

  return <main className={styles.page}>
    <nav data-ui="breadcrumb" className={actionStyles.breadcrumb} aria-label={t("common.breadcrumb")}>{`${t("common.coach")} / ${t("coach.nav.activities")}`}</nav>
    <div className={styles.topline}><div><h1>{t("coach.nav.activities")}</h1><p className={styles.lead}>{t("coach.calendar.intro")}</p></div>{canPlan && firstGroupId ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${firstGroupId}/planning/add`}><CalendarDays size={16} aria-hidden="true" />{t("coach.calendar.add")}</Link> : null}</div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{t(error)} <button type="button" className={actionStyles.secondaryButton} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}
    <section className={styles.overview} aria-label={t("coach.calendar.metrics")}><div className={styles.statsGrid}><article className={styles.statCard}><span>{t("coach.calendar.completed")}</span><b>{loading || error ? "—" : stats.completed}</b><small>{t("coach.calendar.scope")}</small></article><article className={styles.statCard}><span>{t("coach.calendar.planned")}</span><b>{loading || error ? "—" : stats.planned}</b><small>{t("coach.calendar.upcoming")}</small></article><article className={styles.statCard}><span>{t("coach.calendar.total")}</span><b>{loading || error ? "—" : stats.total}</b><small>{t("coach.calendar.totalHint")}</small></article></div></section>
    <section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{t("coach.calendar.filter")}</h2><p>{t("coach.calendar.filterHint")}</p></div></div><div style={{ display: "grid", gap: 12 }}>
      <div style={segmentWrapStyle}><button type="button" onClick={() => setView("month")} aria-pressed={view === "month"} style={segmentButtonStyle(view === "month", true)}>{t("coach.calendar.month")}</button><button type="button" onClick={() => setView("week")} aria-pressed={view === "week"} style={segmentButtonStyle(view === "week", true)}>{t("coach.calendar.week")}</button><button type="button" onClick={() => setView("day")} aria-pressed={view === "day"} style={segmentButtonStyle(view === "day")}>{t("coach.calendar.day")}</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}><FilterSelect label={t("coach.calendar.display")} value={eventFilter} onChange={(value) => setEventFilter(value as EventFilter)} options={[["all", t("coach.calendar.all")], ["evaluations", t("coach.nav.evaluations")]]} /><FilterSelect label={t("coach.calendar.type")} value={typeFilter} onChange={setTypeFilter} options={[["all", t("coach.calendar.allTypes")], ["training", t("coach.activity.training")], ["interclub", t("coach.activity.interclub")], ["camp", t("coach.activity.camp")], ["session", t("coach.activity.session")], ["event", t("coach.activity.event")]]} /><FilterSelect label={t("coach.calendar.group")} value={groupFilter} onChange={setGroupFilter} options={[["all", t("coach.calendar.allGroups")], ...groups]} /></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(-1)} aria-label={t("coach.calendar.previous")} title={t("coach.calendar.previous")}><ChevronLeft size={16} aria-hidden="true" /></button><button className={actionStyles.secondaryButton} type="button" onClick={() => setAnchorDate(new Date())}>{t("coach.calendar.today")}</button><button className={actionStyles.secondaryButton} type="button" onClick={() => movePeriod(1)} aria-label={t("coach.calendar.next")} title={t("coach.calendar.next")}><ChevronRight size={16} aria-hidden="true" /></button></div><strong style={{ color: "#35483b", fontSize: 16 }}>{headerLabel}</strong></div>
    </div></section>
    {loading ? <section className={styles.quickPanel}><ListLoadingBlock label={t("coach.calendar.loading")} /></section> : error ? null : <section className={`${styles.quickPanel} ${activityStyles.panel}`}><div className={activityStyles.list}>{visibleEvents.filter((event) => displayedDays.some((date) => ymd(date) === ymd(new Date(event.starts_at)))).map((event) => {
      const startsAt = new Date(event.starts_at);
      const href = `/coach/groups/${event.group_id}/planning/${event.id}`;
      const actionState = coachCalendarActionState(event, trainingEvaluationCompleteByEventId[event.id] === true, referenceNow);
      const action = calendarAction(actionState, event.group_id, event.id, t);
      const ActionIcon = action.Icon;
      const customTitle = String(event.title ?? "").trim();
      const typeLabel = eventTypeLabel(event.event_type, t);
      const groupName = groupNames[event.group_id] ?? t("coach.calendar.specificGroup");
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
          <span className={dashboardStyles.activityMeta}>{groupName} · {clubNames[event.club_id] ?? t("coach.activity.noClub")}</span>
          <span className={`planning-event-location ${dashboardStyles.activityLocation}`}><MapPin size={14} aria-hidden="true" /><span>{event.location_text || t("coach.activity.noPlace")}</span></span>
        </div>
        <div className={activityStyles.actions}>
          <Link className={`${activityStyles.iconAction} ${activityStyles[action.className]}`} href={action.href} aria-label={`${action.label} — ${customTitle || typeLabel}`} title={action.label}><ActionIcon size={18} aria-hidden="true" /></Link>
        </div>
      </article>;
    })}{!visibleEvents.some((event) => displayedDays.some((date) => ymd(date) === ymd(new Date(event.starts_at)))) ? <div className="marketplace-empty">{t("coach.calendar.empty")}</div> : null}</div></section>}
  </main>;
}

function calendarAction(
  state: CoachCalendarActionState,
  groupId: string,
  eventId: string,
  t: (key: string) => string
) {
  const href = coachCalendarActionHref(state, groupId, eventId);
  if (state === "needs_evaluation") return { className: "pendingAction" as const, href, Icon: ClipboardList, label: t("coachCalendar.toEvaluate") };
  if (state === "evaluation_complete") return { className: "completedAction" as const, href, Icon: ClipboardCheck, label: t("coachCalendar.evaluationComplete") };
  if (state === "prepare_training") return { className: "prepareAction" as const, href, Icon: CalendarClock, label: t("coachCalendar.prepareTraining") };
  return { className: "viewAction" as const, href, Icon: Eye, label: t("coachCalendar.viewActivity") };
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label style={fieldStyle}><span style={fieldLabelStyle}>{label}</span><select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
const fieldStyle: React.CSSProperties = { display: "grid", gap: 4 };
const fieldLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#53675a" };
const segmentWrapStyle: React.CSSProperties = { display: "inline-flex", width: "fit-content", border: "1px solid #dce5db", borderRadius: 10, overflow: "hidden", background: "#fff" };
function segmentButtonStyle(active: boolean, withBorder = false): React.CSSProperties { return { minHeight: 44, padding: "0 14px", border: 0, borderRight: withBorder ? "1px solid #dce5db" : 0, background: active ? "#35483b" : "#fff", color: active ? "#fff" : "#35483b", fontSize: 12, fontWeight: 750, cursor: "pointer" }; }
