"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Eye, EyeOff, Save, ArrowLeft } from "lucide-react";

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

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
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

const MAX_SCORE = 6;

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

export default function CoachEventPlayerFeedbackEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [player, setPlayer] = useState<ProfileRow | null>(null);

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
      setEvent(eRes.data as EventRow);

      const pRes = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap")
        .eq("id", playerId)
        .maybeSingle();

      if (pRes.error) throw new Error(pRes.error.message);
      if (!pRes.data) throw new Error("Joueur introuvable.");
      setPlayer(pRes.data as ProfileRow);

      const cfRes = await supabase
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .eq("coach_id", uRes.user.id)
        .maybeSingle();

      if (!cfRes.error && cfRes.data) {
        setDraft(cfRes.data as CoachFeedbackRow);
      } else {
        setDraft({
          event_id: eventId,
          player_id: playerId,
          coach_id: uRes.user.id,
          engagement: null,
          attitude: null,
          performance: null,
          visible_to_player: false,
          private_note: null,
          player_note: null,
        });
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setEvent(null);
      setPlayer(null);
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

  async function save() {
    setBusy(true);
    setError(null);

    const up = await supabase.from("club_event_coach_feedback").upsert(
      {
        event_id: eventId,
        player_id: playerId,
        coach_id: meId,
        engagement: draft.engagement,
        attitude: draft.attitude,
        performance: draft.performance,
        visible_to_player: !!draft.visible_to_player,
        private_note: draft.private_note?.trim() || null,
        player_note: draft.player_note?.trim() || null,
      },
      { onConflict: "event_id,player_id,coach_id" }
    );

    if (up.error) {
      setError(up.error.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.push(`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`);
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
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                {event ? fmtDateTime(event.starts_at) : ""}
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
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : !event || !player ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Évaluation (1–6)</div>

                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Engagement</span>
                    <select
                      value={draft.engagement ?? ""}
                      onChange={(e) => setDraft((p) => ({ ...p, engagement: e.target.value ? Number(e.target.value) : null }))}
                      disabled={busy}
                    >
                      <option value="">-</option>
                      {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Attitude</span>
                    <select
                      value={draft.attitude ?? ""}
                      onChange={(e) => setDraft((p) => ({ ...p, attitude: e.target.value ? Number(e.target.value) : null }))}
                      disabled={busy}
                    >
                      <option value="">-</option>
                      {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Performance</span>
                  <select
                    value={draft.performance ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, performance: e.target.value ? Number(e.target.value) : null }))}
                    disabled={busy}
                  >
                    <option value="">-</option>
                    {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>

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
                    {draft.visible_to_player ? "Visible joueur" : "Invisible joueur"}
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

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Commentaire privé (coach)</span>
                  <textarea
                    value={draft.private_note ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, private_note: e.target.value }))}
                    disabled={busy}
                    style={{ minHeight: 90 }}
                    placeholder="Notes privées…"
                  />
                </label>

                <button
                  type="button"
                  className="btn"
                  disabled={!canSave}
                  onClick={save}
                  style={{
                    width: "100%",
                    background: "var(--green-dark)",
                    borderColor: "var(--green-dark)",
                    color: "#fff",
                  }}
                >
                  <Save size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}