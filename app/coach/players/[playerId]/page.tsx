"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
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
import { Flame, Mountain, Smile, CalendarRange, SlidersHorizontal, X, Upload, FileText, Trash2 } from "lucide-react";

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

type CoachEvaluationFeedbackRow = {
  event_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  private_note: string | null;
  player_note: string | null;
};

type CoachEvaluationEventRow = {
  id: string;
  starts_at: string;
  event_type: string | null;
  status: "scheduled" | "cancelled" | null;
  club_id: string | null;
  title: string | null;
};

type CoachEvaluationRow = {
  event_id: string;
  starts_at: string;
  title: string | null;
  event_type: string | null;
  engagement: number | null;
  attitude: number | null;
  application: number | null;
  note: string | null;
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
type EvalChartMode = "curve" | "trend";
type Role = "coach" | "manager" | "player";
type ClubMemberRow = { club_id: string; role: Role; is_active: boolean | null };
type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type PlannedEventRow = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  group_id: string | null;
  location_text: string | null;
  club_id: string | null;
};

type PlayerDashboardDocument = {
  id: string;
  organization_id: string;
  player_id: string;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  coach_only: boolean;
  created_at: string;
  public_url: string;
};

type TeamThreadMessage = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
  sender_name?: string | null;
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

function VolumeDonut({ percent }: { percent: number }) {
  const p = clamp(percent, 0, 100);
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = (p / 100) * c;

  return (
    <svg width="120" height="120" viewBox="0 0 110 110" aria-label={`Progression ${Math.round(p)}%`}>
      <circle cx="55" cy="55" r={r} strokeWidth="11" fill="none" stroke="rgba(0,0,0,0.10)" />
      <circle
        cx="55"
        cy="55"
        r={r}
        strokeWidth="11"
        fill="none"
        stroke="rgba(16,94,51,0.95)"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 55 55)"
      />
      <text
        x="55"
        y="60"
        textAnchor="middle"
        style={{ fontSize: 17, fontWeight: 900, fill: "rgba(0,0,0,0.75)" }}
      >
        {Math.round(p)}%
      </text>
    </svg>
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

function shortDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso));
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
  const dateLocale = pickLocaleText(locale, "fr-CH", "en-US");
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
  const [coachEvaluations, setCoachEvaluations] = useState<CoachEvaluationRow[]>([]);
  const [loadingCoachEvaluations, setLoadingCoachEvaluations] = useState(false);
  const [coachEvalPage, setCoachEvalPage] = useState(0);
  const [coachEvalChartMode, setCoachEvalChartMode] = useState<EvalChartMode>("curve");
  const [plannedEvents, setPlannedEvents] = useState<PlannedEventRow[]>([]);
  const [plannedGroupNameById, setPlannedGroupNameById] = useState<Record<string, string>>({});
  const [loadingPlannedEvents, setLoadingPlannedEvents] = useState(false);
  const [documents, setDocuments] = useState<PlayerDashboardDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string>("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewerDocument, setViewerDocument] = useState<PlayerDashboardDocument | null>(null);
  const [teamThreadId, setTeamThreadId] = useState<string>("");
  const [teamMessages, setTeamMessages] = useState<TeamThreadMessage[]>([]);
  const [teamProfilesById, setTeamProfilesById] = useState<Record<string, ProfileLite>>({});
  const [loadingTeamThread, setLoadingTeamThread] = useState(false);
  const [loadingTeamMessages, setLoadingTeamMessages] = useState(false);
  const [sendingTeamMessage, setSendingTeamMessage] = useState(false);
  const [deletingTeamMessageId, setDeletingTeamMessageId] = useState<string>("");
  const [teamComposer, setTeamComposer] = useState("");
  const [teamParticipantNames, setTeamParticipantNames] = useState<string[]>([]);
  const teamMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const [trainingVolumeLevelFromDb, setTrainingVolumeLevelFromDb] = useState<string | null>(null);
  const [trainingVolumeObjectiveFromDb, setTrainingVolumeObjectiveFromDb] = useState<number | null>(null);
  const [trainingVolumeMotivationFromDb, setTrainingVolumeMotivationFromDb] = useState<string | null>(null);

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

        const allPlayerClubIds = Array.from(
          new Set(((targetRes.data ?? []) as ClubMemberRow[]).map((r) => r.club_id).filter(Boolean))
        );

        const [profileRes, clubsRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,first_name,last_name,handicap,avatar_url")
            .eq("id", playerId)
            .maybeSingle(),
          supabase.from("clubs").select("id,name").in("id", allPlayerClubIds),
        ]);

        if (profileRes.error) throw new Error(profileRes.error.message);
        if (clubsRes.error) throw new Error(clubsRes.error.message);

        setPlayerProfile((profileRes.data ?? null) as ProfileLite | null);
        setSharedClubNames(
          ((clubsRes.data ?? []) as Array<{ id: string; name: string | null }>)
            .map((c) => String(c.name ?? "").trim())
            .filter(Boolean)
        );

        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token ?? "";
          if (token) {
            const orgRes = await fetch(
              `/api/coach/players/${encodeURIComponent(playerId)}/organizations`,
              {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              }
            );
            const orgJson = await orgRes.json().catch(() => ({}));
            if (orgRes.ok && Array.isArray(orgJson?.organizations)) {
              const names = (orgJson.organizations as any[])
                .map((x: any) => String(x ?? "").trim())
                .filter(Boolean);
              if (names.length > 0) setSharedClubNames(Array.from(new Set(names)));
            }
          }
        } catch {
          // fallback keeps current names
        }

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

  // ===== LOAD COACH EVALUATIONS (past trainings) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData || !coachId || !playerId || sharedClubIds.length === 0) {
        setCoachEvaluations([]);
        return;
      }

      setLoadingCoachEvaluations(true);
      try {
        const fbRes = await supabase
          .from("club_event_coach_feedback")
          .select("event_id,coach_id,engagement,attitude,performance,private_note,player_note")
          .eq("player_id", playerId)
          .eq("coach_id", coachId)
          .limit(500);
        if (fbRes.error) throw new Error(fbRes.error.message);

        const feedbacks = (fbRes.data ?? []) as CoachEvaluationFeedbackRow[];
        const eventIds = Array.from(new Set(feedbacks.map((x) => x.event_id).filter(Boolean)));
        if (eventIds.length === 0) {
          setCoachEvaluations([]);
          setCoachEvalPage(0);
          return;
        }

        const evRes = await supabase
          .from("club_events")
          .select("id,starts_at,event_type,status,club_id,title")
          .in("id", eventIds)
          .in("event_type", ["training", "camp"])
          .lt("starts_at", new Date().toISOString())
          .limit(1000);
        if (evRes.error) throw new Error(evRes.error.message);

        const events = (evRes.data ?? []) as CoachEvaluationEventRow[];
        const eventById = new Map(events.map((e) => [e.id, e]));

        const merged = feedbacks
          .map((fb) => {
            const ev = eventById.get(fb.event_id);
            if (!ev) return null;
            if (!ev.club_id || !sharedClubIds.includes(ev.club_id)) return null;
            const notePlayer = String(fb.player_note ?? "").trim();
            const notePrivate = String(fb.private_note ?? "").trim();
            return {
              event_id: fb.event_id,
              starts_at: ev.starts_at,
              title: ev.title ?? null,
              event_type: ev.event_type ?? null,
              engagement: fb.engagement,
              attitude: fb.attitude,
              application: fb.performance,
              note: notePlayer || notePrivate || null,
            } as CoachEvaluationRow;
          })
          .filter((x): x is CoachEvaluationRow => Boolean(x))
          .sort((a, b) => (a.starts_at > b.starts_at ? -1 : 1));

        setCoachEvaluations(merged);
        setCoachEvalPage(0);
      } catch {
        setCoachEvaluations([]);
      } finally {
        setLoadingCoachEvaluations(false);
      }
    })();
  }, [canLoadData, coachId, playerId, sharedClubIds]);

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
  const trainingLevel = trainingVolumeLevelFromDb ?? "—";
  const trainingVolumeObjective = trainingVolumeObjectiveFromDb ?? 0;
  const trainingVolumePercent = trainingVolumeObjective > 0 ? Math.max(0, Math.round((totalMinutes / trainingVolumeObjective) * 100)) : 0;

  useEffect(() => {
    (async () => {
      if (!canLoadData || !playerId) {
        setTrainingVolumeLevelFromDb(null);
        setTrainingVolumeObjectiveFromDb(null);
        setTrainingVolumeMotivationFromDb(null);
        return;
      }
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) {
          setTrainingVolumeLevelFromDb(null);
          setTrainingVolumeObjectiveFromDb(null);
          setTrainingVolumeMotivationFromDb(null);
          return;
        }
        const res = await fetch(
          `/api/coach/players/${encodeURIComponent(playerId)}/training-volume-level`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setTrainingVolumeLevelFromDb(null);
          setTrainingVolumeObjectiveFromDb(null);
          setTrainingVolumeMotivationFromDb(null);
          return;
        }
        const label = String(json?.level_label ?? "").trim();
        setTrainingVolumeLevelFromDb(label || null);
        const objective = Number(json?.objective_minutes);
        setTrainingVolumeObjectiveFromDb(Number.isFinite(objective) && objective > 0 ? objective : null);
        const motivation = String(json?.motivation_text ?? "").trim();
        setTrainingVolumeMotivationFromDb(motivation || null);
      } catch {
        setTrainingVolumeLevelFromDb(null);
        setTrainingVolumeObjectiveFromDb(null);
        setTrainingVolumeMotivationFromDb(null);
      }
    })();
  }, [canLoadData, playerId, sharedClubIds]);
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

  const coachEvalCurveSeries = useMemo(() => {
    const asc = [...coachEvaluations].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    return asc.map((x) => ({
      date: shortDate(x.starts_at, dateLocale),
      engagement: x.engagement,
      attitude: x.attitude,
      application: x.application,
    }));
  }, [coachEvaluations, dateLocale]);

  const coachEvalTrendSeries = useMemo(() => {
    const asc = [...coachEvaluations].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    if (asc.length < 2) return [];

    const linearTrendEnds = (key: "engagement" | "attitude" | "application") => {
      const pts = asc
        .map((row, i) => ({ x: i, y: row[key] }))
        .filter((p): p is { x: number; y: number } => typeof p.y === "number" && Number.isFinite(p.y));
      if (pts.length < 2) return { start: null as number | null, end: null as number | null };

      const n = pts.length;
      const sx = pts.reduce((s, p) => s + p.x, 0);
      const sy = pts.reduce((s, p) => s + p.y, 0);
      const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
      const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
      const den = n * sxx - sx * sx;
      if (den === 0) return { start: null as number | null, end: null as number | null };

      const a = (n * sxy - sx * sy) / den;
      const b = (sy - a * sx) / n;
      const x0 = 0;
      const x1 = asc.length - 1;
      const y0 = Math.max(0, Math.min(6, a * x0 + b));
      const y1 = Math.max(0, Math.min(6, a * x1 + b));
      return { start: Math.round(y0 * 10) / 10, end: Math.round(y1 * 10) / 10 };
    };

    const eng = linearTrendEnds("engagement");
    const att = linearTrendEnds("attitude");
    const app = linearTrendEnds("application");

    return [
      { point: "Début", engagement: eng.start, attitude: att.start, application: app.start },
      { point: "Fin", engagement: eng.end, attitude: att.end, application: app.end },
    ];
  }, [coachEvaluations]);

  const coachEvalNotes = useMemo(
    () => coachEvaluations.filter((x) => String(x.note ?? "").trim().length > 0),
    [coachEvaluations]
  );
  const coachEvalPageSize = 5;
  const coachEvalVisibleNotes = useMemo(() => {
    const start = coachEvalPage * coachEvalPageSize;
    return coachEvalNotes.slice(start, start + coachEvalPageSize);
  }, [coachEvalNotes, coachEvalPage]);
  const coachEvalHasMore = (coachEvalPage + 1) * coachEvalPageSize < coachEvalNotes.length;

  useEffect(() => {
    (async () => {
      if (!canLoadData || !playerId || sharedClubIds.length === 0) {
        setPlannedEvents([]);
        setPlannedGroupNameById({});
        return;
      }
      setLoadingPlannedEvents(true);
      try {
        const attendeeRes = await supabase
          .from("club_event_attendees")
          .select("event_id")
          .eq("player_id", playerId)
          .limit(2000);
        if (attendeeRes.error) throw new Error(attendeeRes.error.message);

        const eventIds = Array.from(
          new Set((attendeeRes.data ?? []).map((r: any) => String(r.event_id ?? "")).filter(Boolean))
        );
        if (eventIds.length === 0) {
          setPlannedEvents([]);
          setPlannedGroupNameById({});
          return;
        }

        const evRes = await supabase
          .from("club_events")
          .select("id,starts_at,ends_at,event_type,title,group_id,location_text,club_id,status")
          .in("id", eventIds)
          .in("club_id", sharedClubIds)
          .eq("status", "scheduled")
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(100);
        if (evRes.error) throw new Error(evRes.error.message);

        const nextEvents = (evRes.data ?? []) as PlannedEventRow[];
        setPlannedEvents(nextEvents);

        const groupIds = Array.from(new Set(nextEvents.map((e) => String(e.group_id ?? "")).filter(Boolean)));
        if (groupIds.length === 0) {
          setPlannedGroupNameById({});
          return;
        }
        const gRes = await supabase.from("coach_groups").select("id,name").in("id", groupIds);
        if (gRes.error) throw new Error(gRes.error.message);
        const byId: Record<string, string> = {};
        for (const g of gRes.data ?? []) byId[String((g as any).id)] = String((g as any).name ?? "");
        setPlannedGroupNameById(byId);
      } catch {
        setPlannedEvents([]);
        setPlannedGroupNameById({});
      } finally {
        setLoadingPlannedEvents(false);
      }
    })();
  }, [canLoadData, playerId, sharedClubIds]);

  async function loadDocuments() {
    if (!canLoadData || !playerId) return;
    setLoadingDocuments(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Load documents error"));
      setDocuments((json?.documents ?? []) as PlayerDashboardDocument[]);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadData, playerId]);

  function openDocumentPicker() {
    if (uploadingDocument) return;
    docFileInputRef.current?.click();
  }

  function onPickDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setDocFile(file);
  }

  async function uploadDocument() {
    if (!docFile || !playerId || sharedClubIds.length === 0 || uploadingDocument) return;
    setUploadingDocument(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");

      const fd = new FormData();
      fd.append("organization_id", sharedClubIds[0]);
      fd.append("coach_only", "false");
      fd.append("file", docFile);

      const res = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Upload failed"));
      const created = json?.document as PlayerDashboardDocument | undefined;
      if (created?.id) {
        setDocuments((prev) => [created, ...prev]);
      } else {
        await loadDocuments();
      }
      setDocFile(null);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploadingDocument(false);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!documentId || deletingDocumentId) return;
    const ok = window.confirm(
      locale === "fr"
        ? "Supprimer ce document ? (irréversible)"
        : "Delete this document? (irreversible)"
    );
    if (!ok) return;
    setDeletingDocumentId(documentId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(documentId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function loadTeamThreadMessages(threadId: string, options?: { silent?: boolean }) {
    if (!threadId) {
      setTeamMessages([]);
      return;
    }
    if (!options?.silent) setLoadingTeamMessages(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/messages/threads/${encodeURIComponent(threadId)}/messages?limit=200`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Load failed"));
      const msgs = ((json?.messages ?? []) as TeamThreadMessage[]).slice().reverse();
      setTeamMessages(msgs);

      const senderIds = Array.from(new Set(msgs.map((m) => String(m.sender_user_id ?? "")).filter(Boolean)));
      const missing = senderIds.filter((id) => !teamProfilesById[id]);
      if (missing.length > 0) {
        const profRes = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", missing);
        if (!profRes.error) {
          const next = { ...teamProfilesById };
          for (const p of profRes.data ?? []) next[String((p as any).id)] = p as ProfileLite;
          setTeamProfilesById(next);
        }
      }
    } catch {
      setTeamMessages([]);
    } finally {
      if (!options?.silent) setLoadingTeamMessages(false);
    }
  }

  async function loadTeamParticipants(threadId: string, organizationId?: string) {
    if (!threadId) {
      setTeamParticipantNames([]);
      return;
    }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (token) {
        const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/participants`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({} as any));
        if (res.ok) {
          const names: string[] = Array.isArray(json?.participant_full_names)
            ? (json.participant_full_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
            : Array.isArray(json?.participant_names)
              ? (json.participant_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
              : [];
          if (names.length > 0) {
            setTeamParticipantNames(names);
            return;
          }
        }
      }
    } catch {
      // fallback below
    }
    if (organizationId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (token) {
          const qs = new URLSearchParams({
            organization_id: organizationId,
            include_thread_id: threadId,
          });
          const res = await fetch(`/api/messages/threads?${qs.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({} as any));
          if (res.ok) {
            const thread = (json?.threads ?? []).find((t: any) => String(t?.id ?? "") === threadId);
            const names: string[] = Array.isArray(thread?.participant_full_names)
              ? (thread.participant_full_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
              : Array.isArray(thread?.participant_names)
                ? (thread.participant_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
                : [];
            if (names.length > 0) {
              setTeamParticipantNames(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
              return;
            }
          }
        }
      } catch {
        // fallback below
      }
    }
    const pRes = await supabase
      .from("thread_participants")
      .select("user_id")
      .eq("thread_id", threadId);
    if (pRes.error) {
      setTeamParticipantNames([]);
      return;
    }
    const ids = Array.from(new Set((pRes.data ?? []).map((r: any) => String(r.user_id ?? "")).filter(Boolean)));
    if (ids.length === 0) {
      setTeamParticipantNames([]);
      return;
    }
    const profRes = await supabase
      .from("profiles")
      .select("id,first_name,last_name")
      .in("id", ids);
    if (profRes.error) {
      setTeamParticipantNames([]);
      return;
    }
    const names = (profRes.data ?? [])
      .map((p: any) => `${String(p.first_name ?? "").trim()} ${String(p.last_name ?? "").trim()}`.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setTeamParticipantNames(names);
  }

  async function ensureAndLoadTeamThread() {
    if (!canLoadData || !playerId || !coachId || sharedClubIds.length === 0) {
      setTeamThreadId("");
      setTeamMessages([]);
      return;
    }
    setLoadingTeamThread(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/team-thread`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Team thread unavailable"));
      const threadId = String(json?.thread_id ?? "");
      const orgId = String(json?.organization_id ?? sharedClubIds[0] ?? "");
      if (!threadId) throw new Error("Team thread not found");

      setTeamThreadId(threadId);
      await loadTeamThreadMessages(threadId);
      await loadTeamParticipants(threadId, orgId);
    } catch {
      setTeamThreadId("");
      setTeamMessages([]);
    } finally {
      setLoadingTeamThread(false);
    }
  }

  useEffect(() => {
    void ensureAndLoadTeamThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadData, playerId, coachId, sharedClubIds.join(",")]);

  useEffect(() => {
    if (!teamThreadId) return;
    const channel = supabase
      .channel(`coach-player-team-thread:${teamThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "thread_messages", filter: `thread_id=eq.${teamThreadId}` },
        (payload) => {
          const row = payload.new as any;
          const msg: TeamThreadMessage = {
            id: String(row?.id ?? ""),
            thread_id: String(row?.thread_id ?? ""),
            sender_user_id: String(row?.sender_user_id ?? ""),
            body: String(row?.body ?? ""),
            created_at: String(row?.created_at ?? ""),
            sender_name: null,
          };
          setTeamMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Ensure sender names and ordering are always fresh across clients.
          window.setTimeout(() => {
            void loadTeamThreadMessages(teamThreadId, { silent: true });
          }, 120);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "thread_messages", filter: `thread_id=eq.${teamThreadId}` },
        () => {
          void loadTeamThreadMessages(teamThreadId, { silent: true });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [teamThreadId]);

  useEffect(() => {
    if (!teamThreadId) return;
    const timer = window.setInterval(async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) return;
        const res = await fetch(
          `/api/messages/threads/${encodeURIComponent(teamThreadId)}/messages?limit=1`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const latest = (json?.messages?.[0] ?? null) as any;
        if (!latest?.id) return;
        const latestId = String(latest.id);
        const currentLatestId = teamMessages.length ? String(teamMessages[teamMessages.length - 1]?.id ?? "") : "";
        if (latestId && latestId !== currentLatestId) {
          await loadTeamThreadMessages(teamThreadId, { silent: true });
        }
      } catch {
        // Silent fallback.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [teamThreadId, teamMessages]);

  async function sendTeamMessage() {
    if (!teamThreadId || !teamComposer.trim() || sendingTeamMessage) return;
    setSendingTeamMessage(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(teamThreadId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message_type: "text", body: teamComposer.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Send failed"));
      const created = json?.message as TeamThreadMessage | undefined;
      if (created?.id) {
        setTeamMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
      } else {
        await loadTeamThreadMessages(teamThreadId);
      }
      setTeamComposer("");
    } catch (e: any) {
      setError(e?.message ?? "Send failed");
    } finally {
      setSendingTeamMessage(false);
    }
  }

  async function deleteTeamMessage(messageId: string) {
    if (!teamThreadId || !messageId || deletingTeamMessageId) return;
    setDeletingTeamMessageId(messageId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/messages/threads/${encodeURIComponent(teamThreadId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setTeamMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingTeamMessageId("");
    }
  }

  function teamMessageTime(iso: string) {
    return new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  }

  function teamMessageDayLabel(iso: string) {
    return new Intl.DateTimeFormat(dateLocale, {
      weekday: "long",
      day: "2-digit",
      month: "long",
    }).format(new Date(iso));
  }

  useEffect(() => {
    if (!teamMessagesEndRef.current) return;
    teamMessagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [teamMessages.length, teamThreadId]);

  function renderTeamThreadCard() {
    return (
      <div className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Fil équipe coachs + joueur + parent(s)</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
            Participants: {teamParticipantNames.length ? teamParticipantNames.join(", ") : "—"}
          </div>
        </div>
        {loadingTeamThread || loadingTeamMessages ? (
          <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
        ) : !teamThreadId ? (
          <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Fil équipe indisponible.</div>
        ) : (
          <>
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                background: "linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(245,248,250,0.9) 100%)",
                padding: 10,
                maxHeight: 340,
                overflowY: "auto",
                display: "grid",
                gap: 8,
              }}
            >
              {teamMessages.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun message.</div>
              ) : (
                teamMessages.map((m, idx) => {
                  const mine = m.sender_user_id === coachId;
                  const p = teamProfilesById[m.sender_user_id];
                  const label = (
                    String(m.sender_name ?? "").trim() ||
                    (p ? `${String(p.first_name ?? "").trim()} ${String(p.last_name ?? "").trim()}`.trim() : "")
                  ) || m.sender_user_id.slice(0, 8);
                  const initialsLabel = (() => {
                    const first = String(p?.first_name ?? "").trim();
                    const last = String(p?.last_name ?? "").trim();
                    const i = `${first ? first[0].toUpperCase() : ""}${last ? last[0].toUpperCase() : ""}`;
                    return i || (label?.slice(0, 2) ?? "??").toUpperCase();
                  })();
                  const prev = idx > 0 ? teamMessages[idx - 1] : null;
                  const dayKey = new Date(m.created_at).toDateString();
                  const prevDayKey = prev ? new Date(prev.created_at).toDateString() : "";
                  const showDay = idx === 0 || dayKey !== prevDayKey;
                  return (
                    <div key={m.id} style={{ display: "grid", gap: 6 }}>
                      {showDay ? (
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          <span
                            className="pill-soft"
                            style={{
                              background: "rgba(107,114,128,0.14)",
                              borderColor: "rgba(107,114,128,0.24)",
                              color: "rgba(55,65,81,0.9)",
                              fontWeight: 900,
                              fontSize: 11,
                            }}
                          >
                            {teamMessageDayLabel(m.created_at)}
                          </span>
                        </div>
                      ) : null}
                      <div
                        style={{
                          justifySelf: mine ? "end" : "start",
                          display: "grid",
                          gridTemplateColumns: mine ? "1fr" : "26px 1fr",
                          gap: 8,
                          alignItems: "end",
                          maxWidth: "88%",
                        }}
                      >
                        {!mine ? (
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 999,
                              background: "rgba(53,72,59,0.14)",
                              border: "1px solid rgba(53,72,59,0.24)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 900,
                              color: "rgba(53,72,59,0.9)",
                            }}
                          >
                            {initialsLabel}
                          </div>
                        ) : null}
                        <div
                          style={{
                            position: "relative",
                            borderRadius: 12,
                            padding: "8px 10px 26px 10px",
                            paddingRight: 26,
                            background: mine ? "#1b5e20" : "rgba(0,0,0,0.06)",
                            color: mine ? "white" : "#111827",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                          }}
                        >
                          {mine ? (
                            <button
                              type="button"
                              onClick={() => void deleteTeamMessage(m.id)}
                              disabled={deletingTeamMessageId === m.id}
                              title="Supprimer le message"
                              style={{
                                position: "absolute",
                                bottom: 4,
                                right: 4,
                                border: "1px solid rgba(255,255,255,0.35)",
                                background: "rgba(255,255,255,0.12)",
                                color: "white",
                                width: 18,
                                height: 18,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: 999,
                                padding: 0,
                                cursor: "pointer",
                                opacity: 0.9,
                              }}
                            >
                              <X size={11} />
                            </button>
                          ) : null}
                          <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.82, marginBottom: 4 }}>
                            {label || "—"} • {teamMessageTime(m.created_at)}
                          </div>
                          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={teamMessagesEndRef} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <input
                className="input"
                placeholder="Écrire..."
                value={teamComposer}
                onChange={(e) => setTeamComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendTeamMessage();
                  }
                }}
              />
              <button className="btn btn-primary" type="button" onClick={() => void sendTeamMessage()} disabled={sendingTeamMessage || !teamComposer.trim()}>
                Envoyer
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

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
                flexShrink: 0,
              }}
            >
              {playerProfile?.avatar_url ? (
                <img src={playerProfile.avatar_url} alt={fullName(playerProfile)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                initials(playerProfile)
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 950, fontSize: 18, lineHeight: 1.2, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                {fullName(playerProfile) !== "—" ? fullName(playerProfile) : "Joueur"}
              </div>
              <div style={{ opacity: 0.72, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                Handicap {typeof playerProfile?.handicap === "number" ? playerProfile.handicap.toFixed(1) : "—"} • {trainingLevel}
              </div>
              <div style={{ opacity: 0.58, fontWeight: 800, marginTop: 4, fontSize: 10, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                {sharedClubNames.length ? sharedClubNames.join(" • ") : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-section">
          {renderTeamThreadCard()}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Documents joueur</div>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                ref={docFileInputRef}
                type="file"
                onChange={onPickDocument}
                style={{ display: "none" }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={openDocumentPicker}
                  disabled={uploadingDocument}
                >
                  Choisir un fichier
                </button>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: docFile ? "rgba(0,0,0,0.76)" : "rgba(0,0,0,0.5)",
                  }}
                >
                  {docFile ? docFile.name : "Aucun fichier sélectionné"}
                </span>
              </div>
              <div>
                <button
                  className="btn btn-primary btn-upload-green"
                  type="button"
                  onClick={() => void uploadDocument()}
                  style={{
                    opacity: !docFile || uploadingDocument ? 0.65 : 1,
                    pointerEvents: !docFile || uploadingDocument ? "none" : "auto",
                  }}
                >
                  <Upload size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  Upload
                </button>
              </div>
            </div>

            {loadingDocuments ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : documents.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun document.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {documents.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.75)",
                      padding: "8px 10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 900 }} className="truncate">
                        <FileText size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {d.file_name}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.6)" }}>
                        {shortDate(d.created_at, dateLocale)}
                        {` • Uploadé par ${String(d.uploaded_by_name ?? "").trim() || String(d.uploaded_by ?? "").slice(0, 8)}`}
                      </div>
                    </div>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <button className="btn" type="button" onClick={() => setViewerDocument(d)}>
                        Voir
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void deleteDocument(d.id)}
                        disabled={deletingDocumentId === d.id}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Planification du joueur</div>
            {loadingPlannedEvents ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : plannedEvents.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun événement planifié.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {plannedEvents.slice(0, 12).map((e) => (
                  <div
                    key={e.id}
                    style={{
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.75)",
                      padding: "8px 10px",
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 12, color: "rgba(0,0,0,0.7)" }}>
                      {shortDate(e.starts_at, dateLocale)} • {new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.starts_at))}
                    </div>
                    <div style={{ fontWeight: 900 }}>
                      {e.event_type === "training"
                        ? "Entraînement"
                        : e.event_type === "camp"
                          ? "Stage/Camp"
                          : e.event_type === "interclub"
                            ? "Interclub"
                            : e.event_type === "session"
                              ? "Séance"
                              : "Événement"}
                      {` • ${String(e.title ?? "").trim() || String(plannedGroupNameById[String(e.group_id ?? "")] ?? "").trim() || "Sans titre"}`}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                        {String(plannedGroupNameById[String(e.group_id ?? "")] ?? "").trim() || "—"}
                      </div>
                      <Link className="btn" href={`/coach/groups/${e.group_id}/planning/${e.id}`}>
                        Détails
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title" style={{ marginBottom: 10 }}>Suivi des évaluations</div>

            {loadingCoachEvaluations ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : coachEvaluations.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span className="pill-soft">{coachEvaluations.length} évaluations passées</span>
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setCoachEvalChartMode("curve")}
                      style={coachEvalChartMode === "curve" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                    >
                      Courbe
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setCoachEvalChartMode("trend")}
                      style={coachEvalChartMode === "trend" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                    >
                      Tendance
                    </button>
                  </div>
                </div>

                <div style={{ height: 280 }}>
                  {coachEvalChartMode === "curve" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={coachEvalCurveSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 6]} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="engagement" name="Engagement" stroke="rgba(16,94,51,0.95)" strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="attitude" name="Attitude" stroke="rgba(55,65,81,0.9)" strokeWidth={2} strokeDasharray="2 6" dot={false} />
                        <Line type="monotone" dataKey="application" name="Application" stroke="rgba(34,197,94,0.95)" strokeWidth={3} strokeDasharray="10 6" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={coachEvalTrendSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="point" />
                        <YAxis domain={[0, 6]} />
                        <Tooltip />
                        <Legend />
                        <Line type="linear" dataKey="engagement" name="Engagement" stroke="rgba(16,94,51,0.95)" strokeWidth={3} dot />
                        <Line type="linear" dataKey="attitude" name="Attitude" stroke="rgba(55,65,81,0.9)" strokeWidth={3} dot />
                        <Line type="linear" dataKey="application" name="Application" stroke="rgba(34,197,94,0.95)" strokeWidth={3} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {coachEvalChartMode === "trend" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {[
                      {
                        label: "Engagement",
                        start: coachEvalTrendSeries[0]?.engagement ?? null,
                        end: coachEvalTrendSeries[1]?.engagement ?? null,
                      },
                      {
                        label: "Attitude",
                        start: coachEvalTrendSeries[0]?.attitude ?? null,
                        end: coachEvalTrendSeries[1]?.attitude ?? null,
                      },
                      {
                        label: "Application",
                        start: coachEvalTrendSeries[0]?.application ?? null,
                        end: coachEvalTrendSeries[1]?.application ?? null,
                      },
                    ].map((row) => {
                      const delta =
                        row.start != null && row.end != null
                          ? Math.round((row.end - row.start) * 10) / 10
                          : null;
                      return (
                      <div
                        key={row.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          padding: "8px 10px",
                          background: "rgba(255,255,255,0.75)",
                        }}
                      >
                        <span style={{ fontWeight: 900 }}>{row.label}</span>
                        <span style={{ fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>
                          {row.start ?? "—"} → {row.end ?? "—"}
                          {delta == null ? "" : delta > 0 ? `  ▲ +${delta}` : delta < 0 ? `  ▼ ${delta}` : "  • 0"}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="hr-soft" style={{ margin: "2px 0" }} />

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>
                    Notes coach ({coachEvalNotes.length})
                  </div>

                  {coachEvalVisibleNotes.length === 0 ? (
                    <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune note texte disponible.</div>
                  ) : (
                    coachEvalVisibleNotes.map((row) => (
                      <div
                        key={row.event_id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.78)",
                          padding: "10px 12px",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900, fontSize: 12, color: "rgba(0,0,0,0.68)" }}>
                            {shortDate(row.starts_at, dateLocale)}
                            {` • ${row.event_type === "camp" ? "Stage/Camp" : "Entraînement"}`}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>
                            Eng. {row.engagement ?? "—"} • Att. {row.attitude ?? "—"} • App. {row.application ?? "—"}
                          </div>
                        </div>
                        <div style={{ fontWeight: 800, color: "rgba(0,0,0,0.78)" }}>{row.note}</div>
                      </div>
                    ))
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {coachEvalHasMore ? (
                      <button type="button" className="btn" onClick={() => setCoachEvalPage((p) => p + 1)}>
                        Afficher les suivantes
                      </button>
                    ) : null}
                    {coachEvalPage > 0 ? (
                      <button type="button" className="btn" onClick={() => setCoachEvalPage(0)}>
                        Revenir au début
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

       {/* ===== Title Trainings ===== */}
        <div className="glass-section" style={{ paddingTop: 0 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Volume d'entrainement
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

        {/* ===== Trainings KPIs ===== */}
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div className="glass-card" style={{ gridColumn: "1 / -1" }}>
              <div className="card-title">{t("golfDashboard.volume")}</div>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : filteredSessions.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
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

                      {trainingVolumeObjective > 0 ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.72)" }}>
                            {t("playerHome.goal")}: {trainingVolumeObjective} {t("common.min")}
                          </div>
                        </div>
                      ) : null}

                      {compareLabel && (
                        <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{loadingPrev ? t("golfDashboard.comparing") : compareLabel}</div>
                      )}
                    </div>
                    <div style={{ justifySelf: "center" }}>
                      <VolumeDonut percent={trainingVolumePercent} />
                    </div>
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

            <div className="glass-card" style={{ gridColumn: "1 / -1" }}>
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

      {viewerDocument ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setViewerDocument(null)}
        >
          <div
            style={{
              width: "min(980px, 100%)",
              maxHeight: "min(86vh, 860px)",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.1)",
              boxShadow: "0 20px 48px rgba(0,0,0,0.25)",
              display: "grid",
              gridTemplateRows: "auto 1fr",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "10px 12px",
                borderBottom: "1px solid rgba(0,0,0,0.1)",
                background: "rgba(248,250,248,0.95)",
              }}
            >
              <div className="truncate" style={{ fontWeight: 900 }}>
                {viewerDocument.file_name}
              </div>
              <button className="btn" type="button" onClick={() => setViewerDocument(null)} aria-label="Fermer">
                <X size={14} />
              </button>
            </div>

            <div style={{ background: "rgba(245,246,248,0.9)", overflow: "auto" }}>
              {(viewerDocument.mime_type ?? "").startsWith("image/") ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                  <img
                    src={viewerDocument.public_url}
                    alt={viewerDocument.file_name}
                    style={{ maxWidth: "100%", maxHeight: "74vh", objectFit: "contain", borderRadius: 10 }}
                  />
                </div>
              ) : (viewerDocument.mime_type ?? "").startsWith("video/") ? (
                <div style={{ padding: 12 }}>
                  <video src={viewerDocument.public_url} controls style={{ width: "100%", maxHeight: "74vh", borderRadius: 10 }} />
                </div>
              ) : (
                <iframe
                  title={viewerDocument.file_name}
                  src={viewerDocument.public_url}
                  style={{ width: "100%", height: "74vh", border: "none", display: "block" }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

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
