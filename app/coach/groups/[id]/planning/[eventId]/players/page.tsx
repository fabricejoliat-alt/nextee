"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ArrowLeft, Pencil } from "lucide-react";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
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

// ⚠️ on tente de retrouver une session liée à l’événement
type TrainingSessionRow = {
  id: string;
  user_id: string;
  start_at: string;
  location_text: string | null;
  session_type: SessionType;
  club_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number | null;
  created_at: string;
  event_id?: string | null;
  club_event_id?: string | null;
};

type TrainingItemRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail?: string | null;
  created_at?: string;
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

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    warmup_mobility: "Échauffement / mobilité",
    long_game: "Long jeu",
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

  // “structure entraînement” (postes) si on retrouve une training_session liée
  const [session, setSession] = useState<TrainingSessionRow | null>(null);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  async function tryLoadSessionLinkedToEvent(uid: string, evId: string) {
    // tentative 1: colonne event_id
    const s1 = await supabase
      .from("training_sessions")
      .select(
        "id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,created_at,event_id"
      )
      .eq("user_id", uid)
      // @ts-ignore
      .eq("event_id", evId)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!s1.error && s1.data) return s1.data as TrainingSessionRow;

    // tentative 2: colonne club_event_id
    const s2 = await supabase
      .from("training_sessions")
      .select(
        "id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,created_at,club_event_id"
      )
      .eq("user_id", uid)
      // @ts-ignore
      .eq("club_event_id", evId)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!s2.error && s2.data) return s2.data as TrainingSessionRow;

    return null;
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId || !playerId) throw new Error("Paramètres manquants.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,starts_at,duration_minutes,location_text,series_id,status")
        .eq("id", eventId)
        .maybeSingle();
      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Entraînement introuvable.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      const cRes = await supabase.from("clubs").select("id,name").eq("id", ev.club_id).maybeSingle();
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
      else setClubName("Club");

      const gRes = await supabase.from("coach_groups").select("id,name").eq("id", ev.group_id).maybeSingle();
      if (!gRes.error && gRes.data) setGroupName((gRes.data as GroupRow).name ?? "Groupe");
      else setGroupName("Groupe");

      // player profile
      const pRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap")
        .eq("id", playerId)
        .maybeSingle();

      if (pRes.error) throw new Error(pRes.error.message);
      if (!pRes.data) throw new Error("Joueur introuvable.");
      setPlayer(pRes.data as ProfileRow);

      // attendance status
      const aRes = await supabase
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .maybeSingle();

      if (!aRes.error && aRes.data) setAttendance(aRes.data as AttendeeRow);
      else setAttendance(null);

      // player feedback
      const pfRes = await supabase
        .from("club_event_player_feedback")
        .select("event_id,player_id,motivation,difficulty,satisfaction,player_note,submitted_at")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .maybeSingle();

      if (!pfRes.error && pfRes.data) setPlayerFb(pfRes.data as PlayerFeedbackRow);
      else setPlayerFb(null);

      // coach feedback (this coach)
      const cfRes = await supabase
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .eq("coach_id", uRes.user.id)
        .maybeSingle();

      if (!cfRes.error && cfRes.data) setCoachFb(cfRes.data as CoachFeedbackRow);
      else setCoachFb(null);

      // try to load training structure session+items
      const sess = await tryLoadSessionLinkedToEvent(playerId, eventId);
      setSession(sess);

      if (sess?.id) {
        const itRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes,note,other_detail,created_at")
          .eq("session_id", sess.id)
          .order("created_at", { ascending: true });

        if (!itRes.error) setItems((itRes.data ?? []) as TrainingItemRow[]);
        else setItems([]);
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
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, playerId]);

  const title = useMemo(() => {
    if (!player) return "Détail joueur";
    return `Détail — ${nameOf(player.first_name, player.last_name)}`;
  }, [player]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>{title}</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                {event ? `${fmtDateTime(event.starts_at)} • ${clubName} • ${groupName}` : ""}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                <ArrowLeft size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Retour
              </Link>

              <Link
                className="cta-green cta-green-inline"
                href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}/edit`}
              >
                <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Évaluer
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : !event || !player ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {/* Event summary */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div className="marketplace-item-title" style={{ fontSize: 14, fontWeight: 950 }}>
                    {fmtDateTime(event.starts_at)}
                  </div>
                  <div className="marketplace-price-pill">{event.duration_minutes} min</div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="pill-soft">{clubName || "Club"}</span>
                  {event.series_id ? <span className="pill-soft">Récurrent</span> : <span className="pill-soft">Unique</span>}
                  {attendance ? <span className="pill-soft">{attendance.status}</span> : null}
                  {event.location_text ? (
                    <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>📍 {event.location_text}</span>
                  ) : null}
                </div>

                <div className="hr-soft" />

                {/* Player info */}
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Joueur</div>
                  <div style={{ fontWeight: 950 }}>{nameOf(player.first_name, player.last_name)}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                    Handicap {typeof player.handicap === "number" ? player.handicap.toFixed(1) : "—"}
                  </div>
                </div>

                <div className="hr-soft" />

                {/* Training structure */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Structure de l’entraînement (postes)</div>

                  {!session ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Structure non disponible (je n’ai pas trouvé de session “training_sessions” liée à cet événement).
                    </div>
                  ) : items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Session trouvée, mais aucun poste enregistré.
                    </div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                      {items.map((it, i) => {
                        const extra = String(it.note ?? it.other_detail ?? "").trim();
                        return (
                          <li key={`${it.session_id}-${i}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                            {categoryLabel(it.category)} — {it.minutes} min
                            {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Player feedback */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Retour joueur</div>

                  {!playerFb ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Non saisi.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                        Sensations :{" "}
                        <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.78)" }}>
                          M {playerFb.motivation ?? "—"} • D {playerFb.difficulty ?? "—"} • S {playerFb.satisfaction ?? "—"}
                        </span>
                      </div>

                      {playerFb.player_note ? (
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
                          {playerFb.player_note}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucune note joueur.</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Coach feedback */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Évaluation coach</div>

                  {!coachFb ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Pas encore évalué.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                        Engagement <b>{coachFb.engagement ?? "—"}</b> • Attitude <b>{coachFb.attitude ?? "—"}</b> • Performance{" "}
                        <b>{coachFb.performance ?? "—"}</b>
                      </div>

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
                          <b>Privé coach :</b>
                          <div style={{ height: 8 }} />
                          {coachFb.private_note}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                    Retour participants
                  </Link>
                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}/edit`}>
                    Évaluer
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}