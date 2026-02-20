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
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function typeLabelShort(t: SessionType) {
  if (t === "club") return "Club";
  if (t === "private") return "Privé";
  return "Individuel";
}

function typeLabelLong(t: SessionType) {
  if (t === "club") return "Entraînement en club";
  if (t === "private") return "Entraînement privé";
  return "Entraînement individuel";
}

function deltaPill(delta: number | null, suffix = "") {
  if (delta == null || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  const down = delta < 0;
  const sign = up ? "▲" : down ? "▼" : "•";
  const val = Math.abs(delta);

  return (
    <span
      className="pill-soft"
      style={{
        background: "rgba(0,0,0,0.06)",
        fontSize: 12,
        fontWeight: 950,
        color: up ? "rgba(47,125,79,1)" : down ? "rgba(185,28,28,1)" : "rgba(0,0,0,0.55)",
      }}
      title="Comparatif période précédente"
    >
      {sign} {val}
      {suffix}
    </span>
  );
}

function RatingBar({
  icon,
  label,
  value,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  delta?: number | null;
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

        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{value ?? "—"}</div>
          {deltaPill(delta ?? null)}
        </div>
      </div>

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

function diffDaysInclusive(fromYmd: string, toYmd: string) {
  const a = new Date(`${fromYmd}T00:00:00`).getTime();
  const b = new Date(`${toYmd}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const days = Math.round((b - a) / (24 * 3600 * 1000)) + 1;
  return days > 0 ? days : null;
}

function shiftYmd(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoToYMD(d);
}

export default function GolfDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<Preset>("month");

  // filters (YYYY-MM-DD)
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // data (current)
  const [sessions, setSessions] = useState<TrainingSessionRow[]>([]);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  // data (previous period KPIs only)
  const [prevSessions, setPrevSessions] = useState<TrainingSessionRow[]>([]);

  // init preset dates
  useEffect(() => {
    const now = new Date();
    const { start, end } = monthRangeLocal(now);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);

    setFromDate(isoToYMD(start));
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

  const periodLabel = useMemo(() => fmtPeriod(fromDate, toDate), [fromDate, toDate]);

  // compute previous period range (for KPIs compare)
  const prevRange = useMemo(() => {
    if (preset === "all") return null;

    // month: previous calendar month
    if (preset === "month") {
      const now = new Date();
      const cur = monthRangeLocal(now);
      const prevMonthStart = new Date(cur.start.getFullYear(), cur.start.getMonth() - 1, 1, 0, 0, 0, 0);
      const prevMonthEnd = new Date(cur.start.getFullYear(), cur.start.getMonth(), 1, 0, 0, 0, 0);
      const prevEndInclusive = new Date(prevMonthEnd);
      prevEndInclusive.setDate(prevEndInclusive.getDate() - 1);
      return { from: isoToYMD(prevMonthStart), to: isoToYMD(prevEndInclusive) };
    }

    // last3: previous 3 months block
    if (preset === "last3") {
      const now = new Date();
      const cur = last3MonthsRangeLocal(now);
      // cur.start is 1st day of (M-2). previous block = 3 months before that
      const prevStart = new Date(cur.start.getFullYear(), cur.start.getMonth() - 3, 1, 0, 0, 0, 0);
      const prevEnd = new Date(cur.start.getFullYear(), cur.start.getMonth(), 1, 0, 0, 0, 0);
      const prevEndInclusive = new Date(prevEnd);
      prevEndInclusive.setDate(prevEndInclusive.getDate() - 1);
      return { from: isoToYMD(prevStart), to: isoToYMD(prevEndInclusive) };
    }

    // custom: only if both from/to are present
    if (preset === "custom" && fromDate && toDate) {
      const days = diffDaysInclusive(fromDate, toDate);
      if (!days) return null;
      const prevTo = shiftYmd(fromDate, -1);
      const prevFrom = shiftYmd(prevTo, -(days - 1));
      return { from: prevFrom, to: prevTo };
    }

    return null;
  }, [preset, fromDate, toDate]);

  // load current sessions + items for period
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

        // cap safety
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

        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in("session_id", ids);
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

  // load previous period sessions (KPIs only)
  useEffect(() => {
    (async () => {
      if (!prevRange) {
        setPrevSessions([]);
        return;
      }

      setLoadingPrev(true);
      try {
        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type")
          .order("start_at", { ascending: true });

        q = q.gte("start_at", startOfDayISO(prevRange.from)).lt("start_at", nextDayStartISO(prevRange.to)).limit(2000);

        const res = await q;
        if (res.error) throw new Error(res.error.message);

        setPrevSessions((res.data ?? []) as TrainingSessionRow[]);
      } catch {
        setPrevSessions([]);
      } finally {
        setLoadingPrev(false);
      }
    })();
  }, [prevRange?.from, prevRange?.to]);

  // aggregates (current)
  const totalMinutes = useMemo(() => sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0), [sessions]);
  const avgMotivation = useMemo(() => avg(sessions.map((s) => s.motivation)), [sessions]);
  const avgDifficulty = useMemo(() => avg(sessions.map((s) => s.difficulty)), [sessions]);
  const avgSatisfaction = useMemo(() => avg(sessions.map((s) => s.satisfaction)), [sessions]);

  const byType = useMemo(() => {
    const m: Record<SessionType, number> = { club: 0, private: 0, individual: 0 };
    for (const s of sessions) m[s.session_type] += 1;
    return m;
  }, [sessions]);

  const minutesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) map[it.category] = (map[it.category] ?? 0) + (it.minutes || 0);
    return map;
  }, [items]);

  const topCats = useMemo(() => {
    return Object.entries(minutesByCat)
      .map(([cat, minutes]) => ({ cat, label: TRAINING_CAT_LABEL[cat] ?? cat, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [minutesByCat]);

  const catMax = useMemo(() => {
    const m = topCats.reduce((mx, x) => Math.max(mx, x.minutes), 0);
    return m || 1;
  }, [topCats]);

  // aggregates (previous)
  const prevTotalMinutes = useMemo(() => prevSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0), [prevSessions]);
  const prevCount = useMemo(() => prevSessions.length, [prevSessions]);
  const prevAvgMotivation = useMemo(() => avg(prevSessions.map((s) => s.motivation)), [prevSessions]);
  const prevAvgDifficulty = useMemo(() => avg(prevSessions.map((s) => s.difficulty)), [prevSessions]);
  const prevAvgSatisfaction = useMemo(() => avg(prevSessions.map((s) => s.satisfaction)), [prevSessions]);

  // deltas
  const deltaMinutes = useMemo(() => (prevRange ? totalMinutes - prevTotalMinutes : null), [prevRange, totalMinutes, prevTotalMinutes]);
  const deltaCount = useMemo(() => (prevRange ? sessions.length - prevCount : null), [prevRange, sessions.length, prevCount]);
  const deltaMot = useMemo(() => {
    if (!prevRange) return null;
    if (avgMotivation == null || prevAvgMotivation == null) return null;
    return Math.round((avgMotivation - prevAvgMotivation) * 10) / 10;
  }, [prevRange, avgMotivation, prevAvgMotivation]);
  const deltaDif = useMemo(() => {
    if (!prevRange) return null;
    if (avgDifficulty == null || prevAvgDifficulty == null) return null;
    return Math.round((avgDifficulty - prevAvgDifficulty) * 10) / 10;
  }, [prevRange, avgDifficulty, prevAvgDifficulty]);
  const deltaSat = useMemo(() => {
    if (!prevRange) return null;
    if (avgSatisfaction == null || prevAvgSatisfaction == null) return null;
    return Math.round((avgSatisfaction - prevAvgSatisfaction) * 10) / 10;
  }, [prevRange, avgSatisfaction, prevAvgSatisfaction]);

  // weekly series (current)
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

    return list.map((x) => {
      const d = new Date(`${x.week}T00:00:00`);
      const label = new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [sessions]);

  // insights (simple rules)
  const insights = useMemo(() => {
    const lines: string[] = [];

    if (sessions.length === 0) return ["Aucune donnée sur la période sélectionnée."];

    if (prevRange && !loadingPrev) {
      const label = preset === "month" ? "mois précédent" : "période précédente";
      if (deltaMinutes != null) {
        const sign = deltaMinutes > 0 ? "▲" : deltaMinutes < 0 ? "▼" : "•";
        lines.push(`Minutes : ${sign} ${Math.abs(deltaMinutes)} vs ${label}.`);
      }
      if (deltaCount != null) {
        const sign = deltaCount > 0 ? "▲" : deltaCount < 0 ? "▼" : "•";
        lines.push(`Séances : ${sign} ${Math.abs(deltaCount)} vs ${label}.`);
      }
    }

    if (topCats.length > 0) {
      const total = Object.values(minutesByCat).reduce((a, b) => a + b, 0) || 1;
      const top = topCats[0];
      const pct = Math.round((top.minutes / total) * 100);
      lines.push(`Poste principal : ${top.label} (${pct}%).`);
    }

    // type dominance
    const totalS = sessions.length || 1;
    const typeStats: Array<{ t: SessionType; p: number }> = [
      { t: "individual", p: Math.round((byType.individual / totalS) * 100) },
      { t: "club", p: Math.round((byType.club / totalS) * 100) },
      { t: "private", p: Math.round((byType.private / totalS) * 100) },
    ];
    const maxType = typeStats.reduce((best, cur) => (cur.p > best.p ? cur : best), typeStats[0]);
    lines.push(`Répartition : ${typeLabelShort(maxType.t)} dominant (${maxType.p}%).`);

    if (weekSeries.length >= 2) {
      const last = weekSeries[weekSeries.length - 1];
      const prev = weekSeries[weekSeries.length - 2];
      const delta = (last.minutes ?? 0) - (prev.minutes ?? 0);
      const sign = delta >= 0 ? "▲" : "▼";
      lines.push(`Semaine dernière vs précédente : ${sign} ${Math.abs(delta)} min.`);
    }

    return lines.slice(0, 5);
  }, [
    sessions.length,
    prevRange,
    loadingPrev,
    deltaMinutes,
    deltaCount,
    preset,
    topCats,
    minutesByCat,
    byType,
    weekSeries,
  ]);

  const compareLabel = useMemo(() => {
    if (!prevRange) return null;
    if (preset === "month") return "vs mois précédent";
    if (preset === "last3") return "vs 3 mois précédents";
    return "vs période précédente";
  }, [prevRange, preset]);

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
            {/* Volume (reworked) */}
            <div className="glass-card">
              <div className="card-title">Volume</div>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : sessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {/* minutes + séances */}
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <span className="big-number">{totalMinutes}</span>
                        <span className="unit">MIN</span>
                      </div>
                      {deltaMinutes != null && (
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>{deltaPill(deltaMinutes, " min")}</div>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span className="pill-soft">⛳ {sessions.length} séances</span>
                      {deltaCount != null && <div>{deltaPill(deltaCount, " séances")}</div>}
                    </div>

                    {compareLabel && (
                      <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>
                    )}
                  </div>

                  <div className="hr-soft" style={{ margin: "2px 0" }} />

                  {/* list types */}
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>Répartition</div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("club")}</div>
                        <div style={typeRowRightStyle}>{byType.club}</div>
                      </div>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("private")}</div>
                        <div style={typeRowRightStyle}>{byType.private}</div>
                      </div>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("individual")}</div>
                        <div style={typeRowRightStyle}>{byType.individual}</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                    (Graphes regroupés par semaine)
                  </div>
                </div>
              )}
            </div>

            {/* Sensations moyennes (avec comparatif) */}
            <div className="glass-card">
              <div className="card-title">Sensations (moyennes)</div>

              {sessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <RatingBar icon={<Flame size={16} />} label="Motivation" value={avgMotivation} delta={deltaMot} />
                  <RatingBar icon={<Mountain size={16} />} label="Difficulté" value={avgDifficulty} delta={deltaDif} />
                  <RatingBar icon={<Smile size={16} />} label="Satisfaction" value={avgSatisfaction} delta={deltaSat} />

                  {compareLabel && (
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>
                  )}
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

const typeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(255,255,255,0.55)",
  borderRadius: 12,
  padding: "10px 12px",
};

const typeRowLeftStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.68)",
};

const typeRowRightStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.78)",
};