"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ArrowLeft, Flame, Mountain, Smile, Target } from "lucide-react";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ClubRow = { id: string; name: string | null };
type GroupRow = { id: string; name: string | null };

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type AttendeeRow = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused";
};

type PlayerFeedbackRow = {
  event_id: string;
  player_id: string;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  player_note: string | null;
  submitted_at: string | null;
};

type CoachFeedbackRow = {
  event_id: string;
  player_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  private_note: string | null;
  player_note: string | null;
};

type SessionType = "club" | "private" | "individual";

type TrainingSessionRow = {
  id: string;
  user_id: string;
  start_at: string;
  location_text: string | null;
  session_type: SessionType;
  club_id: string | null;
  coach_user_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number;
  club_event_id: string | null;
  created_at: string;
};
type TrainingItemRow = {
  id: string;
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at: string;
};

type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};
type PlayerPlannedStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
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

function fmtDateTimeRange(startIso: string, durationMinutes: number) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + Math.max(1, Number(durationMinutes || 0)) * 60_000);
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
  return `${fmtDateTime(startIso)} au ${fmtDateTime(end.toISOString())}`;
}

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    warmup_mobility: "Échauffement / mobilité",
    warmup: "Échauffement",
    mobility: "Mobilité",
    long_game: "Long jeu",
    long: "Long jeu",
    putting: "Putting",
    wedging: "Approches (wedging)",
    pitching: "Approches levées (pitching)",
    chipping: "Approches roulées (chipping)",
    bunker: "Bunker",
    course: "Parcours",
    mental: "Mental",
    fitness: "Physique",
    physical: "Physique",
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

function PlayerAvatar({ player }: { player: ProfileRow | null }) {
  if (player?.avatar_url) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(player);
}

function StatBar({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  const v = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(100, (v / 6) * 100));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.72)" }}>{label}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)", width: 34, textAlign: "right" }}>
          {value ?? "—"}
        </div>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function CoachEventPlayerDetailPage() {
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [clubName, setClubName] = useState("");
  const [groupName, setGroupName] = useState("");

  const [player, setPlayer] = useState<ProfileRow | null>(null);
  const [attendance, setAttendance] = useState<AttendeeRow | null>(null);

  const [playerFb, setPlayerFb] = useState<PlayerFeedbackRow | null>(null);
  const [coachFb, setCoachFb] = useState<CoachFeedbackRow | null>(null);

  const [session, setSession] = useState<TrainingSessionRow | null>(null);
  const [items, setItems] = useState<TrainingItemRow[]>([]);
  const [eventStructureItems, setEventStructureItems] = useState<EventStructureItemRow[]>([]);
  const [playerPlannedStructureItems, setPlayerPlannedStructureItems] = useState<PlayerPlannedStructureItemRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId || !playerId) throw new Error("Missing parameters.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,series_id,status")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Training not found.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      const cRes = await supabase.from("clubs").select("id,name").eq("id", ev.club_id).maybeSingle();
      setClubName(!cRes.error && cRes.data ? (cRes.data as ClubRow).name ?? "Club" : "Club");

      const gRes = await supabase.from("coach_groups").select("id,name").eq("id", ev.group_id).maybeSingle();
      setGroupName(!gRes.error && gRes.data ? (gRes.data as GroupRow).name ?? "Groupe" : "Groupe");

      const structRes = await supabase
        .from("club_event_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (structRes.error) throw new Error(structRes.error.message);
      setEventStructureItems((structRes.data ?? []) as EventStructureItemRow[]);

      const playerStructRes = await supabase
        .from("club_event_player_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (playerStructRes.error) throw new Error(playerStructRes.error.message);
      setPlayerPlannedStructureItems((playerStructRes.data ?? []) as PlayerPlannedStructureItemRow[]);

      // player
      const pRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .eq("id", playerId)
        .maybeSingle();
      if (pRes.error) throw new Error(pRes.error.message);
      if (!pRes.data) throw new Error("Joueur introuvable.");
      setPlayer(pRes.data as ProfileRow);

      // attendee status
      const aRes = await supabase
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .limit(1);
      setAttendance(!aRes.error && (aRes.data?.[0] ?? null) ? (aRes.data?.[0] as AttendeeRow) : null);

      // player feedback
      const pfRes = await supabase
        .from("club_event_player_feedback")
        .select("event_id,player_id,motivation,difficulty,satisfaction,player_note,submitted_at")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(1);
      setPlayerFb(!pfRes.error && (pfRes.data?.[0] ?? null) ? (pfRes.data?.[0] as PlayerFeedbackRow) : null);

      // coach feedback (this coach)
      const cfRes = await supabase
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .eq("coach_id", uRes.user.id)
        .limit(1);
      setCoachFb(!cfRes.error && (cfRes.data?.[0] ?? null) ? (cfRes.data?.[0] as CoachFeedbackRow) : null);

      // ✅ STRUCTURE: training_sessions linked by club_event_id + user_id
      const sRes = await supabase
        .from("training_sessions")
        .select(
          "id,user_id,start_at,location_text,session_type,club_id,coach_user_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,club_event_id,created_at"
        )
        .eq("user_id", playerId)
        .eq("club_event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (sRes.error) throw new Error(sRes.error.message);

      const sess = ((sRes.data?.[0] ?? null) as TrainingSessionRow | null);
      setSession(sess);
      if (sess?.id) {
        const itRes = await supabase
          .from("training_session_items")
          .select("id,session_id,category,minutes,note,other_detail,created_at")
          .eq("session_id", sess.id)
          .order("created_at", { ascending: true });
        if (itRes.error) throw new Error(itRes.error.message);
        setItems((itRes.data ?? []) as TrainingItemRow[]);
      } else {
        setItems([]);
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setEvent(null);
      setClubName("");
      setGroupName("");
      setPlayer(null);
      setAttendance(null);
      setPlayerFb(null);
      setCoachFb(null);
      setSession(null);
      setItems([]);
      setEventStructureItems([]);
      setPlayerPlannedStructureItems([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, playerId]);

  const title = useMemo(() => {
    if (!player) return "Player detail";
    return `Détail — ${nameOf(player.first_name, player.last_name)}`;
  }, [player]);

  const attendanceLabel = useMemo(() => {
    if (!attendance) return "Non défini";
    if (attendance.status === "present") return "Présent";
    if (attendance.status === "absent") return "Absent";
    if (attendance.status === "excused") return "Excusé";
    return "Attendu";
  }, [attendance]);

  const attendanceStyle = useMemo((): React.CSSProperties => {
    if (!attendance) return { background: "rgba(0,0,0,0.08)", color: "rgba(0,0,0,0.72)" };
    if (attendance.status === "present") return { background: "rgba(34,197,94,0.16)", color: "rgba(20,83,45,1)" };
    if (attendance.status === "absent") return { background: "rgba(239,68,68,0.16)", color: "rgba(127,29,29,1)" };
    if (attendance.status === "excused") return { background: "rgba(245,158,11,0.16)", color: "rgba(120,53,15,1)" };
    return { background: "rgba(59,130,246,0.12)", color: "rgba(30,64,175,1)" };
  }, [attendance]);

  const effectivePlayerFeedback = useMemo<PlayerFeedbackRow | null>(() => {
    if (playerFb) return playerFb;
    if (!session) return null;
    const hasAnyValue =
      typeof session.motivation === "number" ||
      typeof session.difficulty === "number" ||
      typeof session.satisfaction === "number" ||
      Boolean((session.notes ?? "").trim());
    if (!hasAnyValue) return null;
    return {
      event_id: eventId,
      player_id: playerId,
      motivation: session.motivation,
      difficulty: session.difficulty,
      satisfaction: session.satisfaction,
      player_note: session.notes,
      submitted_at: session.created_at ?? null,
    };
  }, [eventId, playerFb, playerId, session]);
  const displayedPlannedItems = playerPlannedStructureItems.length > 0 ? playerPlannedStructureItems : eventStructureItems;
  const canShowStructure = event?.event_type === "training" || event?.event_type === "camp";

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>{title}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                <ArrowLeft size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Retour
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          {loading ? (
            <div className="glass-card">
              <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
              </div>
            </div>
          ) : !event || !player ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>No data.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="glass-card" style={{ padding: 16, display: "grid", gap: 14 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    <div
                      style={{
                        width: 68,
                        height: 68,
                        borderRadius: 18,
                        overflow: "hidden",
                        border: "1px solid rgba(0,0,0,0.10)",
                        background: "rgba(255,255,255,0.80)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 950,
                        color: "var(--green-dark)",
                        flexShrink: 0,
                      }}
                    >
                      <PlayerAvatar player={player} />
                    </div>
                    <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 11, letterSpacing: 0.8, fontWeight: 900, color: "rgba(0,0,0,0.58)" }}>FICHE JOUEUR</div>
                      <div style={{ fontWeight: 980, fontSize: 20 }} className="truncate">{nameOf(player.first_name, player.last_name)}</div>
                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.65)" }}>
                        Handicap {typeof player.handicap === "number" ? Number(player.handicap).toFixed(1) : "—"}
                      </div>
                    </div>
                  </div>

                  <span className="pill-soft" style={{ ...attendanceStyle, fontWeight: 950 }}>{attendanceLabel}</span>
                </div>

                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.80)" }}>
                    {fmtDateTimeRange(event.starts_at, event.duration_minutes)}
                  </div>
                  {event.location_text ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                      📍 {event.location_text}
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  alignItems: "start",
                }}
              >
                {canShowStructure ? (
                  <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>Structure de l'entrainement</div>
                    {displayedPlannedItems.length === 0 && items.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non saisi.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.88)",
                            padding: 10,
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Planifiée par le coach</div>
                          {displayedPlannedItems.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                              {displayedPlannedItems.map((it, idx) => {
                                const extra = String(it.note ?? "").trim();
                                return (
                                  <li key={`event-struct-${idx}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                    {categoryLabel(it.category)} — {it.minutes} min
                                    {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non saisi.</div>
                          )}
                        </div>

                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.88)",
                            padding: 10,
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Réalisée par le joueur</div>
                          {items.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                              {items.map((it) => {
                                const extra = String(it.note ?? it.other_detail ?? "").trim();
                                return (
                                  <li key={it.id} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                    {categoryLabel(it.category)} — {it.minutes} min
                                    {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non saisi.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Retour joueur</div>
                  {!effectivePlayerFeedback ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non saisi.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <StatBar icon={<Flame size={16} />} label="Motivation" value={effectivePlayerFeedback.motivation} />
                      <StatBar icon={<Mountain size={16} />} label="Difficulté" value={effectivePlayerFeedback.difficulty} />
                      <StatBar icon={<Smile size={16} />} label="Satisfaction" value={effectivePlayerFeedback.satisfaction} />
                      {effectivePlayerFeedback.player_note ? (
                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            fontSize: 13,
                            fontWeight: 800,
                            color: "rgba(0,0,0,0.72)",
                            lineHeight: 1.4,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {effectivePlayerFeedback.player_note}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucune note joueur.</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Évaluation coach</div>
                  {!coachFb ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non évalué.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <StatBar icon={<Target size={16} />} label="Engagement" value={coachFb.engagement} />
                      <StatBar icon={<Smile size={16} />} label="Attitude" value={coachFb.attitude} />
                      <StatBar icon={<Mountain size={16} />} label="Application" value={coachFb.performance} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="pill-soft">{coachFb.visible_to_player ? "Visible joueur" : "Invisible joueur"}</span>
                      </div>
                      {coachFb.player_note ? (
                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            fontSize: 13,
                            fontWeight: 800,
                            color: "rgba(0,0,0,0.72)",
                            lineHeight: 1.4,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          <b>Pour le joueur :</b>
                          <div style={{ height: 8 }} />
                          {coachFb.player_note}
                        </div>
                      ) : null}
                      {coachFb.private_note ? (
                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            fontSize: 13,
                            fontWeight: 800,
                            color: "rgba(0,0,0,0.72)",
                            lineHeight: 1.4,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          <b>Note privée coach :</b>
                          <div style={{ height: 8 }} />
                          {coachFb.private_note}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                    Retour participants
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
