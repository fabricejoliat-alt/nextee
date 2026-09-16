"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import CountUpNumber from "@/components/ui/CountUpNumber";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
import ActiviteeEChart from "@/components/ui/ActiviteeEChart";
import { buildManagementDualLineChartOption, buildManagementLineChartOption, buildManagementVolumeChartOption, MANAGEMENT_CHART_COLORS } from "@/lib/managementCharts";
import managerStyles from "@/app/manager/camps/Camps.module.css";
import adminCardStyles from "@/components/admin/AdminHomeStats.module.css";
import navigationStyles from "@/app/design-system/design-system.module.css";
import overviewStyles from "./PlayerGolfOverview.module.css";
import documentStyles from "./PlayerGolfDocuments.module.css";
import trainingStyles from "./PlayerGolfTraining.module.css";
import type { EChartsOption } from "echarts";
import GolfRoundsWorkspace from "@/components/golf/GolfRoundsWorkspace";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarCheck2,
  Flame,
  Mountain,
  Smile,
  SlidersHorizontal,
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
  Pencil,
  Trash2,
  Flag,
  ClipboardList,
  Dumbbell,
  Target,
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Repeat2,
} from "lucide-react";

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
  location_text: string | null;
  coach_name: string | null;
  notes: string | null;
};

type TrainingItemRow = {
  session_id: string;
  category: string;
  minutes: number;
};

type CoachEvaluationFeedbackRow = {
  event_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  player_note: string | null;
};

type CoachEvaluationEventRow = {
  id: string;
  starts_at: string;
  event_type: string | null;
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
};

type CustomCoachEvaluation = {
  event_id: string;
  criterion_id: string;
  name: string;
  format: string;
  value: string | number | boolean;
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
  rows: TrainingVolumeTargetRow[];
  seasonMonths: number[];
  offseasonMonths: number[];
};

type ClubSeason = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
};

type TrainingVolumeClubResponse = TrainingVolumeClubConfig & {
  objective: number;
  currentSeason: ClubSeason | null;
  previousSeason: ClubSeason | null;
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

type Preset = "week" | "month" | "last3" | "season" | "lastSeason" | "all" | "custom";
type DashboardSection = "overview" | "trainings" | "evaluations" | "rounds" | "stats" | "documents";
type TrainingSubview = "summary" | "sessions" | "evaluations";
type EvaluationFilter = "all" | "pending" | "completed";

type OverviewEvent = {
  id: string;
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  requires_evaluation?: boolean | null;
};

type OverviewSession = TrainingSessionRow & {
  location_text?: string | null;
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

function ProgressDonut({ percent, size = 156 }: { percent: number; size?: number }) {
  const p = clamp(percent, 0, 100);
  const view = 120;
  const center = view / 2;
  const r = 44;
  const c = 2 * Math.PI * r;
  const [animatedP, setAnimatedP] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedP(p), 60);
    return () => clearTimeout(t);
  }, [p]);
  const dashOffset = c - (animatedP / 100) * c;
  const done = p >= 100;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`} aria-label={`Progression ${Math.round(p)}%`}>
      <defs>
        <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(40,146,89,1)" />
          <stop offset="100%" stopColor="rgba(16,94,51,1)" />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={r} strokeWidth="12" className="donut-bg" fill="rgba(255,255,255,0.22)" />
      <circle
        cx={center}
        cy={center}
        r={r}
        strokeWidth="12"
        stroke="url(#donutGrad)"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={dashOffset}
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.9, 0.2, 1)" }}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text x={center} y={center + 6} textAnchor="middle" className="donut-label">
        {Math.round(p)}%
      </text>
      {done ? (
        <g>
          <circle cx={center} cy={center + 28} r={10} fill="rgba(16,94,51,0.18)" />
          <path
            d={`M${center - 5} ${center + 28} l3 3 l7 -8`}
            fill="none"
            stroke="rgba(16,94,51,0.95)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      ) : null}
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

export default function GolfDashboardPage() {
  const { t, locale } = useI18n();
  const dateLocale = pickLocaleText(locale, "fr-CH", "en-US");
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [trainingSubview, setTrainingSubview] = useState<TrainingSubview>("summary");
  const [evaluationFilter, setEvaluationFilter] = useState<EvaluationFilter>("all");
  const [trainingOriginFilter, setTrainingOriginFilter] = useState<"all" | SessionType>("all");
  const [trainingSectorFilter, setTrainingSectorFilter] = useState("all");
  const [trainingStatusFilter, setTrainingStatusFilter] = useState<"all" | "pending" | "completed">("all");
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "evaluations") {
      setActiveSection("trainings");
      setTrainingSubview("evaluations");
      const url = new URL(window.location.href);
      url.searchParams.set("section", "trainings");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    if (["overview", "trainings", "evaluations", "rounds", "stats", "documents"].includes(String(section))) {
      setActiveSection(section === "stats" ? "rounds" : section as DashboardSection);
    }
  }, []);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [loadingPrevRounds, setLoadingPrevRounds] = useState(false);
  const [loadingHoles, setLoadingHoles] = useState(false);
  const [loadingPrevHoles, setLoadingPrevHoles] = useState(false);
  const [loadingTrainLookback, setLoadingTrainLookback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectivePlayerId, setEffectivePlayerId] = useState("");
  const [isPerformanceEnabled, setIsPerformanceEnabled] = useState(false);
  const [playerHandicap, setPlayerHandicap] = useState<number | null>(null);
  const [handicapHistory, setHandicapHistory] = useState<HandicapHistoryEntry[]>([]);
  const [trainingVolumeRows, setTrainingVolumeRows] = useState<TrainingVolumeTargetRow[]>([]);
  const [trainingSeasonMonths, setTrainingSeasonMonths] = useState<number[]>([]);
  const [trainingOffseasonMonths, setTrainingOffseasonMonths] = useState<number[]>([]);
  const [trainingVolumeConfigs, setTrainingVolumeConfigs] = useState<TrainingVolumeClubConfig[]>([]);
  const [currentClubSeason, setCurrentClubSeason] = useState<ClubSeason | null>(null);
  const [previousClubSeason, setPreviousClubSeason] = useState<ClubSeason | null>(null);

  const [preset, setPreset] = useState<Preset>("season");
  const [customOpen, setCustomOpen] = useState(false);

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [sessions, setSessions] = useState<TrainingSessionRow[]>([]);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  const [prevSessions, setPrevSessions] = useState<TrainingSessionRow[]>([]);
  const [prevItems, setPrevItems] = useState<TrainingItemRow[]>([]);
  const [plannedClubMinutes, setPlannedClubMinutes] = useState<number>(0);
  const [plannedClubEventsCount, setPlannedClubEventsCount] = useState<number>(0);

  const [rounds, setRounds] = useState<GolfRoundRow[]>([]);
  const [prevRounds, setPrevRounds] = useState<GolfRoundRow[]>([]);

  const [holes, setHoles] = useState<GolfHoleRow[]>([]);
  const [prevHoles, setPrevHoles] = useState<GolfHoleRow[]>([]);

  const [sessionsLookback, setSessionsLookback] = useState<TrainingSessionRow[]>([]);
  const [itemsLookback, setItemsLookback] = useState<TrainingItemRow[]>([]);
  const [coachEvaluations, setCoachEvaluations] = useState<CoachEvaluationRow[]>([]);
  const [customCoachEvaluations, setCustomCoachEvaluations] = useState<CustomCoachEvaluation[]>([]);
  const [loadingCoachEvaluations, setLoadingCoachEvaluations] = useState(false);
  const authTokenRef = useRef<string>("");
  const [documents, setDocuments] = useState<PlayerDashboardDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string>("");
  const [deletingDocumentId, setDeletingDocumentId] = useState<string>("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState<string>("");
  const [viewerDocument, setViewerDocument] = useState<PlayerDashboardDocument | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const [overviewEvents, setOverviewEvents] = useState<OverviewEvent[]>([]);
  const [overviewAttendance, setOverviewAttendance] = useState<Record<string, string | null>>({});
  const [pendingEvaluationCount, setPendingEvaluationCount] = useState(0);
  const [overviewActivitiesLoading, setOverviewActivitiesLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    setFromDate(`${now.getFullYear()}-01-01`);
    setToDate(isoToYMD(now));
    setPreset("season");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
        setEffectivePlayerId(uid);
        const perfEnabled = await isEffectivePlayerPerformanceEnabled(uid);
        setIsPerformanceEnabled(perfEnabled);

        const [profileRes, membershipsRes, sessionRes] = await Promise.all([
          supabase.from("profiles").select("handicap").eq("id", uid).maybeSingle(),
          supabase.from("club_members").select("club_id").eq("user_id", uid).eq("is_active", true),
          supabase.auth.getSession(),
        ]);

        const handicap = (profileRes.data as { handicap?: number | null } | null)?.handicap;
        if (!profileRes.error) {
          setPlayerHandicap(typeof handicap === "number" ? handicap : null);
        } else {
          setPlayerHandicap(null);
        }

        const clubIds = Array.from(
          new Set(
            (membershipsRes.data ?? [])
              .map((m: { club_id?: string | null }) => String(m?.club_id ?? ""))
              .filter(Boolean)
          )
        );
        const token = sessionRes.data.session?.access_token ?? "";
        if (token) {
          try {
            const historyRes = await fetch("/api/player/handicap-history", {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const historyJson = await historyRes.json().catch(() => ({}));
            if (historyRes.ok) {
              const entries = Array.isArray(historyJson?.entries) ? (historyJson.entries as HandicapHistoryEntry[]) : [];
              setHandicapHistory(entries);
            } else {
              setHandicapHistory([]);
            }
          } catch {
            setHandicapHistory([]);
          }
        } else {
          setHandicapHistory([]);
        }

        if (clubIds.length > 0 && token) {
          const month = new Date().getMonth() + 1;
          const responses = await Promise.all(
            clubIds.map(async (clubId) => {
              const res = await fetch(
                `/api/player/clubs/${clubId}/training-volume?player_id=${encodeURIComponent(uid)}`,
                {
                  method: "GET",
                  headers: { Authorization: `Bearer ${token}` },
                  cache: "no-store",
                }
              );
              const json = await res.json().catch(() => ({}));
              if (!res.ok) return null;
              const rows = Array.isArray(json?.rows) ? (json.rows as TrainingVolumeTargetRow[]) : [];
              const seasons = (Array.isArray(json?.seasons) ? json.seasons : []) as ClubSeason[];
              const currentSeason = seasons.find((season) => season.is_current) ?? seasons[0] ?? null;
              const previousSeason = currentSeason
                ? seasons.find((season) => season.starts_on < currentSeason.starts_on) ?? null
                : null;
              const seasonMonths = parseMonthArray(json?.settings?.season_months);
              const offseasonMonths = parseMonthArray(json?.settings?.offseason_months);
              const target = pickTrainingVolumeTarget(typeof handicap === "number" ? handicap : null, rows);
              const objective = objectiveForMonth(target, seasonMonths, offseasonMonths, month);
              return { rows, seasonMonths, offseasonMonths, objective, currentSeason, previousSeason };
            })
          );

          const configs = responses
            .filter((x): x is TrainingVolumeClubResponse => Boolean(x))
            .map((x) => ({ rows: x.rows, seasonMonths: x.seasonMonths, offseasonMonths: x.offseasonMonths }));
          setTrainingVolumeConfigs(configs);

          const best = responses
            .filter((x): x is TrainingVolumeClubResponse => Boolean(x))
            .sort((a, b) => b.objective - a.objective)[0];

          if (best) {
            setTrainingVolumeRows(best.rows);
            setTrainingSeasonMonths(best.seasonMonths);
            setTrainingOffseasonMonths(best.offseasonMonths);
            setCurrentClubSeason(best.currentSeason);
            setPreviousClubSeason(best.previousSeason);
          } else {
            setTrainingVolumeRows([]);
            setTrainingSeasonMonths([]);
            setTrainingOffseasonMonths([]);
            setCurrentClubSeason(null);
            setPreviousClubSeason(null);
          }
        } else {
          setTrainingVolumeConfigs([]);
          setTrainingVolumeRows([]);
          setTrainingSeasonMonths([]);
          setTrainingOffseasonMonths([]);
          setCurrentClubSeason(null);
          setPreviousClubSeason(null);
        }
      } catch {
        setIsPerformanceEnabled(false);
        setPlayerHandicap(null);
        setHandicapHistory([]);
        setTrainingVolumeConfigs([]);
        setTrainingVolumeRows([]);
        setTrainingSeasonMonths([]);
        setTrainingOffseasonMonths([]);
        setCurrentClubSeason(null);
        setPreviousClubSeason(null);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentUserId(String(data.user?.id ?? ""));
    })();
  }, []);

  useEffect(() => {
    if (!effectivePlayerId) return;
    let cancelled = false;
    (async () => {
      setOverviewActivitiesLoading(true);
      try {
        const [{ data: sessionData }, context] = await Promise.all([
          supabase.auth.getSession(),
          resolveEffectivePlayerContext(),
        ]);
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error("Missing session");
        const params = new URLSearchParams();
        if (context.role === "parent") params.set("child_id", effectivePlayerId);
        const response = await fetch(`/api/player/trainings${params.size ? `?${params}` : ""}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload?.error ?? "Unable to load activities"));
        const loadedSessions = (payload?.sessions ?? []) as OverviewSession[];
        const loadedEvents = (payload?.attendeeEvents ?? []) as OverviewEvent[];
        const sessionIds = loadedSessions.map((session) => session.id);
        const itemResult = sessionIds.length
          ? await supabase.from("training_session_items").select("session_id,minutes").in("session_id", sessionIds)
          : { data: [], error: null };
        if (itemResult.error) throw itemResult.error;
        const sessionsWithStructure = new Set<string>();
        ((itemResult.data ?? []) as Array<{ session_id: string; minutes: number | null }>).forEach((item) => {
          if (Number(item.minutes ?? 0) > 0) sessionsWithStructure.add(item.session_id);
        });
        const completeSessionIds = new Set(
          loadedSessions
            .filter((session) => sessionsWithStructure.has(session.id) && [session.motivation, session.difficulty, session.satisfaction].every((value) => typeof value === "number"))
            .map((session) => session.id)
        );
        const statusByEventId = (payload?.attendeeStatusByEventId ?? {}) as Record<string, string | null>;
        const completeEventIds = new Set(
          loadedSessions
            .filter((session) => completeSessionIds.has(session.id) && session.club_event_id)
            .map((session) => String(session.club_event_id))
        );
        const eventById = new Map(loadedEvents.map((event) => [event.id, event]));
        const now = Date.now();
        const pendingKeys = new Set<string>();
        loadedEvents.forEach((event) => {
          const status = statusByEventId[event.id] ?? null;
          const endedAt = new Date(event.ends_at ?? event.starts_at).getTime();
          if (event.status === "scheduled" && event.requires_evaluation && ["training", "camp"].includes(String(event.event_type)) && endedAt < now && !["absent", "excused", "not_registered"].includes(String(status)) && !completeEventIds.has(event.id)) {
            pendingKeys.add(`event:${event.id}`);
          }
        });
        loadedSessions.forEach((session) => {
          if (completeSessionIds.has(session.id) || new Date(session.start_at).getTime() >= now) return;
          if (!session.club_event_id) {
            pendingKeys.add(`session:${session.id}`);
            return;
          }
          const event = eventById.get(session.club_event_id);
          const status = statusByEventId[session.club_event_id] ?? null;
          if (event?.requires_evaluation && !["absent", "excused", "not_registered"].includes(String(status))) {
            pendingKeys.delete(`event:${session.club_event_id}`);
            pendingKeys.add(`session:${session.id}`);
          }
        });
        if (cancelled) return;
        setOverviewEvents(loadedEvents);
        setOverviewAttendance(statusByEventId);
        setPendingEvaluationCount(pendingKeys.size);
      } catch (cause) {
        if (!cancelled) {
          console.warn("player golf overview activities failed:", cause);
          setOverviewEvents([]);
          setOverviewAttendance({});
          setPendingEvaluationCount(0);
        }
      } finally {
        if (!cancelled) setOverviewActivitiesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [effectivePlayerId]);

  function shortDate(iso: string, localeCode: string) {
    return new Intl.DateTimeFormat(localeCode, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  }

  async function getAuthToken(): Promise<string> {
    if (authTokenRef.current) return authTokenRef.current;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? "";
    if (token) authTokenRef.current = token;
    return token;
  }

  async function loadDocuments(targetPlayerId?: string) {
    setLoadingDocuments(true);
    try {
      const ctx = await resolveEffectivePlayerContext();
      const playerId = String(targetPlayerId ?? effectivePlayerId ?? ctx.effectiveUserId).trim();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing context");
      const params = new URLSearchParams({ player_id: playerId });
      if (ctx.role === "parent") {
        params.set("child_id", ctx.effectiveUserId);
      }
      const res = await fetch(`/api/player/documents?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({})) as { error?: unknown; documents?: PlayerDashboardDocument[] };
      if (!res.ok) throw new Error(String(json?.error ?? "Load documents error"));
      setDocuments((json?.documents ?? []) as PlayerDashboardDocument[]);
    } catch (e) {
      console.warn("player golf documents load failed:", e);
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }

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
    if (!docFile || uploadingDocument) return;
    const finalDocName = docName.trim();
    if (!finalDocName) {
      setError("Veuillez saisir un nom de document.");
      return;
    }
    setUploadingDocument(true);
    try {
      const uploadFile = await optimizeUploadFile(docFile);
      const { effectiveUserId: playerId } = await resolveEffectivePlayerContext();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing context");
      const prepareRes = await fetch(`/api/player/documents?player_id=${encodeURIComponent(playerId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "prepare",
          original_name: uploadFile.name,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const prepareJson = await prepareRes.json().catch(() => ({})) as { error?: unknown; path?: unknown; token?: unknown };
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

      const finalizeRes = await fetch(`/api/player/documents?player_id=${encodeURIComponent(playerId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          storage_path: uploadPath,
          original_name: uploadFile.name,
          file_name: finalDocName,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const json = await finalizeRes.json().catch(() => ({})) as { error?: unknown; document?: PlayerDashboardDocument };
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingDocument(false);
    }
  }

  async function renameDocument(doc: PlayerDashboardDocument) {
    if (!currentUserId || currentUserId !== String(doc.uploaded_by ?? "")) return;
    const currentName = String(doc.file_name ?? "").trim();
    const nextName = window.prompt("Nouveau nom du document", currentName)?.trim() ?? "";
    if (!nextName || nextName === currentName) return;
    setRenamingDocumentId(doc.id);
    try {
      const { effectiveUserId: playerId } = await resolveEffectivePlayerContext();
      const token = await getAuthToken();
      if (!token || !playerId) throw new Error("Missing context");
      const res = await fetch(`/api/player/documents`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_id: doc.id,
          player_id: playerId,
          file_name: nextName,
        }),
      });
      const json = await res.json().catch(() => ({})) as { error?: unknown; document?: PlayerDashboardDocument };
      if (!res.ok) throw new Error(String(json?.error ?? "Rename failed"));
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, file_name: String(json?.document?.file_name ?? nextName) } : d))
      );
      if (viewerDocument?.id === doc.id) {
        setViewerDocument((prev) => (prev ? { ...prev, file_name: String(json?.document?.file_name ?? nextName) } : prev));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenamingDocumentId("");
    }
  }

  async function deleteDocument(doc: PlayerDashboardDocument) {
    if (!currentUserId || currentUserId !== String(doc.uploaded_by ?? "")) return;
    const ok = window.confirm(`Supprimer le document "${doc.file_name}" ?`);
    if (!ok) return;
    setDeletingDocumentId(doc.id);
    try {
      const { effectiveUserId: playerId } = await resolveEffectivePlayerContext();
      const token = await getAuthToken();
      if (!token || !playerId) throw new Error("Missing context");
      const res = await fetch(`/api/player/documents`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_id: doc.id,
          player_id: playerId,
        }),
      });
      const json = await res.json().catch(() => ({})) as { error?: unknown };
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (viewerDocument?.id === doc.id) setViewerDocument(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingDocumentId("");
    }
  }

  useEffect(() => {
    void getAuthToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!effectivePlayerId) return;
    void loadDocuments(effectivePlayerId);
  }, [effectivePlayerId]);

  useEffect(() => {
    if (activeSection !== "documents" || !effectivePlayerId) return;
    void loadDocuments(effectivePlayerId);
  }, [activeSection, effectivePlayerId]);

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

    if (preset === "season") {
      if (currentClubSeason) {
        const today = isoToYMD(now);
        setFromDate(currentClubSeason.starts_on);
        setToDate(currentClubSeason.ends_on < today ? currentClubSeason.ends_on : today);
      } else {
        setFromDate(`${now.getFullYear()}-01-01`);
        setToDate(isoToYMD(now));
      }
      return;
    }

    if (preset === "lastSeason") {
      if (previousClubSeason) {
        setFromDate(previousClubSeason.starts_on);
        setToDate(previousClubSeason.ends_on);
      }
      return;
    }

    if (preset === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
  }, [currentClubSeason, preset, previousClubSeason]);

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

    if (preset === "season") {
      return previousClubSeason
        ? { from: previousClubSeason.starts_on, to: previousClubSeason.ends_on }
        : null;
    }

    if (preset === "lastSeason") {
      return null;
    }

    if (preset === "custom" && fromDate && toDate) {
      const days = diffDaysInclusive(fromDate, toDate);
      if (!days) return null;
      const prevTo = shiftYmd(fromDate, -1);
      const prevFrom = shiftYmd(prevTo, -(days - 1));
      return { from: prevFrom, to: prevTo };
    }

    return null;
  }, [preset, fromDate, previousClubSeason, toDate]);

  const compareMonths = useMemo(() => {
    if (preset === "season" || preset === "lastSeason") return 12;
    if (preset === "last3") return 3;
    if (preset === "month") return 1;
    if (preset === "week") return 0;
    if (preset === "custom" && fromDate && toDate) {
      const d = diffDaysInclusive(fromDate, toDate);
      if (!d) return 1;
      return Math.max(1, Math.round(d / 30));
    }
    return 1;
  }, [preset, fromDate, toDate]);

  const compareLabel = useMemo(() => {
    if (!prevRange) return null;
    if (preset === "week") {
      if (locale === "fr") return "vs semaine précédente";
      return "vs previous week";
    }
    if (locale === "fr") return `vs ${compareMonths} mois précédent${compareMonths > 1 ? "s" : ""}`;
    return `vs previous ${compareMonths} month${compareMonths > 1 ? "s" : ""}`;
  }, [prevRange, locale, compareMonths]);

  // ===== LOAD TRAININGS (current) =====
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        if (!effectivePlayerId) {
          setSessions([]);
          setItems([]);
          setLoading(false);
          return;
        }

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,location_text,coach_name,notes")
          .eq("user_id", effectivePlayerId)
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
        setError(e instanceof Error ? e.message : "Erreur chargement.");
        setSessions([]);
        setItems([]);
        setLoading(false);
      }
    })();
  }, [effectivePlayerId, fromDate, toDate]);

  // ===== LOAD TRAININGS (prev KPIs) =====
  useEffect(() => {
    (async () => {
      if (!prevRange) {
        setPrevSessions([]);
        setPrevItems([]);
        return;
      }

      setLoadingPrev(true);
      try {
        if (!effectivePlayerId) {
          setPrevSessions([]);
          return;
        }

        let q = supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,location_text,coach_name,notes")
          .eq("user_id", effectivePlayerId)
          .order("start_at", { ascending: true });

        q = q.gte("start_at", startOfDayISO(prevRange.from)).lt("start_at", nextDayStartISO(prevRange.to)).limit(2000);

        const res = await q;
        if (res.error) throw new Error(res.error.message);

        const previousSessions = (res.data ?? []) as TrainingSessionRow[];
        setPrevSessions(previousSessions);
        const previousIds = previousSessions.map((session) => session.id);
        if (!previousIds.length) {
          setPrevItems([]);
          return;
        }
        const itemsResult = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes")
          .in("session_id", previousIds);
        if (itemsResult.error) throw new Error(itemsResult.error.message);
        setPrevItems((itemsResult.data ?? []) as TrainingItemRow[]);
      } catch {
        setPrevSessions([]);
        setPrevItems([]);
      } finally {
        setLoadingPrev(false);
      }
    })();
  }, [effectivePlayerId, prevRange?.from, prevRange?.to]);

  useEffect(() => {
    (async () => {
      if (!effectivePlayerId) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }

      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", effectivePlayerId)
        .eq("status", "present");

      const attendeeEventIds = Array.from(
        new Set(
          ((attendeeRes.data ?? []) as Array<{ event_id: string | null }>)
            .map((r) => r.event_id)
            .filter((v): v is string => Boolean(v))
        )
      );

      if (attendeeEventIds.length === 0) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }

      let q = supabase
        .from("club_events")
        .select("id,starts_at,ends_at,duration_minutes,status")
        .in("id", attendeeEventIds)
        .neq("status", "cancelled")
        .lt("starts_at", new Date().toISOString());

      if (fromDate) q = q.gte("starts_at", startOfDayISO(fromDate));
      if (toDate) q = q.lt("starts_at", nextDayStartISO(toDate));

      const res = await q;
      if (res.error) {
        setPlannedClubMinutes(0);
        setPlannedClubEventsCount(0);
        return;
      }

      setPlannedClubEventsCount((res.data ?? []).length);
      const total = (res.data ?? []).reduce(
        (sum, row: { starts_at: string | null; ends_at: string | null; duration_minutes: number | null }) => {
          const mins = Number(row.duration_minutes ?? 0);
          if (Number.isFinite(mins) && mins > 0) return sum + mins;
          if (row.starts_at && row.ends_at) {
            const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
            return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
          }
          return sum;
        },
        0
      );
      setPlannedClubMinutes(total);
    })();
  }, [effectivePlayerId, fromDate, toDate]);

  const shouldLoadRoundStats = activeSection === "overview" || activeSection === "trainings" || activeSection === "stats" || activeSection === "rounds";
  const shouldLoadTrainLookback = activeSection === "stats" && isPerformanceEnabled;

  // ===== LOAD ROUNDS (current) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundStats) {
        setRounds([]);
        setLoadingRounds(false);
        return;
      }
      setLoadingRounds(true);
      try {
        if (!effectivePlayerId) {
          setRounds([]);
          return;
        }

        let q = supabase
          .from("golf_rounds")
          .select(
            "id,start_at,round_type,course_name,location,tee_name,slope_rating,course_rating,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus"
          )
          .eq("user_id", effectivePlayerId)
          .order("start_at", { ascending: true });

        if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
        if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));
        q = q.limit(1000);

        const rRes = await q;
        if (rRes.error) throw new Error(rRes.error.message);

        setRounds((rRes.data ?? []) as GolfRoundRow[]);
      } catch {
        setRounds([]);
      } finally {
        setLoadingRounds(false);
      }
    })();
  }, [effectivePlayerId, fromDate, toDate, shouldLoadRoundStats]);

  // ===== LOAD ROUNDS (prev, for trends) =====
  useEffect(() => {
    (async () => {
      if (!prevRange) {
        setPrevRounds([]);
        return;
      }
      if (!shouldLoadRoundStats) {
        setPrevRounds([]);
        setLoadingPrevRounds(false);
        return;
      }

      setLoadingPrevRounds(true);
      try {
        if (!effectivePlayerId) {
          setPrevRounds([]);
          return;
        }

        const q = supabase
          .from("golf_rounds")
          .select("id,start_at,round_type,total_score,total_putts,fairways_hit,fairways_total,gir,eagles,birdies,pars,bogeys,doubles_plus")
          .eq("user_id", effectivePlayerId)
          .gte("start_at", startOfDayISO(prevRange.from))
          .lt("start_at", nextDayStartISO(prevRange.to))
          .order("start_at", { ascending: true })
          .limit(1000);

        const rRes = await q;
        if (rRes.error) throw new Error(rRes.error.message);

        setPrevRounds((rRes.data ?? []) as GolfRoundRow[]);
      } catch {
        setPrevRounds([]);
      } finally {
        setLoadingPrevRounds(false);
      }
    })();
  }, [effectivePlayerId, prevRange?.from, prevRange?.to, shouldLoadRoundStats]);

  // ===== LOAD HOLES (current) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundStats) {
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
  }, [rounds, shouldLoadRoundStats]);

  // ===== LOAD HOLES (prev) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadRoundStats) {
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
  }, [prevRange, prevRounds, shouldLoadRoundStats]);

  // ===== LOAD TRAININGS LOOKBACK (for correlation) =====
  useEffect(() => {
    (async () => {
      if (!shouldLoadTrainLookback) {
        setSessionsLookback([]);
        setItemsLookback([]);
        setLoadingTrainLookback(false);
        return;
      }
      setLoadingTrainLookback(true);
      try {
        if (!effectivePlayerId) {
          setSessionsLookback([]);
          setItemsLookback([]);
          return;
        }

        const now = new Date();
        const fallbackFrom = isoToYMD(new Date(now.getFullYear(), now.getMonth() - 2, 1));
        const from = fromDate || fallbackFrom;
        const to = toDate || isoToYMD(now);

        const fromISO = toISOStartMinusDays(from, LOOKBACK_DAYS);
        const toISO = nextDayStartISO(to);

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id,location_text,coach_name,notes")
          .eq("user_id", effectivePlayerId)
          .gte("start_at", fromISO)
          .lt("start_at", toISO)
          .order("start_at", { ascending: true })
          .limit(1500);

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
  }, [effectivePlayerId, fromDate, toDate, shouldLoadTrainLookback]);

  useEffect(() => {
    (async () => {
      if (activeSection !== "trainings" || !effectivePlayerId) {
        setCoachEvaluations([]);
        setLoadingCoachEvaluations(false);
        return;
      }

      setLoadingCoachEvaluations(true);
      try {
        const feedbackRes = await supabase
          .from("club_event_coach_feedback")
          .select("event_id,engagement,attitude,performance,player_note")
          .eq("player_id", effectivePlayerId)
          .eq("visible_to_player", true)
          .limit(500);
        if (feedbackRes.error) throw new Error(feedbackRes.error.message);

        const feedbacks = (feedbackRes.data ?? []) as CoachEvaluationFeedbackRow[];
        const eventIds = Array.from(new Set(feedbacks.map((row) => row.event_id).filter(Boolean)));
        if (eventIds.length === 0) {
          setCoachEvaluations([]);
          return;
        }

        let eventsQuery = supabase
          .from("club_events")
          .select("id,starts_at,event_type,title")
          .in("id", eventIds)
          .in("event_type", ["training"])
          .lt("starts_at", new Date().toISOString())
          .limit(1000);
        if (fromDate) eventsQuery = eventsQuery.gte("starts_at", startOfDayISO(fromDate));
        if (toDate) eventsQuery = eventsQuery.lt("starts_at", nextDayStartISO(toDate));

        const eventsRes = await eventsQuery;
        if (eventsRes.error) throw new Error(eventsRes.error.message);

        const events = (eventsRes.data ?? []) as CoachEvaluationEventRow[];
        const eventById = new Map(events.map((event) => [event.id, event]));

        const merged = feedbacks
          .map((feedback) => {
            const event = eventById.get(feedback.event_id);
            if (!event) return null;
            return {
              event_id: feedback.event_id,
              starts_at: event.starts_at,
              title: event.title ?? null,
              event_type: event.event_type ?? null,
              engagement: feedback.engagement,
              attitude: feedback.attitude,
              application: feedback.performance,
              player_note: String(feedback.player_note ?? "").trim() || null,
            } as CoachEvaluationRow;
          })
          .filter((row): row is CoachEvaluationRow => Boolean(row))
          .sort((a, b) => (a.starts_at > b.starts_at ? -1 : 1));

        setCoachEvaluations(merged);
      } catch {
        setCoachEvaluations([]);
      } finally {
        setLoadingCoachEvaluations(false);
      }
    })();
  }, [activeSection, effectivePlayerId, fromDate, toDate]);

  useEffect(() => {
    if (activeSection !== "trainings" || !effectivePlayerId) {
      setCustomCoachEvaluations([]);
      return;
    }
    const eventIds = overviewEvents
      .filter((event) => (!fromDate || event.starts_at >= startOfDayISO(fromDate)) && (!toDate || event.starts_at < nextDayStartISO(toDate)))
      .map((event) => event.id);
    if (!eventIds.length) {
      setCustomCoachEvaluations([]);
      return;
    }
    void (async () => {
      const criteriaResult = await supabase
        .from("club_event_evaluation_criteria")
        .select("id,event_id,snapshot_name,snapshot_response_format")
        .in("event_id", eventIds)
        .eq("is_enabled", true)
        .in("snapshot_respondent", ["coach", "both"]);
      if (criteriaResult.error || !criteriaResult.data?.length) {
        setCustomCoachEvaluations([]);
        return;
      }
      const criteria = criteriaResult.data as Array<{ id: string; event_id: string; snapshot_name: string; snapshot_response_format: string }>;
      const responsesResult = await supabase
        .from("club_event_evaluation_responses")
        .select("event_id,event_criterion_id,value_json")
        .eq("player_id", effectivePlayerId)
        .eq("respondent_role", "coach")
        .in("event_criterion_id", criteria.map((criterion) => criterion.id));
      if (responsesResult.error) {
        setCustomCoachEvaluations([]);
        return;
      }
      const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
      setCustomCoachEvaluations((responsesResult.data ?? []).flatMap((response: { event_id: string; event_criterion_id: string; value_json: unknown }) => {
        const criterion = criterionById.get(response.event_criterion_id);
        if (!criterion || !["string", "number", "boolean"].includes(typeof response.value_json)) return [];
        return [{ event_id: response.event_id, criterion_id: criterion.id, name: criterion.snapshot_name, format: criterion.snapshot_response_format, value: response.value_json as string | number | boolean }];
      }));
    })();
  }, [activeSection, effectivePlayerId, fromDate, overviewEvents, toDate]);
      
  const PRESET_LABEL: Record<Preset, string> = {
    week: t("common.thisWeek"),
    month: t("common.thisMonth"),
    last3: t("common.last3Months"),
    season: pickLocaleText(locale, "Cette saison", "This season"),
    lastSeason: pickLocaleText(locale, "La saison dernière", "Last season"),
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
    if (preset === "season") return pickLocaleText(locale, "Volume de la saison", "Season training volume");
    if (preset === "lastSeason") return pickLocaleText(locale, "Volume de la saison dernière", "Last season training volume");
    if (preset === "custom") return pickLocaleText(locale, "Volume de la période", "Period training volume");
    return pickLocaleText(locale, "Mon volume d'entraînement", "Training volume");
  }, [locale, preset]);
  // ===== TRAININGS AGGREGATES (current + prev) =====
  const nonPerformanceManualSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !session.club_event_id &&
          (session.session_type === "individual" || session.session_type === "private")
      ),
    [sessions]
  );
  const nonPerformanceManualMinutes = useMemo(
    () =>
      nonPerformanceManualSessions.reduce(
        (sum, session) => sum + (Number(session.total_minutes ?? 0) || 0),
        0
      ),
    [nonPerformanceManualSessions]
  );
  const nonPerformanceManualBreakdown = useMemo(() => {
    const counts: Record<"private" | "individual", number> = { private: 0, individual: 0 };
    for (const session of nonPerformanceManualSessions) {
      counts[session.session_type] += 1;
    }
    return counts;
  }, [nonPerformanceManualSessions]);
  const totalMinutes = useMemo(() => {
    if (isPerformanceEnabled) return items.reduce((sum, it) => sum + (it.minutes || 0), 0);
    return plannedClubMinutes + nonPerformanceManualMinutes;
  }, [isPerformanceEnabled, items, plannedClubMinutes, nonPerformanceManualMinutes]);
  const displayedTrainingCount = useMemo(
    () =>
      isPerformanceEnabled
        ? sessions.length
        : plannedClubEventsCount + nonPerformanceManualSessions.length,
    [isPerformanceEnabled, sessions.length, plannedClubEventsCount, nonPerformanceManualSessions.length]
  );
  const trainingVolumeTarget = useMemo(
    () => pickTrainingVolumeTarget(playerHandicap, trainingVolumeRows),
    [playerHandicap, trainingVolumeRows]
  );
  const trainingVolumeObjective = useMemo(() => {
    const nowMonth = new Date().getMonth() + 1;
    const inSeason =
      trainingSeasonMonths.includes(nowMonth) ||
      (!trainingOffseasonMonths.includes(nowMonth) && trainingSeasonMonths.length > 0);
    if (!trainingVolumeTarget) return 0;
    return inSeason ? trainingVolumeTarget.minutes_inseason : trainingVolumeTarget.minutes_offseason;
  }, [trainingSeasonMonths, trainingOffseasonMonths, trainingVolumeTarget]);
  const displayedTrainingVolumeObjective = useMemo(() => {
    if (trainingVolumeObjective <= 0) return 0;
    if (preset === "month") return trainingVolumeObjective * 4;
    return trainingVolumeObjective;
  }, [preset, trainingVolumeObjective]);
  const trainingVolumeMotivation = useMemo(() => {
    const text = String(trainingVolumeTarget?.motivation_text ?? "").trim();
    return text || null;
  }, [trainingVolumeTarget]);
  const trainingVolumePercent = useMemo(
    () => (displayedTrainingVolumeObjective > 0 ? (totalMinutes / displayedTrainingVolumeObjective) * 100 : 0),
    [displayedTrainingVolumeObjective, totalMinutes]
  );
  const trainingVolumeGoalReached = displayedTrainingVolumeObjective > 0 && totalMinutes >= displayedTrainingVolumeObjective;
  const showMonthlyObjective = preset !== "all" && displayedTrainingVolumeObjective > 0;
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
  const avgMotivation = useMemo(() => avg(sessions.map((s) => s.motivation)), [sessions]);
  const avgDifficulty = useMemo(() => avg(sessions.map((s) => s.difficulty)), [sessions]);
  const avgSatisfaction = useMemo(() => avg(sessions.map((s) => s.satisfaction)), [sessions]);

  const byType = useMemo(() => {
    if (!isPerformanceEnabled) {
      return {
        club: plannedClubEventsCount,
        private: nonPerformanceManualBreakdown.private,
        individual: nonPerformanceManualBreakdown.individual,
      } satisfies Record<SessionType, number>;
    }
    const m: Record<SessionType, number> = { club: 0, private: 0, individual: 0 };
    for (const s of sessions) m[s.session_type] += 1;
    return m;
  }, [isPerformanceEnabled, sessions, plannedClubEventsCount, nonPerformanceManualBreakdown]);

  const minutesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) map[it.category] = (map[it.category] ?? 0) + (it.minutes || 0);
    return map;
  }, [items]);

  const topCats = useMemo(() => {
    return Object.entries(minutesByCat)
      .map(([cat, minutes]) => ({ cat, label: t(`cat.${cat}`), minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [minutesByCat, t]);

  const catMax = useMemo(() => {
    const m = topCats.reduce((mx, x) => Math.max(mx, x.minutes), 0);
    return m || 1;
  }, [topCats]);

  const prevAvgMotivation = useMemo(() => avg(prevSessions.map((s) => s.motivation)), [prevSessions]);
  const prevAvgDifficulty = useMemo(() => avg(prevSessions.map((s) => s.difficulty)), [prevSessions]);
  const prevAvgSatisfaction = useMemo(() => avg(prevSessions.map((s) => s.satisfaction)), [prevSessions]);

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
        objective:
          trainingVolumeConfigs.length > 0
            ? trainingVolumeConfigs.reduce((max, config) => {
                const handicapAtWeek = handicapForDate(w.weekStart);
                const target = pickTrainingVolumeTarget(handicapAtWeek, config.rows);
                const month = new Date(`${w.weekStart}T00:00:00`).getMonth() + 1;
                const objective = objectiveForMonth(target, config.seasonMonths, config.offseasonMonths, month);
                return Math.max(max, objective);
              }, 0)
            : weeklyObjectiveMinutes,
      }));

    return list.map((x) => {
      const d = new Date(`${x.week}T00:00:00`);
      const label = new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [dateLocale, handicapForDate, sessions, trainingVolumeConfigs, weeklyObjectiveMinutes]);

  const avgCoachEngagement = useMemo(() => avg(coachEvaluations.map((row) => row.engagement)), [coachEvaluations]);
  const avgCoachAttitude = useMemo(() => avg(coachEvaluations.map((row) => row.attitude)), [coachEvaluations]);
  const avgCoachApplication = useMemo(() => avg(coachEvaluations.map((row) => row.application)), [coachEvaluations]);
  const customCoachCriteriaSummary = useMemo(() => {
    const grouped = new Map<string, { values: number[]; latest: string | number | boolean }>();
    customCoachEvaluations.forEach((entry) => {
      const current = grouped.get(entry.name) ?? { values: [], latest: entry.value };
      current.latest = entry.value;
      if (typeof entry.value === "number") current.values.push(entry.value);
      grouped.set(entry.name, current);
    });
    return [...grouped.entries()].map(([name, data]) => ({ name, value: data.values.length ? avg(data.values) : data.latest }));
  }, [customCoachEvaluations]);

  const coachEvalTrendSeries = useMemo(() => {
    const asc = [...coachEvaluations].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    if (asc.length === 0) return [];
    const linearTrendEnds = (key: "engagement" | "attitude" | "application") => {
      const values = asc
        .map((row, index) => ({ x: index, y: typeof row[key] === "number" ? row[key] : null }))
        .filter((point): point is { x: number; y: number } => point.y != null);
      if (values.length === 0) return { start: null as number | null, end: null as number | null };
      if (values.length === 1) return { start: values[0].y, end: values[0].y };

      const n = values.length;
      const sumX = values.reduce((sum, point) => sum + point.x, 0);
      const sumY = values.reduce((sum, point) => sum + point.y, 0);
      const sumXY = values.reduce((sum, point) => sum + point.x * point.y, 0);
      const sumXX = values.reduce((sum, point) => sum + point.x * point.x, 0);
      const denom = n * sumXX - sumX * sumX;
      if (denom === 0) return { start: values[0].y, end: values[n - 1].y };
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;
      const start = Math.round((intercept + slope * values[0].x) * 10) / 10;
      const end = Math.round((intercept + slope * values[n - 1].x) * 10) / 10;
      return { start, end };
    };

    const engagement = linearTrendEnds("engagement");
    const attitude = linearTrendEnds("attitude");
    const application = linearTrendEnds("application");

    return [
      { point: "Début", engagement: engagement.start, attitude: attitude.start, application: application.start },
      { point: "Fin", engagement: engagement.end, attitude: attitude.end, application: application.end },
    ];
  }, [coachEvaluations]);

  const sessionIdByClubEventId = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach((session) => {
      const clubEventId = String(session.club_event_id ?? "").trim();
      if (!clubEventId || map.has(clubEventId)) return;
      map.set(clubEventId, session.id);
    });
    return map;
  }, [sessions]);

  const coachEvaluationNotes = useMemo(
    () =>
      coachEvaluations.filter((row) => String(row.player_note ?? "").trim()).map((row) => ({
        ...row,
        sessionId: sessionIdByClubEventId.get(row.event_id) ?? null,
      })),
    [coachEvaluations, sessionIdByClubEventId]
  );

  const sessionMinutesById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => map.set(item.session_id, (map.get(item.session_id) ?? 0) + Number(item.minutes ?? 0)));
    sessions.forEach((session) => {
      if (!map.has(session.id)) map.set(session.id, Number(session.total_minutes ?? 0));
    });
    return map;
  }, [items, sessions]);

  const previousTrainingMinutes = useMemo(() => {
    const structured = prevItems.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
    return structured > 0 ? structured : prevSessions.reduce((sum, session) => sum + Number(session.total_minutes ?? 0), 0);
  }, [prevItems, prevSessions]);
  const volumeDelta = previousTrainingMinutes > 0 ? Math.round(((totalMinutes - previousTrainingMinutes) / previousTrainingMinutes) * 100) : null;

  const trainingWeeklyRows = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const first = weekStartMonday(new Date(`${fromDate}T12:00:00`));
    const last = new Date(`${toDate}T23:59:59`);
    const rows: Array<{ week: string; label: string; club: number; private: number; individual: number; total: number; objective: number | null }> = [];
    for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const row = { week: isoToYMD(weekStart), label: new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(weekStart), club: 0, private: 0, individual: 0, total: 0, objective: null as number | null };
      sessions.forEach((session) => {
        const time = new Date(session.start_at).getTime();
        if (time < weekStart.getTime() || time >= weekEnd.getTime()) return;
        const minutes = sessionMinutesById.get(session.id) ?? 0;
        row[session.session_type] += minutes;
        row.total += minutes;
      });
      const objective = trainingVolumeConfigs.length > 0
        ? trainingVolumeConfigs.reduce((maximum, config) => {
            const target = pickTrainingVolumeTarget(handicapForDate(row.week), config.rows);
            return Math.max(maximum, objectiveForMonth(target, config.seasonMonths, config.offseasonMonths, weekStart.getMonth() + 1));
          }, 0)
        : weeklyObjectiveMinutes;
      row.objective = objective > 0 ? objective : null;
      rows.push(row);
    }
    return rows;
  }, [dateLocale, fromDate, handicapForDate, sessionMinutesById, sessions, toDate, trainingVolumeConfigs, weeklyObjectiveMinutes]);

  const regularity = useMemo(() => {
    const active = trainingWeeklyRows.map((row) => row.total > 0);
    let best = 0;
    let running = 0;
    active.forEach((value) => { running = value ? running + 1 : 0; best = Math.max(best, running); });
    let current = 0;
    for (let index = active.length - 1; index >= 0 && active[index]; index -= 1) current += 1;
    return { active: active.filter(Boolean).length, current, best, total: active.length };
  }, [trainingWeeklyRows]);

  const previousActiveWeeks = useMemo(() => {
    const weeks = new Set(prevSessions.map((session) => isoToYMD(weekStartMonday(new Date(session.start_at)))));
    return weeks.size;
  }, [prevSessions]);

  const evaluatedSessions = useMemo(
    () => sessions.filter((session) => [session.motivation, session.difficulty, session.satisfaction].every((value) => typeof value === "number")),
    [sessions]
  );
  const evaluationDenominator = evaluatedSessions.length + pendingEvaluationCount;
  const evaluationRate = evaluationDenominator ? Math.round((evaluatedSessions.length / evaluationDenominator) * 100) : null;

  const sectorRows = useMemo(() => {
    const previous = new Map<string, number>();
    prevItems.forEach((item) => previous.set(item.category, (previous.get(item.category) ?? 0) + Number(item.minutes ?? 0)));
    const sessionCategories = new Map<string, Set<string>>();
    items.forEach((item) => {
      const categories = sessionCategories.get(item.session_id) ?? new Set<string>();
      categories.add(item.category);
      sessionCategories.set(item.session_id, categories);
    });
    return Object.entries(minutesByCat).map(([category, minutes]) => {
      const sessionIds = [...sessionCategories.entries()].filter(([, categories]) => categories.has(category)).map(([id]) => id);
      const satisfaction = avg(sessions.filter((session) => sessionIds.includes(session.id)).map((session) => session.satisfaction));
      const previousMinutes = previous.get(category) ?? 0;
      return {
        category,
        label: t(`cat.${category}`),
        minutes,
        percent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
        sessions: sessionIds.length,
        satisfaction,
        delta: previousMinutes > 0 ? Math.round(((minutes - previousMinutes) / previousMinutes) * 100) : null,
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }, [items, minutesByCat, prevItems, sessions, t, totalMinutes]);

  const trainingVolumeOption = useMemo<EChartsOption>(() => ({
    animationDuration: 900,
    color: ["#35483b", "#899d7d", "#65869a", "#d9a441"],
    grid: { left: 12, right: 14, top: 24, bottom: 54, containLabel: true },
    legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: "#657168", fontSize: 10, fontWeight: 600 } },
    tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: "#e2e7e1", borderWidth: 1, textStyle: { color: "#17211b", fontWeight: 600 } },
    xAxis: { type: "category", data: trainingWeeklyRows.map((row) => row.label), axisTick: { show: false }, axisLine: { lineStyle: { color: "rgba(53,72,59,.12)" } }, axisLabel: { color: "#7d8780", fontSize: 10 } },
    yAxis: { type: "value", name: "min", axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "rgba(53,72,59,.08)" } }, axisLabel: { color: "#7d8780", fontSize: 10 } },
    series: [
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Club", "Club"), data: trainingWeeklyRows.map((row) => row.club), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Cours privé", "Private lesson"), data: trainingWeeklyRows.map((row) => row.private) },
      { type: "bar", stack: "volume", name: pickLocaleText(locale, "Individuel", "Individual"), data: trainingWeeklyRows.map((row) => row.individual) },
      { type: "line", name: pickLocaleText(locale, "Objectif FTEM", "FTEM goal"), data: trainingWeeklyRows.map((row) => row.objective), symbol: "none", lineStyle: { width: 2, type: "dashed", color: "#d9a441" } },
    ],
  }), [locale, trainingWeeklyRows]);

  const sectorChartOption = useMemo<EChartsOption>(() => ({
    animationDuration: 900,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#fff", borderColor: "#e2e7e1", borderWidth: 1 },
    xAxis: { type: "value", axisLabel: { color: "#7d8780", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(53,72,59,.08)" } } },
    yAxis: { type: "category", inverse: true, data: sectorRows.map((row) => row.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#526158", fontSize: 11, fontWeight: 700 } },
    series: [{ type: "bar", data: sectorRows.map((row) => ({ value: row.minutes, itemStyle: { color: "#899d7d", borderRadius: [0, 7, 7, 0] }, label: { show: true, position: "right", formatter: `${row.percent}%`, color: "#526158", fontWeight: 700 } })), barMaxWidth: 22 }],
  }), [sectorRows]);

  const regularityOption = useMemo<EChartsOption>(() => {
    const rows = trainingWeeklyRows.slice(-12);
    const maximum = Math.max(1, ...rows.map((row) => row.total));
    return {
      animationDuration: 700,
      grid: { left: 8, right: 8, top: 32, bottom: 28, containLabel: true },
      tooltip: { formatter: (params: unknown) => { const point = params as { data?: number[] }; const index = Number(point.data?.[0] ?? 0); return `${rows[index]?.label ?? ""}<br/><b>${rows[index]?.total ?? 0} min</b>`; } },
      visualMap: { min: 0, max: maximum, show: false, inRange: { color: ["#f0f3ef", "#cbd8c7", "#789071", "#35483b"] } },
      xAxis: { type: "category", data: rows.map((row) => row.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#7d8780", fontSize: 10 } },
      yAxis: { type: "category", data: [pickLocaleText(locale, "Volume", "Volume")], axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#657168", fontSize: 10 } },
      series: [{ type: "heatmap", data: rows.map((row, index) => [index, 0, row.total]), label: { show: true, formatter: (params: unknown) => `${(params as { value?: number[] }).value?.[2] ?? 0}`, color: "#304438", fontSize: 10, fontWeight: 700 }, itemStyle: { borderColor: "#fff", borderWidth: 5, borderRadius: 9 } }],
    };
  }, [locale, trainingWeeklyRows]);

  const latestEvaluatedSession = useMemo(
    () => [...evaluatedSessions].sort((a, b) => b.start_at.localeCompare(a.start_at))[0] ?? null,
    [evaluatedSessions]
  );
  const latestCoachEvaluation = coachEvaluations[0] ?? null;
  const trainingRoundObservation = useMemo(() => {
    if (rounds.length < 4 || sessions.length < 6) return null;
    const samples = rounds
      .filter((round) => typeof round.total_score === "number")
      .map((round) => {
        const end = new Date(round.start_at).getTime();
        const start = end - 14 * 86400000;
        const preceding = sessions.filter((session) => {
          const time = new Date(session.start_at).getTime();
          return time >= start && time < end;
        });
        return { score: Number(round.total_score), sessions: preceding.length, minutes: preceding.reduce((sum, session) => sum + (sessionMinutesById.get(session.id) ?? 0), 0) };
      });
    const regular = samples.filter((sample) => sample.sessions >= 2);
    const lighter = samples.filter((sample) => sample.sessions < 2);
    if (regular.length < 2 || lighter.length < 2) return null;
    const regularScore = Math.round((regular.reduce((sum, sample) => sum + sample.score, 0) / regular.length) * 10) / 10;
    const lighterScore = Math.round((lighter.reduce((sum, sample) => sum + sample.score, 0) / lighter.length) * 10) / 10;
    const averageMinutes = Math.round(regular.reduce((sum, sample) => sum + sample.minutes, 0) / regular.length);
    return { sampleSize: samples.length, regularScore, lighterScore, difference: Math.round((regularScore - lighterScore) * 10) / 10, averageMinutes };
  }, [rounds, sessionMinutesById, sessions]);

  const filteredEvaluationSessions = useMemo(() => {
    if (evaluationFilter === "pending") return [];
    if (evaluationFilter === "completed") return evaluatedSessions;
    return evaluatedSessions;
  }, [evaluatedSessions, evaluationFilter]);

  const filteredHistorySessions = useMemo(() => sessions.filter((session) => {
    if (trainingOriginFilter !== "all" && session.session_type !== trainingOriginFilter) return false;
    if (trainingSectorFilter !== "all" && !items.some((item) => item.session_id === session.id && item.category === trainingSectorFilter)) return false;
    const complete = evaluatedSessions.some((item) => item.id === session.id);
    if (trainingStatusFilter === "completed" && !complete) return false;
    if (trainingStatusFilter === "pending" && complete) return false;
    return true;
  }), [evaluatedSessions, items, sessions, trainingOriginFilter, trainingSectorFilter, trainingStatusFilter]);

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
        const hs = (byRound[r.id] ?? []).filter((h) => typeof h.score === "number");
        if (hs.length !== 18) return null;
        const sum = hs.reduce((s, x) => s + (x.score as number), 0);
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

    // putts avg (total putts per completed 18-hole round)
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

    // GIR on played holes (including partial rounds)
    const girKnownHoles = holes.filter(
      (h) => typeof h.par === "number" && typeof h.score === "number" && typeof h.putts === "number"
    );
    const girHits = girKnownHoles.filter((h) => isGirOnHole(h.par, h.score, h.putts)).length;
    const girPct = girKnownHoles.length ? round1((girHits / girKnownHoles.length) * 100) : null;
    let scramblingOpp = 0;
    let scramblingSuccess = 0;
    for (const h of girKnownHoles) {
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
        const hs = (byRound[r.id] ?? []).filter((h) => typeof h.score === "number");
        if (hs.length !== 18) return null;
        const sum = hs.reduce((s, x) => s + (x.score as number), 0);
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
    const girPct = girKnownHoles.length ? round1((girHits / girKnownHoles.length) * 100) : null;
    let scramblingOpp = 0;
    let scramblingSuccess = 0;
    for (const h of girKnownHoles) {
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
      putts18Arrow: delta(holeAgg.avgPutts18, prevHoleAgg.avgPutts18),

      fwPct: holeAgg.fwPct,
      fwArrow: delta(holeAgg.fwPct, prevHoleAgg.fwPct),

      scramblingPct: holeAgg.scramblingPct,
      scramblingArrow: delta(holeAgg.scramblingPct, prevHoleAgg.scramblingPct),
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

  const overviewWeekSeries = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const start = weekStartMonday(new Date(`${fromDate}T12:00:00`));
    const end = new Date(`${toDate}T23:59:59`);
    const sessionMinutes = new Map<string, number>();
    items.forEach((item) => sessionMinutes.set(item.session_id, (sessionMinutes.get(item.session_id) ?? 0) + Number(item.minutes ?? 0)));
    const rows: Array<{ week: string; weekLabel: string; minutes: number; objective: number | null }> = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
      const week = isoToYMD(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const minutes = sessions.reduce((sum, session) => {
        const time = new Date(session.start_at).getTime();
        if (time < cursor.getTime() || time >= weekEnd.getTime()) return sum;
        return sum + (isPerformanceEnabled ? (sessionMinutes.get(session.id) ?? Number(session.total_minutes ?? 0)) : Number(session.total_minutes ?? 0));
      }, 0);
      const objective = trainingVolumeConfigs.length > 0
        ? trainingVolumeConfigs.reduce((maximum, config) => {
            const target = pickTrainingVolumeTarget(handicapForDate(week), config.rows);
            const month = cursor.getMonth() + 1;
            return Math.max(maximum, objectiveForMonth(target, config.seasonMonths, config.offseasonMonths, month));
          }, 0)
        : weeklyObjectiveMinutes;
      rows.push({
        week,
        weekLabel: new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(cursor),
        minutes,
        objective: objective > 0 ? objective : null,
      });
    }
    return rows;
  }, [dateLocale, fromDate, handicapForDate, isPerformanceEnabled, items, sessions, toDate, trainingVolumeConfigs, weeklyObjectiveMinutes]);

  const overviewObjective = useMemo(
    () => overviewWeekSeries.reduce((sum, row) => sum + Number(row.objective ?? 0), 0),
    [overviewWeekSeries]
  );
  const overviewFtemPercent = overviewObjective > 0 ? Math.round((totalMinutes / overviewObjective) * 100) : null;

  const attendanceOverview = useMemo(() => {
    const calculate = (from: string, to: string) => {
      const fromTime = new Date(`${from}T00:00:00`).getTime();
      const toTime = new Date(`${to}T23:59:59`).getTime();
      const now = Date.now();
      const eligible = overviewEvents.filter((event) => {
        const eventTime = new Date(event.starts_at).getTime();
        const status = overviewAttendance[event.id];
        return event.status === "scheduled" && eventTime >= fromTime && eventTime <= toTime && eventTime < now && ["training", "interclub", "camp", "event", "session"].includes(String(event.event_type)) && (status === "present" || status === "absent");
      });
      const present = eligible.filter((event) => overviewAttendance[event.id] === "present").length;
      return { present, total: eligible.length, rate: eligible.length ? Math.round((present / eligible.length) * 100) : null };
    };
    if (!fromDate || !toDate) return { present: 0, total: 0, rate: null, trend: null };
    const current = calculate(fromDate, toDate);
    const previous = prevRange ? calculate(prevRange.from, prevRange.to) : null;
    return { ...current, trend: current.rate != null && previous?.rate != null ? current.rate - previous.rate : null };
  }, [fromDate, overviewAttendance, overviewEvents, prevRange, toDate]);

  const orderedRounds = useMemo(
    () => [...rounds].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [rounds]
  );
  const lastRound = orderedRounds.at(-1) ?? null;
  const previousRound = orderedRounds.at(-2) ?? null;
  const lastRoundDelta = typeof lastRound?.total_score === "number" && typeof previousRound?.total_score === "number"
    ? lastRound.total_score - previousRound.total_score
    : null;
  const roundProgressionOption = useMemo(() => buildManagementDualLineChartOption({
    labels: orderedRounds.map((round) => new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "short" }).format(new Date(round.start_at))),
    left: {
      name: pickLocaleText(locale, "Score brut", "Gross score"),
      axisLabel: pickLocaleText(locale, "Score", "Score"),
      data: orderedRounds.map((round) => round.total_score),
      color: MANAGEMENT_CHART_COLORS[0],
    },
    right: {
      name: pickLocaleText(locale, "Handicap", "Handicap"),
      axisLabel: pickLocaleText(locale, "HCP", "HCP"),
      data: orderedRounds.map((round) => handicapForDate(isoToYMD(new Date(round.start_at)))),
      color: MANAGEMENT_CHART_COLORS[2],
    },
  }), [dateLocale, handicapForDate, locale, orderedRounds]);

  const recentDocuments = useMemo(() => [...documents].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3), [documents]);
  const newestSharedDocument = useMemo(() => documents.find((document) => String(document.uploaded_by) !== currentUserId) ?? null, [currentUserId, documents]);
  const incompleteRound = useMemo(() => [...rounds].reverse().find((round) => round.total_score == null) ?? null, [rounds]);
  const strongestGameMarker = useMemo(() => {
    const values = [
      { label: "GIR", value: keyKpisUI.girPct },
      { label: pickLocaleText(locale, "Fairways touchés", "Fairways hit"), value: keyKpisUI.fwPct },
      { label: "Scrambling", value: keyKpisUI.scramblingPct },
    ].filter((entry): entry is { label: string; value: number } => entry.value != null);
    return values.sort((a, b) => b.value - a.value)[0] ?? null;
  }, [keyKpisUI.fwPct, keyKpisUI.girPct, keyKpisUI.scramblingPct, locale]);

  function selectSection(section: DashboardSection) {
    if (section === "evaluations") {
      setActiveSection("trainings");
      setTrainingSubview("evaluations");
      section = "trainings";
    }
    setActiveSection(section);
    if (section === "overview" && !["month", "last3", "season", "lastSeason"].includes(preset)) setPreset("season");
    const url = new URL(window.location.href);
    if (section === "overview") url.searchParams.delete("section");
    else url.searchParams.set("section", section);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  // ===== UI =====
  const kpiGridClass = "golf-kpi-grid";
  const kpiGridStyle: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "1fr" };

  return (
    <div className="player-dashboard-bg player-golf-page">
      <div className="app-shell marketplace-page">
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: pickLocaleText(locale, "Mon golf", "My golf") }]} />
        {/* ===== Header ===== */}
        <header className={managerStyles.topline}>
          <div>
            <h1>{pickLocaleText(locale, "Mon Golf", "My Golf")}</h1>
            <p className={managerStyles.lead}>{pickLocaleText(locale, "Pilotez votre progression, votre volume d’entraînement et vos repères de jeu.", "Track your progress, training volume and playing benchmarks.")}</p>
          </div>
        </header>

        {error && <div className="marketplace-error">{error}</div>}

        <section className={`${adminCardStyles.overview} ${overviewStyles.navigationCard}`}>
          <div className={`${navigationStyles.tabs} ${overviewStyles.navigationTabs}`} role="tablist" aria-label={pickLocaleText(locale, "Sections Mon Golf", "My Golf sections")}>
            {[
              { id: "overview" as DashboardSection, label: pickLocaleText(locale, "Vue d’ensemble", "Overview") },
              { id: "trainings" as DashboardSection, label: pickLocaleText(locale, "Entraînements", "Trainings") },
              { id: "rounds" as DashboardSection, label: pickLocaleText(locale, "Parcours & statistiques", "Rounds & statistics") },
              { id: "documents" as DashboardSection, label: pickLocaleText(locale, "Documents", "Documents") },
            ].map((tab) => {
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => selectSection(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        {activeSection === "documents" ? (
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
              <label style={{ display: "grid", gap: 6, maxWidth: 520 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>Nom du document</span>
                <input
                  className="input"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="Nom du document"
                  maxLength={180}
                />
              </label>
              <div>
                <button
                  className="btn btn-primary btn-upload-green"
                  type="button"
                  onClick={() => void uploadDocument()}
                  style={{
                    opacity: !docFile || !docName.trim() || uploadingDocument ? 0.65 : 1,
                    pointerEvents: !docFile || !docName.trim() || uploadingDocument ? "none" : "auto",
                  }}
                >
                  <Upload size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  Upload
                </button>
              </div>
            </div>
            {loadingDocuments ? (
              <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
              </div>
            ) : documents.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun document.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {documents.map((d) => {
                  const uploader = String(d.uploaded_by_name ?? "").trim() || String(d.uploaded_by ?? "").slice(0, 8);
                  const fileName = String(d.file_name ?? "").trim();
                  const dot = fileName.lastIndexOf(".");
                  const ext = dot > 0 ? fileName.slice(dot + 1).toUpperCase() : "DOC";
                  const Picto = documentPicto(d.mime_type, fileName);
                  return (
                    <div
                      key={d.id}
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.86)",
                        padding: "10px 12px",
                        display: "grid",
                        gap: 8,
                        boxShadow: "0 1px 5px rgba(0,0,0,0.035)",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", gap: 10, alignItems: "start" }}>
                        <div className={documentStyles.typeIcon} aria-hidden="true">
                          <Picto size={16} strokeWidth={2.2} />
                        </div>
                        <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
                          <div style={{ fontWeight: 850, fontSize: 12, lineHeight: 1.3 }} className="truncate">{fileName}</div>
                          <div style={{ fontSize: 11, fontWeight: 750, color: "rgba(0,0,0,0.6)", lineHeight: 1.35 }}>
                            {ext} · {shortDate(d.created_at, dateLocale)}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 750, color: "rgba(0,0,0,0.62)", lineHeight: 1.35 }} className="truncate">
                            Uploadé par {uploader}
                          </div>
                        </div>
                      </div>

                      <div className={documentStyles.actions}>
                        <button className={documentStyles.iconButton} type="button" onClick={() => setViewerDocument(d)} aria-label={`Voir ${fileName}`} title="Voir">
                          <Eye size={15} aria-hidden="true" />
                        </button>
                        {String(d.uploaded_by ?? "") === currentUserId ? (
                          <>
                            <button
                              className={documentStyles.iconButton}
                              type="button"
                              onClick={() => void renameDocument(d)}
                              disabled={renamingDocumentId === d.id || deletingDocumentId === d.id}
                              aria-label={`Renommer ${fileName}`}
                              title="Renommer"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              className={documentStyles.iconButton}
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        ) : null}

       {/* ===== Filters ===== */}
{activeSection !== "rounds" ? <div className="glass-section">
  <div className="glass-card" style={{ padding: 14 }}>
    <div style={{ display: "grid", gap: 12 }}>
      {/* Label */}
      <div className={overviewStyles.periodFilterLabel}>
        <span><SlidersHorizontal size={16} /></span>
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
        <option value="month">{t("common.thisMonth")}</option>
        <option value="last3">{t("common.last3Months")}</option>
        {activeSection === "overview" || activeSection === "trainings" ? (
          <>
            <option value="season">{pickLocaleText(locale, "Cette saison", "This season")}</option>
            {previousClubSeason ? <option value="lastSeason">{pickLocaleText(locale, "La saison dernière", "Last season")}</option> : null}
          </>
        ) : (
          <>
            <option value="week">{t("common.thisWeek")}</option>
            <option value="season">{pickLocaleText(locale, "Cette saison", "This season")}</option>
            {previousClubSeason ? <option value="lastSeason">{pickLocaleText(locale, "La saison dernière", "Last season")}</option> : null}
            <option value="all">{t("common.allActivity")}</option>
            <option value="custom">{t("common.custom")}</option>
          </>
        )}
      </select>

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
                {t("common.from")}
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
                {t("common.to")}
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
</div> : null}

        {activeSection === "overview" ? (
          <div className={overviewStyles.overview}>
            <section className={overviewStyles.kpiGrid} aria-label={pickLocaleText(locale, "Indicateurs golf", "Golf indicators")}>
              <article className={overviewStyles.kpiCard}>
                <div className={overviewStyles.cardTitle}><span><Target size={17} /></span><h2>{pickLocaleText(locale, "Objectif FTEM", "FTEM goal")}</h2></div>
                {loading ? <div className={overviewStyles.kpiSkeleton} /> : overviewFtemPercent == null ? <div className={overviewStyles.neutralValue}>—<small>{pickLocaleText(locale, "Objectif indisponible", "Goal unavailable")}</small></div> : <>
                  <strong>{overviewFtemPercent}%</strong>
                  <div className={overviewStyles.progress}><span style={{ width: `${Math.min(100, overviewFtemPercent)}%` }} /></div>
                  <p>{totalMinutes} / {overviewObjective} min</p>
                  <small>{trainingVolumeTarget?.ftem_code}{trainingVolumeTarget?.level_label ? ` · ${trainingVolumeTarget.level_label}` : ""}</small>
                </>}
              </article>

              <article className={overviewStyles.kpiCard}>
                <div className={overviewStyles.cardTitle}><span><CalendarCheck2 size={17} /></span><h2>{pickLocaleText(locale, "Assiduité", "Attendance")}</h2></div>
                {overviewActivitiesLoading ? <div className={overviewStyles.kpiSkeleton} /> : <>
                  <strong>{attendanceOverview.rate == null ? "—" : `${attendanceOverview.rate}%`}</strong>
                  <p>{attendanceOverview.present} {pickLocaleText(locale, attendanceOverview.present === 1 ? "présence" : "présences", attendanceOverview.present === 1 ? "attendance" : "attendances")} / {attendanceOverview.total}</p>
                  {attendanceOverview.trend != null ? <small className={attendanceOverview.trend >= 0 ? overviewStyles.positive : overviewStyles.caution}>{attendanceOverview.trend > 0 ? <ArrowUp size={13} /> : attendanceOverview.trend < 0 ? <ArrowDown size={13} /> : <ArrowRight size={13} />}{attendanceOverview.trend > 0 ? "+" : ""}{attendanceOverview.trend} pts {compareLabel}</small> : <small>{pickLocaleText(locale, "Pas de période comparable", "No comparable period")}</small>}
                </>}
              </article>

              <article className={overviewStyles.kpiCard}>
                <div className={overviewStyles.cardTitle}><span><Flag size={17} /></span><h2>{pickLocaleText(locale, "Dernier parcours", "Latest round")}</h2></div>
                {loadingRounds ? <div className={overviewStyles.kpiSkeleton} /> : lastRound ? <>
                  <strong>{lastRound.total_score ?? "—"}</strong>
                  <p>{lastRound.course_name || lastRound.location || pickLocaleText(locale, "Parcours non renseigné", "Course not specified")}</p>
                  {lastRoundDelta != null ? <small className={lastRoundDelta <= 0 ? overviewStyles.positive : overviewStyles.caution}>{lastRoundDelta < 0 ? <ArrowDown size={13} /> : lastRoundDelta > 0 ? <ArrowUp size={13} /> : <ArrowRight size={13} />}{lastRoundDelta > 0 ? "+" : ""}{lastRoundDelta} {pickLocaleText(locale, "coup(s)", "stroke(s)")}</small> : <small>{pickLocaleText(locale, "Aucune comparaison disponible", "No comparison available")}</small>}
                </> : <div className={overviewStyles.neutralValue}>—<small>{pickLocaleText(locale, "Aucun parcours sur la période", "No round in this period")}</small></div>}
              </article>

              <Link href="/player/golf/trainings/to-complete" className={`${overviewStyles.kpiCard} ${pendingEvaluationCount > 0 ? overviewStyles.attentionCard : ""}`}>
                <div className={overviewStyles.cardTitle}><span><ClipboardList size={17} /></span><h2>{pickLocaleText(locale, "À compléter", "To complete")}</h2></div>
                {overviewActivitiesLoading ? <div className={overviewStyles.kpiSkeleton} /> : <>
                  <strong>{pendingEvaluationCount}</strong>
                  <p>{pickLocaleText(locale, pendingEvaluationCount === 1 ? "activité à évaluer" : "activités à évaluer", pendingEvaluationCount === 1 ? "activity to evaluate" : "activities to evaluate")}</p>
                  <small>{pendingEvaluationCount > 0 ? pickLocaleText(locale, "Compléter maintenant", "Complete now") : pickLocaleText(locale, "Vous êtes à jour", "You're up to date")}<ArrowRight size={13} /></small>
                </>}
              </Link>
            </section>

            <div className={overviewStyles.splitWide}>
              <section className={overviewStyles.panel}>
                <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume et régularité", "Volume and consistency")}</h2><p>{periodLabel}</p></div><button type="button" onClick={() => selectSection("trainings")}>{pickLocaleText(locale, "Voir les entraînements", "View trainings")}<ArrowRight size={14} /></button></div>
                {loading ? <div className={overviewStyles.chartSkeleton} /> : overviewWeekSeries.length ? <ActiviteeEChart height={300} ariaLabel={pickLocaleText(locale, "Volume hebdomadaire et objectif FTEM", "Weekly volume and FTEM goal")} option={buildManagementVolumeChartOption({ labels: overviewWeekSeries.map((row) => row.weekLabel), values: overviewWeekSeries.map((row) => row.minutes), valueLabel: pickLocaleText(locale, "Volume réalisé", "Completed volume"), objective: overviewWeekSeries.map((row) => row.objective), objectiveLabel: pickLocaleText(locale, "Objectif FTEM", "FTEM goal") })} /> : <div className={overviewStyles.empty}>{pickLocaleText(locale, "Aucune donnée d’entraînement sur cette période.", "No training data for this period.")}</div>}
              </section>

              <section className={overviewStyles.panel}>
                <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Points d’attention", "Points of attention")}</h2><p>{pickLocaleText(locale, "Les prochaines actions utiles.", "Useful next actions.")}</p></div></div>
                <div className={overviewStyles.attentionList}>
                  {pendingEvaluationCount > 0 ? <Link href="/player/golf/trainings/to-complete"><span><ClipboardList size={16} /></span><div><b>{pendingEvaluationCount} {pickLocaleText(locale, pendingEvaluationCount === 1 ? "activité à évaluer" : "activités à évaluer", pendingEvaluationCount === 1 ? "activity to evaluate" : "activities to evaluate")}</b><small>{pickLocaleText(locale, "Partager votre ressenti", "Share your feedback")}</small></div><ArrowRight size={14} /></Link> : null}
                  {overviewFtemPercent != null && overviewFtemPercent < 100 ? <button type="button" onClick={() => selectSection("trainings")}><span><Target size={16} /></span><div><b>{pickLocaleText(locale, "Objectif FTEM à poursuivre", "Keep working toward FTEM goal")}</b><small>{Math.max(0, overviewObjective - totalMinutes)} min {pickLocaleText(locale, "restantes", "remaining")}</small></div><ArrowRight size={14} /></button> : null}
                  {newestSharedDocument ? <button type="button" onClick={() => selectSection("documents")}><span><FileText size={16} /></span><div><b>{pickLocaleText(locale, "Document partagé", "Shared document")}</b><small>{newestSharedDocument.file_name}</small></div><ArrowRight size={14} /></button> : null}
                  {incompleteRound ? <Link href={`/player/golf/rounds/${incompleteRound.id}/edit`}><span><Flag size={16} /></span><div><b>{pickLocaleText(locale, "Parcours à compléter", "Round to complete")}</b><small>{incompleteRound.course_name || shortDate(incompleteRound.start_at, dateLocale)}</small></div><ArrowRight size={14} /></Link> : null}
                  {!pendingEvaluationCount && !(overviewFtemPercent != null && overviewFtemPercent < 100) && !newestSharedDocument && !incompleteRound ? <div className={overviewStyles.positiveState}><CalendarCheck2 size={20} /><b>{pickLocaleText(locale, "Tout est à jour", "Everything is up to date")}</b><small>{pickLocaleText(locale, "Aucune action nécessaire pour le moment.", "No action is needed right now.")}</small></div> : null}
                </div>
              </section>
            </div>

            <div className={overviewStyles.splitWide}>
              <section className={overviewStyles.panel}>
                <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Progression sur le parcours", "On-course progress")}</h2><p>{pickLocaleText(locale, "Évolution du score brut et du handicap.", "Gross score and handicap evolution.")}</p></div><button type="button" onClick={() => selectSection("stats")}>{pickLocaleText(locale, "Voir les statistiques", "View statistics")}<ArrowRight size={14} /></button></div>
                {loadingRounds || loadingHoles ? <div className={overviewStyles.chartSkeleton} /> : orderedRounds.length >= 2 ? <ActiviteeEChart height={300} ariaLabel={pickLocaleText(locale, "Progression du score et du handicap", "Score and handicap progress")} option={roundProgressionOption} /> : <div className={overviewStyles.empty}>{pickLocaleText(locale, "Deux parcours au minimum sont nécessaires pour afficher une progression.", "At least two rounds are required to display progress.")}</div>}
              </section>

              <section className={overviewStyles.panel}>
                <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Repères de jeu", "Playing benchmarks")}</h2><p>{pickLocaleText(locale, "Vos résultats sur la période.", "Your results for this period.")}</p></div></div>
                <div className={overviewStyles.benchmarkList}>
                  <div><span>{pickLocaleText(locale, "Score moyen", "Average score")}</span><strong>{holeAgg.avgScore18 ?? "—"}</strong>{keyKpisUI.girArrow != null ? null : <small>{rounds.length} {pickLocaleText(locale, "parcours", "rounds")}</small>}</div>
                  <div><span>GIR</span><strong>{keyKpisUI.girPct == null ? "—" : `${keyKpisUI.girPct}%`}</strong>{keyKpisUI.girArrow != null ? <small className={keyKpisUI.girArrow >= 0 ? overviewStyles.positive : overviewStyles.caution}>{keyKpisUI.girArrow > 0 ? "+" : ""}{round1(keyKpisUI.girArrow)} pts</small> : null}</div>
                  <div><span>{pickLocaleText(locale, "Putts / 18 trous", "Putts / 18 holes")}</span><strong>{keyKpisUI.putts18 ?? "—"}</strong>{keyKpisUI.putts18Arrow != null ? <small className={keyKpisUI.putts18Arrow <= 0 ? overviewStyles.positive : overviewStyles.caution}>{keyKpisUI.putts18Arrow > 0 ? "+" : ""}{round1(keyKpisUI.putts18Arrow)}</small> : null}</div>
                  <div><span>{pickLocaleText(locale, "Secteur le plus performant", "Strongest area")}</span><strong className={overviewStyles.markerValue}>{strongestGameMarker?.label ?? "—"}</strong>{strongestGameMarker ? <small>{strongestGameMarker.value}%</small> : null}</div>
                </div>
              </section>
            </div>

            <section className={overviewStyles.shortcutsSection}>
              <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Raccourcis", "Shortcuts")}</h2><p>{pickLocaleText(locale, "Accédez directement aux actions principales.", "Go directly to key actions.")}</p></div></div>
              <div className={overviewStyles.shortcuts}>
                <Link href="/player/golf/trainings?plan=training"><span><Dumbbell size={18} /></span><b>{pickLocaleText(locale, "Ajouter un entraînement", "Add training")}</b><ArrowRight size={15} /></Link>
                <Link href="/player/golf/rounds/new"><span><Flag size={18} /></span><b>{pickLocaleText(locale, "Saisir un parcours", "Enter a round")}</b><ArrowRight size={15} /></Link>
                <Link href="/player/golf/trainings/to-complete"><span><ClipboardList size={18} /></span><b>{pickLocaleText(locale, "Compléter mes évaluations", "Complete my evaluations")}</b><ArrowRight size={15} /></Link>
                <button type="button" onClick={() => selectSection("documents")}><span><Upload size={18} /></span><b>{pickLocaleText(locale, "Ajouter un document", "Add document")}</b><ArrowRight size={15} /></button>
              </div>
            </section>

            <section className={overviewStyles.panel}>
              <div className={overviewStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Documents récents", "Recent documents")}</h2><p>{pickLocaleText(locale, "Les derniers fichiers disponibles dans votre espace.", "Latest files available in your space.")}</p></div><button type="button" onClick={() => selectSection("documents")}>{pickLocaleText(locale, "Voir tous les documents", "View all documents")}<ArrowRight size={14} /></button></div>
              {loadingDocuments ? <div className={overviewStyles.documentsSkeleton}><span /><span /><span /></div> : recentDocuments.length ? <div className={overviewStyles.documentsGrid}>{recentDocuments.map((document) => { const DocumentIcon = documentPicto(document.mime_type, document.file_name); const extension = document.file_name.includes(".") ? document.file_name.split(".").pop()?.toUpperCase() : pickLocaleText(locale, "Fichier", "File"); return <button type="button" key={document.id} onClick={() => setViewerDocument(document)}><span><DocumentIcon size={18} /></span><div><b>{document.file_name}</b><small>{extension} · {shortDate(document.created_at, dateLocale)}</small></div><ArrowRight size={14} /></button>; })}</div> : <div className={overviewStyles.empty}>{pickLocaleText(locale, "Aucun document disponible.", "No document available.")}</div>}
            </section>
          </div>
        ) : null}

        {activeSection === "trainings" ? (
          <div className={trainingStyles.dashboard}>
            <nav className={trainingStyles.subnav} aria-label={pickLocaleText(locale, "Navigation des entraînements", "Training navigation")}>
              {([
                ["summary", pickLocaleText(locale, "Synthèse", "Overview")],
                ["sessions", pickLocaleText(locale, "Mes séances", "My sessions")],
                ["evaluations", pickLocaleText(locale, "Évaluations", "Evaluations")],
              ] as Array<[TrainingSubview, string]>).map(([id, label]) => (
                <button key={id} type="button" aria-selected={trainingSubview === id} onClick={() => setTrainingSubview(id)}>
                  {label}{id === "evaluations" && pendingEvaluationCount ? ` (${pendingEvaluationCount})` : ""}
                </button>
              ))}
            </nav>

            {trainingSubview === "summary" ? <>
              <section className={trainingStyles.kpis} aria-label={pickLocaleText(locale, "Repères d’entraînement", "Training benchmarks")}>
                <article className={trainingStyles.kpi}>
                  <div className={trainingStyles.kpiTitle}><span><Activity size={17} /></span><h2>{pickLocaleText(locale, "Volume réalisé", "Completed volume")}</h2></div>
                  <strong>{totalMinutes} min</strong>
                  <p>{displayedTrainingCount} {pickLocaleText(locale, displayedTrainingCount === 1 ? "séance" : "séances", displayedTrainingCount === 1 ? "session" : "sessions")}</p>
                  <small className={volumeDelta == null ? "" : volumeDelta >= 0 ? trainingStyles.positive : trainingStyles.caution}>{volumeDelta == null ? pickLocaleText(locale, "Pas de période comparable", "No comparable period") : `${volumeDelta > 0 ? "+" : ""}${volumeDelta}% · ${compareLabel}`}</small>
                </article>

                <article className={trainingStyles.kpi}>
                  <div className={trainingStyles.kpiTitle}><span><Target size={17} /></span><h2>{pickLocaleText(locale, "Objectif FTEM", "FTEM goal")}</h2></div>
                  {overviewFtemPercent == null ? <><strong>—</strong><p>{pickLocaleText(locale, "Aucun objectif disponible", "No goal available")}</p></> : <>
                    <strong>{overviewFtemPercent}%</strong>
                    <div className={trainingStyles.progress}><span style={{ width: `${Math.min(100, overviewFtemPercent)}%` }} /></div>
                    <p>{totalMinutes} / {overviewObjective} min · {trainingVolumeTarget?.ftem_code ?? "FTEM"}</p>
                    <small>{Math.max(0, overviewObjective - totalMinutes)} min {pickLocaleText(locale, "de volume restant à poursuivre", "of volume left to pursue")}{trainingVolumeMotivation ? ` · ${trainingVolumeMotivation}` : ""}</small>
                  </>}
                </article>

                <article className={trainingStyles.kpi}>
                  <div className={trainingStyles.kpiTitle}><span><Repeat2 size={17} /></span><h2>{pickLocaleText(locale, "Régularité", "Consistency")}</h2></div>
                  <strong>{regularity.active} / {regularity.total}</strong>
                  <p>{pickLocaleText(locale, "semaines actives", "active weeks")}</p>
                  <div className={trainingStyles.metrics}><span>{pickLocaleText(locale, "Série actuelle", "Current streak")} · {regularity.current}</span><span>{pickLocaleText(locale, "Meilleure", "Best")} · {regularity.best}</span></div>
                  <small>{prevRange ? `${regularity.active - previousActiveWeeks >= 0 ? "+" : ""}${regularity.active - previousActiveWeeks} ${pickLocaleText(locale, "vs période précédente", "vs previous period")}` : pickLocaleText(locale, "Pas de période comparable", "No comparable period")}</small>
                </article>

                <button type="button" className={trainingStyles.kpi} onClick={() => setTrainingSubview("evaluations")}>
                  <div className={trainingStyles.kpiTitle}><span><ClipboardList size={17} /></span><h2>{pickLocaleText(locale, "Évaluations", "Evaluations")}</h2></div>
                  <strong>{pendingEvaluationCount}</strong>
                  <p>{pickLocaleText(locale, pendingEvaluationCount === 1 ? "auto-évaluation en attente" : "auto-évaluations en attente", pendingEvaluationCount === 1 ? "self-evaluation pending" : "self-evaluations pending")}</p>
                  <div className={trainingStyles.metrics}><span>{evaluatedSessions.length} {pickLocaleText(locale, "complétées", "completed")}</span><span>{coachEvaluations.length} {pickLocaleText(locale, "retours coach", "coach reviews")}</span></div>
                  <small>{pickLocaleText(locale, "Ouvrir le suivi", "Open evaluation tracking")} <ArrowRight size={12} /></small>
                </button>
              </section>

              <div className={trainingStyles.split}>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume et rythme hebdomadaire", "Weekly volume and rhythm")}</h2><p>{periodLabel} · {pickLocaleText(locale, "volumes empilés par origine", "volume stacked by source")}</p></div><Link href="/player/golf/trainings">{pickLocaleText(locale, "Voir le calendrier", "View calendar")}<ArrowRight size={14} /></Link></div>
                  {loading ? <div className={trainingStyles.empty}>{t("common.loading")}</div> : trainingWeeklyRows.length ? <ActiviteeEChart height={310} ariaLabel={pickLocaleText(locale, "Volume hebdomadaire par origine et objectif FTEM", "Weekly volume by source and FTEM goal")} option={trainingVolumeOption} /> : <div className={trainingStyles.empty}>{t("common.noData")}</div>}
                </section>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Points d’attention", "Points of attention")}</h2><p>{pickLocaleText(locale, "Actions utiles liées à vos séances.", "Useful actions related to your sessions.")}</p></div></div>
                  <div className={trainingStyles.attentionList}>
                    {pendingEvaluationCount ? <Link href="/player/golf/trainings/to-complete"><span><ClipboardList size={16} /></span><div><b>{pendingEvaluationCount} {pickLocaleText(locale, pendingEvaluationCount === 1 ? "activité à évaluer" : "activités à évaluer", pendingEvaluationCount === 1 ? "activity to evaluate" : "activities to evaluate")}</b><small>{pickLocaleText(locale, "Compléter mon ressenti", "Complete my feedback")}</small></div><ArrowRight size={14} /></Link> : null}
                    {latestCoachEvaluation?.player_note ? <button type="button" onClick={() => setTrainingSubview("evaluations")}><span><MessageSquareText size={16} /></span><div><b>{pickLocaleText(locale, "Nouveau retour du coach", "New coach feedback")}</b><small>{latestCoachEvaluation.title || shortDate(latestCoachEvaluation.starts_at, dateLocale)}</small></div><ArrowRight size={14} /></button> : null}
                    {overviewFtemPercent != null && overviewFtemPercent < 100 ? <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span><Target size={16} /></span><div><b>{pickLocaleText(locale, "Objectif FTEM à poursuivre", "Keep pursuing the FTEM goal")}</b><small>{Math.max(0, overviewObjective - totalMinutes)} min {pickLocaleText(locale, "restantes", "remaining")}</small></div><ArrowRight size={14} /></button> : null}
                    {!pendingEvaluationCount && !latestCoachEvaluation?.player_note && !(overviewFtemPercent != null && overviewFtemPercent < 100) ? <div className={trainingStyles.empty}><CheckCircle2 size={20} />{pickLocaleText(locale, "Tout est à jour pour le moment.", "Everything is up to date for now.")}</div> : null}
                  </div>
                </section>
              </div>

              <div className={trainingStyles.twoPanels}>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Répartition des secteurs travaillés", "Training area breakdown")}</h2><p>{pickLocaleText(locale, "Durée et part du volume total.", "Duration and share of total volume.")}</p></div></div>
                  {sectorRows.length ? <ActiviteeEChart height={Math.max(250, sectorRows.length * 42)} ariaLabel={pickLocaleText(locale, "Répartition du volume par secteur", "Volume breakdown by training area")} option={sectorChartOption} /> : <div className={trainingStyles.empty}>{pickLocaleText(locale, "Aucun secteur documenté sur cette période.", "No training area documented for this period.")}</div>}
                </section>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Régularité sur 12 semaines", "Consistency over 12 weeks")}</h2><p>{regularity.current} {pickLocaleText(locale, "semaine(s) dans la série actuelle", "week(s) in the current streak")}</p></div></div>
                  {trainingWeeklyRows.length ? <ActiviteeEChart height={250} ariaLabel={pickLocaleText(locale, "Intensité du volume sur les douze dernières semaines", "Training volume intensity over the last twelve weeks")} option={regularityOption} /> : <div className={trainingStyles.empty}>{t("common.noData")}</div>}
                </section>
              </div>

              <div className={trainingStyles.twoPanels}>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Ressenti du joueur", "Player feedback")}</h2><p>{evaluationRate == null ? pickLocaleText(locale, "Données insuffisantes", "Insufficient data") : `${evaluationRate}% ${pickLocaleText(locale, "des séances auto-évaluées", "of sessions self-evaluated")}`}</p></div></div>
                  <div className={trainingStyles.scoreGrid}><div><span>{t("common.motivation")}</span><strong>{avgMotivation ?? "—"}</strong></div><div><span>{t("common.difficulty")}</span><strong>{avgDifficulty ?? "—"}</strong></div><div><span>{t("common.satisfaction")}</span><strong>{avgSatisfaction ?? "—"}</strong></div><div><span>{pickLocaleText(locale, "Réponses", "Responses")}</span><strong>{evaluatedSessions.length}</strong></div></div>
                  {evaluatedSessions.length >= 2 ? <ActiviteeEChart height={260} ariaLabel={pickLocaleText(locale, "Évolution hebdomadaire du ressenti", "Weekly feedback trend")} option={buildManagementLineChartOption({ labels: weekSeries.map((row) => row.weekLabel), min: 0, max: 6, series: [{ name: t("common.motivation"), data: weekSeries.map((row) => row.motivation), color: MANAGEMENT_CHART_COLORS[0] }, { name: t("common.difficulty"), data: weekSeries.map((row) => row.difficulty), color: MANAGEMENT_CHART_COLORS[2], dashed: true }, { name: t("common.satisfaction"), data: weekSeries.map((row) => row.satisfaction), color: MANAGEMENT_CHART_COLORS[1] }] })} /> : <div className={trainingStyles.empty}>{pickLocaleText(locale, "Données insuffisantes pour afficher une tendance.", "Insufficient data to display a trend.")}</div>}
                </section>
                <section className={trainingStyles.panel}>
                  <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Regard du coach", "Coach perspective")}</h2><p>{coachEvaluations.length} {pickLocaleText(locale, "évaluation(s) reçue(s)", "evaluation(s) received")}</p></div></div>
                  <div className={trainingStyles.scoreGrid}><div><span>{pickLocaleText(locale, "Engagement", "Engagement")}</span><strong>{avgCoachEngagement ?? "—"}</strong></div><div><span>{pickLocaleText(locale, "Attitude", "Attitude")}</span><strong>{avgCoachAttitude ?? "—"}</strong></div><div><span>{pickLocaleText(locale, "Application", "Application")}</span><strong>{avgCoachApplication ?? "—"}</strong></div><div><span>{pickLocaleText(locale, "Retours", "Reviews")}</span><strong>{coachEvaluations.length}</strong></div></div>
                  {customCoachCriteriaSummary.length ? <div className={trainingStyles.customCriteria}>{customCoachCriteriaSummary.map((criterion) => <div key={criterion.name}><span>{criterion.name}</span><b>{typeof criterion.value === "boolean" ? (criterion.value ? pickLocaleText(locale, "Oui", "Yes") : pickLocaleText(locale, "Non", "No")) : criterion.value ?? "—"}</b></div>)}</div> : null}
                  {coachEvaluations.length >= 2 ? <ActiviteeEChart height={260} ariaLabel={pickLocaleText(locale, "Tendance des évaluations du coach", "Coach evaluation trend")} option={buildManagementLineChartOption({ labels: coachEvalTrendSeries.map((row) => row.point), min: 0, max: 6, series: [{ name: "Engagement", data: coachEvalTrendSeries.map((row) => row.engagement), color: MANAGEMENT_CHART_COLORS[0] }, { name: "Attitude", data: coachEvalTrendSeries.map((row) => row.attitude), color: MANAGEMENT_CHART_COLORS[3] }, { name: "Application", data: coachEvalTrendSeries.map((row) => row.application), color: MANAGEMENT_CHART_COLORS[2] }] })} /> : <div className={trainingStyles.empty}>{pickLocaleText(locale, "Données insuffisantes pour afficher une tendance.", "Insufficient data to display a trend.")}</div>}
                </section>
              </div>

              <section className={trainingStyles.panel}>
                <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Regards croisés", "Combined perspectives")}</h2><p>{pickLocaleText(locale, "Deux perspectives présentées sans créer de score artificiel.", "Two perspectives shown without creating an artificial score.")}</p></div></div>
                <div className={trainingStyles.crossed}>
                  <article className={trainingStyles.perspective}><h3>{pickLocaleText(locale, "Ressenti du joueur", "Player feedback")}</h3>{latestEvaluatedSession ? <><dl><dt>{t("common.motivation")}</dt><dd>{latestEvaluatedSession.motivation}/6</dd><dt>{t("common.difficulty")}</dt><dd>{latestEvaluatedSession.difficulty}/6</dd><dt>{t("common.satisfaction")}</dt><dd>{latestEvaluatedSession.satisfaction}/6</dd></dl><p>{latestEvaluatedSession.notes || pickLocaleText(locale, "Aucun commentaire personnel.", "No personal comment.")}</p></> : <p>{pickLocaleText(locale, "Aucune auto-évaluation disponible.", "No self-evaluation available.")}</p>}</article>
                  <article className={trainingStyles.perspective}><h3>{pickLocaleText(locale, "Regard du coach", "Coach perspective")}</h3>{latestCoachEvaluation ? <><dl><dt>{pickLocaleText(locale, "Engagement", "Engagement")}</dt><dd>{latestCoachEvaluation.engagement ?? "—"}/6</dd><dt>{pickLocaleText(locale, "Attitude", "Attitude")}</dt><dd>{latestCoachEvaluation.attitude ?? "—"}/6</dd><dt>{pickLocaleText(locale, "Application", "Application")}</dt><dd>{latestCoachEvaluation.application ?? "—"}/6</dd></dl><p>{latestCoachEvaluation.player_note || pickLocaleText(locale, "Aucun commentaire visible.", "No visible comment.")}</p></> : <p>{pickLocaleText(locale, "Aucune évaluation coach disponible.", "No coach evaluation available.")}</p>}</article>
                </div>
              </section>

              {sectorRows.length ? <section className={trainingStyles.panel}>
                <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Analyse par secteur", "Analysis by training area")}</h2><p>{pickLocaleText(locale, "Les tendances ne sont affichées qu’avec une période comparable.", "Trends are only shown with a comparable period.")}</p></div></div>
                <div className={trainingStyles.tableWrap}><table className={trainingStyles.table}><thead><tr><th>{pickLocaleText(locale, "Secteur", "Area")}</th><th>{pickLocaleText(locale, "Volume", "Volume")}</th><th>{pickLocaleText(locale, "Séances", "Sessions")}</th><th>{pickLocaleText(locale, "Satisfaction", "Satisfaction")}</th><th>{pickLocaleText(locale, "Tendance volume", "Volume trend")}</th></tr></thead><tbody>{sectorRows.map((row) => <tr key={row.category}><td><b>{row.label}</b></td><td>{row.minutes} min · {row.percent}%</td><td>{row.sessions}</td><td>{row.satisfaction == null ? "—" : `${row.satisfaction}/6`}</td><td>{row.delta == null ? "—" : `${row.delta > 0 ? "+" : ""}${row.delta}%`}</td></tr>)}</tbody></table></div>
              </section> : null}

              {trainingRoundObservation ? <section className={trainingStyles.panel}><div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Relation entraînement–parcours", "Training–round relationship")}</h2><p>{pickLocaleText(locale, "Observation descriptive sur les 14 jours précédant un parcours.", "Descriptive observation over the 14 days preceding a round.")}</p></div></div><p className={trainingStyles.observation}>{pickLocaleText(locale, `Sur ${trainingRoundObservation.sampleSize} parcours, les périodes comprenant au moins deux séances (${trainingRoundObservation.averageMinutes} min en moyenne) sont associées à un score moyen de ${trainingRoundObservation.regularScore}, contre ${trainingRoundObservation.lighterScore} pour les autres périodes. Écart observé : ${trainingRoundObservation.difference > 0 ? "+" : ""}${trainingRoundObservation.difference} coup(s). Cette association ne démontre pas un lien de causalité.`, `Across ${trainingRoundObservation.sampleSize} rounds, periods with at least two sessions (${trainingRoundObservation.averageMinutes} average minutes) are associated with an average score of ${trainingRoundObservation.regularScore}, compared with ${trainingRoundObservation.lighterScore} for other periods. Observed difference: ${trainingRoundObservation.difference > 0 ? "+" : ""}${trainingRoundObservation.difference} stroke(s). This association does not establish causality.`)}</p></section> : null}

              <section className={trainingStyles.panel}><div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Retours récents", "Recent feedback")}</h2><p>{pickLocaleText(locale, "Les derniers éléments utiles, sans dupliquer l’historique.", "Latest useful items without duplicating history.")}</p></div></div>{latestCoachEvaluation || latestEvaluatedSession ? <div className={trainingStyles.recent}><span className={trainingStyles.recentIcon}><MessageSquareText size={16} /></span><div><b>{latestCoachEvaluation?.player_note || latestEvaluatedSession?.notes || pickLocaleText(locale, "Évaluation complétée", "Evaluation completed")}</b><small>{shortDate(latestCoachEvaluation?.starts_at || latestEvaluatedSession?.start_at || new Date().toISOString(), dateLocale)} · {latestCoachEvaluation?.title || pickLocaleText(locale, "Séance d’entraînement", "Training session")}</small></div><button type="button" onClick={() => setTrainingSubview("evaluations")}>{pickLocaleText(locale, "Voir", "View")}<ArrowRight size={13} /></button></div> : <div className={trainingStyles.empty}>{t("common.noData")}</div>}</section>
            </> : null}

            {trainingSubview === "sessions" ? <section className={trainingStyles.panel}>
              <div className={trainingStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Historique des séances", "Session history")}</h2><p>{periodLabel} · {sessions.length} {pickLocaleText(locale, "séance(s)", "session(s)")}</p></div><Link href="/player/golf/trainings?plan=training">{pickLocaleText(locale, "Ajouter un entraînement", "Add training")}<ArrowRight size={14} /></Link></div>
              <div className={trainingStyles.historyFilters}>
                <label><span>{pickLocaleText(locale, "Origine", "Source")}</span><select value={trainingOriginFilter} onChange={(event) => setTrainingOriginFilter(event.target.value as "all" | SessionType)}><option value="all">{pickLocaleText(locale, "Toutes", "All")}</option><option value="club">Club</option><option value="private">{pickLocaleText(locale, "Cours privé", "Private lesson")}</option><option value="individual">{pickLocaleText(locale, "Individuel", "Individual")}</option></select></label>
                <label><span>{pickLocaleText(locale, "Secteur", "Area")}</span><select value={trainingSectorFilter} onChange={(event) => setTrainingSectorFilter(event.target.value)}><option value="all">{pickLocaleText(locale, "Tous", "All")}</option>{sectorRows.map((row) => <option key={row.category} value={row.category}>{row.label}</option>)}</select></label>
                <label><span>{pickLocaleText(locale, "Évaluation", "Evaluation")}</span><select value={trainingStatusFilter} onChange={(event) => setTrainingStatusFilter(event.target.value as "all" | "pending" | "completed")}><option value="all">{pickLocaleText(locale, "Tous les statuts", "All statuses")}</option><option value="pending">{pickLocaleText(locale, "À évaluer", "To evaluate")}</option><option value="completed">{pickLocaleText(locale, "Terminées", "Completed")}</option></select></label>
              </div>
              {filteredHistorySessions.length ? <div className={trainingStyles.tableWrap}><table className={trainingStyles.table}><thead><tr><th>{pickLocaleText(locale, "Date", "Date")}</th><th>{pickLocaleText(locale, "Origine", "Source")}</th><th>{pickLocaleText(locale, "Durée", "Duration")}</th><th>{pickLocaleText(locale, "Secteurs", "Areas")}</th><th>{pickLocaleText(locale, "Coach", "Coach")}</th><th>{pickLocaleText(locale, "Ressenti", "Feedback")}</th><th>{pickLocaleText(locale, "Statut", "Status")}</th><th /></tr></thead><tbody>{[...filteredHistorySessions].sort((a, b) => b.start_at.localeCompare(a.start_at)).map((session) => { const categories = [...new Set(items.filter((item) => item.session_id === session.id).map((item) => t(`cat.${item.category}`)))]; const complete = evaluatedSessions.some((item) => item.id === session.id); const hasCoach = session.club_event_id ? coachEvaluations.some((evaluation) => evaluation.event_id === session.club_event_id) : false; return <tr key={session.id}><td><b>{shortDate(session.start_at, dateLocale)}</b></td><td>{typeLabelLong(session.session_type, t)}</td><td>{sessionMinutesById.get(session.id) ?? 0} min</td><td>{categories.join(", ") || "—"}</td><td>{session.coach_name || "—"}</td><td>{session.satisfaction == null ? "—" : `${session.satisfaction}/6`}</td><td><span className={`${trainingStyles.tag} ${complete ? "" : trainingStyles.warningTag}`}>{complete ? pickLocaleText(locale, "Auto-évaluée", "Self-evaluated") : pickLocaleText(locale, "À évaluer", "To evaluate")}</span>{hasCoach ? <span className={trainingStyles.tag}>{pickLocaleText(locale, "Coach reçu", "Coach review")}</span> : null}</td><td><Link href={`/player/golf/trainings/${session.id}`}>{pickLocaleText(locale, "Ouvrir", "Open")}</Link></td></tr>; })}</tbody></table></div> : <div className={trainingStyles.empty}>{pickLocaleText(locale, "Aucune séance ne correspond aux filtres.", "No session matches these filters.")}</div>}
            </section> : null}

            {trainingSubview === "evaluations" ? <section className={trainingStyles.panel}>
              <div className={trainingStyles.evaluationToolbar}><div className={trainingStyles.panelHeader} style={{ borderBottom: 0, paddingBottom: 0 }}><div><h2>{pickLocaleText(locale, "Suivi des évaluations", "Evaluation tracking")}</h2><p>{periodLabel} · {pickLocaleText(locale, "auto-évaluations et retours du coach", "self-evaluations and coach feedback")}</p></div></div><div className={trainingStyles.filterButtons}>{(["all", "pending", "completed"] as EvaluationFilter[]).map((filter) => <button key={filter} type="button" aria-pressed={evaluationFilter === filter} onClick={() => setEvaluationFilter(filter)}>{filter === "all" ? pickLocaleText(locale, "Toutes", "All") : filter === "pending" ? pickLocaleText(locale, "À compléter", "Pending") : pickLocaleText(locale, "Terminées", "Completed")}</button>)}</div></div>
              <div className={trainingStyles.evaluationList}>
                {evaluationFilter !== "completed" && pendingEvaluationCount > 0 ? <div className={trainingStyles.evaluationRow}><div><b>{pendingEvaluationCount} {pickLocaleText(locale, pendingEvaluationCount === 1 ? "activité attend votre auto-évaluation" : "activités attendent votre auto-évaluation", pendingEvaluationCount === 1 ? "activity awaits your self-evaluation" : "activities await your self-evaluation")}</b><small>{pickLocaleText(locale, "Motivation, difficulté, satisfaction et structure de séance", "Motivation, difficulty, satisfaction and session structure")}</small></div><Link href="/player/golf/trainings/to-complete">{pickLocaleText(locale, "Voir les activités", "View activities")}<ArrowRight size={13} /></Link></div> : null}
                {evaluationFilter !== "pending" ? filteredEvaluationSessions.map((session) => { const coach = session.club_event_id ? coachEvaluations.find((evaluation) => evaluation.event_id === session.club_event_id) : null; return <div className={trainingStyles.evaluationRow} key={session.id}><div><b>{shortDate(session.start_at, dateLocale)} · {typeLabelLong(session.session_type, t)}</b><small>{pickLocaleText(locale, "Auto-évaluation", "Self-evaluation")} · M {session.motivation}/6 · D {session.difficulty}/6 · S {session.satisfaction}/6{coach ? ` · ${pickLocaleText(locale, "Retour coach reçu", "Coach review received")}` : ""}</small>{coach?.player_note ? <small>{coach.player_note}</small> : null}</div><Link href={`/player/golf/trainings/${session.id}`}>{pickLocaleText(locale, "Détail", "Details")}<ArrowRight size={13} /></Link></div>; }) : null}
                {((evaluationFilter === "pending" && pendingEvaluationCount === 0) || (evaluationFilter === "completed" && !filteredEvaluationSessions.length) || (evaluationFilter === "all" && pendingEvaluationCount === 0 && !filteredEvaluationSessions.length)) ? <div className={trainingStyles.empty}>{pickLocaleText(locale, "Aucune évaluation dans ce filtre.", "No evaluation matches this filter.")}</div> : null}
              </div>
            </section> : null}
          </div>
        ) : null}

        {/* ===== Ancienne présentation entraînements, conservée hors rendu pendant la transition ===== */}
        {false ? (
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div className="glass-card" style={{ gridColumn: "1 / -1" }}>
              <div className="card-title">{volumeCardTitle}</div>

              {loading ? (
                <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                  <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: showMonthlyObjective ? "1.2fr 0.8fr" : "1fr",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div>
                        <CountUpNumber value={totalMinutes} durationMs={2000} className="big-number" />
                        <span className="unit">MIN</span>
                      </div>
                      {showMonthlyObjective ? (
                        <div style={{ marginTop: 8, fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>
                          {t("playerHome.goal")}: {displayedTrainingVolumeObjective} {t("common.min")}
                        </div>
                      ) : null}
                      {trainingVolumeMotivation ? (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>
                          {trainingVolumeMotivation}
                        </div>
                      ) : null}
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="pill-soft player-meta-with-icon"><Flag size={14} aria-hidden="true" /> {displayedTrainingCount} {t("golfDashboard.sessions")}</span>
                        {showMonthlyObjective && trainingVolumeGoalReached ? (
                          <span className="pill-soft" style={{ background: "rgba(47,125,79,0.14)", color: "rgba(16,94,51,1)", fontWeight: 950 }}>
                            {pickLocaleText(locale, "Objectif atteint", "Goal reached")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="donut-wrap">
                      {showMonthlyObjective ? <ProgressDonut percent={trainingVolumePercent} size={168} /> : null}
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

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>

          </div>
        </div>
        ) : null}

        {/* ===== Graphes trainings ===== */}
        {false ? (
        <div className="glass-section">
          <div className="glass-card">
            <div className="card-title">{t("golfDashboard.weeklyVolume")}</div>

            {weekSeries.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <ActiviteeEChart
                ariaLabel={pickLocaleText(locale, "Volume hebdomadaire d’entraînement en minutes", "Weekly training volume in minutes")}
                option={buildManagementVolumeChartOption({
                  labels: weekSeries.map((item) => item.weekLabel),
                  values: weekSeries.map((item) => Number(item.minutes ?? 0)),
                  valueLabel: t("golfDashboard.minutesPerWeek"),
                  objective: weekSeries.map((item) => typeof item.objective === "number" ? item.objective : null),
                  objectiveLabel: pickLocaleText(locale, "Objectif", "Goal"),
                })}
              />
            )}
            {weekSeries.some((item) => Number(item.objective ?? 0) > 0) ? (
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>
                {pickLocaleText(locale, "Objectif hebdomadaire", "Weekly goal")}:
                {" "}
                {pickLocaleText(
                  locale,
                  "calculé semaine par semaine selon l'historique HCP",
                  "calculated week by week from handicap history"
                )}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}

        {false && isPerformanceEnabled ? (
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
        ) : null}

        {false ? (
        <>
          {isPerformanceEnabled ? (
            <div className="glass-section">
              <div className="glass-card">
                <div className="card-title">Sensations du joueur (Moyenne)</div>

                {sessions.length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 14 }}>
                    <RatingBar icon={<Flame size={16} />} label={t("common.motivation")} value={avgMotivation} delta={deltaMot} />
                    <RatingBar icon={<Mountain size={16} />} label={t("common.difficulty")} value={avgDifficulty} delta={deltaDif} />
                    <RatingBar icon={<Smile size={16} />} label={t("common.satisfaction")} value={avgSatisfaction} delta={deltaSat} />

                    {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isPerformanceEnabled ? (
            <div className="glass-section">
              <div className="glass-card">
                <div className="card-title">{t("golfDashboard.weeklyFeelingTrend")}</div>

                {weekSeries.length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
                ) : (
                  <ActiviteeEChart
                    height={280}
                    ariaLabel={pickLocaleText(locale, "Évolution hebdomadaire des sensations", "Weekly feeling trend")}
                    option={buildManagementLineChartOption({
                      labels: weekSeries.map((item) => item.weekLabel),
                      min: 0,
                      max: 6,
                      series: [
                        { name: t("common.motivation"), data: weekSeries.map((item) => item.motivation), color: MANAGEMENT_CHART_COLORS[0] },
                        { name: t("common.difficulty"), data: weekSeries.map((item) => item.difficulty), color: MANAGEMENT_CHART_COLORS[2], dashed: true },
                        { name: t("common.satisfaction"), data: weekSeries.map((item) => item.satisfaction), color: MANAGEMENT_CHART_COLORS[1] },
                      ],
                    })}
                  />
                )}
              </div>
            </div>
          ) : null}

          <div className="glass-section">
            <div className="glass-card">
              <div className="card-title">Évaluations moyennes du coach</div>

              {loadingCoachEvaluations ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : coachEvaluations.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <RatingBar icon={<Flame size={16} />} label="Engagement" value={avgCoachEngagement} />
                  <RatingBar icon={<Mountain size={16} />} label="Attitude" value={avgCoachAttitude} />
                  <RatingBar icon={<Smile size={16} />} label="Application" value={avgCoachApplication} />
                </div>
              )}
            </div>
          </div>

          <div className="glass-section">
            <div className="glass-card">
              <div className="card-title">Tendances d’évaluation du coach</div>

              {loadingCoachEvaluations ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : coachEvaluations.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
              ) : (
                <ActiviteeEChart
                  height={280}
                  ariaLabel="Évolution des évaluations du coach"
                  option={buildManagementLineChartOption({
                    labels: coachEvalTrendSeries.map((item) => item.point),
                    min: 0,
                    max: 6,
                    series: [
                      { name: "Engagement", data: coachEvalTrendSeries.map((item) => item.engagement), color: MANAGEMENT_CHART_COLORS[0] },
                      { name: "Attitude", data: coachEvalTrendSeries.map((item) => item.attitude), color: MANAGEMENT_CHART_COLORS[3] },
                      { name: "Application", data: coachEvalTrendSeries.map((item) => item.application), color: MANAGEMENT_CHART_COLORS[2] },
                    ],
                  })}
                />
              )}
            </div>
          </div>

          <div className="glass-section">
            <div className="glass-card">
              <div className="card-title">Notes du coach</div>

              {loadingCoachEvaluations ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : coachEvaluationNotes.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune note coach visible.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {coachEvaluationNotes.map((row) => (
                    <div
                      key={row.event_id}
                      style={{
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.78)",
                        padding: "10px 12px",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800, fontSize: 11, color: "rgba(0,0,0,0.62)" }}>
                          {shortDate(row.starts_at, dateLocale)}
                          {row.event_type ? ` • ${row.event_type === "camp" ? "Stage/Camp" : "Entraînement"}` : ""}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                          Eng. {row.engagement ?? "—"} • Att. {row.attitude ?? "—"} • App. {row.application ?? "—"}
                        </div>
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.45, color: "rgba(0,0,0,0.74)" }}>{row.player_note}</div>

                      {row.sessionId ? (
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <Link className="btn" href={`/player/golf/trainings/${row.sessionId}`}>
                            Voir le détail de l’entraînement
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
        ) : null}

        {activeSection === "rounds" ? <GolfRoundsWorkspace /> : null}

        {/* ===== MES PARCOURS — Cards ===== */}
        {activeSection === "stats" ? (
        <div className="glass-section">
          <div className={kpiGridClass} style={kpiGridStyle}>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              }}
            >
              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.72)",
                  borderRadius: 16,
                  padding: "18px 12px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 950,
                    lineHeight: 1,
                    color: "#111111",
                  }}
                >
                  <CountUpNumber value={rounds.length} durationMs={900} style={{ color: "#111111" }} />
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    fontWeight: 900,
                    letterSpacing: 1,
                    color: "#111111",
                  }}
                >
                  {t("playerHome.rounds").toUpperCase()}
                </div>
              </div>

              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.72)",
                  borderRadius: 16,
                  padding: "18px 12px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 950,
                    lineHeight: 1,
                    color: "#111111",
                  }}
                >
                  <CountUpNumber value={holeAgg.holesPlayed} durationMs={1200} style={{ color: "#111111" }} />
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    fontWeight: 900,
                    letterSpacing: 1,
                    color: "#111111",
                  }}
                >
                  {t("playerHome.holes").toUpperCase()}
                </div>
              </div>
            </div>

            {/* Card 1: Répartition des scores (n + % + trend arrow) */}
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
                    <div style={miniLeft}>{pickLocaleText(locale, "Score moyen", "Average score")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{holeAgg.avgScore18 == null ? "—" : `${holeAgg.avgScore18}`}</div>
                      {prevRange ? deltaArrow((holeAgg.avgScore18 ?? 0) - (prevHoleAgg.avgScore18 ?? 0)) : null}
                    </div>
                  </div>

                  <div style={miniRow}>
                    <div style={miniLeft}>{pickLocaleText(locale, "Nombre de putts (sur 18 trous)", "Putts (18 holes)")}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <div style={miniRight}>{keyKpisUI.putts18 == null ? "—" : `${keyKpisUI.putts18}`}</div>
                      {prevRange ? deltaArrow(keyKpisUI.putts18Arrow ?? null) : null}
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

                  {compareLabel && <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{compareLabel}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
        ) : null}

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
            background: "rgba(0,0,0,0.46)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setViewerDocument(null)}
        >
          <div
            style={{
              width: "min(1200px, 100%)",
              height: "min(94vh, 1100px)",
              borderRadius: 14,
              background: "white",
              border: "1px solid rgba(0,0,0,0.12)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.28)",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 900, minWidth: 0 }} className="truncate">
                {viewerDocument.file_name}
              </div>
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <a className="btn" href={viewerDocument.public_url} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
                <button className="btn" type="button" onClick={() => setViewerDocument(null)} aria-label="Fermer">
                  Fermer
                </button>
              </div>
            </div>
            <div style={{ padding: 10, overflow: "auto", background: "rgba(248,250,252,1)" }}>
              {(viewerDocument.mime_type ?? "").startsWith("image/") ? (
                <img
                  src={viewerDocument.public_url}
                  alt={viewerDocument.file_name}
                  style={{ width: "100%", height: "auto", borderRadius: 10, display: "block" }}
                />
              ) : (viewerDocument.mime_type ?? "").startsWith("video/") ? (
                <div style={{ display: "grid", placeItems: "center" }}>
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
                  style={{ width: "100%", height: "calc(94vh - 120px)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, background: "white" }}
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
  background: "rgba(255,255,255,0.72)",
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
  background: "rgba(255,255,255,0.72)",
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
