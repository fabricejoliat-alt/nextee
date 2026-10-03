"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, PlusCircle, Trash2, Pencil, AlertTriangle, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import { managerPlanningPendingEvents } from "@/lib/managerPlanningEvaluation";
import { managerPlanningDate, managerPlanningFeedback, managerPlanningFormat } from "@/lib/managerPlanningPresentation";
import { managerActivityLabel } from "@/lib/managerLocale";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import groupStyles from "@/components/manager/GroupsManagement.module.css";

type GroupRow = { id: string; name: string | null; club_id: string };
type ProfileLite = { id: string; first_name: string | null; last_name: string | null; handicap?: number | null; avatar_url?: string | null };
type EventRow = { id: string; group_id: string; club_id: string; event_type: "training" | "interclub" | "camp" | "session" | "event"; starts_at: string; ends_at: string | null; duration_minutes: number; location_text: string | null; coach_note: string | null; series_id: string | null; status: "scheduled" | "cancelled"; requires_evaluation: boolean };
type EventCoachRow = { event_id: string; coach_id: string };
type EventAttendeeRow = { event_id: string; player_id: string; status: "expected" | "present" | "absent" | "excused" | null };
type FilterMode = "all" | "upcoming" | "past";
type EventTypeFilter = "all" | EventRow["event_type"];
type PlanningFilterTab = FilterMode | "pending";
type FilterCounts = { all: number; upcoming: number; past: number };
const fieldLabelStyle = { fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" };
function fullName(person?: ProfileLite | null) { return [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "—"; }
function avatarNode(person?: ProfileLite | null) {
  // User avatars retain their signed storage URLs.
  // eslint-disable-next-line @next/next/no-img-element
  return person?.avatar_url ? <img src={person.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : [person?.first_name, person?.last_name].map(value => value?.trim().charAt(0).toUpperCase()).join("") || "—";
}

export default function CoachGroupPlanningPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const groupId = String(params?.id ?? "").trim();
  const seasonId = searchParams.get("season") ?? "";
  const loadVersion = useRef(0), deletePending = useRef(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventCoachIds, setEventCoachIds] = useState<Record<string, string[]>>({});
  const [eventAttendeeIds, setEventAttendeeIds] = useState<Record<string, string[]>>({});
  const [eventAttendance, setEventAttendance] = useState<Record<string, Record<string, string>>>({});
  const [historicalProfiles, setHistoricalProfiles] = useState<ProfileLite[]>([]);
  const [pendingEventIds, setPendingEventIds] = useState<Set<string>>(new Set());
  const [pendingEvaluationCount, setPendingEvaluationCount] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("all");
  const [filterCounts, setFilterCounts] = useState<FilterCounts>({ all: 0, upcoming: 0, past: 0 });
  const [pendingEvaluationsOnly, setPendingEvaluationsOnly] = useState(false);
  const personById = useMemo(() => new Map(historicalProfiles.map(person => [person.id, person])), [historicalProfiles]);
  const eventNeedsEvaluation = (event: EventRow) => event.status !== "cancelled" && pendingEventIds.has(event.id);
  const listedEvents = useMemo(() => pendingEvaluationsOnly ? events.filter(event => event.status !== "cancelled" && pendingEventIds.has(event.id)) : events, [events, pendingEvaluationsOnly, pendingEventIds]);

  async function load() {
    const version = ++loadVersion.current;
    async function checked<T>(request: PromiseLike<T>): Promise<T> {
      const result = await request;
      if (version !== loadVersion.current) throw new Error("stale_load");
      return result;
    }
    setLoading(true);
    setError(null);

    try {
      if (!groupId) throw new Error(t("manager.planning.groupMissing"));

      const { data: uRes, error: uErr } = await checked(supabase.auth.getUser());
      if (uErr || !uRes.user) throw new Error(t("manager.home.invalidSession"));

      // group
      const gRes = await checked(supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle());
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("manager.groups.notFound");
      setGroup(gRes.data as GroupRow);

      // ✅ events filtered
      let isoFrom: string | null = null;
      let isoTo: string | null = null;

      if (filterMode === "upcoming") {
        const from = new Date();
        isoFrom = from.toISOString();
      } else if (filterMode === "past") {
        const to = new Date(); // now
        isoTo = to.toISOString();

      }

      let q = supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,requires_evaluation")
        .eq("group_id", groupId)
        .order("starts_at", { ascending: true });

      if (isoFrom) q = q.gte("starts_at", isoFrom);
      if (isoTo) q = q.lt("starts_at", isoTo);
      if (eventTypeFilter !== "all") q = q.eq("event_type", eventTypeFilter);

      const eRes = await checked(q);
      if (eRes.error) throw new Error(eRes.error.message);
      const eList = (eRes.data ?? []) as EventRow[];
      setEvents(eList);

      const nowIso = new Date().toISOString();
      const withType = (qq: ReturnType<ReturnType<typeof supabase.from>["select"]>) => (eventTypeFilter !== "all" ? qq.eq("event_type", eventTypeFilter) : qq);

      const allCountQ = withType(supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId));
      const upCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId).gte("starts_at", nowIso)
      );
      const pastCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId).lt("starts_at", nowIso)
      );
      const [allCountRes, upCountRes, pastCountRes] = await checked(Promise.all([allCountQ, upCountQ, pastCountQ]));
      if (allCountRes.error) throw new Error(allCountRes.error.message);
      if (upCountRes.error) throw new Error(upCountRes.error.message);
      if (pastCountRes.error) throw new Error(pastCountRes.error.message);
      setFilterCounts({
        all: allCountRes.count ?? 0,
        upcoming: upCountRes.count ?? 0,
        past: pastCountRes.count ?? 0,
      });

      // Count past events requiring evaluation (independent from current visible filter)
      const pastEvalEventsRes = await checked(supabase
        .from("club_events")
        .select("id,event_type,starts_at,ends_at,duration_minutes,requires_evaluation")
        .eq("group_id", groupId)
        .eq("requires_evaluation", true).neq("status", "cancelled"));
      if (pastEvalEventsRes.error) throw new Error(pastEvalEventsRes.error.message);

      const nowTs = Date.now();
      const pastEvalEvents = ((pastEvalEventsRes.data ?? []) as Array<{
        id: string;
        event_type: "training" | "interclub" | "camp" | "session" | "event";
        starts_at: string;
        ends_at: string | null;
        requires_evaluation: boolean;
        duration_minutes: number;
      }>).filter((ev) => {
        const endTs = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.starts_at).getTime() + (ev.duration_minutes || 0) * 60_000;
        return endTs < nowTs;
      });

      const pastEvalEventIds = pastEvalEvents.map(event => event.id);
      const pending = await checked(managerPlanningPendingEvents(supabase, pastEvalEventIds));
      setPendingEventIds(pending);
      setPendingEvaluationCount(pending.size);

      const eventIds = eList.map((e) => e.id);
      if (eventIds.length > 0) {
        const ecRes = await checked(supabase
          .from("club_event_coaches")
          .select("event_id,coach_id")
          .in("event_id", eventIds));
        if (ecRes.error) throw new Error(ecRes.error.message);
        const byEvent: Record<string, string[]> = {};
        ((ecRes.data ?? []) as EventCoachRow[]).forEach((r) => {
          if (!byEvent[r.event_id]) byEvent[r.event_id] = [];
          byEvent[r.event_id].push(r.coach_id);
        });
        setEventCoachIds(byEvent);

        const eaRes = await checked(supabase
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", eventIds));
        if (eaRes.error) throw new Error(eaRes.error.message);
        const attendeesByEvent: Record<string, string[]> = {};
        ((eaRes.data ?? []) as EventAttendeeRow[]).forEach((r) => {
          if (!attendeesByEvent[r.event_id]) attendeesByEvent[r.event_id] = [];
          attendeesByEvent[r.event_id].push(r.player_id);

        });
        setEventAttendeeIds(attendeesByEvent);

        const attendance: Record<string, Record<string, string>> = {};
        for (const row of (eaRes.data ?? []) as EventAttendeeRow[]) {
          (attendance[row.event_id] ??= {})[row.player_id] = row.status ?? "expected";
        }
        setEventAttendance(attendance);
        const peopleIds = Array.from(new Set([...Object.values(byEvent).flat(), ...Object.values(attendeesByEvent).flat()]));
        const profiles: ProfileLite[] = [];
        for (let from = 0; from < peopleIds.length; from += 150) {
          const result = await checked(supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").in("id", peopleIds.slice(from, from + 150)));
          if (result.error) throw new Error(result.error.message);
          profiles.push(...(result.data ?? []) as ProfileLite[]);
        }
        setHistoricalProfiles(profiles);
      } else {
        setEventAttendance({});
        setHistoricalProfiles([]);
        setEventCoachIds({});
        setEventAttendeeIds({});
      }

      setLoading(false);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "common.errorLoading");
      setGroup(null);
      setEvents([]);
      setEventCoachIds({});
      setEventAttendeeIds({});
      setPendingEvaluationCount(0);
      setPendingEventIds(new Set());
      setHistoricalProfiles([]);
      setEventAttendance({});
      setFilterCounts({ all: 0, upcoming: 0, past: 0 });
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Invalidate pending requests on filter changes and unmount; this ref is a counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { loadVersion.current++; };
    // Interface language changes do not refetch data or reset list filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, filterMode, eventTypeFilter]);

  async function deleteEvent(eventId: string) {
    if (deletePending.current) return;
    if (!window.confirm(t("manager.planning.confirmDelete"))) return;
    deletePending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("manager.profile.invalidSession");
      const response = await fetch(`/api/manager/events/${encodeURIComponent(eventId)}?scope=occurrence`, { method: "DELETE", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "manager.administration.actionError");
      await load();
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.administration.actionError");
    } finally { deletePending.current = false; setBusy(false); }
  }

  return (
    <main className={`${styles.page} ${groupStyles.page}`}>
      <nav aria-label={t("manager.content.breadcrumb")} style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">{t("manager.content.groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>{group?.name ?? t("manager.performance.group")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{t("manager.groups.planning")}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{t("manager.groups.planning")}</h1>
          <p className={styles.lead}>{managerPlanningFormat(t, "lead", { name: group?.name ?? "" })}</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link className={actionStyles.backButton} href={`/manager/groups/${groupId}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t("coach.planning.back")} </Link>
          <Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning/add${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>
            <PlusCircle size={16} aria-hidden="true" />
            {t("manager.home.addActivity")} </Link>
        </div>
      </div>

      {error && <div className={actionStyles.errorAlert} role="alert">{managerPlanningFeedback(t, error)}</div>}

        <ManagerStatisticsTabs<PlanningFilterTab>
          ariaLabel={t("coach.planning.period")}
          value={pendingEvaluationsOnly ? "pending" : filterMode}
          items={[
            { value: "all", label: `${t("manager.performance.allCategories")} (${filterCounts.all})` },
            { value: "upcoming", label: `${t("manager.content.upcoming")} (${filterCounts.upcoming})` },
            { value: "past", label: `${t("manager.planning.past")} (${filterCounts.past})` },
            { value: "pending", label: `${t("coachCalendar.toEvaluate")} (${pendingEvaluationCount})` },
          ]}
          onChange={(value) => {
            if (value === "pending") {
              setFilterMode("past");
              setEventTypeFilter("all");
              setPendingEvaluationsOnly(true);
              return;
            }
            setPendingEvaluationsOnly(false);
            setFilterMode(value);
          }}
        />

        {/* ✅ Filters for list */}
        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("coach.calendar.filter")}</h2>
              <p>{t("coach.planning.filterHint")}</p>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={fieldLabelStyle}>{t("manager.performance.activityType")}</span>
              <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)} disabled={busy}>
                <option value="all">{t("coach.calendar.allTypes")}</option>
                <option value="training">{t("manager.activity.training")}</option>
                <option value="interclub">{t("manager.activity.interclub")}</option>
                <option value="camp">{t("manager.activity.camp")}</option>
                <option value="session">{t("manager.activity.session")}</option>
                <option value="event">{t("manager.activity.event")}</option>
              </select>
            </label>
          </div>
        </section>

        {/* List */}
        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("manager.nav.activities")}</h2>
            </div>
          </div>
          <div>
            {loading ? (
              <CompactLoadingBlock label={t("common.loading")} />
            ) : listedEvents.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                {pendingEvaluationsOnly
                  ? t("manager.planning.noPending")
                  : filterMode === "upcoming"
                  ? t("manager.home.noEvents")
                  : filterMode === "past"
                  ? t("manager.planning.noPast")
                  : t("manager.planning.noRange")}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {listedEvents.map((e) => (
                  <article key={e.id} className="planning-event-card">
                    {(() => {
                      const coachIds = Array.from(new Set(eventCoachIds[e.id] ?? []));
                      const attendeeIds = Array.from(new Set(eventAttendeeIds[e.id] ?? []));
                      const showEvaluationWarning = eventNeedsEvaluation(e);
                      // An activity keeps its own attendee list. Do not filter it
                      // through the group's current membership: former juniors must
                      // remain visible in the history.
                      const playerIds = attendeeIds;
                      const statuses = eventAttendance[e.id] ?? {};
                      const attendanceLabel = (id: string) => t(statuses[id] === "present" ? "manager.content.present" : statuses[id] === "absent" ? "coachDebrief.absent" : statuses[id] === "excused" ? "manager.planning.excused" : "manager.planning.expected");

                      const renderPeopleLine = (label: string, ids: string[], withAttendance = false) => {
                        const people = ids
                          .map((id) => personById.get(id))
                          .filter(Boolean) as Array<ProfileLite>;
                        const preview = people.slice(0, 8);
                        const hasMore = people.length > 8;
                        return (
                          <div style={{ display: "grid", gap: 2 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", color: "rgba(0,0,0,0.58)" }}>
                              {label.toUpperCase()}
                            </div>
                            <div>
                              {people.length === 0 ? (
                                <span style={{ color: "rgba(0,0,0,0.50)" }}>{t("manager.content.none")}</span>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                  {preview.map((person, idx) => (
                                    <div
                                      key={`${label}-${person.id}-${idx}`}
                                      style={{
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.74)",
                                        padding: "4px 8px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        maxWidth: 180,
                                      }}
                                    >
                                      <span className="user-mgmt-member-avatar" aria-hidden="true">
                                        {avatarNode(person)}
                                      </span>
                                      {withAttendance ? (
                                        <span
                                          aria-label={attendanceLabel(person.id)}
                                          title={attendanceLabel(person.id)}
                                          style={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: 999,
                                            background: statuses[person.id] === "present" ? "#4f8a4b" : statuses[person.id] === "absent" ? "#c84a40" : "#899d7d",
                                            boxShadow: "0 0 0 2px rgba(255,255,255,.86)",
                                            flex: "0 0 auto",
                                          }}
                                        />
                                      ) : null}
                                      <span className="truncate" style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.78)" }}>
                                        {fullName(person)}
                                      </span>
                                    </div>
                                  ))}
                                  {hasMore ? <Link href={`/manager/groups/${groupId}/planning/${e.id}`} style={{ color: "rgba(0,0,0,0.55)", fontSize: 12, fontWeight: 800 }}>{t("manager.planning.more")}</Link> : null}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      };

                      const date = managerPlanningDate(e.starts_at, e.ends_at, locale);
                      return (
                    <div className="planning-event-card-inner">
                      <div className="planning-event-date">
                        <div className="planning-event-day">{date.day}</div>
                        <div className="planning-event-number">{date.date}</div>
                        <div className="planning-event-month">{date.month}</div>
                        <div className="planning-event-time-divider" />
                        <div className="planning-event-times">
                          <span>{date.startTime}</span>
                          {date.endTime ? <span>{date.endTime}</span> : null}
                        </div>
                      </div>

                      <div className="planning-event-content">
                      <div style={{ display: "grid", gap: 10 }}>
                      <div className="planning-event-title-row">
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                          <h3 className="planning-event-title">{managerActivityLabel(t, e.event_type)}</h3>
                          {e.series_id ? <span className="pill-soft">{t("coach.form.recurring")}</span> : <span className="pill-soft">{t("coach.planning.single")}</span>}
                          {showEvaluationWarning ? (
                            <span
                              className="pill-soft"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                color: "rgba(127,29,29,1)",
                                background: "rgba(239,68,68,0.16)",
                                borderColor: "rgba(239,68,68,0.35)",
                                fontWeight: 900,
                              }}
                            >
                              <AlertTriangle size={14} />
                              {t("manager.planning.evaluation")}
                            </span>
                          ) : null}
                        </div>
                        <span className="pill-soft">{e.duration_minutes} {t("common.min")}</span>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        {renderPeopleLine(t("manager.fields.coach"), coachIds)}
                        <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
                        {renderPeopleLine(t("manager.fields.player"), playerIds, true)}
                      </div>

                      <div className="planning-event-footer">
                        <span className="planning-event-location">
                          <MapPin size={16} aria-hidden="true" />
                          <span>{e.location_text?.trim() || t("manager.content.noLocation")}</span>
                        </span>
                        <div className="user-mgmt-card-actions">
                        <Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${e.id}`}>
                          {t("coach.open")}
                        </Link>

                        <Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${e.id}/edit`}>
                          <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {t("common.edit")}
                        </Link>

                        <button
                          type="button"
                          className={actionStyles.dangerButton}
                          disabled={busy}
                          onClick={() => deleteEvent(e.id)}
                          title={t("manager.content.delete")}
                        >
                          <Trash2 size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {t("common.delete")}
                        </button>
                        </div>
                      </div>
                    </div>
                    </div>
                    </div>
                      );
                    })()}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
    </main>
  );
}
