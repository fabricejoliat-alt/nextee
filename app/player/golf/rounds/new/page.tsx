"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type ApiCourseLite = {
  id: string | number;
  course_name: string;
  club_name?: string;
  city?: string;
  country?: string;
};

type ApiTee = {
  id: string;
  gender: "male" | "female";
  tee_name: string;
  slope_rating: number | null;
  course_rating: number | null;
  holes: Array<{ par?: number; handicap?: number }>;
};

function quarterHours() {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out;
}

function safeStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function normalizeCourses(payload: any): ApiCourseLite[] {
  const arr = payload?.courses ?? payload?.data ?? payload?.results ?? payload ?? [];
  if (!Array.isArray(arr)) return [];

  return arr
    .map((c: any) => ({
      id: c.id ?? c.course_id ?? c.uuid ?? c._id,
      course_name: c.course_name ?? c.name ?? "",
      club_name: c.club_name ?? "",
      city: c.location?.city ?? "",
      country: c.location?.country ?? "",
    }))
    .filter((x: any) => x.id != null && x.course_name);
}

function wantedTee(teeName: string, gender: "male" | "female") {
  const n = norm(teeName);
  if (gender === "male") {
    if (n.includes("white") || n.includes("blanc")) return "blanc-h";
    if (n.includes("yellow") || n.includes("jaune")) return "jaune-h";
  } else {
    if (n.includes("blue") || n.includes("bleu")) return "bleu-f";
    if (n.includes("red") || n.includes("rouge")) return "rouge-f";
  }
  return null;
}

function normalizeTees(courseDetail: any): ApiTee[] {
  const root = courseDetail?.course ?? courseDetail?.data ?? courseDetail;
  const teesObj = root?.tees;

  const female = Array.isArray(teesObj?.female) ? teesObj.female : [];
  const male = Array.isArray(teesObj?.male) ? teesObj.male : [];

  const out: ApiTee[] = [];

  female.forEach((t: any, idx: number) => {
    const tee_name = safeStr(t?.tee_name ?? t?.name ?? "");
    if (!wantedTee(tee_name, "female")) return;

    out.push({
      id: `female-${idx}-${tee_name}`,
      gender: "female",
      tee_name,
      slope_rating: typeof t?.slope_rating === "number" ? t.slope_rating : null,
      course_rating: typeof t?.course_rating === "number" ? t.course_rating : null,
      holes: Array.isArray(t?.holes) ? t.holes : [],
    });
  });

  male.forEach((t: any, idx: number) => {
    const tee_name = safeStr(t?.tee_name ?? t?.name ?? "");
    if (!wantedTee(tee_name, "male")) return;

    out.push({
      id: `male-${idx}-${tee_name}`,
      gender: "male",
      tee_name,
      slope_rating: typeof t?.slope_rating === "number" ? t.slope_rating : null,
      course_rating: typeof t?.course_rating === "number" ? t.course_rating : null,
      holes: Array.isArray(t?.holes) ? t.holes : [],
    });
  });

  // ordre strict demandé
  const orderKey = (t: ApiTee) => {
    const n = norm(t.tee_name);
    if (t.gender === "male" && (n.includes("white") || n.includes("blanc"))) return 1;
    if (t.gender === "male" && (n.includes("yellow") || n.includes("jaune"))) return 2;
    if (t.gender === "female" && (n.includes("blue") || n.includes("bleu"))) return 3;
    if (t.gender === "female" && (n.includes("red") || n.includes("rouge"))) return 4;
    return 99;
  };

  return out.sort((a, b) => orderKey(a) - orderKey(b));
}

function teeLabel(t: ApiTee) {
  const n = norm(t.tee_name);
  let color = t.tee_name;
  if (n.includes("white") || n.includes("blanc")) color = "Tee blanc";
  else if (n.includes("yellow") || n.includes("jaune")) color = "Tee jaune";
  else if (n.includes("blue") || n.includes("bleu")) color = "Tee bleu";
  else if (n.includes("red") || n.includes("rouge")) color = "Tee rouge";

  const gender = t.gender === "male" ? "Homme" : "Femme";
  const parts = [`${color} (${gender})`];
  if (typeof t.slope_rating === "number") parts.push(`Slope ${t.slope_rating}`);
  if (typeof t.course_rating === "number") parts.push(`CR ${t.course_rating}`);
  return parts.join(" • ");
}

function teeHolesPrefill(tees: ApiTee[], selectedTeeId: string) {
  const t = tees.find((x) => x.id === selectedTeeId);
  const holes = t?.holes;
  if (!t || !Array.isArray(holes) || holes.length === 0) return null;

  return holes.slice(0, 18).map((h: any, i: number) => ({
    hole_no: i + 1,
    par: h?.par == null ? null : Number(h.par),
    stroke_index: h?.handicap == null ? null : Number(h.handicap),
  }));
}

export default function NewRoundPage() {
  const router = useRouter();
  const times = useMemo(() => quarterHours(), []);
  const debounceRef = useRef<any>(null);

  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ApiCourseLite[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<ApiCourseLite | null>(null);

  const [courseDetail, setCourseDetail] = useState<any | null>(null);
  const [tees, setTees] = useState<ApiTee[]>([]);
  const [selectedTeeId, setSelectedTeeId] = useState("");

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",

    round_type: "training" as "training" | "competition",
    competition_name: "",

    handicap_start: "",

    course_name: "",
    tee_name: "",
    slope_rating: "",
    course_rating: "",

    notes: "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function fetchSearch(query: string): Promise<ApiCourseLite[]> {
    const r = await fetch(`/api/golfcourse/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error ?? "Erreur recherche API");
    return normalizeCourses(j);
  }

  function localContainsFilter(list: ApiCourseLite[], query: string) {
    const nq = norm(query);
    if (!nq) return list;

    // match sur course_name + club_name + city + country
    const scored = list
      .map((c) => {
        const hay = norm(`${c.course_name} ${c.club_name ?? ""} ${c.city ?? ""} ${c.country ?? ""}`);
        const idx = hay.indexOf(nq);
        return { c, idx };
      })
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx);

    const filtered = scored.map((x) => x.c);
    return filtered.length ? filtered : list;
  }

  async function doSearch(query: string) {
    const s = query.trim();
    if (s.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      // 1) recherche directe
      let list = await fetchSearch(s);

      // 2) fallback si trop peu de résultats : on élargit (ex: "lau" -> "la")
      if (list.length < 3 && s.length >= 3) {
        const fallback = await fetchSearch(s.slice(0, 2));
        // merge unique
        const map = new Map<string, ApiCourseLite>();
        [...list, ...fallback].forEach((c) => map.set(String(c.id), c));
        list = Array.from(map.values());
      }

      // 3) filtre local "contains" pour remonter Lausanne quand tu tapes lau/laus...
      const final = localContainsFilter(list, s);

      setResults(final);
    } catch (e: any) {
      setResults([]);
      setError(e?.message ?? "Erreur recherche");
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 220);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function selectCourse(c: ApiCourseLite) {
    setError(null);
    setSelectedCourse(c);
    setCourseDetail(null);
    setTees([]);
    setSelectedTeeId("");
    setResults([]);

    try {
      const r = await fetch(`/api/golfcourse/course/${encodeURIComponent(String(c.id))}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? "Erreur détail parcours API");

      setCourseDetail(j);

      const teeList = normalizeTees(j);
      setTees(teeList);

      setForm((p) => ({
        ...p,
        course_name: c.course_name || "",
        tee_name: "",
        slope_rating: "",
        course_rating: "",
      }));
    } catch (e: any) {
      setError(e?.message ?? "Erreur détail parcours");
    }
  }

  function applyTee(teeId: string) {
    setSelectedTeeId(teeId);
    const t = tees.find((x) => x.id === teeId);
    if (!t) return;

    setForm((p) => ({
      ...p,
      tee_name: t.tee_name,
      slope_rating: typeof t.slope_rating === "number" ? String(t.slope_rating) : "",
      course_rating: typeof t.course_rating === "number" ? String(t.course_rating) : "",
    }));
  }

  async function createRound() {
    setError(null);

    const date = form.date;
    const time = form.time;
    if (!date || !time) return setError("Date et heure requises.");

    const startAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startAt.getTime())) return setError("Date/heure invalide.");

    if (form.round_type === "competition" && !form.competition_name.trim()) {
      return setError("Nom de compétition requis.");
    }

    if (!selectedCourse) return setError("Choisis un parcours.");
    if (!selectedTeeId) return setError("Choisis un tee de départ.");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) return setError("Session invalide.");

    const payload: any = {
      user_id: userRes.user.id,
      start_at: startAt.toISOString(),

      round_type: form.round_type,
      competition_name: form.round_type === "competition" ? form.competition_name.trim() : null,

      handicap_start: form.handicap_start === "" ? null : Number(form.handicap_start),

      course_source: "golfcourseapi",
      course_name: form.course_name.trim() || null,
      external_course_id: safeStr(selectedCourse.id),
      tee_name: form.tee_name.trim() || null,
      slope_rating: form.slope_rating === "" ? null : Number(form.slope_rating),
      course_rating: form.course_rating === "" ? null : Number(form.course_rating),

      notes: form.notes.trim() || null,
    };

    if (payload.handicap_start !== null && Number.isNaN(payload.handicap_start)) return setError("Handicap invalide.");
    if (payload.slope_rating !== null && Number.isNaN(payload.slope_rating)) return setError("Slope invalide.");
    if (payload.course_rating !== null && Number.isNaN(payload.course_rating)) return setError("Course rating invalide.");

    const ins = await supabase.from("golf_rounds").insert(payload).select("id").maybeSingle();
    if (ins.error) return setError(ins.error.message);

    const id = ins.data?.id;
    if (!id) return setError("Création impossible.");

    const holes = teeHolesPrefill(tees, selectedTeeId);
    if (holes) {
      const rows = holes.map((h) => ({
        round_id: id,
        hole_no: h.hole_no,
        par: h.par,
        stroke_index: h.stroke_index,
        score: null,
        putts: null,
        fairway_hit: null,
        note: null,
      }));
      const up = await supabase.from("golf_round_holes").upsert(rows, { onConflict: "round_id,hole_no" });
      if (up.error) console.warn("holes prefill failed:", up.error.message);
    }

    router.push(`/player/golf/rounds/${id}/edit`);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Ajouter un parcours</div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          Recherche du parcours + tee de départ
        </div>
      </div>

      {error && <div style={{ color: "#a00" }}>{error}</div>}

      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Date</div>
            <input className="input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Heure</div>
            <select className="input" value={form.time} onChange={(e) => set("time", e.target.value)}>
              {times.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Type</div>
            <select className="input" value={form.round_type} onChange={(e) => set("round_type", e.target.value as any)}>
              <option value="training">Entraînement</option>
              <option value="competition">Compétition</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Handicap au départ</div>
            <input className="input" inputMode="decimal" value={form.handicap_start} onChange={(e) => set("handicap_start", e.target.value)} placeholder="ex: 18.4" />
          </label>
        </div>

        {form.round_type === "competition" && (
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Nom de la compétition</div>
            <input className="input" value={form.competition_name} onChange={(e) => set("competition_name", e.target.value)} />
          </label>
        )}

        {/* Course */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Rechercher un parcours</div>
            <input
              className="input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSelectedCourse(null);
                setCourseDetail(null);
                setTees([]);
                setSelectedTeeId("");
                setForm((p) => ({ ...p, course_name: "", tee_name: "", slope_rating: "", course_rating: "" }));
              }}
              placeholder="Ex: Lau…"
            />
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>
              {searching ? "Recherche…" : results.length > 0 ? `${results.length} résultat(s)` : " "}
            </div>
          </label>

          {results.length > 0 && !selectedCourse && (
            <div style={{ display: "grid", gap: 8 }}>
              {results.slice(0, 10).map((c) => (
                <button
                  key={safeStr(c.id)}
                  type="button"
                  className="btn"
                  onClick={() => selectCourse(c)}
                  style={{ textAlign: "left" }}
                >
                  <div style={{ fontWeight: 900 }}>{c.course_name}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                    {(c.club_name ? `${c.club_name} • ` : "")}
                    {c.city ? `${c.city} • ` : ""}
                    {c.country ?? ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedCourse && (
            <div className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }} className="truncate">{selectedCourse.course_name}</div>
                  <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }} className="truncate">
                    {selectedCourse.club_name ?? ""} {selectedCourse.city ? `• ${selectedCourse.city}` : ""} {selectedCourse.country ? `• ${selectedCourse.country}` : ""}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSelectedCourse(null);
                    setCourseDetail(null);
                    setTees([]);
                    setSelectedTeeId("");
                    setForm((p) => ({ ...p, course_name: "", tee_name: "", slope_rating: "", course_rating: "" }));
                  }}
                >
                  Changer
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800 }}>Tee de départ</div>
                  <select className="input" value={selectedTeeId} onChange={(e) => applyTee(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {tees.map((t) => (
                      <option key={t.id} value={t.id}>{teeLabel(t)}</option>
                    ))}
                  </select>

                  {!courseDetail && <div style={{ color: "var(--muted)", fontSize: 12 }}>Chargement du détail…</div>}
                  {courseDetail && tees.length === 0 && (
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      Aucun des 4 tees requis trouvé (blanc/jaune homme, bleu/rouge femme) dans l’API.
                    </div>
                  )}
                </label>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800 }}>Parcours</div>
                    <input className="input" value={form.course_name} readOnly />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800 }}>Slope</div>
                    <input className="input" value={form.slope_rating} readOnly />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800 }}>Course rating</div>
                    <input className="input" value={form.course_rating} readOnly />
                  </label>
                </div>

                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>
                  Les 18 trous seront pré-remplis automatiquement (Par + Index) si disponibles.
                </div>
              </div>
            </div>
          )}
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Remarques</div>
          <textarea className="input" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={createRound}>
            Créer et saisir les trous
          </button>
          <Link className="btn" href="/player/golf/rounds">Annuler</Link>
        </div>
      </div>
    </div>
  );
}
