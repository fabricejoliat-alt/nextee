"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, PlusCircle, Trash2, Pencil, AlertTriangle, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey, coachUiErrorKey } from "@/lib/coachUiErrors";
import { coachCalendarActionHref, coachCalendarActionState } from "@/lib/coachCalendar";
import { coachPlanningView, coachPlanningAttendanceKey, coachPlanningTitle, type CoachPlanningData, type CoachPlanningEvent,
  type CoachPlanningPerson, type CoachPlanningAttendee, type CoachPlanningTab } from "@/lib/coachPlanning";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import ManagementActivityDate from "@/components/ui/ManagementActivityDate";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import planningStyles from "./CoachGroupPlanning.module.css";

const eventTypes = ["training", "interclub", "camp", "session", "event"] as const;
const fullName = (person: CoachPlanningPerson) => `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "—";
const initials = (person: CoachPlanningPerson) => `${person.first_name?.[0] ?? ""}${person.last_name?.[0] ?? ""}`.toUpperCase() || "—";

async function authHeaders() {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("coach.error.session");
  return { Authorization: `Bearer ${token}` };
}

export default function CoachGroupPlanningPage() {
  const { locale, t } = useI18n();
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "").trim();
  const [data, setData] = useState<CoachPlanningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<CoachPlanningTab>("upcoming");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(50);
  const [now, setNow] = useState(() => Date.now());
  const [deleteTarget, setDeleteTarget] = useState<CoachPlanningEvent | null>(null);
  const [deleteScope, setDeleteScope] = useState<"occurrence" | "series">("occurrence");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loadVersion = useRef(0);
  const routeVersion = useRef(0);
  const deleteVersion = useRef(0);
  const deleteInFlight = useRef(false);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      if (!groupId) throw new Error("coach.error.groupAccess");
      const response = await fetch(`/api/coach/groups/${encodeURIComponent(groupId)}/planning`, {
        headers: await authHeaders(), cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(coachUiErrorKey(response.status, json, "coach.error.load"));
      if (json?.group?.id !== groupId || !Array.isArray(json.events)) throw new Error("coach.error.load");
      if (version !== loadVersion.current) return null;
      setData(json as CoachPlanningData);
      setNow(Date.now());
      return json as CoachPlanningData;
    } catch (cause) {
      if (version === loadVersion.current) {
        setData(null);
        setError(coachCaughtErrorKey(cause, "coach.error.load"));
      }
      return null;
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setData(null); setNotice(null); setDeleteTarget(null); setDeleteError(null);
    setDeleting(false); setRefreshRequired(false); setTab("upcoming"); setType("all"); setLimit(50);
    void load();
    return () => { loadVersion.current += 1; routeVersion.current += 1; deleteVersion.current += 1; deleteInFlight.current = false; };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const currentData = data?.group.id === groupId ? data : null;
  const unavailable = loading || !currentData || Boolean(error);
  const canPlan = !unavailable && currentData.can_plan;
  const view = useMemo(() => coachPlanningView(currentData?.events ?? [], type, tab, now), [currentData, type, tab, now]);
  const typeLabel = (value: string) => t(eventTypes.includes(value as typeof eventTypes[number]) ? `coach.activity.${value}` : "coach.activity.other");
  const eventName = (event: CoachPlanningEvent) => coachPlanningTitle(event.title, typeLabel(event.event_type));
  const eventDate = (event: CoachPlanningEvent) => new Intl.DateTimeFormat(coachDateLocale(locale), {
    weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(event.starts_at));

  function openDelete(event: CoachPlanningEvent) {
    if (!canPlan || deleteInFlight.current || event.event_type === "competition") return;
    deleteVersion.current += 1;
    setDeleteTarget(event); setDeleteScope("occurrence"); setDeleteError(null); setRefreshRequired(false); setNotice(null);
  }
  function closeDelete() {
    if (!deleteInFlight.current) { deleteVersion.current += 1; setDeleteTarget(null); setDeleteError(null); setRefreshRequired(false); }
  }
  async function refreshDelete() {
    if (deleteInFlight.current || loading) return;
    const scope = routeVersion.current;
    const dialogVersion = deleteVersion.current;
    const result = await load();
    if (scope !== routeVersion.current || dialogVersion !== deleteVersion.current) return;
    if (!result) { setDeleteError("coach.error.load"); return; }
    const refreshed = result.events.find((event) => event.id === deleteTarget?.id);
    if (!refreshed || !result.can_plan) { closeDelete(); return; }
    if (!refreshed.series_id || refreshed.series_id !== deleteTarget?.series_id) setDeleteScope("occurrence");
    setDeleteTarget(refreshed); setDeleteError(null); setRefreshRequired(false);
  }
  async function confirmDelete() {
    if (!deleteTarget || !canPlan || refreshRequired || deleteInFlight.current) return;
    deleteInFlight.current = true;
    const scope = routeVersion.current;
    setDeleting(true); setDeleteError(null);
    try {
      const path = deleteScope === "series" && deleteTarget.series_id
        ? `/api/coach/events/series/${encodeURIComponent(deleteTarget.series_id)}`
        : `/api/coach/events/${encodeURIComponent(deleteTarget.id)}?scope=occurrence`;
      const response = await fetch(path, { method: "DELETE", headers: await authHeaders() });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok !== true) throw new Error(coachUiErrorKey(response.status, json, "coach.error.planningDelete"));
      if (scope !== routeVersion.current) return;
      // Close after confirmed mutation, then distinguish refresh failure from deletion failure.
      setDeleteTarget(null);
      setNotice(json.notification_warning ? "coach.error.deletionNotification" : "coach.planning.deleted");
      const result = await load();
      if (scope === routeVersion.current && !result) { setNotice(null); setError("coach.error.planningRefresh"); }
    } catch (cause) {
      if (scope === routeVersion.current) {
        setDeleteError(coachCaughtErrorKey(cause, "coach.error.planningDelete"));
        setRefreshRequired(true);
      }
    } finally {
      if (scope === routeVersion.current) { deleteInFlight.current = false; setDeleting(false); }
    }
  }

  function peopleLine(label: string, people: CoachPlanningPerson[], attendance = false) {
    const sorted = [...people].sort((a, b) => fullName(a).localeCompare(fullName(b), locale));
    return <div className={planningStyles.people}>
      <span>{label}</span>
      {sorted.length ? <ul aria-label={label}>{sorted.slice(0, 8).map((person) => <li key={person.id}>
        <span className={planningStyles.avatar} aria-hidden="true">{person.avatar_url ? <img src={person.avatar_url} alt=""/> : initials(person)}</span>
        <div className={planningStyles.personCopy}><b>{fullName(person)}</b>
          {attendance ? <small>{t(coachPlanningAttendanceKey(person as CoachPlanningAttendee))}</small> : null}
        </div>
      </li>)}{sorted.length > 8 ? <li>{coachText(t, "coach.planning.more", { count: sorted.length - 8 })}</li> : null}</ul> : <p className={planningStyles.empty}>{t("coach.planning.none")}</p>}
    </div>;
  }

  return <main className={`${styles.page} ${planningStyles.page}`}>
    <nav data-ui="breadcrumb" className={actionStyles.breadcrumb} aria-label={t("common.breadcrumb")}>
      <Link href="/coach/groups">{t("coach.nav.groups")}</Link><span aria-hidden="true">/</span>
      <Link href={`/coach/groups/${groupId}`}>{currentData?.group.name || t("coach.groups.group")}</Link>
      <span aria-hidden="true">/</span><span>{t("coach.group.planning")}</span>
    </nav>
    <div className={styles.topline}>
      <div><h1>{t("coach.group.planning")}</h1><p className={styles.lead}>{coachText(t, "coach.planning.intro", { name: currentData?.group.name || t("coach.groups.group") })}</p></div>
      <div className={planningStyles.actions}>
        <Link className={actionStyles.backButton} href={`/coach/groups/${groupId}`}><ArrowLeft size={16} aria-hidden="true"/>{t("coach.planning.back")}</Link>
        {canPlan ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning/add`}><PlusCircle size={16} aria-hidden="true"/>{t("coach.calendar.add")}</Link> : null}
      </div>
    </div>
    {error ? <div className={`${actionStyles.errorAlert} ${planningStyles.alert}`} role="alert">{t(error)}
      <button type="button" className={actionStyles.secondaryButton} disabled={loading || deleting} onClick={() => void load()}>{t("coach.retry")}</button>
    </div> : null}
    {notice ? <p className={actionStyles.successAlert} role="status">{t(notice)}</p> : null}
    <ManagerStatisticsTabs<CoachPlanningTab> ariaLabel={t("coach.planning.period")} value={tab} mobileGrid
      items={(["all", "upcoming", "past", "pending"] as const).map((value) => ({
        value, label: `${t(`coach.planning.${value}`)} (${unavailable ? "—" : view.counts[value]})`,
      }))} onChange={(value) => { setTab(value); setLimit(50); }}/>
    <section className={styles.quickPanel}>
      <div className={styles.sectionHeading}><div><h2>{t("coach.calendar.filter")}</h2><p>{t("coach.planning.filterHint")}</p></div></div>
      <label className={planningStyles.filter}><span>{t("coach.calendar.type")}</span>
        <select value={type} onChange={(event) => { setType(event.target.value); setLimit(50); }}>
          <option value="all">{t("coach.calendar.allTypes")}</option>
          {eventTypes.map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}
        </select>
      </label>
    </section>
    <section className={styles.quickPanel} aria-busy={loading}>
      <div className={styles.sectionHeading}><div><h2>{t("coach.nav.activities")}</h2>
        <p>{unavailable ? "—" : view.events.length > limit ? coachText(t, "coach.planning.partial", { shown: limit, total: view.events.length })
          : coachText(t, view.events.length === 1 ? "coach.planning.one" : "coach.planning.count", { count: view.events.length })}</p>
      </div></div>
      {loading ? <CoachListSkeleton label={t("coach.calendar.loading")}/> : error ? null : !view.events.length ?
        <p className={planningStyles.empty}>{t({ all: "coach.planning.emptyAll", upcoming: "coach.planning.emptyUpcoming", past: "coach.planning.emptyPast", pending: "coach.planning.emptyPending" }[tab])}</p> :
        <div className={planningStyles.list}>{view.events.slice(0, limit).map((event) => {
          const action = coachCalendarActionState(event, event.evaluation_complete, now);
          const canEdit = canPlan && event.event_type !== "competition";
          return <article key={event.id} className="planning-event-card">
            <div className="planning-event-card-inner">
              <ManagementActivityDate startsAt={event.starts_at} endsAt={event.ends_at} locale={coachDateLocale(locale)}/>
              <div className="planning-event-content">
                <div className={planningStyles.list}>
                  <div className={planningStyles.title}>
                    <h3 className="planning-event-title">{eventName(event)}</h3>
                    <span className="pill-soft">{t(event.series_id ? "coach.planning.recurring" : "coach.planning.single")}</span>
                    {event.status === "cancelled" ? <span className="pill-soft">{t("coach.planning.cancelled")}</span> : null}
                    {action === "needs_evaluation" ? <span className="manager-calendar-warning-pill"><AlertTriangle size={14} aria-hidden="true"/>{t("coach.planning.pending")}</span> : null}
                    {event.duration_minutes != null ? <span className="pill-soft">{coachText(t, "coach.planning.duration", { minutes: event.duration_minutes })}</span> : null}
                  </div>
                  <div className="manager-calendar-detail-grid">
                    <div><span>{t("coach.groups.group")}</span><b>{currentData?.group.name || t("coach.activity.noGroup")}</b></div>
                    <div><span>{t("coach.directory.club")}</span><b>{currentData?.club_name || t("coach.activity.noClub")}</b></div>
                    <div><span>{t("coach.planning.type")}</span><b>{typeLabel(event.event_type)}</b></div>
                  </div>
                  {peopleLine(t("coach.groups.coaches"), event.coaches)}
                  {peopleLine(t("coach.nav.players"), event.attendees.filter((person) => person.is_player), true)}
                  {event.attendees.some((person) => !person.is_player) ? peopleLine(t("coach.planning.guests"), event.attendees.filter((person) => !person.is_player), true) : null}
                  <div className="planning-event-footer">
                    <span className="planning-event-location"><MapPin size={16} aria-hidden="true"/><span>{event.location_text?.trim() || t("coach.activity.noPlace")}</span></span>
                    <div className={planningStyles.actions}>
                      <Link className={actionStyles.secondaryButton} href={coachCalendarActionHref(action, groupId, event.id)}>{t(action === "needs_evaluation" ? "coach.planning.evaluate" : action === "evaluation_complete" ? "coach.planning.review" : "coach.open")}</Link>
                      {canEdit ? <><Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${event.id}/edit`}><Pencil size={16} aria-hidden="true"/>{t("common.edit")}</Link>
                        <button type="button" className={actionStyles.dangerButton} disabled={deleting} onClick={() => openDelete(event)}
                          aria-label={coachText(t, "coach.planning.deleteNamed", { name: `${eventName(event)} · ${eventDate(event)}` })}><Trash2 size={16} aria-hidden="true"/>{t("common.delete")}</button></> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>;
        })}{view.events.length > limit ? <button type="button" className={actionStyles.secondaryButton} onClick={() => setLimit((value) => value + 50)}>{t("coach.planning.showMore")}</button> : null}</div>}
    </section>
    {deleteTarget ? <AccessibleDialog className={planningStyles.dialog} labelledBy="planning-delete-title" onClose={closeDelete}>
      <h2 id="planning-delete-title">{t("coach.planning.deleteTitle")}</h2>
      <p><b>{eventName(deleteTarget)}</b><br/>{currentData?.group.name}<br/>{eventDate(deleteTarget)}</p>
      <fieldset disabled={deleting || loading} aria-busy={deleting || loading}>
        {deleteTarget.series_id ? <><legend>{t("coach.planning.deleteScope")}</legend>
          <label><input type="radio" name="delete-scope" checked={deleteScope === "occurrence"} onChange={() => setDeleteScope("occurrence")}/>{t("coach.planning.deleteOccurrence")}</label>
          <label><input type="radio" name="delete-scope" checked={deleteScope === "series"} onChange={() => setDeleteScope("series")}/>{t("coach.planning.deleteSeries")}</label>
        </> : null}
        <p>{t(deleteScope === "series" ? "coach.planning.deleteSeriesHint" : "coach.planning.deleteOccurrenceHint")}</p>
      </fieldset>
      {deleteError ? <p className={actionStyles.errorAlert} role="alert">{t(deleteError)}</p> : null}
      {refreshRequired ? <button type="button" className={actionStyles.secondaryButton} disabled={loading || deleting} onClick={() => void refreshDelete()}>{t(loading ? "common.loading" : "coach.planning.refresh")}</button> : null}
      <footer>
        <button type="button" className={actionStyles.secondaryButton} onClick={closeDelete} disabled={deleting}>{t("coach.directory.cancel")}</button>
        <button type="button" className={actionStyles.dangerButton} onClick={() => void confirmDelete()} disabled={deleting || loading || refreshRequired || !canPlan}>
          {t(deleting ? "coach.planning.deleting" : deleteScope === "series" ? "coach.planning.deleteConfirmSeries" : "coach.planning.deleteConfirmOccurrence")}
        </button>
      </footer>
    </AccessibleDialog> : null}
  </main>;
}
