"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
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
type AttendanceStatus = "expected" | "present" | "absent" | "excused";

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

const MAX_SCORE = 6;

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

function feedbackFingerprint(input: {
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  private_note: string | null;
  player_note: string | null;
}) {
  return JSON.stringify({
    engagement: input.engagement ?? null,
    attitude: input.attitude ?? null,
    performance: input.performance ?? null,
    visible_to_player: !!input.visible_to_player,
    private_note: (input.private_note ?? "").trim() || null,
    player_note: (input.player_note ?? "").trim() || null,
  });
}

export default function CoachEventPlayerFeedbackEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const { locale } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [player, setPlayer] = useState<ProfileRow | null>(null);
  const [orderedPlayerIds, setOrderedPlayerIds] = useState<string[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>("present");
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [initialFeedbackFp, setInitialFeedbackFp] = useState("");

  const [draft, setDraft] = useState<CoachFeedbackRow>({
    event_id: eventId,
    player_id: playerId,
    coach_id: "",
    engagement: null,
    attitude: null,
    performance: null,
    visible_to_player: false,
    private_note: null,
    player_note: null,
  });

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId || !playerId) throw new Error("Missing parameters.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,series_id,status")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Training not found.");
      setEvent(eRes.data as EventRow);

      const pRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .eq("id", playerId)
        .maybeSingle();

      if (pRes.error) throw new Error(pRes.error.message);
      if (!pRes.data) throw new Error("Joueur introuvable.");
      setPlayer(pRes.data as ProfileRow);

      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("player_id")
        .eq("event_id", eventId);

      if (attendeeRes.error) throw new Error(attendeeRes.error.message);

      const attendeeIds = Array.from(
        new Set((attendeeRes.data ?? []).map((r: any) => String(r.player_id ?? "").trim()).filter(Boolean))
      );

      if (attendeeIds.length > 0) {
        const profRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name")
          .in("id", attendeeIds);

        if (profRes.error) throw new Error(profRes.error.message);

        const byId = new Map(
          ((profRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map((p) => [
            p.id,
            p,
          ])
        );

        const sorted = [...attendeeIds].sort((a, b) => {
          const pa = byId.get(a);
          const pb = byId.get(b);
          const la = (pa?.last_name ?? "").toLocaleLowerCase("fr-CH");
          const lb = (pb?.last_name ?? "").toLocaleLowerCase("fr-CH");
          if (la !== lb) return la.localeCompare(lb, "fr-CH");
          const fa = (pa?.first_name ?? "").toLocaleLowerCase("fr-CH");
          const fb = (pb?.first_name ?? "").toLocaleLowerCase("fr-CH");
          if (fa !== fb) return fa.localeCompare(fb, "fr-CH");
          return a.localeCompare(b);
        });

        setOrderedPlayerIds(sorted.includes(playerId) ? sorted : [...sorted, playerId]);
      } else {
        setOrderedPlayerIds([playerId]);
      }

      const cfRes = await supabase
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .eq("coach_id", uRes.user.id)
        .maybeSingle();

      if (!cfRes.error && cfRes.data) {
        const row = cfRes.data as CoachFeedbackRow;
        setDraft(row);
        setInitialFeedbackFp(
          feedbackFingerprint({
            engagement: row.engagement,
            attitude: row.attitude,
            performance: row.performance,
            visible_to_player: row.visible_to_player,
            private_note: row.private_note,
            player_note: row.player_note,
          })
        );
      } else {
        const row = {
          event_id: eventId,
          player_id: playerId,
          coach_id: uRes.user.id,
          engagement: null,
          attitude: null,
          performance: null,
          visible_to_player: false,
          private_note: null,
          player_note: null,
        };
        setDraft(row);
        setInitialFeedbackFp(
          feedbackFingerprint({
            engagement: row.engagement,
            attitude: row.attitude,
            performance: row.performance,
            visible_to_player: row.visible_to_player,
            private_note: row.private_note,
            player_note: row.player_note,
          })
        );
      }

      const atRes = await supabase
        .from("club_event_attendees")
        .select("status")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .maybeSingle();
      if (!atRes.error && atRes.data?.status) {
        setAttendanceStatus(atRes.data.status as AttendanceStatus);
      } else {
        setAttendanceStatus("present");
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setEvent(null);
      setPlayer(null);
      setOrderedPlayerIds([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, playerId]);

  const canSave = useMemo(() => {
    if (busy || loading) return false;
    if (!event || !player) return false;
    return true;
  }, [busy, loading, event, player]);

  const nextPlayerId = useMemo(() => {
    const idx = orderedPlayerIds.indexOf(playerId);
    if (idx < 0) return null;
    return orderedPlayerIds[idx + 1] ?? null;
  }, [orderedPlayerIds, playerId]);

  async function save(goNext = false) {
    setBusy(true);
    setError(null);

    if (attendanceStatus === "absent") {
      const attUp = await supabase
        .from("club_event_attendees")
        .update({ status: "absent" })
        .eq("event_id", eventId)
        .eq("player_id", playerId);
      if (attUp.error) {
        setError(attUp.error.message);
        setBusy(false);
        return;
      }
    }

    const up = await supabase.from("club_event_coach_feedback").upsert(
      {
        event_id: eventId,
        player_id: playerId,
        coach_id: meId,
        engagement: attendanceStatus === "absent" ? null : draft.engagement,
        attitude: attendanceStatus === "absent" ? null : draft.attitude,
        performance: attendanceStatus === "absent" ? null : draft.performance,
        visible_to_player: attendanceStatus === "absent" ? false : !!draft.visible_to_player,
        private_note: draft.private_note?.trim() || null,
        player_note: attendanceStatus === "absent" ? null : draft.player_note?.trim() || null,
      },
      { onConflict: "event_id,player_id,coach_id" }
    );

    if (up.error) {
      setError(up.error.message);
      setBusy(false);
      return;
    }

    const nextFeedbackFp = feedbackFingerprint({
      engagement: attendanceStatus === "absent" ? null : draft.engagement,
      attitude: attendanceStatus === "absent" ? null : draft.attitude,
      performance: attendanceStatus === "absent" ? null : draft.performance,
      visible_to_player: attendanceStatus === "absent" ? false : !!draft.visible_to_player,
      private_note: draft.private_note,
      player_note: attendanceStatus === "absent" ? null : draft.player_note,
    });

    if (attendanceStatus !== "absent" && meId && playerId && nextFeedbackFp !== initialFeedbackFp) {
      const eventTypeLabel =
        event?.event_type === "camp"
          ? locale === "fr" ? "Stage" : "Camp"
          : event?.event_type === "interclub"
          ? locale === "fr" ? "Interclubs" : "Interclub"
          : event?.event_type === "session"
          ? locale === "fr" ? "Séance" : "Session"
          : event?.event_type === "event"
          ? locale === "fr" ? "Événement" : "Event"
          : locale === "fr" ? "Entraînement" : "Training";
      const msg = await getNotificationMessage("notif.coachPlayerEvaluated", locale, {
        playerName: nameOf(player?.first_name ?? null, player?.last_name ?? null),
        eventType: eventTypeLabel,
        dateTime: fmtDateTime(event?.starts_at ?? new Date().toISOString()),
      });
      await createAppNotification({
        actorUserId: meId,
        kind: "coach_player_evaluated",
        title: msg.title,
        body: msg.body,
        data: {
          event_id: eventId,
          group_id: groupId,
          player_id: playerId,
          url: `/player/golf/trainings/new?club_event_id=${eventId}`,
        },
        recipientUserIds: [playerId],
      });
    }

    setBusy(false);
    if (goNext) {
      if (nextPlayerId) {
        router.push(`/coach/groups/${groupId}/planning/${eventId}/players/${nextPlayerId}/edit`);
      } else {
        router.push(`/coach/groups/${groupId}/planning/${eventId}`);
      }
      return;
    }
    router.push(`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`);
  }

  async function setPresence(next: "present" | "absent") {
    if (attendanceBusy || busy) return;
    const prev = attendanceStatus;
    setAttendanceStatus(next);
    setAttendanceBusy(true);
    const up = await supabase
      .from("club_event_attendees")
      .update({ status: next })
      .eq("event_id", eventId)
      .eq("player_id", playerId);
    if (up.error) {
      setAttendanceStatus(prev);
      setError(up.error.message);
    }
    setAttendanceBusy(false);
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Évaluer — {player ? nameOf(player.first_name, player.last_name) : "Joueur"}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`}>
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
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
          ) : !event || !player ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="glass-card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
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
                    <div style={{ fontSize: 20, fontWeight: 980 }} className="truncate">{nameOf(player.first_name, player.last_name)}</div>
                  </div>
                </div>
                  <AttendanceToggle
                    checked={attendanceStatus === "present"}
                    onToggle={() => setPresence(attendanceStatus === "present" ? "absent" : "present")}
                    disabled={attendanceBusy || busy}
                    ariaLabel="Basculer présence"
                    leftLabel="Absent"
                    rightLabel="Présent"
                  />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="pill-soft">{fmtDateTime(event.starts_at)}</span>
                  <span className="pill-soft">{event.duration_minutes} min</span>
                  {event.location_text ? <span className="pill-soft">📍 {event.location_text}</span> : null}
                </div>

              </div>

              <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Évaluation coach (1 à 6)</div>

                {attendanceStatus === "absent" ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Joueur absent: seule la note privée coach est disponible.
                  </div>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Engagement:</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                        {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => {
                          const active = draft.engagement === v;
                          return (
                            <button
                              key={`eng-${v}`}
                              type="button"
                              onClick={() => setDraft((p) => ({ ...p, engagement: p.engagement === v ? null : v }))}
                              disabled={busy}
                              aria-pressed={active}
                              style={{
                                width: "100%",
                                height: 34,
                                borderRadius: 10,
                                border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                fontWeight: 900,
                                cursor: busy ? "not-allowed" : "pointer",
                              }}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Attitude:</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                        {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => {
                          const active = draft.attitude === v;
                          return (
                            <button
                              key={`att-${v}`}
                              type="button"
                              onClick={() => setDraft((p) => ({ ...p, attitude: p.attitude === v ? null : v }))}
                              disabled={busy}
                              aria-pressed={active}
                              style={{
                                width: "100%",
                                height: 34,
                                borderRadius: 10,
                                border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                fontWeight: 900,
                                cursor: busy ? "not-allowed" : "pointer",
                              }}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Performance:</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                        {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => {
                          const active = draft.performance === v;
                          return (
                            <button
                              key={`perf-${v}`}
                              type="button"
                              onClick={() => setDraft((p) => ({ ...p, performance: p.performance === v ? null : v }))}
                              disabled={busy}
                              aria-pressed={active}
                              style={{
                                width: "100%",
                                height: 34,
                                borderRadius: 10,
                                border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                fontWeight: 900,
                                cursor: busy ? "not-allowed" : "pointer",
                              }}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </label>
                  </>
                )}
              </div>

              {attendanceStatus !== "absent" ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Visibilité et retour joueur</div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setDraft((p) => ({ ...p, visible_to_player: !p.visible_to_player }))}
                      style={
                        draft.visible_to_player
                          ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                          : {}
                      }
                    >
                      {draft.visible_to_player ? <Eye size={16} style={{ marginRight: 6 }} /> : <EyeOff size={16} style={{ marginRight: 6 }} />}
                      {draft.visible_to_player ? "Visible pour le joueur" : "Invisible pour le joueur"}
                    </button>
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Commentaire pour le joueur</span>
                    <textarea
                      value={draft.player_note ?? ""}
                      onChange={(e) => setDraft((p) => ({ ...p, player_note: e.target.value }))}
                      disabled={busy}
                      style={{ minHeight: 90 }}
                      placeholder="Feedback pour le joueur…"
                    />
                  </label>
                </div>
              ) : null}

              <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Note privée coach</div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Visible uniquement par les coachs</span>
                  <textarea
                    value={draft.private_note ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, private_note: e.target.value }))}
                    disabled={busy}
                    style={{ minHeight: 90 }}
                    placeholder="Notes privées..."
                  />
                </label>
              </div>

              <div className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: "grid", gap: 8, width: "100%" }}>
                  <button
                    type="button"
                    className="cta-green cta-green-inline"
                    disabled={!canSave}
                    onClick={() => save(true)}
                    style={{
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    {busy ? "Enregistrement…" : nextPlayerId ? "Enregistrer et passer au joueur suivant" : "Enregistrer et fermer"}
                  </button>
                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`} style={{ width: "100%", textAlign: "center" }}>
                    Annuler
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
