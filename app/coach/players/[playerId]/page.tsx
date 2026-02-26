"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
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
  club_id: string | null;
  coach_user_id: string | null;
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
type TrainingScope = "all" | "mine_club";
type Role = "coach" | "manager" | "player";
type ClubMemberRow = { club_id: string; role: Role; is_active: boolean | null };
type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
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

function fmtPeriod(fromDate: string, toDate: string, locale: string, t: (key: string) => string) {
  if (!fromDate && !toDate) return t("common.allActivity");
  const f = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const toD = toDate ? new Date(`${toDate}T00:00:00`) : null;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

  if (f && toD) return `${fmt(f)} → ${fmt(toD)}`;
  if (f) return `${t("golfDashboard.from")} ${fmt(f)}`;
  if (toD) return `${t("golfDashboard.to")} ${fmt(toD)}`;
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

function typeLabelLong(sessionType: SessionType, t: (key: string) => string) {
  if (sessionType === "club") return t("trainingDetail.typeClub");
  if (sessionType === "private") return t("trainingDetail.typePrivate");
  return t("trainingDetail.typeIndividual");
}

function deltaArrow(delta: number | null, title = "Previous period comparison") {
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
      title={title}
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
  if (r == null) return { labelKey: "golfDashboard.corr.none" };
  const ar = Math.abs(r);
  if (ar >= 0.6) return { labelKey: "golfDashboard.corr.strong" };
  if (ar >= 0.35) return { labelKey: "golfDashboard.corr.moderate" };
  if (ar >= 0.2) return { labelKey: "golfDashboard.corr.weak" };
  return { labelKey: "golfDashboard.corr.veryWeak" };
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

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function initials(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return fi + li || "👤";
}

export default function GolfDashboardPage() {
  const { t, locale } = useI18n();
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";
  const params = useParams<{ playerId: string }>();
  const searchParams = useSearchParams();
  const playerId = String(params?.playerId ?? "").trim();
  const returnToParam = String(searchParams.get("returnTo") ?? "").trim();
  const returnHref = useMemo(() => {
    if (returnToParam.startsWith("/coach/")) return returnToParam;
    return "/coach/groups";
  }, [returnToParam]);

  const [loading, setLoading] = useState(true);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [loadingPrevRounds, setLoadingPrevRounds] = useState(false);
  const [loadingHoles, setLoadingHoles] = useState(false);
  const [loadingPrevHoles, setLoadingPrevHoles] = useState(false);
  const [loadingTrainLookback, setLoadingTrainLookback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<Preset>("all");
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
  const [accessChecked, setAccessChecked] = useState(false);
  const [canLoadData, setCanLoadData] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<ProfileLite | null>(null);
  const [sharedClubNames, setSharedClubNames] = useState<string[]>([]);
  const [sharedClubIds, setSharedClubIds] = useState<string[]>([]);
  const [coachId, setCoachId] = useState<string>("");
  const [trainingScope, setTrainingScope] = useState<TrainingScope>("all");

  useEffect(() => {
    (async () => {
      setAccessChecked(false);
      setCanLoadData(false);
      setError(null);

      try {
        if (!playerId) throw new Error("Joueur introuvable.");

        const { data: authRes, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authRes.user) throw new Error("Session invalide.");

        const meId = authRes.user.id;
        setCoachId(meId);
        if (meId === playerId) {
          setCanLoadData(true);
          setAccessChecked(true);
          return;
        }

        const meRes = await supabase
          .from("club_members")
          .select("club_id,role,is_active")
          .eq("user_id", meId)
          .eq("is_active", true)
          .in("role", ["coach", "manager"]);
        if (meRes.error) throw new Error(meRes.error.message);

        const targetRes = await supabase
          .from("club_members")
          .select("club_id,role,is_active")
          .eq("user_id", playerId)
          .eq("is_active", true);
        if (targetRes.error) throw new Error(targetRes.error.message);

        const myClubIds = new Set(
          ((meRes.data ?? []) as ClubMemberRow[]).map((r) => r.club_id).filter(Boolean)
        );
        const sharedClubIds = ((targetRes.data ?? []) as ClubMemberRow[])
          .map((r) => r.club_id)
          .filter((id) => myClubIds.has(id));

        if (sharedClubIds.length === 0) throw new Error("Access denied for this player.");
        setSharedClubIds(sharedClubIds);

        const [profileRes, clubsRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,first_name,last_name,handicap,avatar_url")
            .eq("id", playerId)
            .maybeSingle(),
          supabase.from("clubs").select("id,name").in("id", sharedClubIds),
        ]);

        if (profileRes.error) throw new Error(profileRes.error.message);
        if (clubsRes.error) throw new Error(clubsRes.error.message);

        setPlayerProfile((profileRes.data ?? null) as ProfileLite | null);
        setSharedClubNames(
          ((clubsRes.data ?? []) as Array<{ id: string; name: string | null }>)
            .map((c) => String(c.name ?? "").trim())
            .filter(Boolean)
        );

        setCanLoadData(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur chargement.";
        setError(msg);
        setCanLoadData(false);
        setPlayerProfile(null);
        setSharedClubNames([]);
        setSharedClubIds([]);
        setCoachId("");
        setLoading(false);
        setLoadingPrev(false);
        setLoadingRounds(false);
        setLoadingPrevRounds(false);
        setLoadingHoles(false);
        setLoadingPrevHoles(false);
        setLoadingTrainLookback(false);
      } finally {
        setAccessChecked(true);
      }
    })();
  }, [playerId]);

  useEffect(() => {
    setFromDate("");
    setToDate("");
    setPreset("all");
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

  const periodLabel = useMemo(() => fmtPeriod(fromDate, toDate, dateLocale, t), [dateLocale, fromDate, t, toDate]);

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
    if (preset === "month") return t("golfDashboard.vsPrevMonth");
    if (preset === "last3") return t("golfDashboard.vsPrev3Months");
    return t("golfDashboard.vsPrevPeriod");
  }, [prevRange, preset, t]);

  // ===== LOAD TRAININGS (current) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
      setLoading(true);
      setError(null);

      try {
        const uid = playerId;

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_id,coach_user_id")
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
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur chargement.";
        setError(msg);
        setSessions([]);
        setItems([]);
        setLoading(false);
      }
    })();
  }, [canLoadData, fromDate, playerId, toDate]);

  // ===== LOAD TRAININGS (prev KPIs) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
      if (!prevRange) {
        setPrevSessions([]);
        return;
      }

      setLoadingPrev(true);
      try {
        const uid = playerId;

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_id,coach_user_id")
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
  }, [canLoadData, playerId, prevRange, prevRange?.from, prevRange?.to]);

  // ===== LOAD ROUNDS (current) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
      setLoadingRounds(true);
      try {
        const uid = playerId;

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
  }, [canLoadData, fromDate, playerId, toDate]);

  // ===== LOAD ROUNDS (prev, for trends) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
      if (!prevRange) {
        setPrevRounds([]);
        return;
      }

      setLoadingPrevRounds(true);
      try {
        const uid = playerId;

        const q = supabase
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
  }, [canLoadData, playerId, prevRange, prevRange?.from, prevRange?.to]);

  // ===== LOAD HOLES (current) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
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
  }, [canLoadData, rounds]);

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
  }, [canLoadData, prevRange, prevRounds]);

  // ===== LOAD TRAININGS LOOKBACK (for correlation) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData) return;
      setLoadingTrainLookback(true);
      try {
        const uid = playerId;

        const now = new Date();
        const fallbackFrom = isoToYMD(new Date(now.getFullYear(), now.getMonth() - 2, 1));
        const from = fromDate || fallbackFrom;
        const to = toDate || isoToYMD(now);

        const fromISO = toISOStartMinusDays(from, LOOKBACK_DAYS);
        const toISO = nextDayStartISO(to);

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_id,coach_user_id")
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
  }, [canLoadData, fromDate, playerId, toDate]);
      
  const PRESET_LABEL: Record<Preset, string> = {
    month: t("common.thisMonth"),
    last3: t("common.last3Months"),
    all: t("common.allActivity"),
    custom: t("common.custom"),
  };

function presetToSelectValue(p: Preset): Preset {
  // Le select doit rester cohérent : si customOpen est ouvert ou preset=custom -> custom
  return p;
}
  const filteredSessions = useMemo(() => {
    if (trainingScope === "all") return sessions;
    return sessions.filter(
      (s) =>
        s.session_type === "club" &&
        s.coach_user_id === coachId &&
        !!s.club_id &&
        sharedClubIds.includes(s.club_id)
    );
  }, [trainingScope, sessions, coachId, sharedClubIds]);

  const filteredSessionIds = useMemo(
    () => new Set(filteredSessions.map((s) => s.id)),
    [filteredSessions]
  );

  const filteredItems = useMemo(
    () => items.filter((it) => filteredSessionIds.has(it.session_id)),
    [items, filteredSessionIds]
  );

  const filteredPrevSessions = useMemo(() => {
    if (trainingScope === "all") return prevSessions;
    return prevSessions.filter(
      (s) =>
        s.session_type === "club" &&
        s.coach_user_id === coachId &&
        !!s.club_id &&
        sharedClubIds.includes(s.club_id)
    );
  }, [trainingScope, prevSessions, coachId, sharedClubIds]);

  // ===== TRAININGS AGGREGATES (current + prev) =====
  const totalMinutes = useMemo(
    () => filteredSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0),
    [filteredSessions]
  );
  const avgMotivation = useMemo(() => avg(filteredSessions.map((s) => s.motivation)), [filteredSessions]);
  const avgDifficulty = useMemo(() => avg(filteredSessions.map((s) => s.difficulty)), [filteredSessions]);
  const avgSatisfaction = useMemo(() => avg(filteredSessions.map((s) => s.satisfaction)), [filteredSessions]);

  const byType = useMemo(() => {
    const m: Record<SessionType, number> = { club: 0, private: 0, individual: 0 };
    for (const s of filteredSessions) m[s.session_type] += 1;
    return m;
  }, [filteredSessions]);

  const minutesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of filteredItems) map[it.category] = (map[it.category] ?? 0) + (it.minutes || 0);
    return map;
  }, [filteredItems]);

  const topCats = useMemo(() => {
    return Object.entries(minutesByCat)
      .map(([cat, minutes]) => ({ cat, label: t(`cat.${cat}`), minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [minutesByCat, t]);

  const catMax = useMemo(() => {
    const m = topCats.reduce((mx, x) => Math.max(mx, x.minutes), 0);
    return m || 1;
  }, [topCats]);

  const prevTotalMinutes = useMemo(
    () => filteredPrevSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0),
    [filteredPrevSessions]
  );
  const prevCount = useMemo(() => filteredPrevSessions.length, [filteredPrevSessions]);
  const prevAvgMotivation = useMemo(() => avg(filteredPrevSessions.map((s) => s.motivation)), [filteredPrevSessions]);
  const prevAvgDifficulty = useMemo(() => avg(filteredPrevSessions.map((s) => s.difficulty)), [filteredPrevSessions]);
  const prevAvgSatisfaction = useMemo(
    () => avg(filteredPrevSessions.map((s) => s.satisfaction)),
    [filteredPrevSessions]
  );

  const deltaMinutes = useMemo(
    () => (prevRange ? totalMinutes - prevTotalMinutes : null),
    [prevRange, totalMinutes, prevTotalMinutes]
  );
  const deltaCount = useMemo(
    () => (prevRange ? filteredSessions.length - prevCount : null),
    [prevRange, filteredSessions.length, prevCount]
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

    for (const s of filteredSessions) {
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
      const label = new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [dateLocale, filteredSessions]);

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
    const completedHoles = holes.filter((h) => completedRoundIds.has(h.round_id));

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
    const puttVals = completedHoles.map((h) => (typeof h.putts === "number" ? h.putts : null));
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
    const completedHoles = prevHoles.filter((h) => completedRoundIds.has(h.round_id));

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

    const avgPuttsPerHole = avg(completedHoles.map((h) => (typeof h.putts === "number" ? h.putts : null)));

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
        title: `${t("golfDashboard.correlation.puttingPutts")} (${t(st.labelKey)})`,
        body: good
          ? t("golfDashboard.advice.puttingGood")
          : t("golfDashboard.advice.puttingWeak"),
      });
    }

    if (corr.long_vs_fairway != null) {
      const st = corrStrength(corr.long_vs_fairway);
      const good = corr.long_vs_fairway > 0;
      tips.push({
        title: `${t("golfDashboard.correlation.longFairways")} (${t(st.labelKey)})`,
        body: good
          ? t("golfDashboard.advice.longGameGood")
          : t("golfDashboard.advice.longGameWeak"),
      });
    }

    if (corr.mins_vs_score != null) {
      const st = corrStrength(corr.mins_vs_score);
      const good = corr.mins_vs_score < 0; // more training -> lower score
      tips.push({
        title: `${t("golfDashboard.correlation.volumeScore")} (${t(st.labelKey)})`,
        body: good
          ? t("golfDashboard.advice.volumeGood")
          : t("golfDashboard.advice.volumeWeak"),
      });
    }

    if (corr.mental_vs_doubles != null) {
      const st = corrStrength(corr.mental_vs_doubles);
      const good = corr.mental_vs_doubles < 0; // more mental -> fewer doubles+
      tips.push({
        title: `${t("golfDashboard.correlation.mentalDoubles")} (${t(st.labelKey)})`,
        body: good
          ? t("golfDashboard.advice.mentalGood")
          : t("golfDashboard.advice.mentalWeak"),
      });
    }

    return tips.slice(0, 4);
  }, [corr, t]);

  // ===== UI =====
  const kpiGridClass = "golf-kpi-grid";
  const kpiGridStyle: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "1fr" };
  const playerFirstName = useMemo(() => {
    const f = (playerProfile?.first_name ?? "").trim();
    return f || "ce joueur";
  }, [playerProfile?.first_name]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {!accessChecked ? (
          <div className="glass-card" style={{ marginTop: 12, fontWeight: 800, opacity: 0.8 }}>{t("common.loading")}</div>
        ) : null}

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

        <div className="glass-section">
          <Link className="cta-green cta-green-inline" href={returnHref}>
            Retour
          </Link>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center" }}>
            <div
              style={{
                width: 62,
                height: 62,
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(255,255,255,0.70)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 18,
                color: "var(--green-dark)",
              }}
            >
              {playerProfile?.avatar_url ? (
                <img src={playerProfile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials(playerProfile)
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 950, fontSize: 18 }} className="truncate">
                {fullName(playerProfile)}
              </div>
              <div style={{ opacity: 0.72, fontWeight: 800, marginTop: 4 }}>
                Handicap {typeof playerProfile?.handicap === "number" ? playerProfile.handicap.toFixed(1) : "—"}
              </div>
              <div className="truncate" style={{ opacity: 0.58, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                {sharedClubNames.length ? sharedClubNames.join(" • ") : "Club —"}
              </div>
            </div>
          </div>
        </div>

       {/* ===== Filters ===== */}
<div className="glass-section">
  <div className="glass-card" style={{ padding: 14 }}>
    <div style={{ display: "grid", gap: 12 }}>
      {/* Label */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <SlidersHorizontal size={16} />
        <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>
          {t("common.period")}
        </div>
      </div>

      {/* Select full width */}
      <select
        value={preset}
        onChange={(e) => {
          const v = e.target.value as Preset;

          if (v === "custom") {
            setPreset("custom");

            // Si aucune date définie, on initialise avec le mois courant
            if (!fromDate && !toDate) {
              const now = new Date();
              const { start, end } = monthRangeLocal(now);
              const endInclusive = new Date(end);
              endInclusive.setDate(endInclusive.getDate() - 1);

              setFromDate(isoToYMD(start));
              setToDate(isoToYMD(endInclusive));
            }

            setCustomOpen(true);
            return;
          }

          setPreset(v);
          setCustomOpen(false);
        }}
        disabled={loading}
        style={{
          width: "100%",
          height: 44,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "rgba(0,0,0,0.10)",
          borderRadius: 12,
          padding: "0 12px",
          background: "rgba(255,255,255,0.75)",
          fontWeight: 950,
          color: "rgba(0,0,0,0.80)",
          outline: "none",
          appearance: "none",
        }}
        aria-label={t("common.filterByPeriod")}
      >
        <option value="month">Ce mois</option>
        <option value="last3">3 derniers mois</option>
        <option value="all">{t("common.allActivity")}</option>
        <option value="custom">{t("common.custom")}</option>
      </select>

      <div className="hr-soft" style={{ margin: "2px 0" }} />
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>
          Entraînements affichés
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={() => setTrainingScope("mine_club")}
          disabled={loading}
          style={
            trainingScope === "mine_club"
              ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
              : {}
          }
        >
          {t("coachPlayerDashboard.scopeMineClub")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setTrainingScope("all")}
          disabled={loading}
          style={
            trainingScope === "all"
              ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
              : {}
          }
        >
          {t("coachPlayerDashboard.scopeAll")}
        </button>
      </div>
      <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>
        {trainingScope === "mine_club"
          ? t("coachPlayerDashboard.scopeMineClubHint")
          : t("coachPlayerDashboard.scopeAllHint")}
      </div>

      {/* Custom dates */}
      {customOpen && preset === "custom" && (
        <>
          <div className="hr-soft" style={{ margin: "2px 0" }} />

          <div
            style={{
              display: "grid",
              gap: 10,
              overflow: "hidden",
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  color: "rgba(0,0,0,0.65)",
                }}
              >
                Du
              </span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPreset("custom");
                  setCustomOpen(true);
                }}
                disabled={loading}
                style={dateInputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  color: "rgba(0,0,0,0.65)",
                }}
              >
                Au
              </span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPreset("custom");
                  setCustomOpen(true);
                }}
                disabled={loading}
                style={dateInputStyle}
              />
            </label>

            <button
              className="btn"
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setPreset("all");
                setCustomOpen(false);
              }}
              disabled={loading}
              style={{
                width: "100%",
                height: 44,
              }}
            >
              {t("common.clearDates")}
            </button>
          </div>
        </>
      )}
    </div>
  </div>
</div>

        {/* ===== Title Trainings ===== */}
        <div className="glass-section" style={{ paddingTop: 0 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {t("coachPlayerDashboard.trainingsOf").replace("{name}", playerFirstName)}
          </div>
        </div>

        {/* ===== Trainings KPIs ===== */}
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.volume")}</div>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : filteredSessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
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
                          title={t("golfDashboard.previousPeriodComparison")}
                        >
                          {deltaMinutes >= 0 ? "▲" : "▼"} {Math.abs(deltaMinutes)} min
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span className="pill-soft">⛳ {filteredSessions.length} {t("golfDashboard.sessions")}</span>

                      {deltaCount != null && (
                        <span
                          className="pill-soft"
                          style={{
                            background: "rgba(0,0,0,0.06)",
                            fontSize: 12,
                            fontWeight: 950,
                            color: deltaCount >= 0 ? "rgba(47,125,79,1)" : "rgba(185,28,28,1)",
                          }}
                          title={t("golfDashboard.previousPeriodComparison")}
                        >
                          {deltaCount >= 0 ? "▲" : "▼"} {Math.abs(deltaCount)} {t("golfDashboard.sessions")}
                        </span>
                      )}
                    </div>

                    {compareLabel && (
                      <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{loadingPrev ? t("golfDashboard.comparing") : compareLabel}</div>
                    )}
                  </div>

                  <div className="hr-soft" style={{ margin: "2px 0" }} />

                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>{t("golfDashboard.breakdown")}</div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("club", t)}</div>
                        <div style={typeRowRightStyle}>{byType.club}</div>
                      </div>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("private", t)}</div>
                        <div style={typeRowRightStyle}>{byType.private}</div>
                      </div>
                      <div style={typeRowStyle}>
                        <div style={typeRowLeftStyle}>{typeLabelLong("individual", t)}</div>
                        <div style={typeRowRightStyle}>{byType.individual}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.feelingsAverage")}</div>

              {filteredSessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <RatingBar icon={<Flame size={16} />} label={t("common.motivation")} value={avgMotivation} delta={deltaMot} />
                  <RatingBar icon={<Mountain size={16} />} label={t("common.difficulty")} value={avgDifficulty} delta={deltaDif} />
                  <RatingBar icon={<Smile size={16} />} label={t("common.satisfaction")} value={avgSatisfaction} delta={deltaSat} />

                  {compareLabel && (
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{loadingPrev ? t("golfDashboard.comparing") : compareLabel}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Graphes trainings ===== */}
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">{t("golfDashboard.weeklyVolume")}</div>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="minutes" name={t("golfDashboard.minutesPerWeek")} fill="rgba(53,72,59,0.65)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">{t("golfDashboard.weeklyFeelingTrend")}</div>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekLabel" />
                    <YAxis domain={[0, 6]} />
                    <Tooltip />
                    <Legend />

                    <Line type="monotone" dataKey="motivation" name={t("common.motivation")} stroke="rgba(16,94,51,0.95)" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="difficulty" name={t("common.difficulty")} stroke="rgba(55,65,81,0.9)" strokeWidth={2} strokeDasharray="2 6" dot={false} />
                    <Line type="monotone" dataKey="satisfaction" name={t("common.satisfaction")} stroke="rgba(34,197,94,0.95)" strokeWidth={3} strokeDasharray="10 6" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">{t("golfDashboard.categoryBreakdown")}</div>

            {topCats.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
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
            {t("coachPlayerDashboard.roundsOf").replace("{name}", playerFirstName)}
          </div>
        </div>

        {/* ===== MES PARCOURS — Cards ===== */}
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            {/* Card 1: Volume + trous + split training/competition */}
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.playVolume")}</div>

              {loadingRounds || loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : rounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("golfDashboard.noRoundsInPeriod")}</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>{t("golfDashboard.roundsPlayed")}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{rounds.length}</div>
                        {prevRange ? deltaArrow(rounds.length - prevRounds.length) : null}
                      </div>
                    </div>

                    <div style={miniRow}>
                      <div style={miniLeft}>{t("golfDashboard.holesPlayed")}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{holeAgg.holesPlayed}</div>
                        {prevRange ? deltaArrow(holeAgg.holesPlayed - prevHoles.length) : null}
                      </div>
                    </div>
                  </div>

                  <div className="hr-soft" />

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>{t("golfDashboard.trainingRounds")}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{roundsSplit.training}</div>
                        {prevRange ? deltaArrow(roundsSplit.training - prevRoundsSplit.training) : null}
                      </div>
                    </div>

                    <div style={miniRow}>
                      <div style={miniLeft}>{t("golfDashboard.competitionRounds")}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{roundsSplit.competition}</div>
                        {prevRange ? deltaArrow(roundsSplit.competition - prevRoundsSplit.competition) : null}
                      </div>
                    </div>

                    {roundsSplit.other > 0 && (
                      <div style={miniRow}>
                        <div style={miniLeft}>{t("golfDashboard.other")}</div>
                        <div style={miniRight}>{roundsSplit.other}</div>
                      </div>
                    )}
                  </div>

                  <div className="hr-soft" />

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={miniRow}>
                      <div style={miniLeft}>{t("golfDashboard.avgScore18")}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <div style={miniRight}>{holeAgg.avgScore18 ?? "—"}</div>
                        {prevRange ? deltaArrow((holeAgg.avgScore18 ?? 0) - (prevHoleAgg.avgScore18 ?? 0)) : null}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                      {t("golfDashboard.avgScore18Hint").replace("{count}", String(holeAgg.completed18Count))}
                    </div>
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 2: Répartition des scores (n + % + trend arrow) */}
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.scoreDistribution")}</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : holeAgg.distDen === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("golfDashboard.notEnoughHolesForAnalysis")}</div>
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
              <div className="card-title">{t("golfDashboard.consistency")}</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : rounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.gir")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.girPct == null ? "—" : `${keyKpisUI.girPct}%`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.girArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgPutts")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.puttsPerHole == null ? "—" : `${keyKpisUI.puttsPerHole}`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.puttsArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.fairwaysHit")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.fwPct == null ? "—" : `${keyKpisUI.fwPct}%`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.fwArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    {t("golfDashboard.girHint1")}
                    <br />
                    {t("golfDashboard.girHint2")}
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 4: Par3/Par4/Par5 averages */}
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.scoresByPar")}</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : holeAgg.holesPlayed === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgPar3")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par3 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par3Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgPar4")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par4 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par4Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgPar5")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{parAvgUI.par5 ?? "—"}</div>
                      {prevRange ? deltaArrow(parAvgUI.par5Arrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    {t("golfDashboard.scoreByParHint")}
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

            {/* Card 5: 1-9 / 10-18 averages */}
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.frontBackTitle")}</div>

              {loadingHoles ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : holeAgg.holesPlayed === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgFront9")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{sideAvgUI.front ?? "—"}</div>
                      {prevRange ? deltaArrow(sideAvgUI.frontArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgBack9")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{sideAvgUI.back ?? "—"}</div>
                      {prevRange ? deltaArrow(sideAvgUI.backArrow ?? null) : null}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                    {t("golfDashboard.frontBackHint")}
                  </div>

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>
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
