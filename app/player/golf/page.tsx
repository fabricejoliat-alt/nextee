"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Flame, Mountain, Smile, CalendarRange, SlidersHorizontal, X } from "lucide-react";

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

type GolfRoundRow = {
  id: string;
  start_at: string;
  round_type: string; // training | competition | ...
  course_name: string | null;
  location: string | null;
  tee_name: string | null;
  slope_rating: number | null;
  course_rating: number | null;
  total_score: number | null;
  total_putts: number | null;
  fairways_hit: number | null;
  fairways_total: number | null;
  gir: number | null;
  eagles: number | null;
  birdies: number | null;
  pars: number | null;
  bogeys: number | null;
  doubles_plus: number | null;
};

type GolfHoleRow = {
  round_id: string;
  hole_no: number;
  par: number | null;
  score: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
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

const LOOKBACK_DAYS = 14;

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

function typeLabelLong(t: SessionType) {
  if (t === "club") return "Entraînement en club";
  if (t === "private") return "Entraînement privé";
  return "Entraînement individuel";
}

function deltaArrow(delta: number | null) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  const down = delta < 0;
  const sign = up ? "▲" : down ? "▼" : "•";

  return (
    <span
      className="pill-soft"
      style={{
        background: "rgba(0,0,0,0.06)",
        fontSize: 12,
        fontWeight: 950,
        padding: "6px 10px",
        minWidth: 34,
        textAlign: "center",
        color: up ? "rgba(47,125,79,1)" : down ? "rgba(185,28,28,1)" : "rgba(0,0,0,0.55)",
      }}
      title="Comparatif période précédente"
    >
      {sign}
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
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              color: "rgba(0,0,0,0.55)",
              width: 34,
              textAlign: "right",
            }}
          >
            {value ?? "—"}
          </div>
          {deltaArrow(delta ?? null)}
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
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.12)",
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
  borderColor: "rgba(53,72,59,0.45)",
  background: "rgba(53,72,59,0.14)",
  boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
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

function toISOStartMinusDays(fromYmd: string, days: number) {
  const d = new Date(`${fromYmd}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function pearson(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  const x = xs.slice(0, n);
  const y = ys.slice(0, n);

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x);
  const my = mean(y);

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function corrStrength(r: number | null) {
  if (r == null) return { label: "—" };
  const ar = Math.abs(r);
  if (ar >= 0.6) return { label: "forte" };
  if (ar >= 0.35) return { label: "modérée" };
  if (ar >= 0.2) return { label: "faible" };
  return { label: "très faible" };
}

function pct(n: number, d: number) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function safeDiv(n: number, d: number) {
  if (!d) return null;
  return n / d;
}

function scoreBucketFromHole(par: number | null, score: number | null) {
  if (typeof par !== "number" || typeof score !== "number") return null;
  const diff = score - par;
  if (diff <= -2) return "eagle"; // includes albatross -> treated as eagle bucket
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "doubleplus";
}

export default function GolfDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [loadingPrevRounds, setLoadingPrevRounds] = useState(false);
  const [loadingHoles, setLoadingHoles] = useState(false);
  const [loadingPrevHoles, setLoadingPrevHoles] = useState(false);
  const [loadingTrainLookback, setLoadingTrainLookback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<Preset>("month");
  const [customOpen, setCustomOpen] = useState(false);

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [sessions, setSessions] = useState<TrainingSessionRow[]>([]);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  const [prevSessions, setPrevSessions] = useState<TrainingSessionRow[]>([]);

  const [rounds, setRounds] = useState<GolfRoundRow[]>([]);
  const [prevRounds, setPrevRounds] = useState<GolfRoundRow[]>([]);

  const [holes, setHoles] = useState<GolfHoleRow[]>([]);
  const [prevHoles, setPrevHoles] = useState<GolfHoleRow[]>([]);

  const [sessionsLookback, setSessionsLookback] = useState<TrainingSessionRow[]>([]);
  const [itemsLookback, setItemsLookback] = useState<TrainingItemRow[]>([]);

  useEffect(() => {
    const now = new Date();
    const { start, end } = monthRangeLocal(now);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);

    setFromDate(isoToYMD(start));
    setToDate(isoToYMD(endInclusive));
    setPreset("month");
  }, []);

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
    setCustomOpen(false);
  }

  const periodLabel = useMemo(() => fmtPeriod(fromDate, toDate), [fromDate, toDate]);

  const prevRange = useMemo(() => {
    if (preset === "all") return null;

    if (preset === "month") {
      const now = new Date();
      const cur = monthRangeLocal(now);
      const prevMonthStart = new Date(cur.start.getFullYear(), cur.start.getMonth() - 1, 1, 0, 0, 0, 0);
      const prevMonthEnd = new Date(cur.start.getFullYear(), cur.start.getMonth(), 1, 0, 0, 0, 0);
      const prevEndInclusive = new Date(prevMonthEnd);
      prevEndInclusive.setDate(prevEndInclusive.getDate() - 1);
      return { from: isoToYMD(prevMonthStart), to: isoToYMD(prevEndInclusive) };
    }

    if (preset === "last3") {
      const now = new Date();
      const cur = last3MonthsRangeLocal(now);
      const prevStart = new Date(cur.start.getFullYear(), cur.start.getMonth() - 3, 1, 0, 0, 0, 0);
      const prevEnd = new Date(cur.start.getFullYear(), cur.start.getMonth(), 1, 0, 0, 0, 0);
      const prevEndInclusive = new Date(prevEnd);
      prevEndInclusive.setDate(prevEndInclusive.getDate() - 1);
      return { from: isoToYMD(prevStart), to: isoToYMD(prevEndInclusive) };
    }

    if (preset === "custom" && fromDate && toDate) {
      const days = diffDaysInclusive(fromDate, toDate);
      if (!days) return null;
      const prevTo = shiftYmd(fromDate, -1);
      const prevFrom = shiftYmd(prevTo, -(days - 1));
      return { from: prevFrom, to: prevTo };
    }

    return null;
  }, [preset, fromDate, toDate]);

  const compareLabel = useMemo(() => {
    if (!prevRange) return null;
    if (preset === "month") return "vs mois précédent";
    if (preset === "last3") return "vs 3 mois précédents";
    return "vs période précédente";
  }, [prevRange, preset]);

  // ===== LOAD TRAININGS (current) =====
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");
        const uid = userRes.user.id;

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type")
          .eq("user_id", uid)
          .order("start_at", { ascending: true });

        if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
        if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));
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

  // ===== LOAD TRAININGS (prev KPIs) =====
  useEffect(() => {
    (async () => {
      if (!prevRange) {
        setPrevSessions([]);
        return;
      }

      setLoadingPrev(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) throw new Error("Session invalide.");

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type")
          .eq("user_id", uid)
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

  // ===== LOAD ROUNDS (current) =====
  useEffect(() => {
    (async () => {
      setLoadingRounds(true);
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");
        const uid = userRes.user.id;

        let q = supabase
          .from("golf_rounds")
          .select(
            "id,start_at,round_type,course_name,location,tee_name,slope_rating,course_rating,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus"
          )
          .eq("user_id", uid)
          .order("start_at", { ascending: true });

        if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
        if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));
        q = q.limit(2000);

        const rRes = await q;
        if (rRes.error) throw new Error(rRes.error.message);

        setRounds((rRes.data ?? []) as GolfRoundRow[]);
      } catch {
        setRounds([]);
      } finally {
        setLoadingRounds(false);
      }
    })();
  }, [fromDate, toDate]);

  // ===== LOAD ROUNDS (prev, for trends) =====
  useEffect(() => {
    (async () => {
      if (!prevRange) {
        setPrevRounds([]);
        return;
      }

      setLoadingPrevRounds(true);
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");
        const uid = userRes.user.id;

        let q = supabase
          .from("golf_rounds")
          .select("id,start_at,round_type,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus")
          .eq("user_id", uid)
          .gte("start_at", startOfDayISO(prevRange.from))
          .lt("start_at", nextDayStartISO(prevRange.to))
          .order("start_at", { ascending: true })
          .limit(2000);

        const rRes = await q;
        if (rRes.error) throw new Error(rRes.error.message);

        setPrevRounds((rRes.data ?? []) as GolfRoundRow[]);
      } catch {
        setPrevRounds([]);
      } finally {
        setLoadingPrevRounds(false);
      }
    })();
  }, [prevRange?.from, prevRange?.to]);

  // ===== LOAD HOLES (current) =====
  useEffect(() => {
    (async () => {
      setLoadingHoles(true);
      try {
        const ids = rounds.map((r) => r.id);
        if (ids.length === 0) {
          setHoles([]);
          return;
        }

        const hRes = await supabase
          .from("golf_round_holes")
          .select("round_id,hole_no,par,score,putts,fairway_hit")
          .in("round_id", ids);

        if (hRes.error) throw new Error(hRes.error.message);
        setHoles((hRes.data ?? []) as GolfHoleRow[]);
      } catch {
        setHoles([]);
      } finally {
        setLoadingHoles(false);
      }
    })();
  }, [rounds]);

  // ===== LOAD HOLES (prev) =====
  useEffect(() => {
    (async () => {
      setLoadingPrevHoles(true);
      try {
        if (!prevRange) {
          setPrevHoles([]);
          return;
        }
        const ids = prevRounds.map((r) => r.id);
        if (ids.length === 0) {
          setPrevHoles([]);
          return;
        }

        const hRes = await supabase
          .from("golf_round_holes")
          .select("round_id,hole_no,par,score,putts,fairway_hit")
          .in("round_id", ids);

        if (hRes.error) throw new Error(hRes.error.message);
        setPrevHoles((hRes.data ?? []) as GolfHoleRow[]);
      } catch {
        setPrevHoles([]);
      } finally {
        setLoadingPrevHoles(false);
      }
    })();
  }, [prevRange, prevRounds]);

  // ===== LOAD TRAININGS LOOKBACK (for correlation) =====
  useEffect(() => {
    (async () => {
      setLoadingTrainLookback(true);
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("Session invalide. Reconnecte-toi.");
        const uid = userRes.user.id;

        const now = new Date();
        const fallbackFrom = isoToYMD(new Date(now.getFullYear(), now.getMonth() - 2, 1));
        const from = fromDate || fallbackFrom;
        const to = toDate || isoToYMD(now);

        const fromISO = toISOStartMinusDays(from, LOOKBACK_DAYS);
        const toISO = nextDayStartISO(to);

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type")
          .eq("user_id", uid)
          .gte("start_at", fromISO)
          .lt("start_at", toISO)
          .order("start_at", { ascending: true })
          .limit(4000);

        if (sRes.error) throw new Error(sRes.error.message);

        const sess = (sRes.data ?? []) as TrainingSessionRow[];
        setSessionsLookback(sess);

        const ids = sess.map((s) => s.id);
        if (ids.length === 0) {
          setItemsLookback([]);
          return;
        }

        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in("session_id", ids);
        if (iRes.error) throw new Error(iRes.error.message);

        setItemsLookback((iRes.data ?? []) as TrainingItemRow[]);
      } catch {
        setSessionsLookback([]);
        setItemsLookback([]);
      } finally {
        setLoadingTrainLookback(false);
      }
    })();
  }, [fromDate, toDate]);

  // ===== TRAININGS AGGREGATES (current + prev) =====
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

  const prevTotalMinutes = useMemo(() => prevSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0), [prevSessions]);
  const prevCount = useMemo(() => prevSessions.length, [prevSessions]);
  const prevAvgMotivation = useMemo(() => avg(prevSessions.map((s) => s.motivation)), [prevSessions]);
  const prevAvgDifficulty = useMemo(() => avg(prevSessions.map((s) => s.difficulty)), [prevSessions]);
  const prevAvgSatisfaction = useMemo(() => avg(prevSessions.map((s) => s.satisfaction)), [prevSessions]);

  const deltaMinutes = useMemo(
    () => (prevRange ? totalMinutes - prevTotalMinutes : null),
    [prevRange, totalMinutes, prevTotalMinutes]
  );
  const deltaCount = useMemo(
    () => (prevRange ? sessions.length - prevCount : null),
    [prevRange, sessions.length, prevCount]
  );
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

  // ===== TRAININGS WEEK SERIES =====
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
        map[key] = { weekStart: key, minutes: 0, sessionsCount: 0, motSum: 0, motN: 0, difSum: 0, difN: 0, satSum: 0, satN: 0 };
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

  // ===== MES PARCOURS AGGREGATES (CURRENT + PREV) =====
  const holeAgg = useMemo(() => {
    const byRound: Record<string, GolfHoleRow[]> = {};
    for (const h of holes) (byRound[h.round_id] ??= []).push(h);

    const roundsWithCount: Record<string, number> = {};
    for (const rid of Object.keys(byRound)) roundsWithCount[rid] = byRound[rid].length;

    const holesPlayed = holes.length;

    // completed rounds: only if 18 holes exist in golf_round_holes
    const completedRoundIds = new Set(Object.entries(roundsWithCount).filter(([, n]) => n === 18).map(([rid]) => rid));
    const completedRounds = rounds.filter((r) => completedRoundIds.has(r.id));

    const avgScore18 = avg(
      completedRounds.map((r) => {
        // prefer computed from holes for reliability
        const hs = byRound[r.id] ?? [];
        if (hs.length !== 18) return null;
        const sum = hs.reduce((s, x) => s + (x.score ?? 0), 0);
        return Number.isFinite(sum) && sum > 0 ? sum : r.total_score ?? null;
      })
    );

    // score distribution from holes (more reliable)
    const dist = { eagle: 0, birdie: 0, par: 0, bogey: 0, doubleplus: 0 };
    let distDen = 0;
    for (const h of holes) {
      const b = scoreBucketFromHole(h.par, h.score);
      if (!b) continue;
      dist[b] += 1;
      distDen += 1;
    }

    // putts avg (per hole)
    const puttVals = holes.map((h) => (typeof h.putts === "number" ? h.putts : null));
    const avgPuttsPerHole = avg(puttVals);

    // fairways (par 4/5 only; count only where fairway_hit not null)
    let fwTot = 0;
    let fwHit = 0;
    for (const h of holes) {
      if (h.par == null) continue;
      if (h.par < 4) continue;
      if (typeof h.fairway_hit !== "boolean") continue;
      fwTot += 1;
      if (h.fairway_hit) fwHit += 1;
    }
    const fwPct = fwTot ? round1((fwHit / fwTot) * 100) : null;

    // GIR avg: use golf_rounds.gir (assumed out of 18). Only for completed 18-hole rounds.
    const girVals = completedRounds.map((r) => (typeof r.gir === "number" ? r.gir : null));
    const girAvg = avg(girVals);
    const girPct = girAvg == null ? null : round1((girAvg / 18) * 100);

    // Par scores
    const parBuckets = {
      par3: { sum: 0, n: 0 },
      par4: { sum: 0, n: 0 },
      par5: { sum: 0, n: 0 },
    };

    // 1-9 / 10-18
    const side = {
      front: { sum: 0, n: 0 },
      back: { sum: 0, n: 0 },
    };

    for (const h of holes) {
      const par = h.par;
      const sc = h.score;
      if (typeof par === "number" && typeof sc === "number") {
        if (par === 3) {
          parBuckets.par3.sum += sc;
          parBuckets.par3.n += 1;
        } else if (par === 4) {
          parBuckets.par4.sum += sc;
          parBuckets.par4.n += 1;
        } else if (par === 5) {
          parBuckets.par5.sum += sc;
          parBuckets.par5.n += 1;
        }
      }

      if (typeof sc === "number" && typeof h.hole_no === "number") {
        if (h.hole_no >= 1 && h.hole_no <= 9) {
          side.front.sum += sc;
          side.front.n += 1;
        } else if (h.hole_no >= 10 && h.hole_no <= 18) {
          side.back.sum += sc;
          side.back.n += 1;
        }
      }
    }

    const avgPar3 = parBuckets.par3.n ? round1(parBuckets.par3.sum / parBuckets.par3.n) : null;
    const avgPar4 = parBuckets.par4.n ? round1(parBuckets.par4.sum / parBuckets.par4.n) : null;
    const avgPar5 = parBuckets.par5.n ? round1(parBuckets.par5.sum / parBuckets.par5.n) : null;

    const avgFront = side.front.n ? round1(side.front.sum / side.front.n) : null;
    const avgBack = side.back.n ? round1(side.back.sum / side.back.n) : null;

    return {
      holesPlayed,
      completed18Count: completedRounds.length,
      avgScore18,
      dist,
      distDen,
      avgPuttsPerHole,
      fwPct,
      girAvg,
      girPct,
      avgPar3,
      avgPar4,
      avgPar5,
      avgFront,
      avgBack,
    };
  }, [holes, rounds]);

  const prevHoleAgg = useMemo(() => {
    const byRound: Record<string, GolfHoleRow[]> = {};
    for (const h of prevHoles) (byRound[h.round_id] ??= []).push(h);

    const roundsWithCount: Record<string, number> = {};
    for (const rid of Object.keys(byRound)) roundsWithCount[rid] = byRound[rid].length;

    const completedRoundIds = new Set(Object.entries(roundsWithCount).filter(([, n]) => n === 18).map(([rid]) => rid));
    const completedRounds = prevRounds.filter((r) => completedRoundIds.has(r.id));

    const avgScore18 = avg(
      completedRounds.map((r) => {
        const hs = byRound[r.id] ?? [];
        if (hs.length !== 18) return null;
        const sum = hs.reduce((s, x) => s + (x.score ?? 0), 0);
        return Number.isFinite(sum) && sum > 0 ? sum : r.total_score ?? null;
      })
    );

    const dist = { eagle: 0, birdie: 0, par: 0, bogey: 0, doubleplus: 0 };
    let distDen = 0;
    for (const h of prevHoles) {
      const b = scoreBucketFromHole(h.par, h.score);
      if (!b) continue;
      dist[b] += 1;
      distDen += 1;
    }

    const avgPuttsPerHole = avg(prevHoles.map((h) => (typeof h.putts === "number" ? h.putts : null)));

    let fwTot = 0;
    let fwHit = 0;
    for (const h of prevHoles) {
      if (h.par == null) continue;
      if (h.par < 4) continue;
      if (typeof h.fairway_hit !== "boolean") continue;
      fwTot += 1;
      if (h.fairway_hit) fwHit += 1;
    }
    const fwPct = fwTot ? round1((fwHit / fwTot) * 100) : null;

    const girVals = completedRounds.map((r) => (typeof r.gir === "number" ? r.gir : null));
    const girAvg = avg(girVals);
    const girPct = girAvg == null ? null : round1((girAvg / 18) * 100);

    const parBuckets = {
      par3: { sum: 0, n: 0 },
      par4: { sum: 0, n: 0 },
      par5: { sum: 0, n: 0 },
    };
    const side = {
      front: { sum: 0, n: 0 },
      back: { sum: 0, n: 0 },
    };

    for (const h of prevHoles) {
      const par = h.par;
      const sc = h.score;
      if (typeof par === "number" && typeof sc === "number") {
        if (par === 3) {
          parBuckets.par3.sum += sc;
          parBuckets.par3.n += 1;
        } else if (par === 4) {
          parBuckets.par4.sum += sc;
          parBuckets.par4.n += 1;
        } else if (par === 5) {
          parBuckets.par5.sum += sc;
          parBuckets.par5.n += 1;
        }
      }

      if (typeof sc === "number" && typeof h.hole_no === "number") {
        if (h.hole_no >= 1 && h.hole_no <= 9) {
          side.front.sum += sc;
          side.front.n += 1;
        } else if (h.hole_no >= 10 && h.hole_no <= 18) {
          side.back.sum += sc;
          side.back.n += 1;
        }
      }
    }

    const avgPar3 = parBuckets.par3.n ? round1(parBuckets.par3.sum / parBuckets.par3.n) : null;
    const avgPar4 = parBuckets.par4.n ? round1(parBuckets.par4.sum / parBuckets.par4.n) : null;
    const avgPar5 = parBuckets.par5.n ? round1(parBuckets.par5.sum / parBuckets.par5.n) : null;

    const avgFront = side.front.n ? round1(side.front.sum / side.front.n) : null;
    const avgBack = side.back.n ? round1(side.back.sum / side.back.n) : null;

    return { avgScore18, dist, distDen, avgPuttsPerHole, fwPct, girAvg, girPct, avgPar3, avgPar4, avgPar5, avgFront, avgBack };
  }, [prevHoles, prevRounds]);

  // Volume / type split
  const roundsSplit = useMemo(() => {
    let training = 0;
    let competition = 0;
    let other = 0;
    for (const r of rounds) {
      if (r.round_type === "training") training += 1;
      else if (r.round_type === "competition") competition += 1;
      else other += 1;
    }
    return { training, competition, other };
  }, [rounds]);

  const prevRoundsSplit = useMemo(() => {
    let training = 0;
    let competition = 0;
    let other = 0;
    for (const r of prevRounds) {
      if (r.round_type === "training") training += 1;
      else if (r.round_type === "competition") competition += 1;
      else other += 1;
    }
    return { training, competition, other };
  }, [prevRounds]);

  // Score distribution current with % + trend arrows
  const scoreDistUI = useMemo(() => {
    const den = holeAgg.distDen || 0;

    const cur = {
      eagle: { n: holeAgg.dist.eagle, p: den ? round1((holeAgg.dist.eagle / den) * 100) : null },
      birdie: { n: holeAgg.dist.birdie, p: den ? round1((holeAgg.dist.birdie / den) * 100) : null },
      par: { n: holeAgg.dist.par, p: den ? round1((holeAgg.dist.par / den) * 100) : null },
      bogey: { n: holeAgg.dist.bogey, p: den ? round1((holeAgg.dist.bogey / den) * 100) : null },
      doubleplus: { n: holeAgg.dist.doubleplus, p: den ? round1((holeAgg.dist.doubleplus / den) * 100) : null },
    };

    const pden = prevHoleAgg.distDen || 0;
    const prev = {
      eagle: { p: pden ? (prevHoleAgg.dist.eagle / pden) * 100 : null },
      birdie: { p: pden ? (prevHoleAgg.dist.birdie / pden) * 100 : null },
      par: { p: pden ? (prevHoleAgg.dist.par / pden) * 100 : null },
      bogey: { p: pden ? (prevHoleAgg.dist.bogey / pden) * 100 : null },
      doubleplus: { p: pden ? (prevHoleAgg.dist.doubleplus / pden) * 100 : null },
    };

    const trend = (curPct: number | null, prevPct: number | null) => {
      if (!prevRange) return null;
      if (curPct == null || prevPct == null) return null;
      const d = curPct - prevPct;
      return d === 0 ? 0 : d;
    };

    return {
      cur,
      trend: {
        eagle: trend(cur.eagle.p, prev.eagle.p),
        birdie: trend(cur.birdie.p, prev.birdie.p),
        par: trend(cur.par.p, prev.par.p),
        bogey: trend(cur.bogey.p, prev.bogey.p),
        doubleplus: trend(cur.doubleplus.p, prev.doubleplus.p),
      },
    };
  }, [holeAgg, prevHoleAgg, prevRange]);

  // Card 3: GIR, putts, fairways + trends
  const keyKpisUI = useMemo(() => {
    const delta = (curVal: number | null, prevVal: number | null) => {
      if (!prevRange) return null;
      if (curVal == null || prevVal == null) return null;
      const d = curVal - prevVal;
      return d === 0 ? 0 : d;
    };

    // For putts, lower is better. We still show arrow based on delta value (up if increased).
    return {
      girPct: holeAgg.girPct,
      girArrow: delta(holeAgg.girPct, prevHoleAgg.girPct),

      puttsPerHole: holeAgg.avgPuttsPerHole,
      puttsArrow: delta(holeAgg.avgPuttsPerHole, prevHoleAgg.avgPuttsPerHole),

      fwPct: holeAgg.fwPct,
      fwArrow: delta(holeAgg.fwPct, prevHoleAgg.fwPct),
    };
  }, [holeAgg, prevHoleAgg, prevRange]);

  // Card 4: Par3/4/5 averages + trends
  const parAvgUI = useMemo(() => {
    const delta = (curVal: number | null, prevVal: number | null) => {
      if (!prevRange) return null;
      if (curVal == null || prevVal == null) return null;
      const d = curVal - prevVal;
      return d === 0 ? 0 : d;
    };
    return {
      par3: holeAgg.avgPar3,
      par3Arrow: delta(holeAgg.avgPar3, prevHoleAgg.avgPar3),
      par4: holeAgg.avgPar4,
      par4Arrow: delta(holeAgg.avgPar4, prevHoleAgg.avgPar4),
      par5: holeAgg.avgPar5,
      par5Arrow: delta(holeAgg.avgPar5, prevHoleAgg.avgPar5),
    };
  }, [holeAgg, prevHoleAgg, prevRange]);

  // Card 5: 1-9 / 10-18 averages + trends
  const sideAvgUI = useMemo(() => {
    const delta = (curVal: number | null, prevVal: number | null) => {
      if (!prevRange) return null;
      if (curVal == null || prevVal == null) return null;
      const d = curVal - prevVal;
      return d === 0 ? 0 : d;
    };
    return {
      front: holeAgg.avgFront,
      frontArrow: delta(holeAgg.avgFront, prevHoleAgg.avgFront),
      back: holeAgg.avgBack,
      backArrow: delta(holeAgg.avgBack, prevHoleAgg.avgBack),
    };
  }, [holeAgg, prevHoleAgg, prevRange]);

  // ===== CORRELATION TRAINING -> ROUNDS (LOOKBACK) =====
  const corr = useMemo(() => {
    if (rounds.length < 3 || sessionsLookback.length === 0) return null;

    const sList = sessionsLookback.map((s) => ({
      ...s,
      t: new Date(s.start_at).getTime(),
      mins: s.total_minutes || 0,
    }));

    const itemsBySession: Record<string, Array<{ cat: string; minutes: number }>> = {};
    for (const it of itemsLookback) {
      (itemsBySession[it.session_id] ??= []).push({ cat: it.category, minutes: it.minutes || 0 });
    }

    const perRound = rounds
      .map((r) => {
        const rt = new Date(r.start_at).getTime();
        const windowStart = rt - LOOKBACK_DAYS * 24 * 3600 * 1000;

        let mins = 0;
        const catMins: Record<string, number> = {};

        for (const s of sList) {
          if (s.t >= windowStart && s.t < rt) {
            mins += s.mins;
            const its = itemsBySession[s.id] ?? [];
            for (const x of its) catMins[x.cat] = (catMins[x.cat] ?? 0) + x.minutes;
          }
        }

        const fwTot = r.fairways_total ?? 0;
        const fwHit = r.fairways_hit ?? 0;
        const fwPct = fwTot > 0 ? (fwHit / fwTot) * 100 : null;

        return {
          id: r.id,
          trainingMins14: mins,
          puttingMins14: catMins["putting"] ?? 0,
          longGameMins14: catMins["long_game"] ?? 0,
          shortMins14: (catMins["wedging"] ?? 0) + (catMins["pitching"] ?? 0) + (catMins["chipping"] ?? 0),
          mentalMins14: catMins["mental"] ?? 0,

          score: typeof r.total_score === "number" ? r.total_score : null,
          putts: typeof r.total_putts === "number" ? r.total_putts : null,
          gir: typeof r.gir === "number" ? r.gir : null,
          fairwayPct: fwPct,
          doublesPlus: typeof r.doubles_plus === "number" ? r.doubles_plus : null,
        };
      })
      .filter((x) => x.score != null || x.putts != null || x.gir != null || x.fairwayPct != null);

    const pairs = (xKey: keyof typeof perRound[number], yKey: keyof typeof perRound[number]) => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of perRound) {
        const xv = r[xKey];
        const yv = r[yKey];
        if (typeof xv === "number" && typeof yv === "number" && Number.isFinite(xv) && Number.isFinite(yv)) {
          xs.push(xv);
          ys.push(yv);
        }
      }
      if (xs.length < 3) return null;
      return { xs, ys };
    };

    return {
      n: perRound.length,
      mins_vs_score: (() => {
        const p = pairs("trainingMins14", "score");
        return p ? pearson(p.xs, p.ys) : null;
      })(),
      putting_vs_putts: (() => {
        const p = pairs("puttingMins14", "putts");
        return p ? pearson(p.xs, p.ys) : null;
      })(),
      long_vs_fairway: (() => {
        const p = pairs("longGameMins14", "fairwayPct");
        return p ? pearson(p.xs, p.ys) : null;
      })(),
      short_vs_gir: (() => {
        const p = pairs("shortMins14", "gir");
        return p ? pearson(p.xs, p.ys) : null;
      })(),
      mental_vs_doubles: (() => {
        const p = pairs("mentalMins14", "doublesPlus");
        return p ? pearson(p.xs, p.ys) : null;
      })(),
    };
  }, [rounds, sessionsLookback, itemsLookback]);

  // ===== RECO SUMMARY (lightweight, data-driven) =====
  const courseAdvice = useMemo(() => {
    if (!corr) return [];

    const tips: Array<{ title: string; body: string }> = [];

    if (corr.putting_vs_putts != null) {
      const st = corrStrength(corr.putting_vs_putts);
      const good = corr.putting_vs_putts < 0; // more putting -> fewer putts
      tips.push({
        title: `Putting ↔ Putts (${st.label})`,
        body: good
          ? "Ton putting semble se traduire par moins de putts. Garde 2 micro-séances/semaine (20–30 min) + 10 minutes de “speed control” à chaque entraînement."
          : "Ton putting ne se voit pas encore sur les putts. Mets l’accent sur la vitesse (putts longs) + routine : 10 putts à 1m en fin de séance (objectif 10/10).",
      });
    }

    if (corr.long_vs_fairway != null) {
      const st = corrStrength(corr.long_vs_fairway);
      const good = corr.long_vs_fairway > 0;
      tips.push({
        title: `Long jeu ↔ Fairways (${st.label})`,
        body: good
          ? "Le long jeu a un impact positif sur les fairways. Pour accélérer : séance 'cible étroite' (couloir) + 10 mises en jeu “routine complète”."
          : "Pas de lien clair long jeu → fairways. Ajoute du transfert : 1 balle = 1 cible, et note le choix de club/ligne sur le parcours.",
      });
    }

    if (corr.mins_vs_score != null) {
      const st = corrStrength(corr.mins_vs_score);
      const good = corr.mins_vs_score < 0; // more training -> lower score
      tips.push({
        title: `Volume (14j) ↔ Score (${st.label})`,
        body: good
          ? "La régularité d’entraînement est associée à un meilleur score. Vise 2–3 séances/semaine plutôt que de gros blocs irréguliers."
          : "Le volume seul n’explique pas ton score : on doit mieux répartir par secteurs et ajouter des objectifs (ex: fairways, putts, doubles+).",
      });
    }

    if (corr.mental_vs_doubles != null) {
      const st = corrStrength(corr.mental_vs_doubles);
      const good = corr.mental_vs_doubles < 0; // more mental -> fewer doubles+
      tips.push({
        title: `Mental ↔ Doubles+ (${st.label})`,
        body: good
          ? "Le mental semble réduire les grosses erreurs. Continue : routine + reset après erreur (respiration 10s, plan simple)."
          : "Les doubles+ semblent venir d’autres facteurs (mise en jeu / pénalités / sorties). On pourra renforcer avec analyse trou par trou + notes.",
      });
    }

    return tips.slice(0, 4);
  }, [corr]);

  // ===== UI =====
  const kpiGridClass = "golf-kpi-grid";
  const kpiGridStyle: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "1fr" };

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* ===== Header ===== */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                GOLF - ANALYSE
              </div>
              <div className="marketplace-filter-label" style={{ margin: 0 }}>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <CalendarRange size={16} />
                  {periodLabel}
                </span>
              </div>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* ===== Filters ===== */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "month" ? chipActive : {}) }}
                onClick={() => {
                  setPreset("month");
                  setCustomOpen(false);
                }}
                disabled={loading}
                aria-pressed={preset === "month"}
              >
                Ce mois
              </button>

              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "last3" ? chipActive : {}) }}
                onClick={() => {
                  setPreset("last3");
                  setCustomOpen(false);
                }}
                disabled={loading}
                aria-pressed={preset === "last3"}
              >
                3 derniers mois
              </button>

              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "all" ? chipActive : {}) }}
                onClick={() => {
                  setPreset("all");
                  setCustomOpen(false);
                }}
                disabled={loading}
                aria-pressed={preset === "all"}
              >
                Toute l’activité
              </button>

              <button
                type="button"
                className="btn"
                style={{ ...chipStyle, ...(preset === "custom" ? chipActive : {}), marginLeft: "auto" }}
                onClick={() => setCustomOpen((v) => !v)}
                disabled={loading}
                aria-expanded={customOpen}
              >
                <SlidersHorizontal size={16} />
                Dates
              </button>
            </div>

            {customOpen && (
              <>
                <div className="hr-soft" style={{ margin: "12px 0" }} />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>Personnaliser les dates</div>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCustomOpen(false)}
                    style={{
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: "rgba(0,0,0,0.10)",
                      background: "rgba(255,255,255,0.65)",
                      borderRadius: 999,
                      padding: "8px 10px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 950,
                    }}
                  >
                    <X size={16} />
                    Fermer
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10, overflow: "hidden", marginTop: 10 }}>
                  <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Du</span>
                    <input type="date" value={fromDate} onChange={(e) => onChangeFrom(e.target.value)} disabled={loading} style={dateInputStyle} />
                  </label>

                  <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Au</span>
                    <input type="date" value={toDate} onChange={(e) => onChangeTo(e.target.value)} disabled={loading} style={dateInputStyle} />
                  </label>

                  <button className="btn" type="button" onClick={clearDates} disabled={loading} style={{ width: "100%", height: 44 }}>
                    Effacer les dates
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ===== Title Trainings ===== */}
        <div className="glass-section" style={{ paddingTop: 0 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            MES ENTRAINEMENTS
          </div>
        </div>

        {/* ===== Trainings KPIs ===== */}
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div className="glass-card">
              <div className="card-title">Volume</div>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : sessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <span className="big-number">{totalMinutes}</span>
                        <span className="unit">MIN</span>
                      </div>

                      {deltaMinutes != null && (
                        <span
                          className="pill-soft"
                          style={{
                            background: "rgba(0,0,0,0.06)",
                            fontSize: 12,
                            fontWeight: 950,
                            color: deltaMinutes >= 0 ? "rgba(47,125,79,1)" : "rgba(185,28,28,1)",
                          }}
                          title="Comparatif période précédente"
                        >
                          {deltaMinutes >= 0 ? "▲" : "▼"} {Math.abs(deltaMinutes)} min
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span className="pill-soft">⛳ {sessions.length} séances</span>

                      {deltaCount != null && (
                        <span
                          className="pill-soft"
                          style={{
                            background: "rgba(0,0,0,0.06)",
                            fontSize: 12,
                            fontWeight: 950,
                            color: deltaCount >= 0 ? "rgba(47,125,79,1)" : "rgba(185,28,28,1)",
                          }}
                          title="Comparatif période précédente"
                        >
                          {deltaCount >= 0 ? "▲" : "▼"} {Math.abs(deltaCount)} séances
                        </span>
                      )}
                    </div>

                    {compareLabel && (
                      <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{loadingPrev ? "Comparatif…" : compareLabel}</div>
                    )}
                  </div>

                  <div className="hr-soft" style={{ margin: "2px 0" }} />

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
                </div>
              )}
            </div>

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
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{loadingPrev ? "Comparatif…" : compareLabel}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Graphes trainings ===== */}
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

                    <Line type="monotone" dataKey="motivation" name="Motivation" stroke="rgba(16,94,51,0.95)" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="difficulty" name="Difficulté" stroke="rgba(55,65,81,0.9)" strokeWidth={2} strokeDasharray="2 6" dot={false} />
                    <Line type="monotone" dataKey="satisfaction" name="Satisfaction" stroke="rgba(34,197,94,0.95)" strokeWidth={3} strokeDasharray="10 6" dot={false} />
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

        {/* ===== Title Rounds ===== */}
        <div className="glass-section" style={{ paddingTop: 0 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            MES PARCOURS
          </div>
        </div>

        {/* ===== MES PARCOURS — Cards ===== */}
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            {/* Card 1: Volume + trous + split training/competition */}
            <div className="glass-card">
              <div className="card-title">Volume de jeu</div>

              {loadingRounds || loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : rounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun parcours sur la période.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>Parcours joués</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{rounds.length}</div>
                        {prevRange ? deltaArrow(rounds.length - prevRounds.length) : null}
                      </div>
                    </div>

                    <div style={miniRow}>
                      <div style={miniLeft}>Trous joués</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{holeAgg.holesPlayed}</div>
                        {prevRange ? deltaArrow(holeAgg.holesPlayed - prevHoles.length) : null}
                      </div>
                    </div>
                  </div>

                  <div className="hr-soft" />

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>Parcours d’entraînement</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{roundsSplit.training}</div>
                        {prevRange ? deltaArrow(roundsSplit.training - prevRoundsSplit.training) : null}
                      </div>
                    </div>

                    <div style={miniRow}>
                      <div style={miniLeft}>Parcours de compétition</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{roundsSplit.competition}</div>
                        {prevRange ? deltaArrow(roundsSplit.competition - prevRoundsSplit.competition) : null}
                      </div>
                    </div>

                    {roundsSplit.other > 0 && (
                      <div style={miniRow}>
                        <div style={miniLeft}>Autres</div>
                        <div style={miniRight}>{roundsSplit.other}</div>
                      </div>
                    )}
                  </div>

                  <div className="hr-soft" />

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>Score moyen (18 trous)</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{holeAgg.avgScore18 ?? "—"}</div>
                        {prevRange ? deltaArrow((holeAgg.avgScore18 ?? 0) - (prevHoleAgg.avgScore18 ?? 0)) : null}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                      Moyenne calculée uniquement sur les parcours avec <b>18 trous saisis</b> ({holeAgg.completed18Count} parcours).
                    </div>
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 2: Répartition des scores (n + % + trend arrow) */}
            <div className="glass-card">
              <div className="card-title">Répartition des scores</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : holeAgg.distDen === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Pas assez de trous saisis pour analyser.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { k: "eagle", label: "Eagles", n: scoreDistUI.cur.eagle.n, p: scoreDistUI.cur.eagle.p, d: scoreDistUI.trend.eagle },
                    { k: "birdie", label: "Birdies", n: scoreDistUI.cur.birdie.n, p: scoreDistUI.cur.birdie.p, d: scoreDistUI.trend.birdie },
                    { k: "par", label: "Pars", n: scoreDistUI.cur.par.n, p: scoreDistUI.cur.par.p, d: scoreDistUI.trend.par },
                    { k: "bogey", label: "Bogeys", n: scoreDistUI.cur.bogey.n, p: scoreDistUI.cur.bogey.p, d: scoreDistUI.trend.bogey },
                    { k: "doubleplus", label: "Doubles+", n: scoreDistUI.cur.doubleplus.n, p: scoreDistUI.cur.doubleplus.p, d: scoreDistUI.trend.doubleplus },
                  ].map((x) => (
                    <div key={x.k} style={miniRow}>
                      <div style={miniLeft}>{x.label}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>
                          {x.n} {x.p == null ? "" : `(${x.p}%)`}
                        </div>
                        {prevRange ? deltaArrow(x.d ?? null) : null}
                      </div>
                    </div>
                  ))}

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 3: GIR / Putts / Fairways */}
            <div className="glass-card">
              <div className="card-title">Régularité</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : rounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>Greens en régulation</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.girPct == null ? "—" : `${keyKpisUI.girPct}%`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.girArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>Moyenne de putt</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.puttsPerHole == null ? "—" : `${keyKpisUI.puttsPerHole}`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.puttsArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>Fairways touchés</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.fwPct == null ? "—" : `${keyKpisUI.fwPct}%`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.fwArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    GIR basé sur <b>golf_rounds.gir</b> et calculé sur les parcours 18 trous.
                    <br />
                    Fairways calculés sur les <b>PAR 4/5</b> où <b>fairway_hit</b> est renseigné.
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 4: Par3/Par4/Par5 averages */}
            <div className="glass-card">
              <div className="card-title">Scores par PAR</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : holeAgg.holesPlayed === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>Score moyen PAR 3</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par3 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par3Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>Score moyen PAR 4</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par4 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par4Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>Score moyen PAR 5</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par5 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par5Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    Calcul basé sur les trous saisis (score / trou), par type de PAR.
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 5: 1-9 / 10-18 averages */}
            <div className="glass-card">
              <div className="card-title">Front 9 vs Back 9</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
              ) : holeAgg.holesPlayed === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>Score moyen 1 à 9</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{sideAvgUI.front ?? "—"}</div>
                      {prevRange ? deltaArrow(sideAvgUI.frontArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>Score moyen 10 à 18</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{sideAvgUI.back ?? "—"}</div>
                      {prevRange ? deltaArrow(sideAvgUI.backArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    Calcul basé sur les trous saisis (score / trou) sur chaque moitié.
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Training → Course analysis ===== */}
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">Analyse entraînement → parcours</div>

            {loadingTrainLookback ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Analyse…</div>
            ) : !corr ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, lineHeight: 1.45 }}>
                Pas assez de données pour calculer une corrélation fiable.
                <br />
                Il faut idéalement <b>au moins 3 parcours</b> et des entraînements sur les <b>{LOOKBACK_DAYS} jours</b> avant.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                  Corrélation (Pearson) entre le volume des {LOOKBACK_DAYS} jours avant chaque parcours et tes stats parcours.
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { label: `Volume (14j) ↔ Score (↓)`, r: corr.mins_vs_score, goodWhen: "neg" as const },
                    { label: `Putting (14j) ↔ Putts (↓)`, r: corr.putting_vs_putts, goodWhen: "neg" as const },
                    { label: `Long jeu (14j) ↔ Fairways (↑)`, r: corr.long_vs_fairway, goodWhen: "pos" as const },
                    { label: `Jeu court (14j) ↔ GIR (↑)`, r: corr.short_vs_gir, goodWhen: "pos" as const },
                    { label: `Mental (14j) ↔ Doubles+ (↓)`, r: corr.mental_vs_doubles, goodWhen: "neg" as const },
                  ].map((x) => {
                    const st = corrStrength(x.r);
                    const good = x.r == null ? false : x.goodWhen === "neg" ? x.r < 0 : x.r > 0;

                    return (
                      <div key={x.label} style={miniRow}>
                        <div style={{ ...miniLeft, minWidth: 0 }}>{x.label}</div>
                        <div
                          style={{
                            ...miniRight,
                            color: x.r == null ? "rgba(0,0,0,0.55)" : good ? "rgba(47,125,79,1)" : "rgba(185,28,28,1)",
                          }}
                          title={x.r == null ? "" : `r=${x.r.toFixed(2)} (n=${corr.n})`}
                        >
                          {x.r == null ? "—" : `${good ? "▲" : "▼"} ${st.label}`}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hr-soft" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>Conseils basés sur tes résultats</div>

                  {courseAdvice.length === 0 ? (
                    <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Pas assez d’infos pour des conseils.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {courseAdvice.map((t) => (
                        <div
                          key={t.title}
                          style={{
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: "rgba(0,0,0,0.08)",
                            background: "rgba(255,255,255,0.60)",
                            borderRadius: 14,
                            padding: 12,
                          }}
                        >
                          <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.78)" }}>{t.title}</div>
                          <div style={{ marginTop: 6, color: "rgba(0,0,0,0.60)", fontWeight: 800, lineHeight: 1.4 }}>{t.body}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.4 }}>
                    Note : corrélation ≠ causalité. Pour rendre l’analyse encore plus “solide”, on peut ensuite :
                    <br />• segmenter par <b>compétition vs entraînement</b> • pondérer par <b>slope/course rating</b> •
                    détecter les “trous catastrophes” via <code>golf_round_holes.note</code>.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 12 }} />
      </div>

      <style jsx global>{`
        @media (min-width: 900px) {
          .golf-kpi-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

const dateInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.90)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.10)",
  borderRadius: 10,
  padding: "10px 12px",
  WebkitAppearance: "none",
  appearance: "none",
};

const typeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.08)",
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

const miniRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.08)",
  background: "rgba(255,255,255,0.55)",
  borderRadius: 12,
  padding: "10px 12px",
};

const miniLeft: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.68)",
};

const miniRight: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.78)",
  whiteSpace: "nowrap",
};