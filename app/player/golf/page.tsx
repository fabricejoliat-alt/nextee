"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type SessionRow = {
  id: string;
  start_at: string;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
};

type ItemRow = {
  session_id: string;
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
};

const CAT_LABEL: Record<ItemRow["category"], string> = {
  warmup_mobility: "Échauffement / mobilité",
  long_game: "Long jeu",
  putting: "Putting",
  wedging: "Wedging",
  pitching: "Pitching",
  chipping: "Chipping",
  bunker: "Bunker",
  course: "Parcours",
  mental: "Préparation mentale",
  fitness: "Fitness / musculation",
  other: "Autre activité",
};

type RangeKey = "month" | "3m" | "year";

function avg(values: Array<number | null>) {
  const v = values.filter((x): x is number => typeof x === "number");
  if (v.length === 0) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return Math.round((sum / v.length) * 10) / 10;
}

function startOfWeekMonday(d: Date) {
  // lundi = 1
  const day = d.getDay(); // 0..6 (0=dimanche)
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function rangeFor(key: RangeKey) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (key === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start, end };
  }
  if (key === "3m") {
    const start = new Date(now);
    start.setMonth(now.getMonth() - 2);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  // year
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  return { start, end };
}

function fmtRangeTitle(key: RangeKey) {
  if (key === "month") return "Ce mois";
  if (key === "3m") return "3 mois";
  return "Année";
}

function fmtWeekLabel(monday: Date) {
  // ex: "Semaine du 05.02"
  const dd = String(monday.getDate()).padStart(2, "0");
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

export default function MonGolfPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Session invalide.");

      const { start, end } = rangeFor(rangeKey);

      // 1) sessions (RLS: user_id = auth.uid)
      const sRes = await supabase
        .from("training_sessions")
        .select("id,start_at,total_minutes,motivation,difficulty,satisfaction")
        .gte("start_at", start.toISOString())
        .lte("start_at", end.toISOString())
        .order("start_at", { ascending: false });

      if (sRes.error) throw new Error(sRes.error.message);

      const sess = (sRes.data ?? []) as SessionRow[];
      setSessions(sess);

      const ids = sess.map((s) => s.id);
      if (ids.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      // 2) items
      const iRes = await supabase
        .from("training_session_items")
        .select("session_id,category,minutes")
        .in("session_id", ids);

      if (iRes.error) throw new Error(iRes.error.message);

      setItems((iRes.data ?? []) as ItemRow[]);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setSessions([]);
      setItems([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const summary = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    const count = sessions.length;

    const motivationAvg = avg(sessions.map((s) => s.motivation));
    const difficultyAvg = avg(sessions.map((s) => s.difficulty));
    const satisfactionAvg = avg(sessions.map((s) => s.satisfaction));

    const byCat: Record<string, number> = {};
    for (const it of items) byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes || 0);

    const topCats = Object.entries(byCat)
      .map(([cat, minutes]) => ({
        cat: cat as ItemRow["category"],
        label: CAT_LABEL[cat as ItemRow["category"]] ?? cat,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 6);

    return { totalMinutes, count, motivationAvg, difficultyAvg, satisfactionAvg, topCats };
  }, [sessions, items]);

  const chart = useMemo(() => {
    // minutes par semaine (lundi)
    const byWeek: Record<number, number> = {};
    for (const s of sessions) {
      const d = new Date(s.start_at);
      const monday = startOfWeekMonday(d);
      const key = monday.getTime();
      byWeek[key] = (byWeek[key] ?? 0) + (s.total_minutes || 0);
    }

    const entries = Object.entries(byWeek)
      .map(([k, minutes]) => ({ monday: new Date(Number(k)), minutes }))
      .sort((a, b) => a.monday.getTime() - b.monday.getTime());

    const max = entries.reduce((m, e) => Math.max(m, e.minutes), 0) || 1;

    return { entries, max };
  }, [sessions]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Mon Golf</div>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
              Résumé — {fmtRangeTitle(rangeKey)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={() => setRangeKey("month")}
              style={{ background: rangeKey === "month" ? "rgba(0,0,0,0.06)" : undefined }}
            >
              Ce mois
            </button>
            <button
              className="btn"
              onClick={() => setRangeKey("3m")}
              style={{ background: rangeKey === "3m" ? "rgba(0,0,0,0.06)" : undefined }}
            >
              3 mois
            </button>
            <button
              className="btn"
              onClick={() => setRangeKey("year")}
              style={{ background: rangeKey === "year" ? "rgba(0,0,0,0.06)" : undefined }}
            >
              Année
            </button>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: "#a00" }}>{error}</div>}
      </div>

      {/* Cartouche Entraînements */}
      <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900 }}>Mes entraînements</div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
              {loading ? "…" : `${summary.count} séance(s) • ${summary.totalMinutes} min`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/player/trainings/new">
              Ajouter
            </Link>
            <Link className="btn" href="/player/trainings">
              Voir tout
            </Link>
          </div>
        </div>

        {/* Mini graphe */}
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12 }}>
          <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
            Minutes par semaine
          </div>

          {loading ? (
            <div style={{ color: "var(--muted)" }}>Chargement…</div>
          ) : chart.entries.length === 0 ? (
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
              Aucune séance sur la période.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {chart.entries.map((e) => {
                const w = Math.round((e.minutes / chart.max) * 100);
                return (
                  <div key={e.monday.getTime()} style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: "var(--muted)", fontWeight: 800 }}>
                      <span>Semaine {fmtWeekLabel(e.monday)}</span>
                      <span>{e.minutes} min</span>
                    </div>
                    <div style={{ height: 10, background: "#efefef", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${w}%`, height: "100%", background: "#111" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sensations + top catégories */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12 }}>Sensations (moy.)</div>
            <div style={{ marginTop: 8, display: "grid", gap: 6, color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
              <div>Motivation : {summary.motivationAvg ?? "—"} / 6</div>
              <div>Difficulté : {summary.difficultyAvg ?? "—"} / 6</div>
              <div>Satisfaction : {summary.satisfactionAvg ?? "—"} / 6</div>
            </div>
          </div>

          <div style={{ border: "1px solid #e8e8e8", borderRadius: 14, padding: 12 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 12 }}>Top catégories</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {loading ? (
                <div style={{ color: "var(--muted)" }}>…</div>
              ) : summary.topCats.length === 0 ? (
                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
                  Ajoute des postes pour voir la répartition.
                </div>
              ) : (
                summary.topCats.map((c) => (
                  <div key={c.cat} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{c.label}</div>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{c.minutes} min</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Placeholders pour la suite */}
      <div className="card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 900 }}>Parcours</div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          Bientôt : tes tours (compétition / hors compétition) + stats.
        </div>
      </div>

      <div className="card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 900 }}>Calendrier</div>
        <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
          Bientôt : entraînements, tournois, planning du club.
        </div>
      </div>
    </div>
  );
}
