"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Flame, Mountain, Smile, CalendarRange } from "lucide-react";

type SessionType = "club" | "private" | "individual";

type TrainingSessionRow = {
  id: string;
  start_at: string;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  session_type: SessionType;
};

type TrainingItemRow = {
  session_id: string;
  category: string;
  minutes: number;
};

type Preset = "month" | "last3" | "all" | "custom";

const TRAINING_CAT_LABEL: Record<string, string> = {
  warmup_mobility: "Échauffement",
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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function startOfDayISO(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}

function nextDayStartISO(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function isoToYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function last3MonthsRangeLocal(now = new Date()) {
  // from first day of month (M-2) to end of current month (exclusive tomorrow if you prefer)
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function fmtPeriod(fromDate: string, toDate: string) {
  if (!fromDate && !toDate) return "Toute l’activité";
  const f = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const t = toDate ? new Date(`${toDate}T00:00:00`) : null;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

  if (f && t) return `${fmt(f)} → ${fmt(t)}`;
  if (f) return `Depuis ${fmt(f)}`;
  if (t) return `Jusqu’au ${fmt(t)}`;
  return "—";
}

function avg(values: Array<number | null | undefined>) {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  const s = v.reduce((a, b) => a + b, 0);
  return Math.round((s / v.length) * 10) / 10;
}

function weekStartMonday(d: Date) {
  // local week, Monday as start
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function typeLabel(t: SessionType) {
  if (t === "club") return "Club";
  if (t === "private") return "Privé";
  return "Individuel";
}

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
  const pct = clamp((v / 6) * 100, 0, 100);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{label}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{value ?? "—"}</div>
      </div>

      {/* bar verte (dégradé) via globals.css .bar */}
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
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

const chipActive: React.CSSProperties = {
  borderColor: "rgba(53,72,59,0.35)",
  background: "rgba(53,72,59,0.10)",
};

export default function GolfDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<Preset>("month");

  // filters (YYYY-MM-DD)
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // data
  const [sessions, setSessions] = useState<TrainingSessionRow[]>([]);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  // init preset dates
  useEffect(() => {
    const now = new Date();
    const { start, end } = monthRangeLocal(now);
    setFromDate(isoToYMD(start));
    // toDate inclusive for UI, but query uses next day start => end-1day
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    setToDate(isoToYMD(endInclusive));
    setPreset("month");
  }, []);

  // when preset changes, update dates
  useEffect(() => {
    const now = new Date();

    if (preset === "month") {
      const { start, end } = monthRangeLocal(now);
      const endInclusive = new Date(end);
      endInclusive.setDate(endInclusive.getDate() - 1);
      setFromDate(isoToYMD(start));
      setToDate(isoToYMD(endInclusive));
      return;
    }

    if (preset === "last3") {
      const { start, end } = last3MonthsRangeLocal(now);
      const endInclusive = new Date(end);
      endInclusive.setDate(endInclusive.getDate() - 1);
      setFromDate(isoToYMD(start));
      setToDate(isoToYMD(endInclusive));
      return;
    }

    if (preset === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
  }, [preset]);

  function onChangeFrom(v: string) {
    setFromDate(v);
    setPreset("custom");
  }
  function onChangeTo(v: string) {
    setToDate(v);
    setPreset("custom");
  }
  function clearDates() {
    setFromDate("");
    setToDate("");
    setPreset("all");
  }

  // load sessions + items for period
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type")
          .order("start_at", { ascending: true });

        if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
        if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));

        // sécurité: évite de charger 50k lignes si “Toute l’activité”
        q = q.limit(2000);

        const sRes = await q;
        if (sRes.error) throw new Error(sRes.error.message);

        const sess = (sRes.data ?? []) as TrainingSessionRow[];
        setSessions(sess);

        const ids = sess.map((s) => s.id);
        if (ids.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }

        const iRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes")
          .in("session_id", ids);

        if (iRes.error) throw new Error(iRes.error.message);

        setItems((iRes.data ?? []) as TrainingItemRow[]);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Erreur chargement.");
        setSessions([]);
        setItems([]);
        setLoading(false);
      }
    })();
  }, [fromDate, toDate]);

  // aggregates
  const periodLabel = useMemo(() => fmtPeriod(fromDate, toDate), [fromDate, toDate]);

  const totalMinutes = useMemo(
    () => sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0),
    [sessions]
  );

  const avgMotivation = useMemo(() => avg(sessions.map((s) => s.motivation)), [sessions]);
  const avgDifficulty = useMemo(() => avg(sessions.map((s) => s.difficulty)), [sessions]);
  const avgSatisfaction = useMemo(() => avg(sessions.map((s) => s.satisfaction)), [sessions]);

  const minutesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) map[it.category] = (map[it.category] ?? 0) + (it.minutes || 0);
    return map;
  }, [items]);

  const topCats = useMemo(() => {
    const entries = Object.entries(minutesByCat)
      .map(([cat, minutes]) => ({
        cat,
        label: TRAINING_CAT_LABEL[cat] ?? cat,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return entries;
  }, [minutesByCat]);

  const catMax = useMemo(() => {
    const m = topCats.reduce((mx, x) => Math.max(mx, x.minutes), 0);
    return m || 1;
  }, [topCats]);

  // by type
  const byType = useMemo(() => {
    const m: Record<SessionType, number> = { club: 0, private: 0, individual: 0 };
    for (const s of sessions) m[s.session_type] += 1;
    return m;
  }, [sessions]);

  // weekly series
  const weekSeries = useMemo(() => {
    const map: Record<
      string,
      {
        weekStart: string;
        minutes: number;
        sessionsCount: number;
        motSum: number;
        motN: number;
        difSum: number;
        difN: number;
        satSum: number;
        satN: number;
      }
    > = {};

    for (const s of sessions) {
      const d = new Date(s.start_at);
      const ws = weekStartMonday(d);
      const key = isoToYMD(ws);

      if (!map[key]) {
        map[key] = {
          weekStart: key,
          minutes: 0,
          sessionsCount: 0,
          motSum: 0,
          motN: 0,
          difSum: 0,
          difN: 0,
          satSum: 0,
          satN: 0,
        };
      }

      map[key].minutes += s.total_minutes || 0;
      map[key].sessionsCount += 1;

      if (typeof s.motivation === "number") {
        map[key].motSum += s.motivation;
        map[key].motN += 1;
      }
      if (typeof s.difficulty === "number") {
        map[key].difSum += s.difficulty;
        map[key].difN += 1;
      }
      if (typeof s.satisfaction === "number") {
        map[key].satSum += s.satisfaction;
        map[key].satN += 1;
      }
    }

    const list = Object.values(map)
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
      .map((w) => ({
        week: w.weekStart,
        minutes: w.minutes,
        sessions: w.sessionsCount,
        motivation: w.motN ? Math.round((w.motSum / w.motN) * 10) / 10 : null,
        difficulty: w.difN ? Math.round((w.difSum / w.difN) * 10) / 10 : null,
        satisfaction: w.satN ? Math.round((w.satSum / w.satN) * 10) / 10 : null,
      }));

    // label court semaine
    return list.map((x) => {
      const d = new Date(`${x.week}T00:00:00`);
      const label = new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [sessions]);

  // simple insights (règles)
  const insights = useMemo(() => {
    const lines: string[] = [];

    if (sessions.length === 0) return ["Aucune donnée sur la période sélectionnée."];

    // régularité
    if (weekSeries.length >= 2) {
      const last = weekSeries[weekSeries.length - 1];
      const prev = weekSeries[weekSeries.length - 2];
      const delta = last.minutes - prev.minutes;
      const sign = delta >= 0 ? "▲" : "▼";
      lines.push(`Volume hebdo : ${sign} ${Math.abs(delta)} min vs semaine précédente.`);
    }

    // répartition
    if (topCats.length > 0) {
      const total = Object.values(minutesByCat).reduce((a, b) => a + b, 0) || 1;
      const top = topCats[0];
      const pct = Math.round((top.minutes / total) * 100);
      lines.push(`Ton poste principal : ${top.label} (${pct}%).`);
    }

    // type dominance
    const totalS = sessions.length || 1;
    const indPct = Math.round((byType.individual / totalS) * 100);
    const clubPct = Math.round((byType.club / totalS) * 100);
    const privPct = Math.round((byType.private / totalS) * 100);
    const maxType: { t: SessionType; p: number } = [
      { t: "individual", p: indPct },
      { t: "club", p: clubPct },
      { t: "private", p: privPct },
    ].sort((a, b) => b.p - a.p)[0];
    lines.push(`Répartition : ${typeLabel(maxType.t)} dominant (${maxType.p}%).`);

    // sensations
    if (avgMotivation != null && avgSatisfaction != null) {
      if (avgMotivation >= 4.5 && avgSatisfaction >= 4.5) {
        lines.push("Très bonne dynamique : motivation et satisfaction élevées.");
      } else if (avgMotivation < 3 && avgSatisfaction < 3) {
        lines.push("Dynamique faible : attention à la fatigue / objectifs trop élevés.");
      } else {
        lines.push("Sensations stables : continue la régularité et ajuste tes postes clés.");
      }
    }

    return lines.slice(0, 5);
  }, [sessions.length, weekSeries, topCats, minutesByCat, byType, avgMotivation, avgSatisfaction]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* ===== Header ===== */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Golf — Analyse
              </div>
              <div className="marketplace-filter-label" style={{ margin: 0 }}>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <CalendarRange size={16} />
                  {periodLabel}
                </span>
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player">
                Dashboard
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/trainings">
                Entraînements
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* ===== Filters (glass) ===== */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            {/* Presets */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "month" ? chipActive : {}) }}
                onClick={() => setPreset("month")}
                disabled={loading}
              >
                Mois en cours
              </button>
              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "last3" ? chipActive : {}) }}
                onClick={() => setPreset("last3")}
                disabled={loading}
              >
                3 derniers mois
              </button>
              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "all" ? chipActive : {}) }}
                onClick={() => setPreset("all")}
                disabled={loading}
              >
                Toute l’activité
              </button>
              <div style={{ ...chipStyle, ...(preset === "custom" ? chipActive : {}) }}>
                Personnalisé
              </div>
            </div>

            <div className="hr-soft" style={{ margin: "12px 0" }} />

            {/* Dates (stacked, safe mobile) */}
            <div style={{ display: "grid", gap: 10, overflow: "hidden" }}>
              <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Du</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => onChangeFrom(e.target.value)}
                  disabled={loading}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "100%",
                    minWidth: 0,
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.90)",
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    WebkitAppearance: "none",
                    appearance: "none",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Au</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => onChangeTo(e.target.value)}
                  disabled={loading}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: "100%",
                    minWidth: 0,
                    boxSizing: "border-box",
                    background: "rgba(255,255,255,0.90)",
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    WebkitAppearance: "none",
                    appearance: "none",
                  }}
                />
              </label>

              <button className="btn" type="button" onClick={clearDates} disabled={loading} style={{ width: "100%", height: 44 }}>
                Effacer les dates
              </button>
            </div>
          </div>
        </div>

        {/* ===== KPIs ===== */}
        <div className="glass-section">
          <div className="grid-2">
            {/* Volume */}
            <div className="glass-card">
              <div className="card-title">Volume</div>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : sessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <span className="big-number">{totalMinutes}</span>
                    <span className="unit">MIN</span>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="pill-soft">⛳ {sessions.length} séances</span>
                    <span className="pill-soft">Club {byType.club}</span>
                    <span className="pill-soft">Privé {byType.private}</span>
                    <span className="pill-soft">Individuel {byType.individual}</span>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                    (Graphes ci-dessous regroupés par semaine)
                  </div>
                </div>
              )}
            </div>

            {/* Sensations moyennes */}
            <div className="glass-card">
              <div className="card-title">Sensations (moyennes)</div>

              {sessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <RatingBar icon={<Flame size={16} />} label="Motivation" value={avgMotivation} />
                  <RatingBar icon={<Mountain size={16} />} label="Difficulté" value={avgDifficulty} />
                  <RatingBar icon={<Smile size={16} />} label="Satisfaction" value={avgSatisfaction} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Graphes ===== */}
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Volume hebdomadaire</div>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="minutes" name="Minutes / semaine" fill="rgba(53,72,59,0.65)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Tendance des sensations (par semaine)</div>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis domain={[0, 6]} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="motivation" name="Motivation" stroke="var(--green-dark)" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="difficulty" name="Difficulté" stroke="rgba(0,0,0,0.55)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="satisfaction" name="Satisfaction" stroke="var(--green-light)" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Répartition des postes</div>

            {topCats.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {topCats.slice(0, 8).map((x) => {
                  const w = Math.round((x.minutes / catMax) * 100);
                  return (
                    <div key={x.cat}>
                      <div className="bar-row">
                        <div>{x.label}</div>
                        <div>{x.minutes} min</div>
                      </div>
                      <div className="bar">
                        <span style={{ width: `${w}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ===== Insights ===== */}
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Analyse</div>
            <div style={{ display: "grid", gap: 10 }}>
              {insights.map((t, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: "rgba(255,255,255,0.60)",
                    borderRadius: 14,
                    padding: 12,
                    fontSize: 13,
                    fontWeight: 850,
                    color: "rgba(0,0,0,0.72)",
                    lineHeight: 1.35,
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== Parcours (placeholder) ===== */}
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Parcours (bientôt)</div>
            <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, lineHeight: 1.4 }}>
              Ici on ajoutera l’analyse des parcours (score, GIR, fairways, putts, eagles/birdies/bogeys, etc.)
              et la corrélation avec tes entraînements (ex: wedging → doubles+).
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span className="pill-soft">GIR</span>
              <span className="pill-soft">Fairways</span>
              <span className="pill-soft">Putts</span>
              <span className="pill-soft">Score vs Par</span>
            </div>
          </div>
        </div>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}