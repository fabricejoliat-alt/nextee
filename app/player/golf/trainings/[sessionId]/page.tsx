"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Flame, Mountain, Smile } from "lucide-react";

type SessionType = "club" | "private" | "individual";

type SessionDbRow = {
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
};

type ItemDbRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail?: string | null;
  created_at?: string;
};

type ClubRow = { id: string; name: string | null };

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

function typeLabel(t: SessionType) {
  if (t === "club") return "Entraînement Club";
  if (t === "private") return "Cours privé";
  return "Entraînement individuel";
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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

const MAX_SCORE = 6;

function RatingBar({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
}) {
  const v = typeof value === "number" ? value : 0;
  const pct = clamp((v / MAX_SCORE) * 100, 0, 100);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{label}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{value ?? "—"}</div>
      </div>

      {/* ✅ bar verte (dégradé) = classe .bar du globals.css */}
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PlayerTrainingDetailPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params?.sessionId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionDbRow | null>(null);
  const [items, setItems] = useState<ItemDbRow[]>([]);
  const [clubName, setClubName] = useState<string>("");

  const totalMinutes = useMemo(() => {
    if (session?.total_minutes != null) return session.total_minutes;
    return items.reduce((sum, it) => sum + (it.minutes || 0), 0);
  }, [session?.total_minutes, items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        if (!sessionId) throw new Error("ID entraînement manquant.");

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");
        const uid = userRes.user.id;

        const sRes = await supabase
          .from("training_sessions")
          .select(
            "id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,created_at"
          )
          .eq("id", sessionId)
          .maybeSingle();

        if (sRes.error) throw new Error(sRes.error.message);

        const s = (sRes.data ?? null) as SessionDbRow | null;
        if (!s) throw new Error("Entraînement introuvable.");

        // protection soft UI
        if (s.user_id !== uid) throw new Error("Tu n’as pas l’autorisation de voir cet entraînement.");

        setSession(s);

        const itRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes,note,other_detail,created_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true });

        if (itRes.error) throw new Error(itRes.error.message);

        setItems((itRes.data ?? []) as ItemDbRow[]);

        // club name if needed
        if (s.session_type === "club" && s.club_id) {
          const cRes = await supabase.from("clubs").select("id,name").eq("id", s.club_id).maybeSingle();
          if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
          else setClubName("Club");
        } else {
          setClubName("");
        }

        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Erreur chargement.");
        setSession(null);
        setItems([]);
        setClubName("");
        setLoading(false);
      }
    })();
  }, [sessionId]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Détail entraînement
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                Retour
              </Link>

              <Link
                className="cta-green cta-green-inline"
                href={sessionId ? `/player/golf/trainings/${sessionId}/edit` : "/player/golf/trainings"}
              >
                Modifier
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
            ) : !session ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {/* Top line: date + total */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div className="marketplace-item-title" style={{ fontSize: 14, fontWeight: 950 }}>
                    {fmtDateTime(session.start_at)}
                  </div>
                  <div className="marketplace-price-pill">{totalMinutes > 0 ? `${totalMinutes} min` : "—"}</div>
                </div>

                {/* Type + club + location */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {session.session_type === "club" ? (
                    <span className="pill-soft">{clubName || "Club"}</span>
                  ) : (
                    <span className="pill-soft">{typeLabel(session.session_type)}</span>
                  )}

                  {session.location_text && (
                    <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>
                      📍 {session.location_text}
                    </span>
                  )}
                </div>

                {/* Coach */}
                {session.coach_name && (
                  <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                    👤 Coach : <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.78)" }}>{session.coach_name}</span>
                  </div>
                )}

                {/* Postes */}
                {items.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                {items.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Postes</div>

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
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun poste enregistré.
                  </div>
                )}

                {items.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                {/* Sensations */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Sensations</div>

                  <RatingBar icon={<Flame size={16} />} label="Motivation" value={session.motivation} />
                  <RatingBar icon={<Mountain size={16} />} label="Difficulté" value={session.difficulty} />
                  <RatingBar icon={<Smile size={16} />} label="Satisfaction" value={session.satisfaction} />
                </div>

                {/* Notes */}
                {session.notes && (
                  <>
                    <div className="hr-soft" style={{ margin: "2px 0" }} />
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>Remarques</div>
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
                        {session.notes}
                      </div>
                    </div>
                  </>
                )}

                {/* Actions bottom (optionnel, pratique sur mobile) */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => router.push("/player/golf/trainings")}>
                    Retour liste
                  </button>

                  <Link className="btn" href={`/player/golf/trainings/${sessionId}/edit`}>
                    Modifier
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