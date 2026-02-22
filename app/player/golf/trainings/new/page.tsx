"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SessionType = "club" | "private" | "individual";

type TrainingItemDraft = {
  category: string; // enum value (snake_case)
  minutes: string; // store as string for select
  note: string;
};

type ClubRow = { id: string; name: string | null };
type ClubMemberRow = { club_id: string };

// ✅ enum values from DB + nice labels
const TRAINING_CATEGORIES: { value: string; label: string }[] = [
  { value: "warmup_mobility", label: "Échauffement / mobilité" },
  { value: "long_game", label: "Long jeu" },
  { value: "putting", label: "Putting" },
  { value: "wedging", label: "Wedging" },
  { value: "pitching", label: "Pitching" },
  { value: "chipping", label: "Chipping" },
  { value: "bunker", label: "Bunker" },
  { value: "course", label: "Parcours" },
  { value: "mental", label: "Mental" },
  { value: "fitness", label: "Fitness" },
  { value: "other", label: "Autre" },
];

function buildMinuteOptions() {
  const opts: number[] = [];
  for (let m = 5; m <= 120; m += 5) opts.push(m);
  return opts;
}
const MINUTE_OPTIONS = buildMinuteOptions();

export default function PlayerTrainingNewPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");

  // clubs
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [clubsById, setClubsById] = useState<Record<string, ClubRow>>({});
  const [clubIdForTraining, setClubIdForTraining] = useState<string>("");

  // fields
  const [startAt, setStartAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  });

  const [place, setPlace] = useState<string>("");
  const [sessionType, setSessionType] = useState<SessionType>("club");

  const [coachName, setCoachName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // sensations 1..6 (DB checks)
  const [motivation, setMotivation] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<string>("");

  // items
  const [items, setItems] = useState<TrainingItemDraft[]>([]);

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!userId) return false;
    if (!startAt) return false;

    if (sessionType === "club" && !clubIdForTraining) return false;

    const hasValidLine = items.some((it) => it.category && Number(it.minutes) > 0);
    if (!hasValidLine) return false;

    for (const it of items) {
      if (!it.category) return false;
      if (!it.minutes.trim()) return false;
      const v = Number(it.minutes);
      if (!Number.isFinite(v) || v <= 0 || v > 120) return false;
      if (v % 5 !== 0) return false;
    }

    return true;
  }, [busy, userId, startAt, sessionType, clubIdForTraining, items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        setError("Session invalide. Reconnecte-toi.");
        setLoading(false);
        return;
      }

      const uid = userRes.user.id;
      setUserId(uid);

      const memRes = await supabase
        .from("club_members")
        .select("club_id")
        .eq("user_id", uid)
        .eq("is_active", true);

      if (memRes.error) {
        setError(memRes.error.message);
        setLoading(false);
        return;
      }

      const ids = Array.from(new Set((memRes.data ?? []).map((r: ClubMemberRow) => r.club_id))).filter(Boolean);
      setClubIds(ids);

      if (ids.length > 0) {
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", ids);
        if (clubsRes.error) {
          setError(clubsRes.error.message);
          setLoading(false);
          return;
        }

        const map: Record<string, ClubRow> = {};
        for (const c of clubsRes.data ?? []) map[c.id] = c as ClubRow;
        setClubsById(map);

        setClubIdForTraining(ids[0]);
      } else {
        setClubIdForTraining("");
      }

      setLoading(false);
    })();
  }, []);

  function addLine() {
    setItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<TrainingItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function setType(next: SessionType) {
    setSessionType(next);
    if (next === "club" && !clubIdForTraining && clubIds.length > 0) {
      setClubIdForTraining(clubIds[0]);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);

    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) {
      setError("Date/heure invalide.");
      setBusy(false);
      return;
    }

    const mot = motivation ? Number(motivation) : null;
    const dif = difficulty ? Number(difficulty) : null;
    const sat = satisfaction ? Number(satisfaction) : null;

    const club_id = sessionType === "club" ? clubIdForTraining : null;

    // 1) session (✅ correct columns)
    const insertSession = await supabase
      .from("training_sessions")
      .insert({
        user_id: userId,
        start_at: dt.toISOString(),
        location_text: place.trim() || null,
        session_type: sessionType,
        club_id,
        coach_name: coachName.trim() || null,
        motivation: mot,
        difficulty: dif,
        satisfaction: sat,
        notes: notes.trim() || null,
        total_minutes: totalMinutes,
      })
      .select("id")
      .single();

    if (insertSession.error) {
      setError(insertSession.error.message);
      setBusy(false);
      return;
    }

    const sessionId = insertSession.data.id as string;

    // 2) items (✅ correct table + enum values)
    const payload = items.map((it) => ({
      session_id: sessionId,
      category: it.category, // must be enum value
      minutes: Number(it.minutes),
      note: it.note.trim() || null,
    }));

    const insertItems = await supabase.from("training_session_items").insert(payload);

    if (insertItems.error) {
      setError(insertItems.error.message);
      setBusy(false);
      return;
    }

    router.push("/player/golf/trainings");
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Ajouter un entraînement
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                Retour
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                Mes entraînements
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}

          {sessionType === "club" && clubIds.length === 0 && !loading && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              ⚠️ Ton compte n’est lié à aucun club actif : impossible d’enregistrer un entraînement “Club”.
            </div>
          )}
        </div>

        {/* Form */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>Chargement…</div>
            ) : (
              <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Date & heure</span>
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      disabled={busy}
                    />
                  </label>

                  <div style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Total</span>
                    <div
                      style={{
                        height: 42,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.10)",
                        background: "rgba(255,255,255,0.65)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 12px",
                        fontWeight: 950,
                        color: "rgba(0,0,0,0.78)",
                      }}
                    >
                      <span>{totalMinutes}</span>
                      <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>min</span>
                    </div>
                  </div>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Lieu (optionnel)</span>
                  <input
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    disabled={busy}
                    placeholder="Ex: Practice / Putting green / Parcours"
                  />
                </label>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Type d’entraînement</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ ...chipRadioStyle, ...(sessionType === "club" ? chipRadioActive : {}) }}>
                      <input type="radio" checked={sessionType === "club"} onChange={() => setType("club")} disabled={busy} />
                      <span>Entraînement Club</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(sessionType === "private" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        checked={sessionType === "private"}
                        onChange={() => setType("private")}
                        disabled={busy}
                      />
                      <span>Cours privé</span>
                    </label>

                    <label style={{ ...chipRadioStyle, ...(sessionType === "individual" ? chipRadioActive : {}) }}>
                      <input
                        type="radio"
                        checked={sessionType === "individual"}
                        onChange={() => setType("individual")}
                        disabled={busy}
                      />
                      <span>Entraînement individuel</span>
                    </label>
                  </div>

                  {sessionType === "club" && (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Club</span>
                      <select
                        value={clubIdForTraining}
                        onChange={(e) => setClubIdForTraining(e.target.value)}
                        disabled={busy || clubIds.length === 0}
                      >
                        <option value="">-</option>
                        {clubIds.map((id) => (
                          <option key={id} value={id}>
                            {clubsById[id]?.name ?? id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Coach (optionnel)</span>
                    <input
                      value={coachName}
                      onChange={(e) => setCoachName(e.target.value)}
                      disabled={busy}
                      placeholder="Ex: Prénom Nom"
                    />
                  </label>
                </div>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={fieldLabelStyle}>Structure de l&apos;entraînement</div>

                  {items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Ajoute un poste pour structurer ton entraînement.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {items.map((it, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            display: "grid",
                            gap: 10,
                          }}
                        >
                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Poste</span>
                              <select
                                value={it.category}
                                onChange={(e) => updateLine(idx, { category: e.target.value })}
                                disabled={busy}
                              >
                                <option value="">-</option>
                                {TRAINING_CATEGORIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Durée</span>
                              <select
                                value={it.minutes}
                                onChange={(e) => updateLine(idx, { minutes: e.target.value })}
                                disabled={busy}
                              >
                                <option value="">-</option>
                                {MINUTE_OPTIONS.map((m) => (
                                  <option key={m} value={String(m)}>
                                    {m} min
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Note (optionnel)</span>
                            <input
                              value={it.note}
                              onChange={(e) => updateLine(idx, { note: e.target.value })}
                              disabled={busy}
                              placeholder="Ex: focus wedging 60–80m"
                            />
                          </label>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div className="pill-soft">Poste {idx + 1}</div>

                            <button type="button" className="btn btn-danger soft" onClick={() => removeLine(idx)} disabled={busy}>
                              Supprimer
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addLine} disabled={busy}>
                      + Ajouter un poste
                    </button>
                  </div>
                </div>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Motivation avant l&apos;entraînement</span>
                    <select value={motivation} onChange={(e) => setMotivation(e.target.value)} disabled={busy}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Difficulté de l&apos;entraînement</span>
                    <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} disabled={busy}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>Satisfaction après l&apos;entraînement</span>
                    <select value={satisfaction} onChange={(e) => setSatisfaction(e.target.value)} disabled={busy}>
                      <option value="">-</option>
                      {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={String(v)}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="hr-soft" />

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>Remarques (optionnel)</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={busy}
                    placeholder="Hydratation, alimentation, attitude, points clés, objectifs…"
                    style={{ minHeight: 110 }}
                  />
                </label>

                <button
                  className="btn"
                  type="submit"
                  disabled={!canSave || busy}
                  style={{
                    width: "100%",
                    background: "var(--green-dark)",
                    borderColor: "var(--green-dark)",
                    color: "#fff",
                  }}
                >
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

const chipRadioStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "rgba(255,255,255,0.70)",
  fontWeight: 900,
  fontSize: 13,
  color: "rgba(0,0,0,0.78)",
  cursor: "pointer",
  userSelect: "none",
};

const chipRadioActive: React.CSSProperties = {
  borderColor: "rgba(53,72,59,0.35)",
  background: "rgba(53,72,59,0.10)",
};