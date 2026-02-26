"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { Users, ArrowRight, Pencil, PlusCircle, Trash2 } from "lucide-react";

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
function eventTypeLabelLocalized(v: string | null | undefined, locale: "fr" | "en") {
  if (locale === "en") {
    if (v === "training") return "Training";
    if (v === "interclub") return "Interclub";
    if (v === "camp") return "Camp";
    if (v === "session") return "Session";
    return "Event";
  }
  return eventTypeLabel(v);
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

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
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
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
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
  const [coachBusyIds, setCoachBusyIds] = useState<Record<string, boolean>>({});
  const [attendanceBusyIds, setAttendanceBusyIds] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId) throw new Error("Événement manquant.");

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
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
      setGroupName(!gRes.error && gRes.data ? (gRes.data as GroupRow).name ?? "Groupe" : "Groupe");

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

      const coRes = await supabase
        .from("coach_group_coaches")
        .select("coach_user_id, profiles:coach_user_id ( id, first_name, last_name )")
        .eq("group_id", ev.group_id);
      if (coRes.error) throw new Error(coRes.error.message);
      const coList: CoachLite[] = (coRes.data ?? []).map((r: any) => ({
        id: String(r.coach_user_id),
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
      }));
      setCoaches(coList);

      const ecRes = await supabase.from("club_event_coaches").select("coach_id").eq("event_id", ev.id);
      if (ecRes.error) throw new Error(ecRes.error.message);
      setSelectedCoachIds((ecRes.data ?? []).map((r: any) => String(r.coach_id ?? "")).filter(Boolean));

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
      setEvent(null);
      setClubName("");
      setGroupName("");
      setAttendees([]);
      setCoaches([]);
      setSelectedCoachIds([]);
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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {event ? eventTypeLabelLocalized(event.event_type, locale) : tr("Événement", "Event")} — {groupName || tr("Groupe", "Group")}
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
                    {eventTypeLabelLocalized(event.event_type, locale)} — {groupName || tr("Groupe", "Group")}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div className="marketplace-item-title" style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 980 }}>
                      {fmtDateTimeRange(event.starts_at, event.ends_at)}
                    </div>
                    <div className="marketplace-price-pill">{event.duration_minutes} {t("common.min")}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="pill-soft">{eventTypeLabelLocalized(event.event_type, locale)}</span>
                    <span className="pill-soft">{clubName || t("common.club")}</span>
                    {event.series_id ? <span className="pill-soft">{tr("Récurrent", "Recurring")}</span> : <span className="pill-soft">{tr("Unique", "Single")}</span>}
                    {event.location_text ? (
                      <span style={{ color: "rgba(0,0,0,0.68)", fontWeight: 800, fontSize: 12 }}>
                        📍 {event.location_text}
                      </span>
                    ) : null}
                  </div>

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
                      const p = a.profile ?? null;
                      const playerName = nameOf(p?.first_name ?? null, p?.last_name ?? null);
                      const canOpenPlayerDetail = event.event_type === "training";
                      const canEvaluatePlayer = canOpenPlayerDetail && a.status !== "absent";

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
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={avatarBoxStyle} aria-hidden="true">
                                {avatarNode(p)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 950 }} className="truncate">
                                  {playerName}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                              <div
                                style={{
                                  display: "inline-flex",
                                  border: "1px solid rgba(0,0,0,0.12)",
                                  borderRadius: 10,
                                  overflow: "hidden",
                                  background: "rgba(255,255,255,0.78)",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setAttendanceStatus(a.player_id, "present")}
                                  disabled={Boolean(attendanceBusyIds[a.player_id])}
                                  style={{
                                    borderRadius: 0,
                                    border: "none",
                                    borderRight: "1px solid rgba(0,0,0,0.10)",
                                    background: a.status === "present" ? "#22c55e" : "transparent",
                                    color: a.status === "present" ? "#ffffff" : "rgba(0,0,0,0.82)",
                                    fontWeight: 900,
                                    fontSize: 11,
                                    lineHeight: 1.1,
                                    padding: "5px 8px",
                                    cursor: attendanceBusyIds[a.player_id] ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {tr("Présent", "Present")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAttendanceStatus(a.player_id, "absent")}
                                  disabled={Boolean(attendanceBusyIds[a.player_id])}
                                  style={{
                                    borderRadius: 0,
                                    border: "none",
                                    background: a.status === "absent" ? "#ef4444" : "transparent",
                                    color: a.status === "absent" ? "#ffffff" : "rgba(0,0,0,0.82)",
                                    fontWeight: 900,
                                    fontSize: 11,
                                    lineHeight: 1.1,
                                    padding: "5px 8px",
                                    cursor: attendanceBusyIds[a.player_id] ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {tr("Absent", "Absent")}
                                </button>
                              </div>
                            </div>
                          </div>

                          {canOpenPlayerDetail ? (
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                              <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}`}>
                                <ArrowRight size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                {tr("Voir", "View")}
                              </Link>
                              {canEvaluatePlayer ? (
                                <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}/edit`}>
                                  <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                  {tr("Évaluer", "Evaluate")}
                                </Link>
                              ) : (
                                <button type="button" className="btn" disabled title={tr("Impossible d’évaluer un joueur absent.", "Cannot evaluate an absent player.")}>
                                  <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                  {tr("Évaluer", "Evaluate")}
                                </button>
                              )}
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
