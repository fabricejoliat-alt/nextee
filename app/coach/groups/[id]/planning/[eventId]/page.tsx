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
import { ArrowRight, Pencil, PlusCircle, Trash2, ArrowLeft, MapPin, Check } from "lucide-react";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};
type CampDayRow = {
  camp_id: string;
  day_index: number;
  starts_at: string | null;
  ends_at: string | null;
  location_text: string | null;
};
function eventTypeLabel(v: string | null | undefined) {
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclub";
  if (v === "camp") return "Stage/Camp";
  if (v === "session") return "Séance";
  return "Événement";
}
function eventTypeLabelLocalized(v: string | null | undefined, locale: string) {
  if (v === "training") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Entraînement", "Training");
  if (v === "interclub") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Interclub", "Interclub");
  if (v === "camp") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Stage/Camp", "Camp");
  if (v === "session") return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Séance", "Session");
  return pickLocaleText(locale as "fr" | "en" | "de" | "it", "Événement", "Event");
}

type ClubRow = { id: string; name: string | null };
type GroupRow = { id: string; name: string | null };
type CoachLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
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
type PlayerEvaluationSummary = {
  player_id: string;
  coach_id: string | null;
  coach_name: string | null;
};
type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};

type ThreadMessageRow = {
  id: string;
  sender_user_id: string;
  sender_name: string | null;
  body: string | null;
  created_at: string;
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(d);
  const datePart = new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${datePart} à ${timePart}`;
}

function fmtDateTimeRange(startIso: string, endIso: string | null) {
  if (!endIso) return fmtDateTime(startIso);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(start);
    const datePart = new Intl.DateTimeFormat("fr-CH", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(start);
    const timeFmt = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${datePart} de ${timeFmt.format(start)} à ${timeFmt.format(end)}`;
  }
  return `${fmtDateTime(startIso)} au ${fmtDateTime(endIso)}`;
}

function eventDateSummary(startIso: string, endIso: string | null) {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  const time = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
  return {
    day: capitalize(new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(start)),
    date: start.getDate(),
    month: capitalize(new Intl.DateTimeFormat("fr-CH", { month: "long" }).format(start)),
    startTime: time.format(start),
    endTime: end ? time.format(end) : null,
  };
}

function fmtMessageTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

async function markThreadRead(threadId: string) {
  const { data: sessRes } = await supabase.auth.getSession();
  const token = sessRes.session?.access_token ?? "";
  if (!token || !threadId) return;
  await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function shortNameForList(first: string | null, last: string | null, maxChars = 16) {
  const full = nameOf(first, last);
  if (full.length <= maxChars) return full;
  const f = String(first ?? "").trim();
  const l = String(last ?? "").trim();
  if (f) {
    if (l) return `${f} ${l[0].toUpperCase()}.`;
    return f;
  }
  return full;
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
  const [campDay, setCampDay] = useState<CampDayRow | null>(null);
  const [clubName, setClubName] = useState("");
  const [groupName, setGroupName] = useState("");

  const [attendees, setAttendees] = useState<AttendeeUiRow[]>([]);
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);
  const [structureItems, setStructureItems] = useState<EventStructureItemRow[]>([]);
  const [meId, setMeId] = useState("");
  const [eventThreadId, setEventThreadId] = useState<string>("");
  const [eventThreadMessages, setEventThreadMessages] = useState<ThreadMessageRow[]>([]);
  const [eventThreadParticipants, setEventThreadParticipants] = useState<string[]>([]);
  const [loadingEventThread, setLoadingEventThread] = useState(false);
  const [threadComposer, setThreadComposer] = useState("");
  const [sendingThreadMessage, setSendingThreadMessage] = useState(false);
  const [coachBusyIds, setCoachBusyIds] = useState<Record<string, boolean>>({});
  const [attendanceBusyIds, setAttendanceBusyIds] = useState<Record<string, boolean>>({});
  const [evaluatedPlayersById, setEvaluatedPlayersById] = useState<Map<string, PlayerEvaluationSummary>>(new Map());
  const [copyingStructure, setCopyingStructure] = useState(false);
  const [copyStructureMessage, setCopyStructureMessage] = useState<string | null>(null);

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

      const futureEventIds = ((futureEventsRes.data ?? []) as Array<{ id: string | null }>)
        .map((row) => String(row.id ?? "").trim())
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
    } catch (error: unknown) {
      setCopyStructureMessage(error instanceof Error ? error.message : tr("Copie impossible.", "Copy failed."));
    } finally {
      setCopyingStructure(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId) throw new Error("Événement manquant.");
      const { data: sessRes } = await supabase.auth.getSession();
      const token = sessRes.session?.access_token ?? "";
      if (!token) throw new Error("Session invalide.");

      const detailRes = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const detailJson = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) throw new Error(String(detailJson?.error ?? "Événement introuvable."));

      const ev = detailJson?.event as EventRow | undefined;
      if (!ev?.id) throw new Error("Événement introuvable.");

      setEvent(ev);
      setCampDay((detailJson?.campDay ?? null) as CampDayRow | null);
      setClubName(String(detailJson?.clubName ?? "Club"));
      setGroupName(String(detailJson?.groupName ?? "Groupe"));
      setMeId(String(detailJson?.meId ?? ""));
      setAttendees(Array.isArray(detailJson?.attendees) ? (detailJson.attendees as AttendeeUiRow[]) : []);
      setCoaches(Array.isArray(detailJson?.coaches) ? (detailJson.coaches as CoachLite[]) : []);
      setSelectedCoachIds(
        Array.isArray(detailJson?.selectedCoachIds)
          ? (detailJson.selectedCoachIds as string[]).map((id) => String(id ?? "")).filter(Boolean)
          : []
      );
      setStructureItems(Array.isArray(detailJson?.structureItems) ? (detailJson.structureItems as EventStructureItemRow[]) : []);
      setEvaluatedPlayersById(
        new Map(
          (
            Array.isArray(detailJson?.evaluatedPlayers)
              ? (detailJson.evaluatedPlayers as PlayerEvaluationSummary[])
              : []
          )
            .map((row) => ({
              player_id: String(row?.player_id ?? "").trim(),
              coach_id: String(row?.coach_id ?? "").trim() || null,
              coach_name: String(row?.coach_name ?? "").trim() || null,
            }))
            .filter((row) => row.player_id)
            .map((row) => [row.player_id, row] as const)
        )
      );

      // Thread preview
      setLoadingEventThread(true);
      try {
        if (!token) {
          setEventThreadId("");
          setEventThreadMessages([]);
          setEventThreadParticipants([]);
        } else {
          const threadRes = await fetch(`/api/messages/event-thread?event_id=${encodeURIComponent(ev.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const threadJson = await threadRes.json().catch(() => ({}));
          if (!threadRes.ok) throw new Error(String(threadJson?.error ?? "Thread load failed"));
          const threadId = String(threadJson?.thread_id ?? "");
          setEventThreadId(threadId);
          if (threadId) {
            const [msgRes, partRes] = await Promise.all([
              fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/messages?limit=20`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              }),
              fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/participants`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              }),
            ]);
            const msgJson = await msgRes.json().catch(() => ({}));
            const partJson = await partRes.json().catch(() => ({}));
            if (!msgRes.ok) throw new Error(String(msgJson?.error ?? "Messages load failed"));
            if (!partRes.ok) throw new Error(String(partJson?.error ?? "Participants load failed"));
            const msgs = ((msgJson?.messages ?? []) as ThreadMessageRow[]).slice().reverse();
            setEventThreadMessages(msgs);
            setEventThreadParticipants((partJson?.participant_full_names ?? []) as string[]);
            await markThreadRead(threadId);
          } else {
            setEventThreadMessages([]);
            setEventThreadParticipants([]);
          }
        }
      } catch {
        setEventThreadId("");
        setEventThreadMessages([]);
        setEventThreadParticipants([]);
      } finally {
        setLoadingEventThread(false);
      }

      setLoading(false);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t("common.errorLoading"));
      setEvent(null);
      setCampDay(null);
      setClubName("");
      setGroupName("");
      setAttendees([]);
      setCoaches([]);
      setSelectedCoachIds([]);
      setStructureItems([]);
      setEvaluatedPlayersById(new Map());
      setMeId("");
      setEventThreadId("");
      setEventThreadMessages([]);
      setEventThreadParticipants([]);
      setLoadingEventThread(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!eventThreadId) return;
    void markThreadRead(eventThreadId);
  }, [eventThreadId, eventThreadMessages.length]);

  const selectedCoaches = useMemo(
    () => coaches.filter((c) => selectedCoachIds.includes(c.id)),
    [coaches, selectedCoachIds]
  );
  const candidateCoaches = useMemo(
    () => coaches.filter((c) => !selectedCoachIds.includes(c.id)),
    [coaches, selectedCoachIds]
  );
  const eventCardTitle = useMemo(() => {
    if (!event) return pickLocaleText(locale, "Événement", "Event");
    if (event.event_type === "camp") {
      const campTitle = String(event.title ?? "").trim() || eventTypeLabelLocalized(event.event_type, locale);
      const dayLabel =
        campDay && Number.isFinite(campDay.day_index)
          ? `${pickLocaleText(locale, "Jour", "Day")} ${campDay.day_index + 1}`
          : null;
      return dayLabel ? `${campTitle} • ${dayLabel}` : campTitle;
    }
    return `${eventTypeLabelLocalized(event.event_type, locale)} — ${groupName || pickLocaleText(locale, "Groupe", "Group")}`;
  }, [campDay, event, groupName, locale]);

  async function addCoach(coachId: string) {
    if (!event) return;
    if (coachBusyIds[coachId]) return;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    const ins = await supabase.from("club_event_coaches").insert({ event_id: event.id, coach_id: coachId });
    if (ins.error) {
      setError(ins.error.message);
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
      return;
    }
    setSelectedCoachIds((prev) => Array.from(new Set([...prev, coachId])));
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
  }

  async function removeCoach(coachId: string) {
    if (!event) return;
    if (coachBusyIds[coachId]) return;
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: true }));
    const del = await supabase
      .from("club_event_coaches")
      .delete()
      .eq("event_id", event.id)
      .eq("coach_id", coachId);
    if (del.error) {
      setError(del.error.message);
      setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
      return;
    }
    setSelectedCoachIds((prev) => prev.filter((id) => id !== coachId));
    setCoachBusyIds((prev) => ({ ...prev, [coachId]: false }));
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
    const ok = window.confirm(
      tr(
        next === "absent" ? "Confirmer le passage à absent ?" : "Confirmer le passage à présent ?",
        next === "absent" ? "Confirm switch to absent?" : "Confirm switch to present?"
      )
    );
    if (!ok) return;
    void setAttendanceStatus(playerId, next);
  }

  async function sendThreadMessage() {
    const trimmed = threadComposer.trim();
    if (!eventThreadId || !trimmed || sendingThreadMessage) return;
    setSendingThreadMessage(true);
    try {
      const { data: sessRes } = await supabase.auth.getSession();
      const token = sessRes.session?.access_token ?? "";
      if (!token) throw new Error(tr("Session invalide.", "Invalid session."));

      const res = await fetch(`/api/messages/threads/${encodeURIComponent(eventThreadId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message_type: "text", body: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? tr("Envoi impossible.", "Failed to send message.")));

      const created = json?.message as ThreadMessageRow | undefined;
      if (created?.id) {
        setEventThreadMessages((prev) => [...prev, created].slice(-20));
      }
      setThreadComposer("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : tr("Envoi impossible.", "Failed to send message.");
      setError(message);
    } finally {
      setSendingThreadMessage(false);
    }
  }

  if (loading) {
    return <main className={styles.page}><section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section></main>;
  }

  if (!event) {
    return <main className={styles.page}><section className={styles.quickPanel}>{error ?? t("common.noData")}</section></main>;
  }

  const date = eventDateSummary(event.starts_at, event.ends_at);
  const isEventPast = new Date(event.starts_at).getTime() < Date.now();
  const isSpecific = groupName === "Groupe spécifique" || event.title?.trim() === "Activité spécifique";

  return (
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/coach/groups">{tr("Mes groupes", "My groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/coach/groups/${groupId}`}>{groupName}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/coach/groups/${groupId}/planning`}>{tr("Planification", "Planning")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{eventTypeLabelLocalized(event.event_type, locale)}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{eventTypeLabelLocalized(event.event_type, locale)}</h1>
          <p className={styles.lead}>{groupName} · {clubName}</p>
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <Link className={actionStyles.backButton} href={`/coach/groups/${groupId}/planning`}>
            <ArrowLeft size={16} aria-hidden="true" />
            {tr("Retour à la planification", "Back to planning")}
          </Link>
          <Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/edit`}>
            <Pencil size={16} aria-hidden="true" />
            {t("common.edit")}
          </Link>
        </div>
      </div>

      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}

      <article className="planning-event-card">
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
          <div className="planning-event-content" style={{ display: "grid", gap: 14 }}>
            <div className="planning-event-title-row">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 className="planning-event-title">{eventCardTitle}</h2>
                <span className="pill-soft">{event.series_id ? tr("Récurrent", "Recurring") : tr("Unique", "Single")}</span>
                {isSpecific ? <span className="pill-soft">{tr("Activité spécifique", "Specific activity")}</span> : null}
                {event.status === "cancelled" ? <span className="pill-soft">{tr("Annulée", "Cancelled")}</span> : null}
              </div>
              <span className="pill-soft">{event.duration_minutes} {t("common.min")}</span>
            </div>
            {event.coach_note?.trim() ? <p className="manager-calendar-detail-note">{event.coach_note}</p> : null}
            <div className="planning-event-footer">
              <span className="planning-event-location"><MapPin size={16} aria-hidden="true" /><span>{event.location_text?.trim() || tr("Lieu non disponible", "Location unavailable")}</span></span>
            </div>
          </div>
        </div>
      </article>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}>
          <div><h2>{tr("Coachs attendus", "Expected coaches")}</h2><p>{tr("Coachs affectés à cette activité.", "Coaches assigned to this activity.")}</p></div>
        </div>
        <div className="user-mgmt-table-wrap">
          <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
            <thead><tr><th>{tr("Nom et prénom", "Name")}</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {selectedCoaches.map((coach) => (
                <tr key={coach.id}>
                  <td><b>{nameOf(coach.first_name, coach.last_name)}</b></td>
                  <td><button type="button" className={actionStyles.secondaryButton} onClick={() => removeCoach(coach.id)} disabled={Boolean(coachBusyIds[coach.id])} aria-label={tr("Retirer le coach", "Remove coach")} title={tr("Retirer le coach", "Remove coach")}><Trash2 size={16} aria-hidden="true" /></button></td>
                </tr>
              ))}
              {selectedCoaches.length === 0 ? <tr><td colSpan={2}>{tr("Aucun coach assigné.", "No coach assigned.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
        {candidateCoaches.length ? (
          <div className="user-mgmt-table-wrap">
            <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
              <thead><tr><th>{tr("Ajouter un coach", "Add coach")}</th><th aria-label="Actions" /></tr></thead>
              <tbody>{candidateCoaches.map((coach) => <tr key={coach.id}><td><b>{nameOf(coach.first_name, coach.last_name)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => addCoach(coach.id)} disabled={Boolean(coachBusyIds[coach.id])} aria-label={tr("Ajouter le coach", "Add coach")} title={tr("Ajouter le coach", "Add coach")}><PlusCircle size={16} aria-hidden="true" /></button></td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}>
          <div><h2>{tr("Joueurs attendus", "Expected players")}</h2><p>{tr("Présence et évaluation des juniors de l’activité.", "Attendance and evaluation for the activity's juniors.")}</p></div>
        </div>
        <div className="user-mgmt-table-wrap">
          <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
            <thead><tr><th aria-label="Avatar" /><th>{tr("Nom et prénom", "Name")}</th><th>{tr("Handicap", "Handicap")}</th><th>{tr("Présence", "Attendance")}</th><th>{tr("Évaluation", "Evaluation")}</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {attendees.map((attendee) => {
                const player = attendee.profile ?? null;
                const evaluation = evaluatedPlayersById.get(attendee.player_id) ?? null;
                const canOpenPlayerDetail = event.event_type === "training" || event.event_type === "camp" || event.event_type === "interclub";
                const canEvaluate = (event.event_type === "training" || event.event_type === "interclub") && attendee.status !== "absent" && isEventPast;
                const canStructure = (event.event_type === "training" || event.event_type === "camp") && !isEventPast;
                return (
                  <tr key={attendee.player_id}>
                    <td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(player)}</span></td>
                    <td><b>{nameOf(player?.first_name ?? null, player?.last_name ?? null)}</b></td>
                    <td>{typeof player?.handicap === "number" ? Number(player.handicap).toFixed(1) : "—"}</td>
                    <td><AttendanceToggle checked={attendee.status === "present"} onToggle={() => handleAttendanceToggle(attendee.player_id, attendee.status)} disabled={Boolean(attendanceBusyIds[attendee.player_id])} ariaLabel={tr("Basculer présence", "Toggle attendance")} leftLabel={tr("Absent", "Absent")} rightLabel={tr("Présent", "Present")} /></td>
                    <td>{evaluation ? <span className="pill-soft" title={evaluation.coach_name ? tr(`Évalué par ${evaluation.coach_name}`, `Evaluated by ${evaluation.coach_name}`) : undefined}><Check size={14} aria-hidden="true" /> {tr("Terminée", "Completed")}</span> : <span className="pill-soft">{isEventPast ? tr("À évaluer", "To evaluate") : tr("À venir", "Upcoming")}</span>}</td>
                    <td>
                      <div className="user-mgmt-card-actions">
                        {canOpenPlayerDetail ? <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}`}><ArrowRight size={16} aria-hidden="true" />{tr("Voir", "View")}</Link> : null}
                        {canEvaluate ? <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}/edit`}><Pencil size={16} aria-hidden="true" />{evaluation ? tr("Modifier l’évaluation", "Edit evaluation") : tr("Évaluer", "Evaluate")}</Link> : null}
                        {canStructure ? <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/players/${attendee.player_id}/structure`}><Pencil size={16} aria-hidden="true" />{tr("Structurer", "Structure")}</Link> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {attendees.length === 0 ? <tr><td colSpan={6}>{tr("Aucun joueur.", "No player.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {event.event_type === "training" || event.event_type === "camp" ? (
        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>{tr("Structure de l’activité", "Activity structure")}</h2><p>{tr("Déroulement prévu pour cette activité.", "Planned structure for this activity.")}</p></div></div>
          {structureItems.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>{structureItems.map((item, index) => <li key={`${item.category}-${index}`}><b>{categoryLabel(item.category)}</b> — {item.minutes} min{item.note ? ` · ${item.note}` : ""}</li>)}</ul> : <p style={{ margin: 0 }}>{tr("Aucune structure planifiée.", "No planned structure.")}</p>}
          <div className="user-mgmt-card-actions">
            {event.series_id ? <button type="button" className={actionStyles.secondaryButton} onClick={copyStructureToFutureEvents} disabled={copyingStructure || !structureItems.length}>{copyingStructure ? tr("Copie…", "Copying…") : tr("Copier sur les activités futures", "Copy to future activities")}</button> : null}
            <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/edit`}><Pencil size={16} aria-hidden="true" />{t("common.edit")}</Link>
          </div>
          {copyStructureMessage ? <div className={actionStyles.successAlert}>{copyStructureMessage}</div> : null}
        </section>
      ) : null}
    </main>
  );
}
