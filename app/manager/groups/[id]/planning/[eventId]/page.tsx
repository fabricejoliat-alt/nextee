"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerPlanningDate, managerPlanningFeedback, managerPlanningFormat } from "@/lib/managerPlanningPresentation";
import { managerGroupFormat } from "@/lib/managerGroupPresentation";
import { managerActivityLabel, managerLocaleTag, type ManagerTranslate } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import { ArrowRight, Pencil, PlusCircle, Trash2, ArrowLeft, MapPin } from "lucide-react";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  coach_note: string | null;
  title: string | null;
  requires_evaluation: boolean;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ClubRow = { id: string; name: string | null };
type GroupRow = { id: string; name: string | null };
type CoachLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
};

type AttendeeDbRow = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused";
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type AttendeeUiRow = AttendeeDbRow & {
  profile?: ProfileLite | null;
};
type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function categoryLabel(t: ManagerTranslate, cat: string) {
  const standard = ["warmup_mobility", "long_game", "short_game_all", "putting", "wedging", "pitching", "chipping", "bunker", "course", "mental", "fitness", "other"];
  return standard.includes(cat) ? t(`cat.${cat}`) : cat;
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function avatarNode(p?: CoachLite | null) {
  if (p?.avatar_url) {
    return (
      <img
        src={p.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(p);
}

export default function CoachEventDetailPage() {
  const { locale, t } = useI18n();
  const params = useParams<{ id: string; eventId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [clubName, setClubName] = useState("");
  const [groupName, setGroupName] = useState("");

  const [attendees, setAttendees] = useState<AttendeeUiRow[]>([]);
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);
  const [structureItems, setStructureItems] = useState<EventStructureItemRow[]>([]);
  const [coachBusyIds, setCoachBusyIds] = useState<Record<string, boolean>>({});
  const [attendanceBusyIds, setAttendanceBusyIds] = useState<Record<string, boolean>>({});
  const loadVersion = useRef(0);
  const copyPending = useRef(false);
  const coachPending = useRef(false);
  const attendancePending = useRef(new Set<string>());
  const [copySnapshot, setCopySnapshot] = useState<Record<string, unknown> | null>(null);
  const [copiedCount, setCopiedCount] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [copyingStructure, setCopyingStructure] = useState(false);
  const [copyStructureMessage, setCopyStructureMessage] = useState<string | null>(null);

  async function load() {
    const version = ++loadVersion.current;
    async function checked<T>(request: PromiseLike<T>): Promise<T> {
      const result = await request;
      if (version !== loadVersion.current) throw new Error("stale_load");
      return result;
    }
    setLoading(true);
    setError(null);
    setCopySnapshot(null);
    setCopiedCount(null);
    setCopyError(false);
    setCopyStructureMessage(null);

    try {
      if (!eventId) throw new Error("manager.planning.eventMissing");

      // event
      const eRes = await checked(supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,requires_evaluation")
        .eq("id", eventId)
        .maybeSingle());

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("manager.planning.eventNotFound");
      const ev = eRes.data as EventRow;
      if (ev.group_id !== groupId) throw new Error("manager.planning.eventNotFound");
      setEvent(ev);

      // club name
      const cRes = await checked(supabase.from("organizations").select("id,name").eq("id", ev.club_id).maybeSingle());
      setClubName(!cRes.error && cRes.data ? (cRes.data as ClubRow).name ?? t("manager.settings.club") : t("manager.settings.club"));

      // group name
      const gRes = await checked(supabase.from("coach_groups").select("id,name").eq("id", ev.group_id).maybeSingle());
      const resolvedGroupName = !gRes.error && gRes.data ? (gRes.data as GroupRow).name ?? "" : "";
      setGroupName(resolvedGroupName);

      const { data: userRes, error: userErr } = await checked(supabase.auth.getUser());
      if (userErr || !userRes.user) throw new Error("manager.home.invalidSession");

      // attendees (⚠️ no join, because no FK on player_id -> profiles.id)
      const aRes = await checked(supabase
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId));

      if (aRes.error) throw new Error(aRes.error.message);

      const aList = (aRes.data ?? []) as AttendeeDbRow[];
      const playerIds = aList.map((r) => r.player_id);

      // profiles (second query)
      const profilesById: Record<string, ProfileLite> = {};
      if (playerIds.length > 0) {
        const pRes = await checked(supabase
          .from("profiles")
          .select("id,first_name,last_name,handicap,avatar_url")
          .in("id", playerIds));

        if (pRes.error) throw new Error(pRes.error.message);

        ((pRes.data ?? []) as ProfileLite[]).forEach((p) => {
          profilesById[p.id] = {
            id: p.id,
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            handicap: p.handicap ?? null,
            avatar_url: p.avatar_url ?? null,
          };
        });
      }

      const uiRows: AttendeeUiRow[] = aList.map((a) => ({
        ...a,
        profile: profilesById[a.player_id] ?? null,
      }));

      // sort by name (nice UX)
      uiRows.sort((x, y) =>
        nameOf(x.profile?.first_name ?? null, x.profile?.last_name ?? null).localeCompare(
          nameOf(y.profile?.first_name ?? null, y.profile?.last_name ?? null),
          managerLocaleTag(locale)
        )
      );

      setAttendees(uiRows);

      const ecRes = await checked(supabase.from("club_event_coaches").select("coach_id").eq("event_id", ev.id));
      if (ecRes.error) throw new Error(ecRes.error.message);
      const selectedCoachIds = ((ecRes.data ?? []) as Array<{ coach_id: string }>).map((r) => String(r.coach_id ?? "")).filter(Boolean);

      const clubCoachMembershipsRes = await checked(supabase
        .from("club_members")
        .select("user_id")
        .eq("club_id", ev.club_id)
        .eq("role", "coach")
        .eq("is_active", true));
      if (clubCoachMembershipsRes.error) throw new Error(clubCoachMembershipsRes.error.message);

      const coachIds = Array.from(
        new Set([
          ...((clubCoachMembershipsRes.data ?? []) as Array<{ user_id: string | null }>)
            .map((row) => String(row.user_id ?? "").trim())
            .filter(Boolean),
          ...selectedCoachIds,
        ])
      );

      let coList: CoachLite[] = [];
      if (coachIds.length > 0) {
        const coachProfilesRes = await checked(supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", coachIds));
        if (coachProfilesRes.error) throw new Error(coachProfilesRes.error.message);
        coList = ((coachProfilesRes.data ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          avatar_url: string | null;
        }>)
          .map((p) => ({
            id: String(p.id ?? ""),
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            avatar_url: p.avatar_url ?? null,
          }))
          .filter((p) => Boolean(p.id))
          .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), managerLocaleTag(locale)));
      }

      setCoaches(coList);
      setSelectedCoachIds(selectedCoachIds);

      if (ev.event_type === "training" || ev.event_type === "camp") {
        // The scoped snapshot also permits Managers who are not assigned group
        // coaches; the participant-only table policy can otherwise hide saved items.
        const snapshot = await checked(supabase.rpc("get_manager_planning_snapshot_v1", { p_event_id: ev.id }));
        if (snapshot.error) throw new Error(snapshot.error.code === "PGRST202" ? "manager.planning.migrationRequired" : snapshot.error.message);
        if (!Array.isArray(snapshot.data?.structure)) throw new Error("common.errorLoading");
        setStructureItems(snapshot.data.structure as EventStructureItemRow[]);
        if (ev.series_id) setCopySnapshot(snapshot.data as Record<string, unknown>);
      } else setStructureItems([]);
      setLoading(false);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "common.errorLoading");
      setEvent(null);
      setClubName("");
      setGroupName("");
      setAttendees([]);
      setCoaches([]);
      setSelectedCoachIds([]);
      setStructureItems([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // This counter invalidates requests when the activity changes or unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { loadVersion.current++; };
    // Locale changes preserve current activity state without fetching again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, eventId]);

  const selectedCoaches = useMemo(
    () => coaches.filter((c) => selectedCoachIds.includes(c.id)),
    [coaches, selectedCoachIds]
  );
  const candidateCoaches = useMemo(
    () => coaches.filter((c) => !selectedCoachIds.includes(c.id)),
    [coaches, selectedCoachIds]
  );

  async function replaceEventCoaches(nextCoachIds: string[]) {
    if (!event) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    if (!token) throw new Error("manager.home.invalidSession");

    const res = await fetch("/api/manager/events/coaches/bulk", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_ids: [event.id],
        coach_ids: nextCoachIds,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json?.error ?? t("manager.planning.coachesError")));
  }

  async function addCoach(coachId: string) {
    if (!event) return;
    if (coachPending.current) return;
    coachPending.current = true;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    setError(null);
    try {
      const nextIds = Array.from(new Set([...selectedCoachIds, coachId]));
      await replaceEventCoaches(nextIds);
      setSelectedCoachIds(nextIds);
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "common.errorLoading");
    } finally {
      coachPending.current = false;
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
    }
  }

  async function removeCoach(coachId: string) {
    if (!event) return;
    if (coachPending.current) return;
    coachPending.current = true;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    setError(null);
    try {
      const nextIds = selectedCoachIds.filter((id) => id !== coachId);
      await replaceEventCoaches(nextIds);
      setSelectedCoachIds(nextIds);
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "common.errorLoading");
    } finally {
      coachPending.current = false;
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
    }
  }

  async function setAttendanceStatus(playerId: string, nextStatus: "present" | "absent") {
    if (!event || attendancePending.current.has(playerId)) return;
    const previous = attendees.find(row => row.player_id === playerId)?.status ?? "expected";
    if (previous === nextStatus) return;
    attendancePending.current.add(playerId);
    setAttendanceBusyIds(values => ({ ...values, [playerId]: true }));
    setError(null);
    setAttendees(rows => rows.map(row => row.player_id === playerId ? { ...row, status: nextStatus } : row));
    try {
      const result = await supabase.from("club_event_attendees").update({ status: nextStatus }).eq("event_id", event.id).eq("player_id", playerId);
      if (result.error) throw result.error;
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.saveError");
      setAttendees(rows => rows.map(row => row.player_id === playerId ? { ...row, status: previous } : row));
    } finally {
      attendancePending.current.delete(playerId);
      setAttendanceBusyIds(values => ({ ...values, [playerId]: false }));
    }
  }

  function handleAttendanceToggle(playerId: string, status: "expected" | "present" | "absent" | "excused") {
    void setAttendanceStatus(playerId, status === "present" ? "absent" : "present");
  }

  async function copyStructureToFutureEvents() {
    if (!event?.series_id || !copySnapshot || copyPending.current) return;
    if (!structureItems.length) { setCopyError(true); setCopyStructureMessage("manager.planning.noStructureToCopy"); return; }
    if (!window.confirm(t("manager.planning.confirmCopy"))) return;
    copyPending.current = true;
    setCopyingStructure(true);
    setCopyStructureMessage(null);
    setCopyError(false);
    setCopiedCount(null);
    try {
      const result = await supabase.rpc("copy_manager_event_structure_v1", { p_event_id: event.id, p_expected: copySnapshot });
      if (result.error) {
        if (["PGRST202", "42883"].includes(result.error.code)) throw new Error("manager.planning.migrationRequired");
        throw result.error;
      }
      if (!Number.isInteger(result.data?.copied) || result.data.copied < 0) throw new Error("manager.planning.copyError");
      setCopiedCount(result.data.copied);
      // A successful copy changes the target snapshots. Reload before another copy.
      setCopySnapshot(null);
    } catch (cause) {
      setCopyError(true);
      setCopyStructureMessage(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.planning.copyError");
    } finally { copyPending.current = false; setCopyingStructure(false); }
  }

  if (loading) return <main className={`${styles.page} ${groupStyles.page} ${groupStyles.activityPage}`}><section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section></main>;

  if (!event) return <main className={`${styles.page} ${groupStyles.page} ${groupStyles.activityPage}`}><section role={error ? "alert" : undefined} className={styles.quickPanel}>{managerPlanningFeedback(t, error) ?? t("common.noData")}</section></main>;

  const date = managerPlanningDate(event.starts_at, event.ends_at, locale);
  const displayGroupName = groupName.startsWith("__EVENT_SPECIFIQUE__") ? t("manager.planning.specificGroup") : groupName || t("manager.performance.group");
  const isSpecific = groupName.startsWith("__EVENT_SPECIFIQUE__") || groupName === "Groupe spécifique" || event.title?.trim() === "Activité spécifique";
  const showEvaluation = event.requires_evaluation && (event.event_type === "training" || event.event_type === "camp");

  return (
    <main className={`${styles.page} ${groupStyles.page} ${groupStyles.activityPage}`}>
      <nav aria-label={t("manager.content.breadcrumb")} style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">{t("manager.content.groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}`}>{displayGroupName}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}/planning`}>{t("manager.groups.planning")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{managerActivityLabel(t, event.event_type)}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{managerActivityLabel(t, event.event_type)}</h1>
          <p className={styles.lead}>{displayGroupName} · {clubName}</p>
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Link className={actionStyles.backButton} href={`/manager/groups/${groupId}/planning`}><ArrowLeft size={16} />{t("coach.form.backPlanning")}</Link>
          <Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/edit`}><Pencil size={16} />{t("common.edit")}</Link>
        </div>
      </div>

      {error ? <div className={actionStyles.errorAlert} role="alert">{managerPlanningFeedback(t, error)}</div> : null}

      <article className="planning-event-card">
        <div className="planning-event-card-inner">
          <div className="planning-event-date">
            <div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.date}</div><div className="planning-event-month">{date.month}</div>
            <div className="planning-event-time-divider" /><div className="planning-event-times"><span>{date.startTime}</span>{date.endTime ? <span>{date.endTime}</span> : null}</div>
          </div>
          <div className="planning-event-content" style={{ display: "grid", gap: 14 }}>
            <div className="planning-event-title-row">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 className="planning-event-title">{managerActivityLabel(t, event.event_type)}</h2>
                <span className="pill-soft">{event.series_id ? t("coach.form.recurring") : t("coach.planning.single")}</span>
                {isSpecific ? <span className="pill-soft">{t("manager.planning.specific")}</span> : null}
                {showEvaluation ? <span className="pill-soft">{t("manager.planning.evaluation")}</span> : null}
              </div>
              <span className="pill-soft">{event.duration_minutes} {t("common.min")}</span>
            </div>
            {event.coach_note?.trim() ? <p className="manager-calendar-detail-note">{event.coach_note}</p> : null}
            <div className="planning-event-footer"><span className="planning-event-location"><MapPin size={16} /><span>{event.location_text?.trim() || t("manager.content.noLocation")}</span></span></div>
          </div>
        </div>
      </article>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{t("coach.form.coaches")}</h2><p>{t("manager.planning.coachesHelp")}</p></div></div>
        <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>
          {selectedCoaches.map((coach) => <tr key={coach.id}><td><span className="user-mgmt-member-avatar">{avatarNode(coach)}</span></td><td><b>{nameOf(coach.first_name, coach.last_name)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => removeCoach(coach.id)} disabled={Object.values(coachBusyIds).some(Boolean)} aria-label={managerGroupFormat(t, "removeNamed", { name: nameOf(coach.first_name, coach.last_name) })}><Trash2 size={16} /></button></td></tr>)}
          {selectedCoaches.length === 0 ? <tr><td colSpan={3}>{t("manager.planning.noCoaches")}</td></tr> : null}
        </tbody></table></div>
        {candidateCoaches.length ? <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.coaches.add")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{candidateCoaches.map((coach) => <tr key={coach.id}><td><span className="user-mgmt-member-avatar">{avatarNode(coach)}</span></td><td><b>{nameOf(coach.first_name, coach.last_name)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => addCoach(coach.id)} disabled={Object.values(coachBusyIds).some(Boolean)} aria-label={managerGroupFormat(t, "addNamed", { name: nameOf(coach.first_name, coach.last_name) })}><PlusCircle size={16} /></button></td></tr>)}</tbody></table></div> : null}
      </section>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{t("coach.form.players")}</h2><p>{t("manager.planning.attendeesHelp")}</p></div></div>
        <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th>{t("coachDebrief.presence")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>
          {attendees.map((attendee) => { const player = attendee.profile; const canEvaluate = showEvaluation && attendee.status === "present"; return <tr key={attendee.player_id}><td><span className="user-mgmt-member-avatar">{avatarNode(player)}</span></td><td><b>{nameOf(player?.first_name ?? null, player?.last_name ?? null)}</b></td><td data-label={t("manager.performance.attendance")}>{attendee.status === "expected" || attendee.status === "excused" ? <div style={{ display: "grid", gap: 8 }}><span>{t(attendee.status === "excused" ? "manager.planning.excused" : "manager.planning.expected")}</span><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["absent", "present"] as const).map(status => <button key={status} type="button" className={actionStyles.secondaryButton} disabled={Boolean(attendanceBusyIds[attendee.player_id])} onClick={() => void setAttendanceStatus(attendee.player_id, status)}>{t(status === "present" ? "manager.content.present" : "coachDebrief.absent")}</button>)}</div></div> : <AttendanceToggle checked={attendee.status === "present"} onToggle={() => handleAttendanceToggle(attendee.player_id, attendee.status)} disabled={Boolean(attendanceBusyIds[attendee.player_id])} ariaLabel={t("manager.planning.toggleAttendance")} leftLabel={t("coachDebrief.absent")} rightLabel={t("manager.content.present")} />}</td><td><div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}`}><ArrowRight size={16} />{t("common.view")}</Link>{showEvaluation ? <Link className={actionStyles.secondaryButton} aria-disabled={!canEvaluate} href={canEvaluate ? `/manager/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}/edit` : "#"}><Pencil size={16} />{t("coach.planning.evaluate")}</Link> : null}</div></td></tr>; })}
          {attendees.length === 0 ? <tr><td colSpan={4}>{t("manager.planning.noPlayers")}</td></tr> : null}
        </tbody></table></div>
      </section>

      {(event.event_type === "training" || event.event_type === "camp") ? <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{t("manager.planning.structure")}</h2><p>{t("manager.planning.structureHelp")}</p></div></div>
        {structureItems.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>{structureItems.map((item, index) => <li key={`${item.category}-${index}`}><b>{categoryLabel(t, item.category)}</b> — {item.minutes} {t("common.min")}{item.note ? ` · ${item.note}` : ""}</li>)}</ul> : <p style={{ margin: 0 }}>{t("manager.planning.noStructure")}</p>}
        <div className="user-mgmt-card-actions">{event.series_id ? <button type="button" className={actionStyles.secondaryButton} onClick={copyStructureToFutureEvents} disabled={copyingStructure || !structureItems.length || !copySnapshot}>{copyingStructure ? t("manager.planning.copying") : t("manager.planning.copyFuture")}</button> : null}<Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/edit`}><Pencil size={16} />{t("common.edit")}</Link></div>
        {copiedCount !== null ? <div className={actionStyles.successAlert} role="status">{copiedCount === 0 ? t("manager.planning.noFuture") : copiedCount === 1 ? t("manager.planning.copyOne") : managerPlanningFormat(t, "copyMany", { count: copiedCount.toLocaleString(managerLocaleTag(locale)) })}</div> : null}
        {copyStructureMessage ? <div role={copyError ? "alert" : "status"} className={copyError ? actionStyles.errorAlert : actionStyles.successAlert}>{managerPlanningFeedback(t, copyStructureMessage)}</div> : null}
      </section> : null}
    </main>
  );
}
