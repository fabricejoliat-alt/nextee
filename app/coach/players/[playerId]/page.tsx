"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import CountUpNumber from "@/components/ui/CountUpNumber";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
import {
  getValidationBadgeColors,
  getValidationBadgeLabel,
  type ValidationBadge,
  type ValidationDashboardPayload,
} from "@/lib/validations";
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
import {
  Flame,
  Mountain,
  Smile,
  SlidersHorizontal,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  X,
  Upload,
  FileText,
  FileImage,
  FileMusic,
  FileVideoCamera,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  FileQuestionMark,
  FileType,
  Eye,
  ExternalLink,
  MessageCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import managerStyles from "@/app/manager/camps/Camps.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import CoachPlayerActivityCard from "@/components/coach/player-detail/CoachPlayerActivityCard";
import CoachPlayerIdentity from "@/components/coach/player-detail/CoachPlayerIdentity";
import playerStyles from "./CoachPlayerDetail.module.css";

type SessionType = "club" | "private" | "individual";

type TrainingSessionRow = {
  id: string;
  start_at: string;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  session_type: SessionType;
  club_event_id: string | null;
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
  player_note: string | null;
  private_note: string | null;
};

type GolfRoundRow = {
  id: string;
  start_at: string;
  round_type: string; // training | competition | ...
  competition_name?: string | null;
  course_name: string | null;
  location: string | null;
  tee_name: string | null;
  handicap_start?: number | null;
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

type TrainingVolumeSummarySnapshot = {
  current: { minutes: number; count: number };
  previous: { minutes: number; count: number };
};

type TrainingVolumeTargetRow = {
  id: string;
  ftem_code: string;
  level_label: string;
  handicap_label: string;
  handicap_min: number | null;
  handicap_max: number | null;
  motivation_text: string | null;
  minutes_offseason: number;
  minutes_inseason: number;
  sort_order: number;
};

type HandicapHistoryEntry = {
  id: string;
  effective_date: string;
  value: number;
  note: string | null;
};

type TrainingVolumeClubConfig = {
  organization_id: string;
  season_months: number[];
  offseason_months: number[];
  rows: TrainingVolumeTargetRow[];
};

type OmTournamentScoreRow = {
  round_id: string;
  score_gross: number | null;
  score_net: number | null;
};

type Preset = "week" | "month" | "last3" | "all" | "custom";
type TrainingScope = "all" | "mine_club";
type EvalChartMode = "curve" | "trend";
type DashboardSection = "overview" | "trainings" | "competition" | "stats" | "planning" | "followup" | "thread" | "documents" | "evaluations" | "validations";
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
  group_name?: string | null;
  organization_name?: string | null;
  can_open_detail?: boolean;
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
  club_event_id?: string | null;
  linked_event_group_id?: string | null;
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

function thisWeekRangeLocal(now = new Date()) {
  const start = weekStartMonday(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
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

function parseMonthArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const uniq = new Set<number>();
  for (const v of values) {
    const n = Number(v);
    if (!Number.isInteger(n)) continue;
    if (n < 1 || n > 12) continue;
    uniq.add(n);
  }
  return Array.from(uniq);
}

function pickTrainingVolumeTarget(
  handicap: number | null | undefined,
  rows: TrainingVolumeTargetRow[]
): TrainingVolumeTargetRow | null {
  if (!rows.length) return null;
  if (typeof handicap !== "number" || !Number.isFinite(handicap)) return rows[0] ?? null;
  const matched = rows.find((row) => {
    if (typeof row.handicap_min !== "number" || typeof row.handicap_max !== "number") return false;
    const lo = Math.min(row.handicap_min, row.handicap_max);
    const hi = Math.max(row.handicap_min, row.handicap_max);
    return handicap >= lo && handicap <= hi;
  });
  return matched ?? rows[0] ?? null;
}

function objectiveForMonth(
  target: TrainingVolumeTargetRow | null,
  seasonMonths: number[],
  offseasonMonths: number[],
  month: number
) {
  if (!target) return 0;
  const inSeason =
    seasonMonths.includes(month) || (!offseasonMonths.includes(month) && seasonMonths.length > 0);
  return inSeason ? target.minutes_inseason : target.minutes_offseason;
}

function compareYmd(a: string, b: string) {
  return a.localeCompare(b);
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

function documentPicto(mimeType: string | null | undefined, fileName: string) {
  const mime = String(mimeType ?? "").toLowerCase();
  const n = String(fileName ?? "").toLowerCase();
  const ext = n.includes(".") ? n.split(".").pop() ?? "" : "";

  if (mime.includes("pdf") || ext === "pdf") return FileType;
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "svg"].includes(ext)) return FileImage;
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return FileMusic;
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return FileVideoCamera;
  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xls", "xlsx", "csv", "ods"].includes(ext)) return FileSpreadsheet;
  if (mime.includes("word") || ["doc", "docx", "odt", "rtf"].includes(ext)) return FileText;
  if (mime.includes("presentation") || ["ppt", "pptx", "odp"].includes(ext)) return FileSpreadsheet;
  if (mime.includes("zip") || mime.includes("compressed") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("html") ||
    mime.includes("css") ||
    ["json", "xml", "js", "ts", "tsx", "jsx", "html", "css", "md", "txt"].includes(ext)
  ) {
    return FileCode;
  }
  return FileQuestionMark;
}

function isPdfDocument(mimeType: string | null | undefined, fileName: string) {
  const mime = String(mimeType ?? "").toLowerCase();
  const n = String(fileName ?? "").toLowerCase();
  const ext = n.includes(".") ? n.split(".").pop() ?? "" : "";
  return mime.includes("pdf") || ext === "pdf";
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

function isGirOnHole(par: number | null, score: number | null, putts: number | null) {
  if (typeof par !== "number" || typeof score !== "number" || typeof putts !== "number") return false;
  return score - putts <= par - 2;
}

function ScoreMark({ par, score }: { par: number | null; score: number | null }) {
  if (typeof score !== "number") return <>—</>;
  if (typeof par !== "number") return <>{score}</>;
  const difference = score - par;
  const markClass = difference <= -2
    ? playerStyles.scoreEagle
    : difference === -1
      ? playerStyles.scoreBirdie
      : difference === 1
        ? playerStyles.scoreBogey
        : difference >= 2
          ? playerStyles.scoreDoublePlus
          : playerStyles.scorePar;
  return <span className={`${playerStyles.scoreMark} ${markClass}`}><span>{score}</span></span>;
}

function ScorecardBooleanMark({ value }: { value: boolean | null }) {
  if (value == null) return <>—</>;
  return (
    <span
      className={value ? playerStyles.scorecardSuccess : playerStyles.scorecardFailure}
      aria-label={value ? "Oui" : "Non"}
    >
      {value ? "✓" : "✕"}
    </span>
  );
}

function formatSigned(n: number) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function shortDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso));
}

function validationProgressRatio(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function ValidationBadgePill({ locale, badge }: { locale: string; badge: ValidationBadge }) {
  const colors = getValidationBadgeColors(badge);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: 0.2,
        background: colors.background,
        color: colors.color,
        border: badge === "none" ? "1px solid rgba(15,23,42,0.08)" : "none",
      }}
    >
      <ShieldCheck size={14} />
      {getValidationBadgeLabel(locale, badge)}
    </span>
  );
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
    return "/coach/players";
  }, [returnToParam]);

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
  const [prevItems, setPrevItems] = useState<TrainingItemRow[]>([]);
  const [plannedClubMinutes, setPlannedClubMinutes] = useState<number>(0);
  const [prevPlannedClubMinutes, setPrevPlannedClubMinutes] = useState<number>(0);
  const [plannedClubEventsCount, setPlannedClubEventsCount] = useState<number>(0);
  const [isPerformanceEnabled, setIsPerformanceEnabled] = useState(false);

  const [rounds, setRounds] = useState<GolfRoundRow[]>([]);
  const [prevRounds, setPrevRounds] = useState<GolfRoundRow[]>([]);
  const [omScoresByRoundId, setOmScoresByRoundId] = useState<Record<string, { gross: number | null; net: number | null }>>({});

  const [holes, setHoles] = useState<GolfHoleRow[]>([]);
  const [prevHoles, setPrevHoles] = useState<GolfHoleRow[]>([]);

  const [sessionsLookback, setSessionsLookback] = useState<TrainingSessionRow[]>([]);
  const [itemsLookback, setItemsLookback] = useState<TrainingItemRow[]>([]);
  const [accessChecked, setAccessChecked] = useState(false);
  const [canLoadData, setCanLoadData] = useState(false);
  const [canAccessSensitiveSections, setCanAccessSensitiveSections] = useState(false);
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
  const [loadingPlannedEvents, setLoadingPlannedEvents] = useState(false);
  const [plannedEventsPage, setPlannedEventsPage] = useState(0);
  const [documents, setDocuments] = useState<PlayerDashboardDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string>("");
  const [deletingDocumentId, setDeletingDocumentId] = useState<string>("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState<string>("");
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
  const [activeSection, setActiveSection] = useState<DashboardSection>(() => {
    const requested = String(searchParams.get("tab") ?? "overview");
    const allowedTabs: string[] = ["overview", "trainings", "competition", "stats", "planning", "followup", "documents", "thread"];
    return allowedTabs.includes(requested)
      ? requested as DashboardSection
      : "overview";
  });
  const [validationDashboard, setValidationDashboard] = useState<ValidationDashboardPayload | null>(null);
  const [loadingValidations, setLoadingValidations] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const teamMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const [selectedCompetitionRoundId, setSelectedCompetitionRoundId] = useState<string>("");
  const [trainingVolumeLevelFromDb, setTrainingVolumeLevelFromDb] = useState<string | null>(null);
  const [trainingVolumeObjectiveFromDb, setTrainingVolumeObjectiveFromDb] = useState<number | null>(null);
  const [trainingVolumeMotivationFromDb, setTrainingVolumeMotivationFromDb] = useState<string | null>(null);
  const [trainingVolumeSummary, setTrainingVolumeSummary] = useState<TrainingVolumeSummarySnapshot | null>(null);
  const [playerHandicap, setPlayerHandicap] = useState<number | null>(null);
  const [handicapHistory, setHandicapHistory] = useState<HandicapHistoryEntry[]>([]);
  const [trainingVolumeConfigs, setTrainingVolumeConfigs] = useState<TrainingVolumeClubConfig[]>([]);

  useEffect(() => {
    (async () => {
      setAccessChecked(false);
      setCanLoadData(false);
      setCanAccessSensitiveSections(false);
      setError(null);
      setValidationDashboard(null);
      setValidationError(null);

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
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error("Session invalide.");

        const accessRes = await fetch(
          `/api/coach/players/${encodeURIComponent(playerId)}/access`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );
        const accessJson = await accessRes.json().catch(() => ({}));
        if (!accessRes.ok) throw new Error(String(accessJson?.error ?? "Access denied for this player."));

        const nextSharedClubIds = Array.isArray(accessJson?.access?.shared_club_ids)
          ? (accessJson.access.shared_club_ids as unknown[]).map((id) => String(id ?? "")).filter(Boolean)
          : [];
        if (nextSharedClubIds.length === 0) throw new Error("Access denied for this player.");
        setSharedClubIds(nextSharedClubIds);

        const sensitiveAccess = Boolean(accessJson?.access?.can_access_sensitive_sections);
        setCanAccessSensitiveSections(sensitiveAccess);
        setPlayerProfile((accessJson?.profile ?? null) as ProfileLite | null);
        setSharedClubNames(
          Array.isArray(accessJson?.organizations)
            ? (accessJson.organizations as unknown[]).map((organization) => String(organization ?? "").trim()).filter(Boolean)
            : []
        );

        setCanLoadData(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur chargement.";
        setError(msg);
        setCanLoadData(false);
        setCanAccessSensitiveSections(false);
        setPlayerProfile(null);
        setSharedClubNames([]);
        setSharedClubIds([]);
        setCoachId("");
        setValidationDashboard(null);
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
    if (!accessChecked) return;
    if (canAccessSensitiveSections) return;
    if (activeSection === "followup" || activeSection === "evaluations" || activeSection === "thread" || activeSection === "documents") {
      setActiveSection("overview");
    }
  }, [accessChecked, activeSection, canAccessSensitiveSections]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    query.set("tab", activeSection);
    window.history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
  }, [activeSection]);

  const visibleSectionTabs = useMemo(
    () =>
      [
        { id: "overview" as DashboardSection, label: "Vue d’ensemble" },
        { id: "trainings" as DashboardSection, label: "Entraînements" },
        { id: "competition" as DashboardSection, label: "Compétitions" },
        { id: "stats" as DashboardSection, label: "Statistiques" },
        { id: "planning" as DashboardSection, label: "Planification" },
        { id: "followup" as DashboardSection, label: "Suivi" },
        { id: "documents" as DashboardSection, label: "Documents" },
        { id: "thread" as DashboardSection, label: "Discussion" },
      ].filter(
        (tab) => canAccessSensitiveSections || (tab.id !== "followup" && tab.id !== "thread" && tab.id !== "documents")
      ),
    [canAccessSensitiveSections]
  );

  useEffect(() => {
    if (!canLoadData || activeSection !== "followup" || !playerId) return;
    if (validationDashboard?.effective_player_id === playerId) return;

    let active = true;

    void (async () => {
      setLoadingValidations(true);
      setValidationError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error("Session invalide.");

        const res = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/validations`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Erreur de chargement des validations."));
        if (!active) return;
        setValidationDashboard(json as ValidationDashboardPayload);
      } catch (e: unknown) {
        if (!active) return;
        setValidationDashboard(null);
        setValidationError(e instanceof Error ? e.message : "Erreur de chargement des validations.");
      } finally {
        if (active) setLoadingValidations(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeSection, canLoadData, playerId, validationDashboard?.effective_player_id]);

  const shouldLoadTrainingData = canLoadData && (activeSection === "overview" || activeSection === "trainings");
  const shouldLoadRoundData = canLoadData && (activeSection === "overview" || activeSection === "competition" || activeSection === "stats");

  const validationAttemptCount = useMemo(() => {
    if (!validationDashboard) return 0;
    return validationDashboard.sections.reduce(
      (sum, section) => sum + section.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.attempts.length, 0),
      0
    );
  }, [validationDashboard]);

  const validationSectionSummaries = useMemo(() => {
    if (!validationDashboard) return [];
    return validationDashboard.sections.map((section) => {
      const latestAttemptAt = section.exercises.reduce<string | null>((latest, exercise) => {
        return exercise.attempts.reduce<string | null>((latestAttempt, attempt) => {
          if (!attempt.attempted_at) return latestAttempt;
          if (!latestAttempt) return attempt.attempted_at;
          return new Date(attempt.attempted_at).getTime() > new Date(latestAttempt).getTime()
            ? attempt.attempted_at
            : latestAttempt;
        }, latest);
      }, null);

      return {
        id: section.id,
        name: section.name,
        validatedCount: section.validated_count,
        totalCount: section.total_count,
        badge: section.badge,
        latestAttemptAt,
      };
    });
  }, [validationDashboard]);

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

    if (preset === "week") {
      const { start, end } = thisWeekRangeLocal(now);
      const endInclusive = new Date(end);
      endInclusive.setDate(endInclusive.getDate() - 1);
      setFromDate(isoToYMD(start));
      setToDate(isoToYMD(endInclusive));
      return;
    }

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

    if (preset === "week") {
      const now = new Date();
      const cur = thisWeekRangeLocal(now);
      const prevStart = new Date(cur.start);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevEndInclusive = new Date(cur.start);
      prevEndInclusive.setDate(prevEndInclusive.getDate() - 1);
      return { from: isoToYMD(prevStart), to: isoToYMD(prevEndInclusive) };
    }

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
    if (preset === "week") return t("golfDashboard.vsPrevPeriod");
    if (preset === "month") return t("golfDashboard.vsPrevMonth");
    if (preset === "last3") return t("golfDashboard.vsPrev3Months");
    return t("golfDashboard.vsPrevPeriod");
  }, [prevRange, preset, t]);

  // ===== LOAD TRAININGS (current) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const uid = playerId;

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,club_id,coach_user_id")
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
  }, [shouldLoadTrainingData, fromDate, playerId, toDate]);

  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData || !playerId) {
        setIsPerformanceEnabled(false);
        return;
      }
      const perfEnabled = await isEffectivePlayerPerformanceEnabled(playerId);
      setIsPerformanceEnabled(perfEnabled);
    })();
  }, [shouldLoadTrainingData, playerId]);

  // ===== LOAD COACH EVALUATIONS (past trainings) =====
  useEffect(() => {
    (async () => {
      if (!canLoadData || !canAccessSensitiveSections || !coachId || !playerId || sharedClubIds.length === 0) {
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
          .in("event_type", ["training"])
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
              player_note: notePlayer || null,
              private_note: notePrivate || null,
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
  }, [canLoadData, canAccessSensitiveSections, coachId, playerId, sharedClubIds]);

  // ===== LOAD TRAININGS (prev KPIs) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData) {
        setPrevSessions([]);
        setPrevItems([]);
        return;
      }
      if (!prevRange) {
        setPrevSessions([]);
        setPrevItems([]);
        return;
      }

      setLoadingPrev(true);
      try {
        const uid = playerId;

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,club_id,coach_user_id")
          .eq("user_id", uid)
          .order("start_at", { ascending: true });

        q = q.gte("start_at", startOfDayISO(prevRange.from)).lt("start_at", nextDayStartISO(prevRange.to)).limit(2000);

        const res = await q;
        if (res.error) throw new Error(res.error.message);

        const sess = (res.data ?? []) as TrainingSessionRow[];
        setPrevSessions(sess);

        const ids = sess.map((s) => s.id);
        if (ids.length === 0) {
          setPrevItems([]);
          return;
        }

        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in("session_id", ids);
        if (iRes.error) throw new Error(iRes.error.message);

        setPrevItems((iRes.data ?? []) as TrainingItemRow[]);
      } catch {
        setPrevSessions([]);
        setPrevItems([]);
      } finally {
        setLoadingPrev(false);
      }
    })();
  }, [shouldLoadTrainingData, playerId, prevRange, prevRange?.from, prevRange?.to]);

  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData || !playerId) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }
      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", playerId)
        .eq("status", "present");
      const attendeeEventIds = Array.from(
        new Set(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => r.event_id).filter((v): v is string => Boolean(v)))
      );
      if (attendeeEventIds.length === 0) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }
      let q = supabase
        .from("club_events")
        .select("id,club_id,starts_at,ends_at,duration_minutes,status")
        .in("id", attendeeEventIds)
        .neq("status", "cancelled")
        .lt("starts_at", new Date().toISOString());
      if (fromDate) q = q.gte("starts_at", startOfDayISO(fromDate));
      if (toDate) q = q.lt("starts_at", nextDayStartISO(toDate));
      if (trainingScope === "mine_club" && sharedClubIds.length > 0) q = q.in("club_id", sharedClubIds);
      const res = await q;
      if (res.error) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }
      setPlannedClubEventsCount((res.data ?? []).length);
      const total = (res.data ?? []).reduce((sum, row: { starts_at: string | null; ends_at: string | null; duration_minutes: number | null }) => {
        const mins = Number(row.duration_minutes ?? 0);
        if (Number.isFinite(mins) && mins > 0) return sum + mins;
        if (row.starts_at && row.ends_at) {
          const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
          return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
        }
        return sum;
      }, 0);
      setPlannedClubMinutes(total);
    })();
  }, [shouldLoadTrainingData, playerId, fromDate, toDate, trainingScope, sharedClubIds]);

  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData || !playerId || !prevRange) {
        setPrevPlannedClubMinutes(0);
        return;
      }
      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", playerId)
        .eq("status", "present");
      const attendeeEventIds = Array.from(
        new Set(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => r.event_id).filter((v): v is string => Boolean(v)))
      );
      if (attendeeEventIds.length === 0) {
        setPrevPlannedClubMinutes(0);
        return;
      }
      let q = supabase
        .from("club_events")
        .select("id,club_id,starts_at,ends_at,duration_minutes,status")
        .in("id", attendeeEventIds)
        .neq("status", "cancelled")
        .gte("starts_at", startOfDayISO(prevRange.from))
        .lt("starts_at", nextDayStartISO(prevRange.to));
      if (trainingScope === "mine_club" && sharedClubIds.length > 0) q = q.in("club_id", sharedClubIds);
      const res = await q;
      if (res.error) {
        setPrevPlannedClubMinutes(0);
        return;
      }
      const total = (res.data ?? []).reduce((sum, row: { starts_at: string | null; ends_at: string | null; duration_minutes: number | null }) => {
        const mins = Number(row.duration_minutes ?? 0);
        if (Number.isFinite(mins) && mins > 0) return sum + mins;
        if (row.starts_at && row.ends_at) {
          const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
          return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
        }
        return sum;
      }, 0);
      setPrevPlannedClubMinutes(total);
    })();
  }, [shouldLoadTrainingData, playerId, prevRange, trainingScope, sharedClubIds]);

  // ===== LOAD ROUNDS (current) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundData) {
        setRounds([]);
        setLoadingRounds(false);
        return;
      }
      setLoadingRounds(true);
      try {
        const uid = playerId;

        let q = supabase
          .from("golf_rounds")
          .select(
            "id,start_at,round_type,competition_name,course_name,location,tee_name,handicap_start,slope_rating,course_rating,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus"
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
  }, [shouldLoadRoundData, fromDate, playerId, toDate]);

  // ===== LOAD ROUNDS (prev, for trends) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundData) {
        setPrevRounds([]);
        setLoadingPrevRounds(false);
        return;
      }
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
  }, [shouldLoadRoundData, playerId, prevRange, prevRange?.from, prevRange?.to]);

  // ===== LOAD HOLES (current) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundData) {
        setHoles([]);
        setLoadingHoles(false);
        return;
      }
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
  }, [shouldLoadRoundData, rounds]);

  // ===== LOAD OM SCORES (gross/net) FOR CURRENT ROUNDS =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundData) {
        setOmScoresByRoundId({});
        return;
      }
      try {
        const ids = rounds.map((r) => r.id);
        if (ids.length === 0) {
          setOmScoresByRoundId({});
          return;
        }
        const res = await supabase.from("om_tournament_scores").select("round_id,score_gross,score_net").in("round_id", ids);
        if (res.error) {
          setOmScoresByRoundId({});
          return;
        }
        const map: Record<string, { gross: number | null; net: number | null }> = {};
        for (const row of (res.data ?? []) as OmTournamentScoreRow[]) {
          map[row.round_id] = {
            gross: typeof row.score_gross === "number" ? row.score_gross : null,
            net: typeof row.score_net === "number" ? row.score_net : null,
          };
        }
        setOmScoresByRoundId(map);
      } catch {
        setOmScoresByRoundId({});
      }
    })();
  }, [shouldLoadRoundData, rounds]);

  // ===== LOAD HOLES (prev) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundData) {
        setPrevHoles([]);
        setLoadingPrevHoles(false);
        return;
      }
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
  }, [shouldLoadRoundData, prevRange, prevRounds]);

  // ===== LOAD TRAININGS LOOKBACK (for correlation) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData) {
        setSessionsLookback([]);
        setItemsLookback([]);
        setLoadingTrainLookback(false);
        return;
      }
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
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,club_id,coach_user_id")
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
  }, [shouldLoadTrainingData, fromDate, playerId, toDate]);
      
  const PRESET_LABEL: Record<Preset, string> = {
    week: t("common.thisWeek"),
    month: t("common.thisMonth"),
    last3: t("common.last3Months"),
    all: t("common.allActivity"),
    custom: t("common.custom"),
  };

function presetToSelectValue(p: Preset): Preset {
  // Le select doit rester cohérent : si customOpen est ouvert ou preset=custom -> custom
  return p;
}
  const volumeCardTitle = useMemo(() => {
    if (preset === "week") return pickLocaleText(locale, "Volume de la semaine", "Weekly training volume");
    if (preset === "month") return pickLocaleText(locale, "Volume du mois", "Monthly training volume");
    if (preset === "last3") return pickLocaleText(locale, "Volume des 3 derniers mois", "Last 3 months volume");
    if (preset === "custom") return pickLocaleText(locale, "Volume de la période", "Period training volume");
    return t("golfDashboard.volume");
  }, [locale, preset, t]);
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

  const filteredPrevSessionIds = useMemo(
    () => new Set(filteredPrevSessions.map((s) => s.id)),
    [filteredPrevSessions]
  );

  const filteredPrevItems = useMemo(
    () => prevItems.filter((it) => filteredPrevSessionIds.has(it.session_id)),
    [prevItems, filteredPrevSessionIds]
  );

  // ===== TRAININGS AGGREGATES (current + prev) =====
  const totalMinutes = useMemo(
    () => {
      if (trainingVolumeSummary) return trainingVolumeSummary.current.minutes;
      if (isPerformanceEnabled) return filteredItems.reduce((sum, it) => sum + (it.minutes || 0), 0);
      return plannedClubMinutes;
    },
    [trainingVolumeSummary, isPerformanceEnabled, filteredItems, plannedClubMinutes]
  );
  const displayedTrainingCount = useMemo(
    () =>
      trainingVolumeSummary
        ? trainingVolumeSummary.current.count
        : isPerformanceEnabled
          ? filteredSessions.length
          : plannedClubEventsCount,
    [trainingVolumeSummary, isPerformanceEnabled, filteredSessions.length, plannedClubEventsCount]
  );
  const trainingLevel = trainingVolumeLevelFromDb ?? "—";
  const trainingVolumeObjective = trainingVolumeObjectiveFromDb ?? 0;
  const displayedTrainingVolumeObjective = useMemo(() => {
    if (trainingVolumeObjective <= 0) return 0;
    if (preset === "month") return trainingVolumeObjective * 4;
    return trainingVolumeObjective;
  }, [preset, trainingVolumeObjective]);
  const weeklyObjectiveMinutes = useMemo(
    () => (trainingVolumeObjective > 0 ? trainingVolumeObjective : 0),
    [trainingVolumeObjective]
  );
  const handicapForDate = useMemo(() => {
    const sortedAsc = [...handicapHistory].sort((a, b) => compareYmd(a.effective_date, b.effective_date));
    return (ymd: string) => {
      if (sortedAsc.length === 0) return playerHandicap;
      let active: HandicapHistoryEntry | null = null;
      for (const entry of sortedAsc) {
        if (compareYmd(entry.effective_date, ymd) <= 0) active = entry;
        else break;
      }
      if (active) return active.value;
      return sortedAsc[0]?.value ?? playerHandicap;
    };
  }, [handicapHistory, playerHandicap]);
  const trainingVolumePercent =
    displayedTrainingVolumeObjective > 0
      ? Math.max(0, Math.round((totalMinutes / displayedTrainingVolumeObjective) * 100))
      : 0;
  useEffect(() => {
    (async () => {
      if (!canLoadData || !playerId) {
        setPlayerHandicap(null);
        setHandicapHistory([]);
        setTrainingVolumeConfigs([]);
        setTrainingVolumeLevelFromDb(null);
        setTrainingVolumeObjectiveFromDb(null);
        setTrainingVolumeMotivationFromDb(null);
        return;
      }
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) {
          setPlayerHandicap(null);
          setHandicapHistory([]);
          setTrainingVolumeConfigs([]);
          setTrainingVolumeLevelFromDb(null);
          setTrainingVolumeObjectiveFromDb(null);
          setTrainingVolumeMotivationFromDb(null);
          return;
        }
        const weeklyTargetsRes = await fetch(
          `/api/coach/players/${encodeURIComponent(playerId)}/training-volume-weekly-targets`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        const weeklyTargetsJson = await weeklyTargetsRes.json().catch(() => ({}));
        if (weeklyTargetsRes.ok) {
          const currentHandicap = Number(weeklyTargetsJson?.current_handicap);
          setPlayerHandicap(Number.isFinite(currentHandicap) ? currentHandicap : null);
          setHandicapHistory(
            Array.isArray(weeklyTargetsJson?.handicap_history)
              ? (weeklyTargetsJson.handicap_history as HandicapHistoryEntry[])
              : []
          );
          setTrainingVolumeConfigs(
            Array.isArray(weeklyTargetsJson?.configs)
              ? (weeklyTargetsJson.configs as TrainingVolumeClubConfig[]).map((config) => ({
                  organization_id: String(config.organization_id ?? ""),
                  season_months: parseMonthArray(config.season_months),
                  offseason_months: parseMonthArray(config.offseason_months),
                  rows: Array.isArray(config.rows) ? config.rows : [],
                }))
              : []
          );
        } else {
          setPlayerHandicap(null);
          setHandicapHistory([]);
          setTrainingVolumeConfigs([]);
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
        setPlayerHandicap(null);
        setHandicapHistory([]);
        setTrainingVolumeConfigs([]);
        setTrainingVolumeLevelFromDb(null);
        setTrainingVolumeObjectiveFromDb(null);
        setTrainingVolumeMotivationFromDb(null);
      }
    })();
  }, [canLoadData, playerId, sharedClubIds]);
  const avgMotivation = useMemo(() => avg(filteredSessions.map((s) => s.motivation)), [filteredSessions]);
  const avgDifficulty = useMemo(() => avg(filteredSessions.map((s) => s.difficulty)), [filteredSessions]);
  const avgSatisfaction = useMemo(() => avg(filteredSessions.map((s) => s.satisfaction)), [filteredSessions]);

  const nonPerformanceManualSessions = useMemo(
    () =>
      filteredSessions.filter(
        (session) =>
          !session.club_event_id &&
          (session.session_type === "individual" || session.session_type === "private")
      ),
    [filteredSessions]
  );

  const byType = useMemo(() => {
    if (!isPerformanceEnabled) {
      const manualPrivateCount = nonPerformanceManualSessions.filter((session) => session.session_type === "private").length;
      const manualIndividualCount = nonPerformanceManualSessions.filter((session) => session.session_type === "individual").length;
      return {
        club: plannedClubEventsCount,
        private: manualPrivateCount,
        individual: manualIndividualCount,
      } satisfies Record<SessionType, number>;
    }
    const m: Record<SessionType, number> = { club: 0, private: 0, individual: 0 };
    for (const s of filteredSessions) m[s.session_type] += 1;
    return m;
  }, [isPerformanceEnabled, plannedClubEventsCount, filteredSessions, nonPerformanceManualSessions]);

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
    () => {
      if (trainingVolumeSummary) return trainingVolumeSummary.previous.minutes;
      if (isPerformanceEnabled) return filteredPrevItems.reduce((sum, it) => sum + (it.minutes || 0), 0);
      return prevPlannedClubMinutes;
    },
    [trainingVolumeSummary, isPerformanceEnabled, filteredPrevItems, prevPlannedClubMinutes]
  );
  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainingData || !playerId) {
        setTrainingVolumeSummary(null);
        return;
      }
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) {
          setTrainingVolumeSummary(null);
          return;
        }

        const params = new URLSearchParams();
        params.set("scope", trainingScope);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        if (prevRange?.from) params.set("prev_from", prevRange.from);
        if (prevRange?.to) params.set("prev_to", prevRange.to);

        const res = await fetch(
          `/api/coach/players/${encodeURIComponent(playerId)}/training-volume-summary?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setTrainingVolumeSummary(null);
          return;
        }

        const currentMinutes = Number(json?.current?.minutes);
        const currentCount = Number(json?.current?.count);
        const previousMinutes = Number(json?.previous?.minutes);
        const previousCount = Number(json?.previous?.count);

        setTrainingVolumeSummary({
          current: {
            minutes: Number.isFinite(currentMinutes) ? currentMinutes : 0,
            count: Number.isFinite(currentCount) ? currentCount : 0,
          },
          previous: {
            minutes: Number.isFinite(previousMinutes) ? previousMinutes : 0,
            count: Number.isFinite(previousCount) ? previousCount : 0,
          },
        });
      } catch {
        setTrainingVolumeSummary(null);
      }
    })();
  }, [shouldLoadTrainingData, playerId, trainingScope, fromDate, toDate, prevRange?.from, prevRange?.to]);
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
        objective:
          trainingVolumeConfigs.length > 0
            ? trainingVolumeConfigs.reduce((max, config) => {
                const handicapAtWeek = handicapForDate(w.weekStart);
                const target = pickTrainingVolumeTarget(handicapAtWeek, config.rows);
                const month = new Date(`${w.weekStart}T00:00:00`).getMonth() + 1;
                const objective = objectiveForMonth(target, config.season_months, config.offseason_months, month);
                return Math.max(max, objective);
              }, 0)
            : weeklyObjectiveMinutes,
      }));

    return list.map((x) => {
      const d = new Date(`${x.week}T00:00:00`);
      const label = new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [dateLocale, filteredSessions, handicapForDate, trainingVolumeConfigs, weeklyObjectiveMinutes]);

  // ===== MES PARCOURS AGGREGATES (CURRENT + PREV) =====
  const holeAgg = useMemo(() => {
    const byRound: Record<string, GolfHoleRow[]> = {};
    for (const h of holes) (byRound[h.round_id] ??= []).push(h);

    const roundsWithPlayedCount: Record<string, number> = {};
    for (const rid of Object.keys(byRound)) {
      roundsWithPlayedCount[rid] = byRound[rid].filter((h) => typeof h.score === "number").length;
    }

    const holesPlayed = holes.filter((h) => typeof h.score === "number").length;

    // completed rounds: only if 18 holes have a played score
    const completedRoundIds = new Set(Object.entries(roundsWithPlayedCount).filter(([, n]) => n === 18).map(([rid]) => rid));
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

    const avgPutts18 = avg(
      completedRounds.map((r) => {
        if (typeof r.total_putts === "number") return r.total_putts;
        const hs = (byRound[r.id] ?? []).filter((h) => typeof h.score === "number");
        if (hs.length !== 18) return null;
        const sumPutts = hs.reduce((sum, h) => sum + (typeof h.putts === "number" ? h.putts : 0), 0);
        return Number.isFinite(sumPutts) && sumPutts > 0 ? sumPutts : null;
      })
    );

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

    const girKnownHoles = holes.filter(
      (h) => typeof h.par === "number" && typeof h.score === "number" && typeof h.putts === "number"
    );
    const girHits = girKnownHoles.filter((h) => isGirOnHole(h.par, h.score, h.putts)).length;
    const girPct = girKnownHoles.length ? round1((girHits / girKnownHoles.length) * 100) : null;
    const scramblingKnownHoles = girKnownHoles;
    let scramblingOpp = 0;
    let scramblingSuccess = 0;
    for (const h of scramblingKnownHoles) {
      if (isGirOnHole(h.par, h.score, h.putts)) continue;
      scramblingOpp += 1;
      if ((h.score as number) <= (h.par as number)) scramblingSuccess += 1;
    }
    const scramblingPct = scramblingOpp > 0 ? round1((scramblingSuccess / scramblingOpp) * 100) : null;

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
      avgPutts18,
      fwPct,
      girPct,
      scramblingPct,
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

    const roundsWithPlayedCount: Record<string, number> = {};
    for (const rid of Object.keys(byRound)) {
      roundsWithPlayedCount[rid] = byRound[rid].filter((h) => typeof h.score === "number").length;
    }

    const holesPlayed = prevHoles.filter((h) => typeof h.score === "number").length;
    const completedRoundIds = new Set(Object.entries(roundsWithPlayedCount).filter(([, n]) => n === 18).map(([rid]) => rid));
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

    const avgPutts18 = avg(
      completedRounds.map((r) => {
        if (typeof r.total_putts === "number") return r.total_putts;
        const hs = (byRound[r.id] ?? []).filter((h) => typeof h.score === "number");
        if (hs.length !== 18) return null;
        const sumPutts = hs.reduce((sum, h) => sum + (typeof h.putts === "number" ? h.putts : 0), 0);
        return Number.isFinite(sumPutts) && sumPutts > 0 ? sumPutts : null;
      })
    );

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

    const girKnownHoles = prevHoles.filter(
      (h) => typeof h.par === "number" && typeof h.score === "number" && typeof h.putts === "number"
    );
    const girHits = girKnownHoles.filter((h) => isGirOnHole(h.par, h.score, h.putts)).length;
    const girPct = girKnownHoles.length > 0 ? round1((girHits / girKnownHoles.length) * 100) : null;
    const scramblingKnownHoles = girKnownHoles;
    let scramblingOpp = 0;
    let scramblingSuccess = 0;
    for (const h of scramblingKnownHoles) {
      if (isGirOnHole(h.par, h.score, h.putts)) continue;
      scramblingOpp += 1;
      if ((h.score as number) <= (h.par as number)) scramblingSuccess += 1;
    }
    const scramblingPct = scramblingOpp > 0 ? round1((scramblingSuccess / scramblingOpp) * 100) : null;

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

    return {
      holesPlayed,
      avgScore18,
      dist,
      distDen,
      avgPutts18,
      fwPct,
      girPct,
      scramblingPct,
      avgPar3,
      avgPar4,
      avgPar5,
      avgFront,
      avgBack,
    };
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

  const competitionRounds = useMemo(
    () =>
      rounds
        .filter((r) => r.round_type === "competition")
        .slice()
        .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()),
    [rounds]
  );

  const holesByRoundId = useMemo(() => {
    const map: Record<string, GolfHoleRow[]> = {};
    for (const h of holes) (map[h.round_id] ??= []).push(h);
    for (const rid of Object.keys(map)) {
      map[rid].sort((a, b) => (a.hole_no ?? 0) - (b.hole_no ?? 0));
    }
    return map;
  }, [holes]);

  const selectedCompetitionRound = useMemo(
    () => competitionRounds.find((r) => r.id === selectedCompetitionRoundId) ?? null,
    [competitionRounds, selectedCompetitionRoundId]
  );

  const selectedCompetitionHoles = useMemo(
    () => (selectedCompetitionRound ? holesByRoundId[selectedCompetitionRound.id] ?? [] : []),
    [holesByRoundId, selectedCompetitionRound]
  );

  const selectedCompetitionStats = useMemo(() => {
    if (!selectedCompetitionRound) return null;
    const hs = selectedCompetitionHoles.filter(
      (h) => typeof h.par === "number" && typeof h.score === "number"
    );
    const totalGrossFromHoles =
      hs.length > 0 ? hs.reduce((sum, h) => sum + (h.score as number), 0) : null;
    const totalGross = totalGrossFromHoles ?? selectedCompetitionRound.total_score ?? null;
    const netFromOm = omScoresByRoundId[selectedCompetitionRound.id]?.net ?? null;
    const totalNet =
      netFromOm ??
      (typeof totalGross === "number" ? totalGross - Number(selectedCompetitionRound.handicap_start ?? 0) : null);

    const puttsTotal = selectedCompetitionHoles.reduce(
      (sum, h) => sum + (typeof h.putts === "number" ? h.putts : 0),
      0
    );
    const fwKnown = selectedCompetitionHoles.filter(
      (h) => typeof h.par === "number" && h.par >= 4 && typeof h.fairway_hit === "boolean"
    );
    const fwHit = fwKnown.filter((h) => h.fairway_hit === true).length;
    const fwPct = fwKnown.length > 0 ? round1((fwHit / fwKnown.length) * 100) : null;

    const girKnown = selectedCompetitionHoles.filter(
      (h) => typeof h.par === "number" && typeof h.score === "number" && typeof h.putts === "number"
    );
    const girHits = girKnown.filter((h) => isGirOnHole(h.par, h.score, h.putts)).length;
    const girPct = girKnown.length > 0 ? round1((girHits / girKnown.length) * 100) : null;

    let scramblingOpp = 0;
    let scramblingSuccess = 0;
    for (const h of girKnown) {
      if (isGirOnHole(h.par, h.score, h.putts)) continue;
      scramblingOpp += 1;
      if ((h.score as number) <= (h.par as number)) scramblingSuccess += 1;
    }
    const scramblingPct = scramblingOpp > 0 ? round1((scramblingSuccess / scramblingOpp) * 100) : null;

    return { totalGross, totalNet, puttsTotal, fwPct, girPct, scramblingPct };
  }, [omScoresByRoundId, selectedCompetitionHoles, selectedCompetitionRound]);

  const selectedCompetitionTotals = useMemo(() => {
    if (!selectedCompetitionRound) return null;
    const totalPar = selectedCompetitionHoles.reduce(
      (sum, h) => sum + (typeof h.par === "number" ? h.par : 0),
      0
    );
    const totalScoreFromHoles = selectedCompetitionHoles.reduce(
      (sum, h) => sum + (typeof h.score === "number" ? h.score : 0),
      0
    );
    const totalPutts = selectedCompetitionHoles.reduce(
      (sum, h) => sum + (typeof h.putts === "number" ? h.putts : 0),
      0
    );
    const hasScoreFromHoles = selectedCompetitionHoles.some((h) => typeof h.score === "number");
    const totalScore = hasScoreFromHoles ? totalScoreFromHoles : selectedCompetitionRound.total_score ?? null;
    return { totalPar, totalScore, totalPutts };
  }, [selectedCompetitionHoles, selectedCompetitionRound]);

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

      putts18: holeAgg.avgPutts18,
      puttsArrow: delta(holeAgg.avgPutts18, prevHoleAgg.avgPutts18),

      fwPct: holeAgg.fwPct,
      fwArrow: delta(holeAgg.fwPct, prevHoleAgg.fwPct),

      scramblingPct: holeAgg.scramblingPct,
      scramblingArrow: delta(holeAgg.scramblingPct, prevHoleAgg.scramblingPct),
    };
  }, [holeAgg, prevHoleAgg, prevRange]);

  const playerAvatarUrl = useMemo(() => {
    const base = playerProfile?.avatar_url?.trim() || "";
    if (!base) return null;
    return `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }, [playerProfile?.avatar_url]);

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
  const currentGroupNames = useMemo(
    () => Array.from(new Set(plannedEvents.map((event) => String(event.group_name ?? "").trim()).filter(Boolean))),
    [plannedEvents]
  );
  const nextPlannedEvent = useMemo(
    () => plannedEvents.filter((event) => new Date(event.starts_at).getTime() >= Date.now()).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] ?? null,
    [plannedEvents]
  );
  const trainingMinutesLabel = totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)} h ${String(totalMinutes % 60).padStart(2, "0")}` : displayedTrainingCount > 0 ? "Durée indisponible" : "Aucune donnée";
  const handicapChartData = useMemo(
    () => [...handicapHistory].sort((a, b) => compareYmd(a.effective_date, b.effective_date)).map((entry) => ({ date: entry.effective_date, handicap: entry.value })),
    [handicapHistory]
  );

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
    () =>
      coachEvaluations.filter(
        (x) => String(x.player_note ?? "").trim().length > 0 || String(x.private_note ?? "").trim().length > 0
      ),
    [coachEvaluations]
  );
  const coachEvalPageSize = 5;
  const plannedEventsPageSize = 12;
  const coachEvalVisibleNotes = useMemo(() => {
    const start = coachEvalPage * coachEvalPageSize;
    return coachEvalNotes.slice(start, start + coachEvalPageSize);
  }, [coachEvalNotes, coachEvalPage]);
  const coachEvalHasMore = (coachEvalPage + 1) * coachEvalPageSize < coachEvalNotes.length;
  const plannedEventsVisible = useMemo(() => {
    const start = plannedEventsPage * plannedEventsPageSize;
    return plannedEvents.slice(start, start + plannedEventsPageSize);
  }, [plannedEvents, plannedEventsPage]);
  const plannedEventsHasMore = (plannedEventsPage + 1) * plannedEventsPageSize < plannedEvents.length;

  useEffect(() => {
    setPlannedEventsPage(0);
  }, [plannedEvents.length]);

  useEffect(() => {
    (async () => {
      if (!canLoadData || !playerId) {
        setPlannedEvents([]);
        return;
      }
      setLoadingPlannedEvents(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token ?? "";
        if (!token) throw new Error("Missing token");
        const res = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/planning`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Load planning error"));
        setPlannedEvents((json?.events ?? []) as PlannedEventRow[]);
      } catch {
        setPlannedEvents([]);
      } finally {
        setLoadingPlannedEvents(false);
      }
    })();
  }, [canLoadData, playerId]);

  async function loadDocuments() {
    if (!canLoadData || !canAccessSensitiveSections || !playerId) {
      setDocuments([]);
      return;
    }
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
  }, [canLoadData, canAccessSensitiveSections, playerId]);

  function openDocumentPicker() {
    if (uploadingDocument) return;
    docFileInputRef.current?.click();
  }

  function onPickDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setDocFile(file);
    setDocName(file?.name ?? "");
  }

  async function uploadDocument() {
    if (!docFile || !playerId || sharedClubIds.length === 0 || uploadingDocument) return;
    const finalDocName = docName.trim();
    if (!finalDocName) {
      setError("Veuillez saisir un nom de document.");
      return;
    }
    setUploadingDocument(true);
    try {
      const uploadFile = await optimizeUploadFile(docFile);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");

      const prepareRes = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "prepare",
          organization_id: sharedClubIds[0],
          coach_only: false,
          original_name: uploadFile.name,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const prepareJson = await prepareRes.json().catch(() => ({}));
      if (!prepareRes.ok) throw new Error(String(prepareJson?.error ?? "Upload failed"));

      const uploadPath = String(prepareJson?.path ?? "").trim();
      const uploadToken = String(prepareJson?.token ?? "").trim();
      if (!uploadPath || !uploadToken) throw new Error("Upload initialization failed");

      const uploadRes = await supabase.storage.from("marketplace").uploadToSignedUrl(
        uploadPath,
        uploadToken,
        uploadFile,
        {
          upsert: false,
          contentType: uploadFile.type || "application/octet-stream",
        }
      );
      if (uploadRes.error) throw new Error(uploadRes.error.message);

      const finalizeRes = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          organization_id: sharedClubIds[0],
          coach_only: false,
          storage_path: uploadPath,
          original_name: uploadFile.name,
          file_name: finalDocName,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const json = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) throw new Error(String(json?.error ?? "Upload failed"));

      const created = json?.document as PlayerDashboardDocument | undefined;
      if (created?.id) {
        setDocuments((prev) => [created, ...prev]);
      } else {
        await loadDocuments();
      }
      setDocFile(null);
      setDocName("");
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploadingDocument(false);
    }
  }

  async function renameDocument(doc: PlayerDashboardDocument) {
    if (!coachId || coachId !== String(doc.uploaded_by ?? "")) return;
    const currentName = String(doc.file_name ?? "").trim();
    const nextName = window.prompt("Nouveau nom du document", currentName)?.trim() ?? "";
    if (!nextName || nextName === currentName) return;
    setRenamingDocumentId(doc.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(doc.id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ file_name: nextName }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Rename failed"));
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, file_name: String(json?.document?.file_name ?? nextName) } : d))
      );
      if (viewerDocument?.id === doc.id) {
        setViewerDocument((prev) => (prev ? { ...prev, file_name: String(json?.document?.file_name ?? nextName) } : prev));
      }
    } catch (e: any) {
      setError(e?.message ?? "Rename failed");
    } finally {
      setRenamingDocumentId("");
    }
  }

  async function deleteDocument(doc: PlayerDashboardDocument) {
    if (!doc?.id || deletingDocumentId || !coachId || coachId !== String(doc.uploaded_by ?? "")) return;
    const ok = window.confirm(
      locale === "fr" ? `Supprimer le document "${doc.file_name}" ?` : `Delete document "${doc.file_name}"?`
    );
    if (!ok) return;
    setDeletingDocumentId(doc.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(doc.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (viewerDocument?.id === doc.id) setViewerDocument(null);
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
    if (!canLoadData || !canAccessSensitiveSections || !playerId || !coachId || sharedClubIds.length === 0) {
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
  }, [canLoadData, canAccessSensitiveSections, playerId, coachId, sharedClubIds.join(",")]);

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
      <div className={playerStyles.panel} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 className={playerStyles.panelTitle}>Discussion liée au junior</h2>
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
            <div className={playerStyles.threadMessagesViewport}>
              {teamMessages.length === 0 ? (
                <div className={playerStyles.threadEmptyState}>
                  <span className={playerStyles.threadEmptyIcon} aria-hidden="true">
                    <MessageCircle size={19} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong>Aucun message pour le moment</strong>
                    <p>Commencez la discussion avec le junior et les participants associés.</p>
                  </div>
                </div>
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
              <button className={actionStyles.primaryButton} type="button" onClick={() => void sendTeamMessage()} disabled={sendingTeamMessage || !teamComposer.trim()}>
                Envoyer
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderValidationsCard() {
    const title = pickLocaleText(locale, "Validation des défis", "Challenge validation");
    const overallLabel = pickLocaleText(locale, "Progression globale", "Overall progress");
    const attemptsLabel = pickLocaleText(locale, "tentatives", "attempts");
    const sectionsLabel = pickLocaleText(locale, "Secteurs", "Sections");
    const lastAttemptLabel = pickLocaleText(locale, "Dernière tentative", "Last attempt");
    const noAttemptLabel = pickLocaleText(locale, "Aucune tentative", "No attempt");

    if (loadingValidations) {
      return (
        <div className={playerStyles.panel} style={{ display: "grid", gap: 12 }}>
          <h2 className={playerStyles.panelTitle}>{title}</h2>
          <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
        </div>
      );
    }

    if (validationError) {
      return (
        <div className={playerStyles.panel} style={{ display: "grid", gap: 12 }}>
          <h2 className={playerStyles.panelTitle}>{title}</h2>
          <div className={actionStyles.errorAlert} role="alert">{validationError}</div>
        </div>
      );
    }

    if (!validationDashboard) {
      return (
        <div className={playerStyles.panel} style={{ display: "grid", gap: 12 }}>
          <h2 className={playerStyles.panelTitle}>{title}</h2>
          <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
        </div>
      );
    }

    return (
      <div className={playerStyles.panel} style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "rgba(0,0,0,0.08)",
            background: "rgba(255,255,255,0.72)",
            borderRadius: 16,
            padding: "18px 16px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <h2 className={playerStyles.panelTitle}>{title}</h2>
            <ValidationBadgePill locale={locale} badge={validationDashboard.overall_badge} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <h3 className={playerStyles.panelTitle}>{overallLabel}</h3>
              <div className="big-number" style={{ lineHeight: 1.05, marginTop: 6 }}>
                {validationDashboard.overall_validated_count}/{validationDashboard.overall_total_count}
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.58)" }}>
              {validationAttemptCount} {attemptsLabel}
            </div>
          </div>
          <div className="bar">
            <span
              style={{
                width: `${validationProgressRatio(
                  validationDashboard.overall_validated_count,
                  validationDashboard.overall_total_count
                )}%`,
                background: "linear-gradient(90deg, var(--green-light), var(--green-dark))",
              }}
            />
          </div>
        </div>

        <div
          style={{
            border: "1px solid rgba(15,23,42,0.08)",
            borderRadius: 18,
            padding: 16,
            background: "rgba(255,255,255,0.92)",
            display: "grid",
            gap: 10,
          }}
        >
          <h3 className={playerStyles.panelTitle}>{sectionsLabel}</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {validationSectionSummaries.map((section) => (
              <div
                key={section.id}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(15,23,42,0.08)",
                  background: "white",
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="bar-row" style={{ flex: 1, marginBottom: 0 }}>
                    <span>{section.name}</span>
                    <span>{section.validatedCount}/{section.totalCount}</span>
                  </div>
                  <ValidationBadgePill locale={locale} badge={section.badge} />
                </div>
                <div className="bar">
                  <span
                    style={{
                      width: `${validationProgressRatio(section.validatedCount, section.totalCount)}%`,
                      background: "linear-gradient(90deg, var(--green-light), var(--green-dark))",
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.62)" }}>
                  {lastAttemptLabel}: {section.latestAttemptAt ? shortDate(section.latestAttemptAt, dateLocale) : noAttemptLabel}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderFilterCard() {
    return (
      <div className={playerStyles.panel} style={{ padding: 14 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <SlidersHorizontal size={16} />
            <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>
              {t("common.period")}
            </div>
          </div>

          <select
            value={preset}
            onChange={(e) => {
              const v = e.target.value as Preset;

              if (v === "custom") {
                setPreset("custom");

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
            <option value="week">{t("common.thisWeek")}</option>
            <option value="month">Ce mois</option>
            <option value="last3">3 derniers mois</option>
            <option value="all">{t("common.allActivity")}</option>
            <option value="custom">{t("common.custom")}</option>
          </select>

          {customOpen && preset === "custom" ? (
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
                  className={actionStyles.secondaryButton}
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
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <main className={managerStyles.page}>
      <nav className={managerStyles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><ChevronRight size={13} aria-hidden="true" /><Link href="/coach/players">Juniors</Link><ChevronRight size={13} aria-hidden="true" /><span>{fullName(playerProfile) || "Junior"}</span></nav>
      <header className={managerStyles.topline}><div><h1>{fullName(playerProfile) || "Junior"}</h1><p className={managerStyles.lead}>Suivi sportif, activités et progression du junior.</p></div><div className={managerStyles.actions}><Link className={actionStyles.backButton} href={returnHref}><ArrowLeft size={16} aria-hidden="true" />Retour aux juniors</Link></div></header>
      {!accessChecked ? <section className={managerStyles.panel}><CompactLoadingBlock label={t("common.loading")} /></section> : null}
      {error && <div className={managerStyles.alertError} role="alert">{error}</div>}
      <section className={managerStyles.panel} aria-label="Identité sportive">
        <CoachPlayerIdentity avatarUrl={playerAvatarUrl} avatarAlt={fullName(playerProfile)} initials={initials(playerProfile)} handicap={typeof playerProfile?.handicap === "number" ? playerProfile.handicap.toFixed(1) : "Non renseigné"} ftemLevel={trainingLevel === "—" ? "Non défini" : trainingLevel} groups={currentGroupNames.length ? currentGroupNames.join(", ") : "Non renseigné"} clubs={sharedClubNames.length ? sharedClubNames.join(", ") : "Non renseigné"} nextActivity={nextPlannedEvent ? shortDate(nextPlannedEvent.starts_at, dateLocale) : "Aucune activité"} />
      </section>
      <ManagerStatisticsTabs<DashboardSection> items={visibleSectionTabs.map((tab) => ({ value: tab.id, label: tab.label }))} value={activeSection} onChange={setActiveSection} ariaLabel="Sections du junior" />

        {activeSection === "overview" ? (
          <div className={playerStyles.stack}>
            <section className={playerStyles.overviewGrid} aria-label="Vue d’ensemble sportive">
              <div className={playerStyles.metric}><span>Assiduité</span><strong>—</strong><small>Données insuffisantes</small></div>
              <div className={playerStyles.metric}><span>Volume</span><strong>{trainingMinutesLabel}</strong><small>Période sélectionnée</small></div>
              <div className={playerStyles.metric}><span>Objectif</span><strong>{displayedTrainingVolumeObjective > 0 ? `${trainingVolumePercent} %` : "—"}</strong><small>{displayedTrainingVolumeObjective > 0 ? `${displayedTrainingVolumeObjective} min` : "Non défini"}</small></div>
              <div className={playerStyles.metric}><span>Activités</span><strong>{displayedTrainingCount}</strong><small>Période sélectionnée</small></div>
              <div className={playerStyles.metric}><span>Compétitions</span><strong>{loadingRounds ? "—" : competitionRounds.length}</strong><small>Période sélectionnée</small></div>
              <div className={playerStyles.metric}><span>Évaluations</span><strong>{coachEvaluations.length || "—"}</strong><small>{coachEvaluations.length ? "Réalisées par ce coach" : "Aucune donnée"}</small></div>
            </section>
            <div className={playerStyles.overviewColumns}>
              <section className={playerStyles.panel}>
                <h2 className={playerStyles.panelTitle}>Prochaine activité</h2>
                {loadingPlannedEvents ? <CompactLoadingBlock label={t("common.loading")} /> : nextPlannedEvent ? <CoachPlayerActivityCard startsAt={nextPlannedEvent.starts_at} endsAt={nextPlannedEvent.ends_at} dateLocale={dateLocale} typeLabel={nextPlannedEvent.event_type === "training" ? "Entraînement" : nextPlannedEvent.event_type === "camp" ? "Stage" : nextPlannedEvent.event_type === "interclub" ? "Interclub" : nextPlannedEvent.event_type === "session" ? "Séance" : "Événement"} title={nextPlannedEvent.title || undefined} groupName={nextPlannedEvent.group_name || "Groupe non renseigné"} clubName={nextPlannedEvent.organization_name || sharedClubNames[0] || "Club non renseigné"} location={nextPlannedEvent.location_text} href={nextPlannedEvent.can_open_detail && nextPlannedEvent.group_id ? `/coach/groups/${nextPlannedEvent.group_id}/planning/${nextPlannedEvent.id}` : undefined} /> : <div className={playerStyles.empty}>Aucune activité à venir.</div>}
              </section>
              <section className={playerStyles.panel}>
                <h2 className={playerStyles.panelTitle}>Points d’attention</h2>
                <div className={playerStyles.attention}>
                  {displayedTrainingVolumeObjective <= 0 ? <button type="button" onClick={() => setActiveSection("trainings")}>L’objectif d’entraînement n’a pas encore été défini.</button> : null}
                  {!nextPlannedEvent && !loadingPlannedEvents ? <button type="button" onClick={() => setActiveSection("planning")}>Aucune activité à venir n’est planifiée.</button> : null}
                  {displayedTrainingVolumeObjective > 0 && trainingVolumePercent < 60 ? <button type="button" onClick={() => setActiveSection("trainings")}>Le volume enregistré représente {trainingVolumePercent} % de l’objectif de la période.</button> : null}
                  {displayedTrainingVolumeObjective > 0 && trainingVolumePercent >= 60 && (nextPlannedEvent || loadingPlannedEvents) ? <div className={playerStyles.empty}>Aucun point d’attention actuellement.</div> : null}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {activeSection === "trainings" || activeSection === "competition" || activeSection === "stats" ? (
          <div className={playerStyles.section}>{renderFilterCard()}</div>
        ) : null}

        {activeSection === "thread" ? (
          <div className={playerStyles.section}>
            {renderTeamThreadCard()}
          </div>
        ) : null}

        {activeSection === "documents" ? (
          <div className={playerStyles.section}>
            <div className={`${playerStyles.panel} ${playerStyles.documentsPanel}`}>
            <div className={playerStyles.documentsHeader}><div><h2 className={playerStyles.panelTitle}>Documents du junior</h2><p>Ajoutez ou consultez les fichiers associés au suivi du junior.</p></div><span>{documents.length}</span></div>
            <div className={playerStyles.documentUploadBox}>
              <input
                ref={docFileInputRef}
                type="file"
                onChange={onPickDocument}
                style={{ display: "none" }}
              />
              <div className={playerStyles.documentUploadHeading}>
                <span><Upload size={16} aria-hidden="true" /></span>
                <div><b>Ajouter un document</b><small>Choisissez un fichier puis vérifiez son nom.</small></div>
              </div>
              <div className={playerStyles.documentUploadGrid}>
                <button type="button" className={playerStyles.documentFilePicker} onClick={openDocumentPicker} disabled={uploadingDocument}>
                  <FileText size={16} aria-hidden="true" />
                  <span><b>{docFile ? docFile.name : "Choisir un fichier"}</b><small>{docFile ? "Fichier prêt à être ajouté" : "Aucun fichier sélectionné"}</small></span>
                </button>
                <label className={playerStyles.documentField}>
                  <span>Nom du document</span>
                  <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Ex. Analyse vidéo du swing" maxLength={180} />
                </label>
              </div>
                <button
                  className={actionStyles.primaryButton}
                  type="button"
                  onClick={() => void uploadDocument()}
                  disabled={!docFile || !docName.trim() || uploadingDocument}
                >
                  <Upload size={15} aria-hidden="true" />
                  {uploadingDocument ? "Ajout en cours…" : "Ajouter le document"}
                </button>
            </div>

            <div className={playerStyles.documentsListHeader}><span>Documents liés</span><small>{documents.length ? `${documents.length} fichier${documents.length > 1 ? "s" : ""}` : "Aucun fichier"}</small></div>
            {loadingDocuments ? (
              <CompactLoadingBlock label="Chargement des documents…" />
            ) : documents.length === 0 ? (
              <div className={playerStyles.empty}>Aucun document n’a encore été ajouté.</div>
            ) : (
              <div className={playerStyles.documentsGrid}>
                {documents.map((d) => {
                  const uploader = String(d.uploaded_by_name ?? "").trim() || String(d.uploaded_by ?? "").slice(0, 8);
                  const fileName = String(d.file_name ?? "").trim();
                  const dot = fileName.lastIndexOf(".");
                  const ext = dot > 0 ? fileName.slice(dot + 1).toUpperCase() : "DOC";
                  const Picto = documentPicto(d.mime_type, fileName);
                  return (
                    <article key={d.id} className={playerStyles.documentCard}>
                      <div className={playerStyles.documentCardMain}>
                        <div className={playerStyles.documentTypeIcon} aria-hidden="true">
                          <Picto size={16} strokeWidth={2.2} />
                        </div>
                        <div className={playerStyles.documentCardCopy}>
                          <b title={fileName}>{fileName}</b>
                          <span>{ext} · {shortDate(d.created_at, dateLocale)}</span>
                          <small title={uploader}>Ajouté par {uploader}</small>
                          <div className={playerStyles.documentBadges}>{d.coach_only ? <span><ShieldCheck size={11} aria-hidden="true" />Coachs uniquement</span> : <span>Visible par le junior</span>}{d.club_event_id ? <span>Activité liée</span> : null}</div>
                        </div>
                      </div>

                      <div className={playerStyles.documentCardActions}>
                        <button className={playerStyles.documentIconButton} type="button" onClick={() => setViewerDocument(d)} aria-label={`Voir ${fileName}`} title="Voir">
                          <Eye size={15} aria-hidden="true" />
                        </button>
                        {d.club_event_id && d.linked_event_group_id ? (
                          <Link
                            className={playerStyles.documentIconButton}
                            href={`/coach/groups/${encodeURIComponent(d.linked_event_group_id)}/planning/${encodeURIComponent(d.club_event_id)}`}
                            aria-label={`Ouvrir l’activité liée à ${fileName}`}
                            title="Ouvrir l’activité liée"
                          >
                            <ExternalLink size={15} aria-hidden="true" />
                          </Link>
                        ) : null}
                        {String(d.uploaded_by ?? "") === coachId ? (
                          <>
                            <button
                              className={playerStyles.documentIconButton}
                              type="button"
                              onClick={() => void renameDocument(d)}
                              disabled={renamingDocumentId === d.id || deletingDocumentId === d.id}
                              aria-label={`Renommer ${fileName}`}
                              title="Renommer"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              className={`${playerStyles.documentIconButton} ${playerStyles.documentDangerButton}`}
                              type="button"
                              onClick={() => void deleteDocument(d)}
                              disabled={deletingDocumentId === d.id || renamingDocumentId === d.id}
                              aria-label={`Supprimer ${fileName}`}
                              title="Supprimer"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        ) : null}

        {activeSection === "planning" ? (
          <div className={playerStyles.section}>
            <div className={playerStyles.panel} style={{ display: "grid", gap: 10 }}>
            <h2 className={playerStyles.panelTitle}>Planification du junior</h2>
            {loadingPlannedEvents ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : plannedEvents.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun événement planifié.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {plannedEventsVisible.map((event) => {
                  const type = event.event_type === "training" ? "Entraînement" : event.event_type === "camp" ? "Stage" : event.event_type === "interclub" ? "Interclub" : event.event_type === "session" ? "Séance" : "Événement";
                  return <CoachPlayerActivityCard key={event.id} startsAt={event.starts_at} endsAt={event.ends_at} dateLocale={dateLocale} typeLabel={type} title={String(event.title ?? "").trim() || undefined} groupName={String(event.group_name ?? "").trim() || "Groupe non renseigné"} clubName={String(event.organization_name ?? "").trim() || "Club non renseigné"} location={event.location_text} href={event.can_open_detail && event.group_id ? `/coach/groups/${event.group_id}/planning/${event.id}` : undefined} actionLabel="Détails" />;
                })}
                {plannedEvents.length > plannedEventsPageSize ? (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    <button
                      type="button"
                      className={actionStyles.secondaryButton}
                      onClick={() => setPlannedEventsPage((prev) => Math.max(0, prev - 1))}
                      disabled={plannedEventsPage === 0}
                    >
                      Précédent
                    </button>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)", alignSelf: "center" }}>
                      Page {plannedEventsPage + 1} / {Math.max(1, Math.ceil(plannedEvents.length / plannedEventsPageSize))}
                    </div>
                    <button
                      type="button"
                      className={actionStyles.secondaryButton}
                      onClick={() => setPlannedEventsPage((prev) => (plannedEventsHasMore ? prev + 1 : prev))}
                      disabled={!plannedEventsHasMore}
                    >
                      Suivant
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          </div>
        ) : null}

        {activeSection === "followup" ? (
          <div className={playerStyles.section}>
            <div className={playerStyles.panel}>
            <div className={playerStyles.evaluationChartHeader}>
              <div><h2 className={playerStyles.panelTitle}>Évolution des évaluations</h2><p>Engagement, attitude et application, sur une échelle de 1 à 6.</p></div>
            </div>

            {loadingCoachEvaluations ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : coachEvaluations.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div className={playerStyles.evaluationChartStack}>
                <div className={playerStyles.evaluationChartToolbar}>
                  <span className={playerStyles.evaluationCount}>{coachEvaluations.length} évaluation{coachEvaluations.length > 1 ? "s" : ""}</span>
                  <div className={playerStyles.chartModeTabs} role="group" aria-label="Mode d’affichage du graphique">
                    <button
                      type="button"
                      className={playerStyles.chartModeButton}
                      onClick={() => setCoachEvalChartMode("curve")}
                      aria-pressed={coachEvalChartMode === "curve"}
                    >
                      Courbe
                    </button>
                    <button
                      type="button"
                      className={playerStyles.chartModeButton}
                      onClick={() => setCoachEvalChartMode("trend")}
                      aria-pressed={coachEvalChartMode === "trend"}
                    >
                      Tendance
                    </button>
                  </div>
                </div>

                <div className={playerStyles.evaluationChart} role="img" aria-label={coachEvalChartMode === "curve" ? "Évolution chronologique des évaluations du coach" : "Tendance des évaluations entre le début et la fin de la période"}>
                  {coachEvalChartMode === "curve" ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={coachEvalCurveSeries} margin={{ top: 12, right: 14, left: -12, bottom: 4 }}>
                        <CartesianGrid stroke="#e7ece6" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} minTickGap={26} />
                        <YAxis domain={[0, 6]} ticks={[0, 1, 2, 3, 4, 5, 6]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                        <Tooltip contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 11, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} />
                        <Legend wrapperStyle={{ color: "#617067", fontSize: 11, paddingTop: 10 }} iconType="circle" iconSize={7} />
                        <Line type="monotone" dataKey="engagement" name="Engagement" stroke="#35483b" strokeWidth={2.5} dot={{ r: 3, fill: "#35483b", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                        <Line type="monotone" dataKey="attitude" name="Attitude" stroke="#82977a" strokeWidth={2.5} dot={{ r: 3, fill: "#82977a", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                        <Line type="monotone" dataKey="application" name="Application" stroke="#b19d6b" strokeWidth={2.5} dot={{ r: 3, fill: "#b19d6b", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={coachEvalTrendSeries} margin={{ top: 12, right: 14, left: -12, bottom: 4 }}>
                        <CartesianGrid stroke="#e7ece6" vertical={false} />
                        <XAxis dataKey="point" tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} />
                        <YAxis domain={[0, 6]} ticks={[0, 1, 2, 3, 4, 5, 6]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                        <Tooltip contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 11, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} />
                        <Legend wrapperStyle={{ color: "#617067", fontSize: 11, paddingTop: 10 }} iconType="circle" iconSize={7} />
                        <Line type="linear" dataKey="engagement" name="Engagement" stroke="#35483b" strokeWidth={2.5} dot={{ r: 4, fill: "#35483b", strokeWidth: 0 }} />
                        <Line type="linear" dataKey="attitude" name="Attitude" stroke="#82977a" strokeWidth={2.5} dot={{ r: 4, fill: "#82977a", strokeWidth: 0 }} />
                        <Line type="linear" dataKey="application" name="Application" stroke="#b19d6b" strokeWidth={2.5} dot={{ r: 4, fill: "#b19d6b", strokeWidth: 0 }} />
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
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Note pour le joueur</div>
                            <div style={{ fontWeight: 800, color: "rgba(0,0,0,0.78)" }}>{row.player_note || "—"}</div>
                          </div>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>Note privée</div>
                            <div style={{ fontWeight: 800, color: "rgba(0,0,0,0.78)" }}>{row.private_note || "—"}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {coachEvalHasMore ? (
                      <button type="button" className={actionStyles.secondaryButton} onClick={() => setCoachEvalPage((p) => p + 1)}>
                        Afficher les suivantes
                      </button>
                    ) : null}
                    {coachEvalPage > 0 ? (
                      <button type="button" className={actionStyles.secondaryButton} onClick={() => setCoachEvalPage(0)}>
                        Revenir au début
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        ) : null}

        {activeSection === "followup" ? (
          <div className={playerStyles.section}>
            {renderValidationsCard()}
          </div>
        ) : null}

        {activeSection === "trainings" ? (
          <>
        {/* ===== Trainings KPIs ===== */}
          <div className={playerStyles.section}>
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div className={playerStyles.panel} style={{ gridColumn: "1 / -1" }}>
              <h2 className={playerStyles.panelTitle}>{volumeCardTitle}</h2>

              {loading ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <CountUpNumber value={totalMinutes} durationMs={2000} className="big-number" />
                          <span className="unit">MIN</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span className="pill-soft">⛳ {displayedTrainingCount} {t("golfDashboard.sessions")}</span>
                      </div>

                      {trainingVolumeObjective > 0 ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.72)" }}>
                            {t("playerHome.goal")}: {displayedTrainingVolumeObjective} {t("common.min")}
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

            <div className={playerStyles.panel} style={{ gridColumn: "1 / -1" }}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.feelingsAverage")}</h2>

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
          <div className={playerStyles.section}>
          <div className={playerStyles.panel}>
            <h2 className={playerStyles.panelTitle}>{t("golfDashboard.weeklyVolume")}</h2>
            <p className={playerStyles.panelIntro}>Volume réellement enregistré par semaine, comparé à l’objectif lorsqu’il est défini.</p>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div className={playerStyles.chart} role="img" aria-label="Évolution du volume hebdomadaire">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekSeries} margin={{ top: 8, right: 12, left: -14, bottom: 2 }}>
                    <CartesianGrid stroke="#e7ece6" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} />
                    <YAxis tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} />
                    <Legend />
                    {weekSeries.some((item) => Number(item.objective ?? 0) > 0) ? (
                      <Line
                        type="monotone"
                        dataKey="objective"
                        name={pickLocaleText(locale, "Objectif", "Goal")}
                        stroke="#b08a46"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        dot={false}
                        activeDot={false}
                      />
                    ) : null}
                    <Bar dataKey="minutes" name={t("golfDashboard.minutesPerWeek")} fill="#607b5b" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

          <div className={playerStyles.section}>
          <div className={playerStyles.panel}>
            <h2 className={playerStyles.panelTitle}>{t("golfDashboard.weeklyFeelingTrend")}</h2>
            <p className={playerStyles.panelIntro}>Moyennes hebdomadaires des sensations renseignées par le junior.</p>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div className={playerStyles.chart} role="img" aria-label="Évolution hebdomadaire des sensations">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekSeries} margin={{ top: 8, right: 12, left: -14, bottom: 2 }}>
                    <CartesianGrid stroke="#e7ece6" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} />
                    <YAxis domain={[0, 6]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} />
                    <Legend />

                    <Line type="monotone" dataKey="motivation" name={t("common.motivation")} stroke="#35483b" strokeWidth={2.5} dot={{ r: 3, fill: "#35483b" }} />
                    <Line type="monotone" dataKey="difficulty" name={t("common.difficulty")} stroke="#9cab95" strokeWidth={2.5} dot={{ r: 3, fill: "#9cab95" }} />
                    <Line type="monotone" dataKey="satisfaction" name={t("common.satisfaction")} stroke="#b08a46" strokeWidth={2.5} dot={{ r: 3, fill: "#b08a46" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

          <div className={playerStyles.section}>
          <div className={playerStyles.panel}>
            <h2 className={playerStyles.panelTitle}>{t("golfDashboard.categoryBreakdown")}</h2>

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
          </>
        ) : null}

        {/* ===== MES PARCOURS — Cards ===== */}
        {activeSection === "competition" || activeSection === "stats" ? (
          <div className={playerStyles.section}>
          <div className={activeSection === "stats" ? playerStyles.statisticsGrid : kpiGridClass} style={activeSection === "stats" ? undefined : kpiGridStyle}>
            {activeSection === "competition" ? (
            <div className={playerStyles.panel} style={{ gridColumn: "1 / -1" }}>
              <h2 className={playerStyles.panelTitle}>{pickLocaleText(locale, "Résultats en compétition", "Competition results")}</h2>

              {loadingRounds ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : competitionRounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                  {pickLocaleText(locale, "Aucun parcours en compétition sur la période.", "No competition rounds in this period.")}
                </div>
              ) : (
                <div className="user-mgmt-table-wrap">
                  <table className="user-mgmt-table">
                    <thead><tr><th>DATE</th><th>COMPÉTITION</th><th>PARCOURS</th><th>BRUT</th><th>NET</th><th>PUTTS</th><th>GIR</th><th>FAIRWAYS</th><th className={playerStyles.competitionActions}>ACTIONS</th></tr></thead>
                    <tbody>{competitionRounds.map((r) => {
                    const gross = omScoresByRoundId[r.id]?.gross ?? r.total_score ?? null;
                    const netFromOm = omScoresByRoundId[r.id]?.net ?? null;
                    const net = netFromOm ?? (typeof gross === "number" ? gross - Number(r.handicap_start ?? 0) : null);
                    const name = String(r.competition_name ?? "").trim() || pickLocaleText(locale, "Compétition", "Competition");
                    const date = new Intl.DateTimeFormat(dateLocale, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(r.start_at));
                    const cfg = [String(r.course_name ?? "").trim(), String(r.tee_name ?? "").trim()].filter(Boolean).join(" • ");
                    const fwPct =
                      typeof r.fairways_hit === "number" && typeof r.fairways_total === "number" && r.fairways_total > 0
                        ? `${Math.round((r.fairways_hit / r.fairways_total) * 100)}%`
                        : "—";
                    return <tr key={r.id}>
                      <td>{date}</td><td><strong>{name}</strong></td><td>{cfg || "—"}</td><td>{gross ?? "—"}</td><td>{net ?? "—"}</td><td>{r.total_putts ?? "—"}</td><td>{r.gir ?? "—"}</td><td>{fwPct}</td>
                      <td className={playerStyles.competitionActions}><button type="button" className={actionStyles.secondaryButton} onClick={() => setSelectedCompetitionRoundId(r.id)}>{t("rounds.scorecard")}</button></td>
                    </tr>;
                  })}</tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}

            {/* Card 1: Volume + trous + split training/competition */}
            {activeSection === "stats" ? (
            <div className={playerStyles.statisticsOverview}>
              <div className={playerStyles.statisticsMetric}><span>Parcours</span><b>{rounds.length || "—"}</b></div>
              <div className={playerStyles.statisticsMetric}><span>Trous documentés</span><b>{holeAgg.holesPlayed || "—"}</b></div>
              <div className={playerStyles.statisticsMetric}><span>GIR</span><b>{keyKpisUI.girPct == null ? "—" : `${keyKpisUI.girPct} %`}</b></div>
              <div className={playerStyles.statisticsMetric}><span>Handicap actuel</span><b>{typeof playerHandicap === "number" ? playerHandicap.toFixed(1) : "—"}</b></div>
            </div>
            ) : null}

            {activeSection === "stats" ? (
            <div className={`${playerStyles.panel} ${playerStyles.statisticsWide}`}>
              <h2 className={playerStyles.panelTitle}>Évolution du handicap</h2>
              <p className={playerStyles.panelIntro}>Historique chronologique des valeurs enregistrées par le junior.</p>
              {handicapChartData.length ? <div className={playerStyles.chart} role="img" aria-label="Évolution du handicap, les valeurs les plus élevées sont placées en haut"><ResponsiveContainer width="100%" height="100%"><LineChart data={handicapChartData} margin={{ top: 8, right: 12, left: -10, bottom: 2 }}><CartesianGrid stroke="#e7ece6" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => shortDate(String(value), dateLocale)} tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} minTickGap={28} /><YAxis domain={([dataMin, dataMax]) => [Number(dataMin) - 1, Number(dataMax) + 1]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(value) => shortDate(String(value), dateLocale)} formatter={(value) => [Number(value).toFixed(1), "Handicap"]} contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} /><Line type="monotone" dataKey="handicap" stroke="#607b5b" strokeWidth={2.5} dot={{ r: 4, fill: "#607b5b", strokeWidth: 0 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <div className={playerStyles.empty}>Aucun historique de handicap disponible.</div>}
            </div>
            ) : null}

            {activeSection === "stats" ? (
            <div className={playerStyles.panel}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.playVolume")}</h2>

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
                        {prevRange ? deltaArrow(holeAgg.holesPlayed - (prevHoleAgg.holesPlayed ?? 0)) : null}
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
            ) : null}

            {/* Card 2: Répartition des scores (n + % + trend arrow) */}
            {activeSection === "stats" ? (
            <div className={playerStyles.panel}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.scoreDistribution")}</h2>

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
            ) : null}

            {/* Card 3: GIR / Putts / Fairways */}
            {activeSection === "stats" ? (
            <div className={playerStyles.panel}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.consistency")}</h2>

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
                    <div style={miniLeft}>{pickLocaleText(locale, "Nombre de putts (sur 18 trous)", "Putts (18 holes)")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.putts18 == null ? "—" : `${keyKpisUI.putts18}`}</div>
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

                  <div style={miniRow}>
                    <div style={miniLeft}>Scrambling</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.scramblingPct == null ? "—" : `${keyKpisUI.scramblingPct}%`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.scramblingArrow ?? null) : null}
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
            ) : null}

            {/* Card 4: Par3/Par4/Par5 averages */}
            {activeSection === "stats" ? (
            <div className={playerStyles.panel}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.scoresByPar")}</h2>

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
            ) : null}

            {/* Card 5: 1-9 / 10-18 averages */}
            {activeSection === "stats" ? (
            <div className={playerStyles.panel}>
              <h2 className={playerStyles.panelTitle}>{t("golfDashboard.frontBackTitle")}</h2>

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
            ) : null}
          </div>
        </div>
        ) : null}

        <div style={{ height: 12 }} />

      {selectedCompetitionRound ? (
        <div
          className={playerStyles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Détail de la compétition"
          onClick={() => setSelectedCompetitionRoundId("")}
        >
          <div
            className={playerStyles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={playerStyles.modalHeader}
            >
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <div className="truncate" style={{ fontWeight: 900 }}>
                  {String(selectedCompetitionRound.competition_name ?? "").trim() ||
                    pickLocaleText(locale, "Compétition", "Competition")}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.58)" }}>
                  {shortDate(selectedCompetitionRound.start_at, dateLocale)}
                </div>
              </div>
              <button className={actionStyles.secondaryButton} type="button" onClick={() => setSelectedCompetitionRoundId("")} aria-label="Fermer" title="Fermer">
                <X size={14} />
              </button>
            </div>

            <div className={playerStyles.modalBody} style={{ display: "grid", gap: 10 }}>
              <div className={playerStyles.panel} style={{ display: "grid", gap: 8 }}>
                <h2 className={playerStyles.panelTitle}>{pickLocaleText(locale, "Statistiques", "Statistics")}</h2>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={miniRow}>
                    <div style={miniLeft}>{pickLocaleText(locale, "Score brut", "Gross score")}</div>
                    <div style={{ ...miniRight, whiteSpace: "normal", textAlign: "right" }}>
                      {selectedCompetitionStats?.totalGross ?? "—"}
                      {selectedCompetitionTotals &&
                      typeof selectedCompetitionTotals.totalScore === "number" &&
                      typeof selectedCompetitionTotals.totalPar === "number"
                        ? ` (${formatSigned(selectedCompetitionTotals.totalScore - selectedCompetitionTotals.totalPar)})`
                        : ""}
                    </div>
                  </div>
                  <div style={miniRow}>
                    <div style={miniLeft}>{pickLocaleText(locale, "Score net", "Net score")}</div>
                    <div style={miniRight}>{selectedCompetitionStats?.totalNet ?? "—"}</div>
                  </div>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.avgPutts")}</div>
                    <div style={miniRight}>{selectedCompetitionStats?.puttsTotal ?? "—"}</div>
                  </div>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.gir")}</div>
                    <div style={miniRight}>{selectedCompetitionStats?.girPct == null ? "—" : `${selectedCompetitionStats.girPct}%`}</div>
                  </div>
                  <div style={miniRow}>
                    <div style={miniLeft}>{t("golfDashboard.fairwaysHit")}</div>
                    <div style={miniRight}>{selectedCompetitionStats?.fwPct == null ? "—" : `${selectedCompetitionStats.fwPct}%`}</div>
                  </div>
                  <div style={miniRow}>
                    <div style={miniLeft}>Scrambling</div>
                    <div style={miniRight}>{selectedCompetitionStats?.scramblingPct == null ? "—" : `${selectedCompetitionStats.scramblingPct}%`}</div>
                  </div>
                </div>
              </div>

              <div className={playerStyles.panel} style={{ display: "grid", gap: 8 }}>
                <h2 className={playerStyles.panelTitle}>{pickLocaleText(locale, "Carte des scores", "Scorecard")}</h2>
                {selectedCompetitionHoles.length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
                ) : (() => {
                  const holes = Array.from({ length: 18 }, (_, index) => selectedCompetitionHoles.find((hole) => hole.hole_no === index + 1) ?? null);
                  const row = (label: string, render: (hole: GolfHoleRow | null) => React.ReactNode, total: React.ReactNode = "—") => <tr><th scope="row">{label}</th>{holes.map((hole, index) => <td key={`${label}-${index + 1}`}>{render(hole)}</td>)}<td className={playerStyles.scorecardTotal}>{total}</td></tr>;
                  return <div className={playerStyles.scorecardWrap}>
                    <table className={playerStyles.scorecard}>
                      <tbody>
                        <tr><th scope="row">Trou</th>{holes.map((_, index) => <th key={index + 1} scope="col">{index + 1}</th>)}<th scope="col">Total</th></tr>
                        {row("Par", (hole) => hole?.par ?? "—", selectedCompetitionTotals?.totalPar ?? "—")}
                        {row("Score", (hole) => <ScoreMark par={hole?.par ?? null} score={hole?.score ?? null} />, selectedCompetitionTotals?.totalScore ?? "—")}
                        {row("Putts", (hole) => hole?.putts ?? "—", selectedCompetitionTotals?.totalPutts ?? "—")}
                        {row("Fairway", (hole) => <ScorecardBooleanMark value={typeof hole?.fairway_hit === "boolean" ? hole.fairway_hit : null} />)}
                        {row("GIR", (hole) => {
                          const gir = hole && typeof hole.par === "number" && typeof hole.score === "number" && typeof hole.putts === "number" ? isGirOnHole(hole.par, hole.score, hole.putts) : null;
                          return <ScorecardBooleanMark value={gir} />;
                        })}
                      </tbody>
                    </table>
                  </div>;
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {viewerDocument ? (
        <div
          className={playerStyles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu du document"
          onClick={() => setViewerDocument(null)}
        >
          <div
            className={playerStyles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={playerStyles.modalHeader}
            >
              <div className="truncate" style={{ fontWeight: 900 }}>
                {viewerDocument.file_name}
              </div>
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <a className={actionStyles.secondaryButton} href={viewerDocument.public_url} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
                <button className={actionStyles.secondaryButton} type="button" onClick={() => setViewerDocument(null)} aria-label="Fermer" title="Fermer">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className={playerStyles.modalBody}>
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
                  <video src={viewerDocument.public_url} controls style={{ width: "100%", maxHeight: "calc(94vh - 120px)", borderRadius: 10 }} />
                </div>
              ) : isPdfDocument(viewerDocument.mime_type, viewerDocument.file_name) ? (
                <object
                  data={`${viewerDocument.public_url}#view=FitH`}
                  type="application/pdf"
                  style={{ width: "100%", height: "calc(94vh - 120px)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, background: "white" }}
                >
                  <iframe
                    title={viewerDocument.file_name}
                    src={`${viewerDocument.public_url}#view=FitH`}
                    style={{ width: "100%", height: "calc(94vh - 120px)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, background: "white" }}
                  />
                </object>
              ) : (
                <iframe
                  title={viewerDocument.file_name}
                  src={viewerDocument.public_url}
                  style={{ width: "100%", height: "calc(94vh - 120px)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, background: "white", display: "block" }}
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
    </main>
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
