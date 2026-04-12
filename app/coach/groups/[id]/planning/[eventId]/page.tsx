"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { Users, ArrowRight, Pencil, PlusCircle, Trash2, MessageCircle, Send, Check } from "lucide-react";

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
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
      setEvent(null);
      setCampDay(null);
      setClubName("");
      setGroupName("");
      setAttendees([]);
      setCoaches([]);
      setSelectedCoachIds([]);
      setStructureItems([]);
      setEvaluatedPlayerIds(new Set());
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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {event ? eventCardTitle : tr("Événement", "Event")}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning`}>
                {tr("Planification", "Planning")}
              </Link>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}/edit`}>
                {t("common.edit")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : !event ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {eventCardTitle}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="pill-soft">{clubName || t("common.club")}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div className="marketplace-item-title" style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 980 }}>
                      {fmtDateTimeRange(event.starts_at, event.ends_at)}
                    </div>
                    <div className="marketplace-price-pill">{event.duration_minutes} {t("common.min")}</div>
                  </div>
                  {event.location_text ? (
                    <div style={{ color: "rgba(0,0,0,0.68)", fontWeight: 800, fontSize: 12 }}>
                      📍 {event.location_text}
                    </div>
                  ) : null}

                  {event.coach_note?.trim() ? (
                    <div
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.72)",
                        padding: 12,
                        fontSize: 13,
                        fontWeight: 750,
                        color: "rgba(0,0,0,0.84)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {event.coach_note}
                    </div>
                  ) : null}
                </div>

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <MessageCircle size={16} />
                    Fil de discussion
                  </div>
                  {loadingEventThread ? (
                    <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                      <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,0,0,0.72)", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                        Participants: {eventThreadParticipants.length > 0 ? eventThreadParticipants.join(", ") : "—"}
                      </div>
                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.94)",
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        {eventThreadMessages.length === 0 ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun message.</div>
                        ) : (
                          <div
                            style={{
                              overflow: "auto",
                              maxHeight: 320,
                              display: "grid",
                              gap: 8,
                              paddingTop: 2,
                              paddingRight: 8,
                              alignContent: "start",
                            }}
                          >
                            {eventThreadMessages.map((m) => {
                              const mine = String(m.sender_user_id ?? "") === meId;
                              return (
                              <div
                                key={m.id}
                                style={{
                                  justifySelf: mine ? "end" : "start",
                                  maxWidth: "82%",
                                  borderRadius: 12,
                                  padding: "8px 10px",
                                  background: mine ? "#1b5e20" : "rgba(0,0,0,0.05)",
                                  color: mine ? "white" : "#111827",
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, marginBottom: 4 }}>
                                  {String(m.sender_name ?? "").trim() || "Membre"} • {fmtMessageTime(m.created_at)}
                                </div>
                                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                                  {String(m.body ?? "").trim() || "—"}
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                        <input
                          className="input"
                          value={threadComposer}
                          onChange={(e) => setThreadComposer(e.target.value)}
                          placeholder={tr("Écrire un message…", "Write a message...")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void sendThreadMessage();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!eventThreadId || !threadComposer.trim() || sendingThreadMessage}
                          onClick={() => void sendThreadMessage()}
                        >
                          <Send size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {sendingThreadMessage ? tr("Envoi…", "Sending...") : tr("Envoyer", "Send")}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} />
                    {tr("Coachs assignés", "Assigned coaches")}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                  {selectedCoaches.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun coach assigné.", "No coach assigned.")}</div>
                  ) : (
                    selectedCoaches.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.12)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.72)",
                          padding: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>{nameOf(c.first_name, c.last_name)}</div>
                      </div>
                    ))
                  )}
                </div>

                {candidateCoaches.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">{tr("Ajouter un coach", "Add coach")}</div>
                    {candidateCoaches.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.12)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.72)",
                          padding: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>{nameOf(c.first_name, c.last_name)}</div>
                        <button type="button" className="btn" onClick={() => addCoach(c.id)} disabled={Boolean(coachBusyIds[c.id])}>
                          <PlusCircle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {t("common.add")}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                </div>

                {event.event_type === "training" || event.event_type === "camp" ? (
                  <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {tr("Structure planifiée commune au groupe", "Planned structure shared with group")}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.88)",
                        padding: 10,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      {structureItems.length === 0 ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            {tr("Non saisi.", "Not entered.")}
                          </div>
                        </div>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                          {structureItems.map((it, idx) => {
                            const extra = String(it.note ?? "").trim();
                            return (
                              <li key={`proposed-struct-${idx}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                {categoryLabel(it.category)} — {it.minutes} min
                                {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {copyStructureMessage ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>{copyStructureMessage}</div>
                      ) : null}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        {event.series_id ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={copyStructureToFutureEvents}
                            disabled={copyingStructure || structureItems.length === 0}
                          >
                            {copyingStructure
                              ? tr("Copie…", "Copying…")
                              : tr("Copier la structure dans les activités futures", "Copy structure to future events")}
                          </button>
                        ) : null}
                        <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/edit`}>
                          {tr("Éditer", "Edit")}
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Users size={16} />
                  {tr("Participants", "Participants")}
                </div>

                {attendees.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun joueur.", "No player.")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {attendees.map((a) => {
                      const isEventPast = new Date(event.starts_at).getTime() < Date.now();
                      const p = a.profile ?? null;
                      const playerName = shortNameForList(p?.first_name ?? null, p?.last_name ?? null, 16);
                      const canOpenPlayerDetail =
                        event.event_type === "training" || event.event_type === "camp" || event.event_type === "interclub";
                      const canEvaluatePlayer = canOpenPlayerDetail && a.status !== "absent" && isEventPast;
                      const canStructurePlayer = (event.event_type === "training" || event.event_type === "camp") && !isEventPast;
                      const evaluationSummary = evaluatedPlayersById.get(a.player_id) ?? null;
                      const alreadyEvaluated = Boolean(evaluationSummary);

                      return (
                        <div
                          key={a.player_id}
                          style={{
                            border: "1px solid rgba(0,0,0,0.12)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.72)",
                            padding: 12,
                            display: "grid",
                            gap: 10,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={avatarBoxStyle} aria-hidden="true">
                                {avatarNode(p)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">
                                  {playerName}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                                  {tr("Hcp", "Hcp")} {typeof p?.handicap === "number" ? Number(p.handicap).toFixed(1) : "—"}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                              <AttendanceToggle
                                checked={a.status === "present"}
                                onToggle={() => handleAttendanceToggle(a.player_id, a.status)}
                                disabled={Boolean(attendanceBusyIds[a.player_id])}
                                ariaLabel={tr("Basculer présence", "Toggle attendance")}
                                leftLabel={tr("Absent", "Absent")}
                                rightLabel={tr("Présent", "Present")}
                              />
                            </div>
                          </div>

                          {canOpenPlayerDetail ? (
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                              {evaluationSummary ? (
                                <span
                                  className="pill-soft"
                                  title={
                                    evaluationSummary.coach_name
                                      ? tr(`Évalué par ${evaluationSummary.coach_name}`, `Evaluated by ${evaluationSummary.coach_name}`)
                                      : tr("Déjà évalué", "Already evaluated")
                                  }
                                >
                                  {evaluationSummary.coach_name
                                    ? tr(`Évalué par ${evaluationSummary.coach_name}`, `Evaluated by ${evaluationSummary.coach_name}`)
                                    : tr("Évalué", "Evaluated")}
                                </span>
                              ) : null}
                              <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}`}>
                                <ArrowRight size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                {tr("Voir", "View")}
                              </Link>

                              {isEventPast ? (
                                canEvaluatePlayer ? (
                                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}/edit`}>
                                    <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                    {tr("Évaluer", "Evaluate")}
                                    {alreadyEvaluated ? (
                                      <span
                                        style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", color: "#16a34a" }}
                                        title={tr("Déjà évalué", "Already evaluated")}
                                        aria-label={tr("Déjà évalué", "Already evaluated")}
                                      >
                                        <Check size={14} />
                                      </span>
                                    ) : null}
                                  </Link>
                                ) : (
                                  <button type="button" className="btn" disabled title={tr("Impossible d’évaluer un joueur absent.", "Cannot evaluate an absent player.")}>
                                    <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                    {tr("Évaluer", "Evaluate")}
                                  </button>
                                )
                              ) : canStructurePlayer ? (
                                <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}/structure`}>
                                  <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                  {tr("Structurer", "Structure")}
                                </Link>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
