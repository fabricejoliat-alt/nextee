"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Session = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  coach_user_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number;
};

type ItemDraft = {
  id: string; // local
  category:
    | "warmup_mobility"
    | "long_game"
    | "putting"
    | "wedging"
    | "pitching"
    | "chipping"
    | "bunker"
    | "course"
    | "mental"
    | "fitness"
    | "other";
  minutes: number;
  note: string;
  other_detail: string;
};

const categories: { value: ItemDraft["category"]; label: string }[] = [
  { value: "warmup_mobility", label: "Échauffement / mobilité" },
  { value: "long_game", label: "Long jeu" },
  { value: "putting", label: "Putting" },
  { value: "wedging", label: "Wedging" },
  { value: "pitching", label: "Pitching" },
  { value: "chipping", label: "Chipping" },
  { value: "bunker", label: "Bunker" },
  { value: "course", label: "Parcours" },
  { value: "mental", label: "Préparation mentale" },
  { value: "fitness", label: "Fitness / musculation" },
  { value: "other", label: "Autre activité" },
];

function timeOptions15() {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
}

function minutesOptions5(max = 240) {
  const out: number[] = [];
  for (let m = 5; m <= max; m += 5) out.push(m);
  return out;
}

function toDateInputValue(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeInputValue(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function TrainingEditPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [initLoading, setInitLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const times = useMemo(() => timeOptions15(), []);

  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; label: string }[]>([]);

  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("16:00");

  const [location, setLocation] = useState("");
  const [sessionType, setSessionType] = useState<"club" | "private" | "individual">("individual");

  const [clubId, setClubId] = useState<string>("");
  const [coachUserId, setCoachUserId] = useState<string>("");
  const [coachName, setCoachName] = useState<string>("");

  const [motivation, setMotivation] = useState<number | "">("");
  const [difficulty, setDifficulty] = useState<number | "">("");
  const [satisfaction, setSatisfaction] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<ItemDraft[]>([]);

  const totalMinutes = useMemo(
    () => items.reduce((sum, it) => sum + (it.minutes || 0), 0),
    [items]
  );

  // -------- LOADERS (sans embeds) --------

  async function loadClubs(uid: string) {
    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true);

    if (memRes.error) throw new Error(memRes.error.message);

    const clubIds = (memRes.data ?? []).map((m: any) => m.club_id).filter(Boolean);

    if (clubIds.length === 0) {
      setClubs([]);
      return;
    }

    const clubsRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
    if (clubsRes.error) throw new Error(clubsRes.error.message);

    const mapped = (clubsRes.data ?? [])
      .map((c: any) => ({ id: c.id as string, name: (c.name ?? "Club") as string }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setClubs(mapped);
  }

  async function loadCoachesForClub(clubIdToLoad: string) {
    if (!clubIdToLoad) {
      setCoaches([]);
      setCoachUserId("");
      return;
    }

    const cmRes = await supabase
      .from("club_members")
      .select("user_id")
      .eq("club_id", clubIdToLoad)
      .eq("role", "coach")
      .eq("is_active", true);

    if (cmRes.error) {
      setCoaches([]);
      setCoachUserId("");
      return;
    }

    const coachIds = (cmRes.data ?? []).map((r: any) => r.user_id).filter(Boolean);

    if (coachIds.length === 0) {
      setCoaches([]);
      setCoachUserId("");
      return;
    }

    const profRes = await supabase
      .from("profiles")
      .select("id,first_name,last_name")
      .in("id", coachIds);

    if (profRes.error) {
      const mappedFallback = coachIds.map((id: string) => ({ id, label: id.slice(0, 8) }));
      setCoaches(mappedFallback);
      setCoachUserId((prev) => prev || mappedFallback[0]?.id || "");
      return;
    }

    const labelById: Record<string, string> = {};
    (profRes.data ?? []).forEach((p: any) => {
      const f = (p.first_name ?? "").trim();
      const l = (p.last_name ?? "").trim();
      labelById[p.id] = !f && !l ? String(p.id).slice(0, 8) : `${f} ${l ? l[0] + "." : ""}`.trim();
    });

    const mapped = coachIds
      .map((id: string) => ({ id, label: labelById[id] ?? id.slice(0, 8) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    setCoaches(mapped);
    setCoachUserId((prev) => prev || mapped[0]?.id || "");
  }

  async function load() {
    setInitLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Session invalide.");
      const uid = userRes.user.id;

      // clubs
      await loadClubs(uid);

      // session
      const sRes = await supabase.from("training_sessions").select("*").eq("id", sessionId).single();
      if (sRes.error) throw new Error(sRes.error.message);

      const s = sRes.data as Session;

      setDate(toDateInputValue(s.start_at));
      setTime(toTimeInputValue(s.start_at));
      setLocation(s.location_text ?? "");
      setSessionType(s.session_type);

      setClubId(s.club_id ?? "");
      setCoachUserId(s.coach_user_id ?? "");
      setCoachName(s.coach_name ?? "");

      setMotivation(s.motivation ?? "");
      setDifficulty(s.difficulty ?? "");
      setSatisfaction(s.satisfaction ?? "");
      setNotes(s.notes ?? "");

      // coach list if club
      if (s.session_type === "club" && s.club_id) {
        await loadCoachesForClub(s.club_id);
      } else {
        setCoaches([]);
      }

      // items
      const iRes = await supabase
        .from("training_session_items")
        .select("category,minutes,note,other_detail,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (iRes.error) throw new Error(iRes.error.message);

      const draft: ItemDraft[] = (iRes.data ?? []).map((it: any) => ({
        id: crypto.randomUUID(),
        category: it.category,
        minutes: it.minutes,
        note: it.note ?? "",
        other_detail: it.other_detail ?? "",
      }));

      setItems(
        draft.length > 0
          ? draft
          : [{ id: crypto.randomUUID(), category: "warmup_mobility", minutes: 10, note: "", other_detail: "" }]
      );
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
    } finally {
      setInitLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // reload coaches when type/club changes
  useEffect(() => {
    if (sessionType === "club") {
      loadCoachesForClub(clubId);
    } else {
      setCoaches([]);
      setCoachUserId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType, clubId]);

  // -------- UI helpers --------
  function setItem(id: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), category: "long_game", minutes: 10, note: "", other_detail: "" },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  // -------- SAVE --------
  async function onSave() {
    setSaving(true);
    setError(null);

    try {
      if (items.length === 0) throw new Error("Ajoute au moins un exercice.");

      for (const it of items) {
        if (!it.minutes || it.minutes % 5 !== 0) {
          throw new Error("La durée d’un poste doit être un multiple de 5 minutes.");
        }
        if (it.category === "other" && !it.other_detail.trim()) {
          throw new Error("Pour 'Autre activité', merci de renseigner le détail.");
        }
      }

      const startAt = new Date(`${date}T${time}:00`);
      if (Number.isNaN(startAt.getTime())) throw new Error("Date/heure invalide.");

      if (sessionType === "club" && !clubId) {
        throw new Error("Merci de sélectionner un club.");
      }

      const upd = await supabase
        .from("training_sessions")
        .update({
          start_at: startAt.toISOString(),
          location_text: location.trim() || null,
          session_type: sessionType,
          club_id: sessionType === "club" ? (clubId || null) : null,
          coach_user_id: sessionType === "club" ? (coachUserId || null) : null,
          coach_name: sessionType === "club" ? null : (coachName.trim() || null),
          motivation: motivation === "" ? null : motivation,
          difficulty: difficulty === "" ? null : difficulty,
          satisfaction: satisfaction === "" ? null : satisfaction,
          notes: notes.trim() || null,
          total_minutes: totalMinutes,
        })
        .eq("id", sessionId);

      if (upd.error) throw new Error(upd.error.message);

      // Replace items (MVP)
      const del = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
      if (del.error) throw new Error(del.error.message);

      const ins = await supabase.from("training_session_items").insert(
        items.map((it) => ({
          session_id: sessionId,
          category: it.category,
          minutes: it.minutes,
          note: it.note.trim() || null,
          other_detail: it.category === "other" ? (it.other_detail.trim() || null) : null,
        }))
      );

      if (ins.error) throw new Error(ins.error.message);

      router.push(`/player/trainings/${sessionId}`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  if (initLoading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Modifier l’entraînement</div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          Total : {totalMinutes} min
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label>Heure (par 15 minutes)</label>
          <select value={time} onChange={(e) => setTime(e.target.value)}>
            {times.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label>Lieu</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label>Type</label>
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value as any)}>
            <option value="club">Club</option>
            <option value="private">Privé</option>
            <option value="individual">Individuel</option>
          </select>
        </div>

        {sessionType === "club" && (
          <>
            <div style={{ display: "grid", gap: 6 }}>
              <label>Club</label>
              <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
                <option value="">—</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label>Coach principal</label>
              <select value={coachUserId} onChange={(e) => setCoachUserId(e.target.value)}>
                <option value="">—</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {sessionType !== "club" && (
          <div style={{ display: "grid", gap: 6 }}>
            <label>Coach principal (champ libre)</label>
            <input value={coachName} onChange={(e) => setCoachName(e.target.value)} />
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Détail</div>
          <button className="btn" onClick={addItem}>
            Ajouter un poste
          </button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                border: "1px solid #e8e8e8",
                borderRadius: 14,
                padding: 12,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <label>Exercice</label>
                <select value={it.category} onChange={(e) => setItem(it.id, { category: e.target.value as any })}>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {it.category === "other" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <label>Détail (obligatoire)</label>
                  <input value={it.other_detail} onChange={(e) => setItem(it.id, { other_detail: e.target.value })} />
                </div>
              )}

              <div style={{ display: "grid", gap: 6 }}>
                <label>Durée (pas de 5 min)</label>
                <select value={it.minutes} onChange={(e) => setItem(it.id, { minutes: Number(e.target.value) })}>
                  {minutesOptions5(240).map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label>Note (optionnel)</label>
                <input value={it.note} onChange={(e) => setItem(it.id, { note: e.target.value })} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>Poste : {it.minutes} min</div>
                {items.length > 1 && (
                  <button className="btn btn-danger" onClick={() => removeItem(it.id)}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 900 }}>Sensations</div>

        <Scale label="Motivation avant l’entraînement" left="Pas motivé" right="Très motivé" value={motivation} onChange={setMotivation} />
        <Scale label="Difficulté de l’entraînement" left="Facile" right="Très dur" value={difficulty} onChange={setDifficulty} />
        <Scale label="Satisfaction de l’entraînement" left="Déçu" right="Très satisfait" value={satisfaction} onChange={setSatisfaction} />
      </div>

      <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 900 }}>Remarques</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </div>

      {error && <div style={{ color: "#a00" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => router.push(`/player/trainings/${sessionId}`)}>
          Annuler
        </button>
        <button className="btn" disabled={saving} onClick={onSave}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

function Scale({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 800 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <select value={value === "" ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
