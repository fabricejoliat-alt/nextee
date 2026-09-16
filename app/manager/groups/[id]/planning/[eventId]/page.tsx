"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import { Users, ArrowRight, Pencil, PlusCircle, Trash2, ArrowLeft, MapPin } from "lucide-react";

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
function eventTypeLabel(v: string | null | undefined) {
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclub";
  if (v === "camp") return "Stage";
  if (v === "session") return "Séance";
  return "Événement";
}
function eventTypeLabelLocalized(v: string | null | undefined, locale: string) {
  if (v === "training") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Entraînement", "Training");
  if (v === "interclub") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Interclub", "Interclub");
  if (v === "camp") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Stage", "Camp");
  if (v === "session") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Séance", "Session");
  return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Événement", "Event");
}

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

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTimeRange(startIso: string, endIso: string | null) {
  if (!endIso) return fmtDateTime(startIso);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const datePart = new Intl.DateTimeFormat("fr-CH", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(start);
    const timeFmt = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
    return `${datePart} • ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  }
  return `${fmtDateTime(startIso)} → ${fmtDateTime(endIso)}`;
}

function eventDateSummary(startIso: string, endIso: string | null) {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const day = new Intl.DateTimeFormat("fr-CH", { weekday: "short" }).format(start).replace(".", "");
  const date = new Intl.DateTimeFormat("fr-CH", { day: "2-digit" }).format(start);
  const month = new Intl.DateTimeFormat("fr-CH", { month: "short" }).format(start).replace(".", "");
  const time = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
  return { day, date, month, startTime: time.format(start), endTime: end ? time.format(end) : null };
}

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    warmup_mobility: "Échauffement / mobilité",
    long_game: "Long jeu",
    short_game_all: "Petit jeu (tout secteur)",
    putting: "Putting",
    wedging: "Wedging",
    pitching: "Pitching",
    chipping: "Chipping",
    bunker: "Bunker",
    course: "Parcours",
    mental: "Mental",
    fitness: "Fitness",
    other: "Autre",
  };
  return map[cat] ?? cat;
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function avatarNode(p?: ProfileLite | null) {
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

const avatarBoxStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(255,255,255,0.65)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};

export default function CoachEventDetailPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
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
  const [copyingStructure, setCopyingStructure] = useState(false);
  const [copyStructureMessage, setCopyStructureMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId) throw new Error("Événement manquant.");

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,requires_evaluation")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Événement introuvable.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", ev.club_id).maybeSingle();
      setClubName(!cRes.error && cRes.data ? (cRes.data as ClubRow).name ?? "Club" : "Club");

      // group name
      const gRes = await supabase.from("coach_groups").select("id,name").eq("id", ev.group_id).maybeSingle();
      const resolvedGroupName = !gRes.error && gRes.data ? (gRes.data as GroupRow).name ?? "Groupe" : "Groupe";
      setGroupName(resolvedGroupName.startsWith("__EVENT_SPECIFIQUE__") ? "Groupe spécifique" : resolvedGroupName);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Session invalide.");

      // attendees (⚠️ no join, because no FK on player_id -> profiles.id)
      const aRes = await supabase
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId);

      if (aRes.error) throw new Error(aRes.error.message);

      const aList = (aRes.data ?? []) as AttendeeDbRow[];
      const playerIds = aList.map((r) => r.player_id);

      // profiles (second query)
      let profilesById: Record<string, ProfileLite> = {};
      if (playerIds.length > 0) {
        const pRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,handicap,avatar_url")
          .in("id", playerIds);

        if (pRes.error) throw new Error(pRes.error.message);

        (pRes.data ?? []).forEach((p: any) => {
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
          "fr"
        )
      );

      setAttendees(uiRows);

      const ecRes = await supabase.from("club_event_coaches").select("coach_id").eq("event_id", ev.id);
      if (ecRes.error) throw new Error(ecRes.error.message);
      const selectedCoachIds = (ecRes.data ?? []).map((r: any) => String(r.coach_id ?? "")).filter(Boolean);

      const clubCoachMembershipsRes = await supabase
        .from("club_members")
        .select("user_id")
        .eq("club_id", ev.club_id)
        .eq("role", "coach")
        .eq("is_active", true);
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
        const coachProfilesRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", coachIds);
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
          .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), "fr"));
      }

      setCoaches(coList);
      setSelectedCoachIds(selectedCoachIds);

      const structRes = await supabase
        .from("club_event_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", ev.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (structRes.error) throw new Error(structRes.error.message);
      setStructureItems((structRes.data ?? []) as EventStructureItemRow[]);

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

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
    if (!token) throw new Error("Session invalide.");

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
    if (!res.ok) throw new Error(String(json?.error ?? "Impossible de mettre à jour les coachs."));
  }

  async function addCoach(coachId: string) {
    if (!event) return;
    if (coachBusyIds[coachId]) return;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    try {
      const nextIds = Array.from(new Set([...selectedCoachIds, coachId]));
      await replaceEventCoaches(nextIds);
      setSelectedCoachIds(nextIds);
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
    } finally {
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
    }
  }

  async function removeCoach(coachId: string) {
    if (!event) return;
    if (coachBusyIds[coachId]) return;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    try {
      const nextIds = selectedCoachIds.filter((id) => id !== coachId);
      await replaceEventCoaches(nextIds);
      setSelectedCoachIds(nextIds);
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
    } finally {
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
    }
  }

  async function setAttendanceStatus(playerId: string, nextStatus: "present" | "absent") {
    if (!event || attendanceBusyIds[playerId]) return;
    const prev = attendees.find((a) => a.player_id === playerId)?.status ?? "expected";
    if (prev === nextStatus) return;

    setAttendanceBusyIds((m) => ({ ...m, [playerId]: true }));
    setAttendees((list) => list.map((a) => (a.player_id === playerId ? { ...a, status: nextStatus } : a)));

    const up = await supabase
      .from("club_event_attendees")
      .update({ status: nextStatus })
      .eq("event_id", event.id)
      .eq("player_id", playerId);

    if (up.error) {
      setError(up.error.message);
      setAttendees((list) => list.map((a) => (a.player_id === playerId ? { ...a, status: prev } : a)));
    }

    setAttendanceBusyIds((m) => ({ ...m, [playerId]: false }));
  }

  function handleAttendanceToggle(playerId: string, status: "expected" | "present" | "absent" | "excused") {
    const current: "present" | "absent" = status === "absent" ? "absent" : "present";
    const next: "present" | "absent" = current === "present" ? "absent" : "present";
    setAttendanceStatus(playerId, next);
  }

  async function copyStructureToFutureEvents() {
    if (!event?.series_id) return;
    if (structureItems.length === 0) {
      setCopyStructureMessage(tr("Aucune structure à copier.", "No structure to copy."));
      return;
    }

    const confirmed = window.confirm(
      tr(
        "Copier cette structure planifiée sur toutes les activités futures de cette récurrence ? Les structures déjà présentes sur ces activités seront remplacées.",
        "Copy this planned structure to all future events in this recurrence? Existing planned structures on those events will be replaced."
      )
    );
    if (!confirmed) return;

    setCopyingStructure(true);
    setCopyStructureMessage(null);
    try {
      const futureEventsRes = await supabase
        .from("club_events")
        .select("id")
        .eq("series_id", event.series_id)
        .gt("starts_at", event.starts_at)
        .order("starts_at", { ascending: true });
      if (futureEventsRes.error) throw new Error(futureEventsRes.error.message);

      const futureEventIds = (futureEventsRes.data ?? [])
        .map((row: any) => String(row?.id ?? "").trim())
        .filter(Boolean);

      if (futureEventIds.length === 0) {
        setCopyStructureMessage(tr("Aucune activité future à mettre à jour.", "No future event to update."));
        return;
      }

      const deleteRes = await supabase.from("club_event_structure_items").delete().in("event_id", futureEventIds);
      if (deleteRes.error) throw new Error(deleteRes.error.message);

      const payload = futureEventIds.flatMap((futureEventId) =>
        structureItems.map((item, index) => ({
          event_id: futureEventId,
          category: item.category,
          minutes: item.minutes,
          note: item.note ?? null,
          position: item.position ?? index,
        }))
      );

      if (payload.length > 0) {
        const insertRes = await supabase.from("club_event_structure_items").insert(payload);
        if (insertRes.error) throw new Error(insertRes.error.message);
      }

      setCopyStructureMessage(
        futureEventIds.length === 1
          ? tr("Structure copiée sur 1 activité future.", "Structure copied to 1 future event.")
          : tr(
              `Structure copiée sur ${futureEventIds.length} activités futures.`,
              `Structure copied to ${futureEventIds.length} future events.`
            )
      );
    } catch (e: any) {
      setCopyStructureMessage(String(e?.message ?? tr("Copie impossible.", "Copy failed.")));
    } finally {
      setCopyingStructure(false);
    }
  }

  if (loading) return <main className={styles.page}><section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section></main>;

  if (!event) return <main className={styles.page}><section className={styles.quickPanel}>{error ?? t("common.noData")}</section></main>;

  const date = eventDateSummary(event.starts_at, event.ends_at);
  const isSpecific = groupName === "Groupe spécifique" || event.title?.trim() === "Activité spécifique";
  const showEvaluation = event.requires_evaluation && (event.event_type === "training" || event.event_type === "camp");

  return (
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">{tr("Groupes", "Groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}`}>{groupName}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}/planning`}>{tr("Planification", "Planning")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{eventTypeLabelLocalized(event.event_type, locale)}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{eventTypeLabelLocalized(event.event_type, locale)}</h1>
          <p className={styles.lead}>{groupName} · {clubName}</p>
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Link className={actionStyles.backButton} href={`/manager/groups/${groupId}/planning`}><ArrowLeft size={16} />{tr("Retour à la planification", "Back to planning")}</Link>
          <Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/edit`}><Pencil size={16} />{t("common.edit")}</Link>
        </div>
      </div>

      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}

      <article className="planning-event-card">
        <div className="planning-event-card-inner">
          <div className="planning-event-date">
            <div className="planning-event-day">{date.day}</div><div className="planning-event-number">{date.date}</div><div className="planning-event-month">{date.month}</div>
            <div className="planning-event-time-divider" /><div className="planning-event-times"><span>{date.startTime}</span>{date.endTime ? <span>{date.endTime}</span> : null}</div>
          </div>
          <div className="planning-event-content" style={{ display: "grid", gap: 14 }}>
            <div className="planning-event-title-row">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 className="planning-event-title">{eventTypeLabelLocalized(event.event_type, locale)}</h2>
                <span className="pill-soft">{event.series_id ? tr("Récurrent", "Recurring") : tr("Unique", "Single")}</span>
                {isSpecific ? <span className="pill-soft">{tr("Activité spécifique", "Specific activity")}</span> : null}
                {showEvaluation ? <span className="pill-soft">{tr("Évaluation", "Evaluation")}</span> : null}
              </div>
              <span className="pill-soft">{event.duration_minutes} {t("common.min")}</span>
            </div>
            {event.coach_note?.trim() ? <p className="manager-calendar-detail-note">{event.coach_note}</p> : null}
            <div className="planning-event-footer"><span className="planning-event-location"><MapPin size={16} /><span>{event.location_text?.trim() || tr("Lieu non disponible", "Location unavailable")}</span></span></div>
          </div>
        </div>
      </article>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{tr("Coachs attendus", "Expected coaches")}</h2><p>{tr("Coachs affectés à cette activité.", "Coaches assigned to this activity.")}</p></div></div>
        <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>{tr("Nom et prénom", "Name")}</th><th aria-label="Actions" /></tr></thead><tbody>
          {selectedCoaches.map((coach) => <tr key={coach.id}><td><span className="user-mgmt-member-avatar">{avatarNode(coach as any)}</span></td><td><b>{nameOf(coach.first_name, coach.last_name)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => removeCoach(coach.id)} disabled={Boolean(coachBusyIds[coach.id])} aria-label={tr("Retirer le coach", "Remove coach")}><Trash2 size={16} /></button></td></tr>)}
          {selectedCoaches.length === 0 ? <tr><td colSpan={3}>{tr("Aucun coach assigné.", "No coach assigned.")}</td></tr> : null}
        </tbody></table></div>
        {candidateCoaches.length ? <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>{tr("Ajouter un coach", "Add coach")}</th><th aria-label="Actions" /></tr></thead><tbody>{candidateCoaches.map((coach) => <tr key={coach.id}><td><span className="user-mgmt-member-avatar">{avatarNode(coach as any)}</span></td><td><b>{nameOf(coach.first_name, coach.last_name)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => addCoach(coach.id)} disabled={Boolean(coachBusyIds[coach.id])} aria-label={tr("Ajouter le coach", "Add coach")}><PlusCircle size={16} /></button></td></tr>)}</tbody></table></div> : null}
      </section>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{tr("Joueurs attendus", "Expected players")}</h2><p>{tr("Présence et évaluation des juniors de l’activité.", "Attendance and evaluation for the activity's juniors.")}</p></div></div>
        <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>{tr("Nom et prénom", "Name")}</th><th>{tr("Présence", "Attendance")}</th><th aria-label="Actions" /></tr></thead><tbody>
          {attendees.map((attendee) => { const player = attendee.profile; const canEvaluate = showEvaluation && attendee.status !== "absent"; return <tr key={attendee.player_id}><td><span className="user-mgmt-member-avatar">{avatarNode(player)}</span></td><td><b>{nameOf(player?.first_name ?? null, player?.last_name ?? null)}</b></td><td><AttendanceToggle checked={attendee.status === "present"} onToggle={() => handleAttendanceToggle(attendee.player_id, attendee.status)} disabled={Boolean(attendanceBusyIds[attendee.player_id])} ariaLabel={tr("Basculer présence", "Toggle attendance")} leftLabel={tr("Absent", "Absent")} rightLabel={tr("Présent", "Present")} /></td><td><div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}`}><ArrowRight size={16} />{tr("Voir", "View")}</Link>{showEvaluation ? <Link className={actionStyles.secondaryButton} aria-disabled={!canEvaluate} href={canEvaluate ? `/manager/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}/edit` : "#"}><Pencil size={16} />{tr("Évaluer", "Evaluate")}</Link> : null}</div></td></tr>; })}
          {attendees.length === 0 ? <tr><td colSpan={4}>{tr("Aucun joueur.", "No player.")}</td></tr> : null}
        </tbody></table></div>
      </section>

      {(event.event_type === "training" || event.event_type === "camp") ? <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{tr("Structure de l’activité", "Activity structure")}</h2><p>{tr("Déroulement prévu pour cette activité.", "Planned structure for this activity.")}</p></div></div>
        {structureItems.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>{structureItems.map((item, index) => <li key={`${item.category}-${index}`}><b>{categoryLabel(item.category)}</b> — {item.minutes} min{item.note ? ` · ${item.note}` : ""}</li>)}</ul> : <p style={{ margin: 0 }}>{tr("Aucune structure planifiée.", "No planned structure.")}</p>}
        <div className="user-mgmt-card-actions">{event.series_id ? <button type="button" className={actionStyles.secondaryButton} onClick={copyStructureToFutureEvents} disabled={copyingStructure || !structureItems.length}>{copyingStructure ? tr("Copie…", "Copying…") : tr("Copier sur les activités futures", "Copy to future activities")}</button> : null}<Link className={actionStyles.secondaryButton} href={`/manager/groups/${groupId}/planning/${eventId}/edit`}><Pencil size={16} />{t("common.edit")}</Link></div>
        {copyStructureMessage ? <div className={actionStyles.successAlert}>{copyStructureMessage}</div> : null}
      </section> : null}
    </main>
  );
}
