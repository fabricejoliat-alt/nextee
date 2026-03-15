"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import CountUpNumber from "@/components/ui/CountUpNumber";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
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
  ReferenceLine,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Flame,
  Mountain,
  Smile,
  CalendarRange,
  SlidersHorizontal,
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

type TeamThreadMessage = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
  sender_name?: string | null;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
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

type Preset = "week" | "month" | "last3" | "all" | "custom";
type DashboardSection = "trainings" | "rounds" | "stats" | "thread" | "documents";

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

function eventStartKey(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 16);
}

export default function GolfDashboardPage() {
  const { t, locale } = useI18n();
  const dateLocale = pickLocaleText(locale, "fr-CH", "en-US");
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<DashboardSection>("trainings");
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
  const [trainingVolumeRows, setTrainingVolumeRows] = useState<TrainingVolumeTargetRow[]>([]);
  const [trainingSeasonMonths, setTrainingSeasonMonths] = useState<number[]>([]);
  const [trainingOffseasonMonths, setTrainingOffseasonMonths] = useState<number[]>([]);

  const [preset, setPreset] = useState<Preset>("month");
  const [customOpen, setCustomOpen] = useState(false);

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [sessions, setSessions] = useState<TrainingSessionRow[]>([]);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  const [prevSessions, setPrevSessions] = useState<TrainingSessionRow[]>([]);
  const [clubEventDurationById, setClubEventDurationById] = useState<Record<string, number>>({});
  const [clubEventDurationByStartKey, setClubEventDurationByStartKey] = useState<Record<string, number>>({});

  const [rounds, setRounds] = useState<GolfRoundRow[]>([]);
  const [prevRounds, setPrevRounds] = useState<GolfRoundRow[]>([]);

  const [holes, setHoles] = useState<GolfHoleRow[]>([]);
  const [prevHoles, setPrevHoles] = useState<GolfHoleRow[]>([]);

  const [sessionsLookback, setSessionsLookback] = useState<TrainingSessionRow[]>([]);
  const [itemsLookback, setItemsLookback] = useState<TrainingItemRow[]>([]);
  const [teamThreadId, setTeamThreadId] = useState<string>("");
  const [teamMessages, setTeamMessages] = useState<TeamThreadMessage[]>([]);
  const [teamComposer, setTeamComposer] = useState("");
  const [teamProfilesById, setTeamProfilesById] = useState<Record<string, ProfileLite>>({});
  const [teamParticipantNames, setTeamParticipantNames] = useState<string[]>([]);
  const authTokenRef = useRef<string>("");
  const [loadingTeamThread, setLoadingTeamThread] = useState(false);
  const [loadingTeamMessages, setLoadingTeamMessages] = useState(false);
  const [sendingTeamMessage, setSendingTeamMessage] = useState(false);
  const [deletingTeamMessageId, setDeletingTeamMessageId] = useState("");
  const [documents, setDocuments] = useState<PlayerDashboardDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string>("");
  const [deletingDocumentId, setDeletingDocumentId] = useState<string>("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState<string>("");
  const [viewerDocument, setViewerDocument] = useState<PlayerDashboardDocument | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const teamMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

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
              const seasonMonths = parseMonthArray(json?.settings?.season_months);
              const offseasonMonths = parseMonthArray(json?.settings?.offseason_months);
              const target = pickTrainingVolumeTarget(typeof handicap === "number" ? handicap : null, rows);
              const objective = objectiveForMonth(target, seasonMonths, offseasonMonths, month);
              return { rows, seasonMonths, offseasonMonths, objective };
            })
          );

          const best = responses
            .filter((x): x is { rows: TrainingVolumeTargetRow[]; seasonMonths: number[]; offseasonMonths: number[]; objective: number } => Boolean(x))
            .sort((a, b) => b.objective - a.objective)[0];

          if (best) {
            setTrainingVolumeRows(best.rows);
            setTrainingSeasonMonths(best.seasonMonths);
            setTrainingOffseasonMonths(best.offseasonMonths);
          } else {
            setTrainingVolumeRows([]);
            setTrainingSeasonMonths([]);
            setTrainingOffseasonMonths([]);
          }
        } else {
          setTrainingVolumeRows([]);
          setTrainingSeasonMonths([]);
          setTrainingOffseasonMonths([]);
        }
      } catch {
        setIsPerformanceEnabled(false);
        setPlayerHandicap(null);
        setTrainingVolumeRows([]);
        setTrainingSeasonMonths([]);
        setTrainingOffseasonMonths([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentUserId(String(data.user?.id ?? ""));
    })();
  }, []);

  function shortDate(iso: string, localeCode: string) {
    return new Intl.DateTimeFormat(localeCode, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
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

  async function getAuthToken(): Promise<string> {
    if (authTokenRef.current) return authTokenRef.current;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? "";
    if (token) authTokenRef.current = token;
    return token;
  }

  async function loadTeamThreadMessages(threadId: string, options?: { silent?: boolean }) {
    if (!threadId) {
      setTeamMessages([]);
      return;
    }
    if (!options?.silent) setLoadingTeamMessages(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("Missing token");
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/messages?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String((json as any)?.error ?? "Load failed"));
      const msgs = (((json as any)?.messages ?? []) as TeamThreadMessage[]).slice().reverse();
      setTeamMessages(msgs);

      const senderIds = Array.from(new Set(msgs.map((m) => String(m.sender_user_id ?? "")).filter(Boolean)));
      const missing = senderIds.filter((id) => !teamProfilesById[id]);
      if (missing.length > 0) {
        const profRes = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", missing);
        if (!profRes.error) {
          setTeamProfilesById((prev) => {
            const next = { ...prev };
            for (const p of profRes.data ?? []) next[String((p as any).id)] = p as ProfileLite;
            return next;
          });
        }
      }
    } catch {
      setTeamMessages([]);
    } finally {
      if (!options?.silent) setLoadingTeamMessages(false);
    }
  }

  async function loadTeamParticipants(threadId: string) {
    if (!threadId) {
      setTeamParticipantNames([]);
      return;
    }
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/participants`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) return;
      const names: string[] = Array.isArray(json?.participant_full_names)
        ? (json.participant_full_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
        : Array.isArray(json?.participant_names)
          ? (json.participant_names as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean)
          : [];
      setTeamParticipantNames(names);
    } catch {
      setTeamParticipantNames([]);
    }
  }

  async function ensureAndLoadTeamThread() {
    setLoadingTeamThread(true);
    try {
      const { effectiveUserId: playerId } = await resolveEffectivePlayerContext();
      const token = await getAuthToken();
      if (!token || !playerId) throw new Error("Missing context");
      const res = await fetch(`/api/player/team-thread?player_id=${encodeURIComponent(playerId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error ?? "Team thread unavailable"));
      const threadId = String(json?.thread_id ?? "");
      if (!threadId) throw new Error("Team thread unavailable");

      setTeamThreadId(threadId);
      void loadTeamThreadMessages(threadId);
      void loadTeamParticipants(threadId);
    } catch {
      setTeamThreadId("");
      setTeamMessages([]);
      setTeamParticipantNames([]);
    } finally {
      setLoadingTeamThread(false);
    }
  }

  async function loadDocuments() {
    setLoadingDocuments(true);
    try {
      const { effectiveUserId: playerId } = await resolveEffectivePlayerContext();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing context");
      const res = await fetch(`/api/player/documents?player_id=${encodeURIComponent(playerId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error ?? "Load documents error"));
      setDocuments((json?.documents ?? []) as PlayerDashboardDocument[]);
    } catch {
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
          original_name: docFile.name,
          mime_type: docFile.type,
          size_bytes: docFile.size,
        }),
      });
      const prepareJson = await prepareRes.json().catch(() => ({} as any));
      if (!prepareRes.ok) throw new Error(String(prepareJson?.error ?? "Upload failed"));

      const uploadPath = String(prepareJson?.path ?? "").trim();
      const uploadToken = String(prepareJson?.token ?? "").trim();
      if (!uploadPath || !uploadToken) throw new Error("Upload initialization failed");

      const uploadRes = await supabase.storage.from("marketplace").uploadToSignedUrl(
        uploadPath,
        uploadToken,
        docFile,
        {
          upsert: false,
          contentType: docFile.type || "application/octet-stream",
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
          original_name: docFile.name,
          file_name: finalDocName,
          mime_type: docFile.type,
          size_bytes: docFile.size,
        }),
      });
      const json = await finalizeRes.json().catch(() => ({} as any));
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
      const json = await res.json().catch(() => ({} as any));
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
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (viewerDocument?.id === doc.id) setViewerDocument(null);
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingDocumentId("");
    }
  }

  useEffect(() => {
    void getAuthToken();
    void ensureAndLoadTeamThread();
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!teamThreadId) return;
    const channel = supabase
      .channel(`player-team-thread:${teamThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "thread_messages", filter: `thread_id=eq.${teamThreadId}` },
        () => {
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
        const token = sess.session?.access_token ?? authTokenRef.current ?? "";
        if (sess.session?.access_token) authTokenRef.current = sess.session.access_token;
        if (!token) return;
        const res = await fetch(`/api/messages/threads/${encodeURIComponent(teamThreadId)}/messages?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok) return;
        const latest = (json?.messages?.[0] ?? null) as any;
        if (!latest?.id) return;
        const latestId = String(latest.id);
        const currentLatestId = teamMessages.length ? String(teamMessages[teamMessages.length - 1]?.id ?? "") : "";
        if (latestId && latestId !== currentLatestId) {
          await loadTeamThreadMessages(teamThreadId, { silent: true });
        }
      } catch {
        // keep silent polling
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [teamThreadId, teamMessages]);

  useEffect(() => {
    if (!teamMessagesEndRef.current) return;
    teamMessagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [teamMessages.length, teamThreadId]);

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
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error ?? "Send failed"));
      setTeamComposer("");
      await loadTeamThreadMessages(teamThreadId, { silent: true });
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
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setTeamMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingTeamMessageId("");
    }
  }

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

  const compareMonths = useMemo(() => {
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
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id")
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
      } catch (e: any) {
        setError(e?.message ?? "Erreur chargement.");
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
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id")
          .eq("user_id", effectivePlayerId)
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
  }, [effectivePlayerId, prevRange?.from, prevRange?.to]);

  useEffect(() => {
    (async () => {
      const ids = Array.from(
        new Set(
          [...sessions, ...prevSessions]
            .filter((s) => s.session_type === "club")
            .map((s) => s.club_event_id)
            .filter((v): v is string => Boolean(v))
        )
      );
      if (ids.length === 0) {
        setClubEventDurationById({});
        setClubEventDurationByStartKey({});
        return;
      }
      const res = await supabase
        .from("club_events")
        .select("id,duration_minutes,starts_at,ends_at")
        .in("id", ids);
      if (res.error) {
        setClubEventDurationById({});
        setClubEventDurationByStartKey({});
        return;
      }
      const map: Record<string, number> = {};
      const byStartKey: Record<string, number> = {};
      (res.data ?? []).forEach(
        (row: { id: string; duration_minutes: number | null; starts_at: string | null; ends_at: string | null }) => {
        if (!row?.id) return;
        const mins = Number(row.duration_minutes ?? 0);
          if (Number.isFinite(mins) && mins > 0) {
            map[row.id] = mins;
            const key = eventStartKey(row.starts_at);
            if (key) byStartKey[key] = mins;
            return;
          }
          if (row.starts_at && row.ends_at) {
            const startMs = new Date(row.starts_at).getTime();
            const endMs = new Date(row.ends_at).getTime();
            const diff = Math.round((endMs - startMs) / 60000);
            map[row.id] = Number.isFinite(diff) && diff > 0 ? diff : 0;
            const key = eventStartKey(row.starts_at);
            if (key) byStartKey[key] = map[row.id];
            return;
          }
          map[row.id] = 0;
        }
      );
      const missingClubSessions = [...sessions, ...prevSessions].filter((s) => s.session_type === "club" && !s.club_event_id);
      if (missingClubSessions.length > 0) {
        if (!effectivePlayerId) {
          setClubEventDurationById(map);
          setClubEventDurationByStartKey(byStartKey);
          return;
        }
        const attendeeRes = await supabase
          .from("club_event_attendees")
          .select("event_id")
          .eq("player_id", effectivePlayerId)
          .eq("status", "present");
        const attendeeEventIds = Array.from(
          new Set(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => r.event_id).filter((v): v is string => Boolean(v)))
        );
        if (attendeeEventIds.length > 0) {
          const starts = missingClubSessions.map((s) => new Date(s.start_at).getTime()).filter((v) => Number.isFinite(v));
          const minMs = starts.length > 0 ? Math.min(...starts) : null;
          const maxMs = starts.length > 0 ? Math.max(...starts) : null;
          if (minMs != null && maxMs != null) {
            const fallbackRes = await supabase
              .from("club_events")
              .select("starts_at,ends_at,duration_minutes")
              .in("id", attendeeEventIds)
              .gte("starts_at", new Date(minMs - 60_000).toISOString())
              .lt("starts_at", new Date(maxMs + 60_000).toISOString());
            if (!fallbackRes.error) {
              (fallbackRes.data ?? []).forEach(
                (row: { starts_at: string | null; ends_at: string | null; duration_minutes: number | null }) => {
                  const key = eventStartKey(row.starts_at);
                  if (!key || byStartKey[key] > 0) return;
                  const mins = Number(row.duration_minutes ?? 0);
                  if (Number.isFinite(mins) && mins > 0) {
                    byStartKey[key] = mins;
                    return;
                  }
                  if (row.starts_at && row.ends_at) {
                    const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
                    byStartKey[key] = Number.isFinite(diff) && diff > 0 ? diff : 0;
                  }
                }
              );
            }
          }
        }
      }
      setClubEventDurationById(map);
      setClubEventDurationByStartKey(byStartKey);
    })();
  }, [effectivePlayerId, sessions, prevSessions]);

  const shouldLoadRoundStats = activeSection === "stats" || activeSection === "rounds";
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

        let q = supabase
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
          .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id")
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
    return pickLocaleText(locale, "Mon volume d'entraînement", "Training volume");
  }, [locale, preset]);
  const plannedClubMinutes = useMemo(() => {
    return sessions
      .filter((s) => s.session_type === "club")
      .reduce((sum, s) => {
        const byEventId = s.club_event_id ? Number(clubEventDurationById[s.club_event_id] ?? 0) : 0;
        if (Number.isFinite(byEventId) && byEventId > 0) return sum + byEventId;
        const byStart = Number(clubEventDurationByStartKey[eventStartKey(s.start_at)] ?? 0);
        return sum + (Number.isFinite(byStart) && byStart > 0 ? byStart : 0);
      }, 0);
  }, [sessions, clubEventDurationById, clubEventDurationByStartKey]);
  // ===== TRAININGS AGGREGATES (current + prev) =====
  const totalMinutes = useMemo(() => {
    if (isPerformanceEnabled) return sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    const nonClubEffective = sessions
      .filter((s) => s.session_type !== "club")
      .reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    return plannedClubMinutes + nonClubEffective;
  }, [isPerformanceEnabled, sessions, plannedClubMinutes]);
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
      }));

    return list.map((x) => {
      const d = new Date(`${x.week}T00:00:00`);
      const label = new Intl.DateTimeFormat(dateLocale, { day: "2-digit", month: "2-digit" }).format(d);
      return { ...x, weekLabel: label };
    });
  }, [dateLocale, sessions]);

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

  // ===== UI =====
  const kpiGridClass = "golf-kpi-grid";
  const kpiGridStyle: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "1fr" };

  return (
    <div className="player-dashboard-bg player-golf-page">
      <div className="app-shell marketplace-page">
        {/* ===== Header ===== */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                MON GOLF
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

        <div className="glass-section coach-player-tabs-card">
          <div
            className="coach-player-tabs"
            style={{
              display: "flex",
              gap: 8,
            }}
          >
            {[
              { id: "trainings" as DashboardSection, label: "Entrainements" },
              { id: "rounds" as DashboardSection, label: "Parcours" },
              { id: "stats" as DashboardSection, label: "Statistiques" },
              { id: "thread" as DashboardSection, label: "Fil de discussion" },
              { id: "documents" as DashboardSection, label: "Documents" },
            ].map((tab) => {
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="btn"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveSection(tab.id)}
                  style={{
                    flexShrink: 0,
                    minHeight: 36,
                    borderRadius: 10,
                    fontWeight: 850,
                    transition: "all 150ms ease",
                    boxShadow: isActive ? "0 2px 8px rgba(16,94,51,0.24)" : "none",
                    background: isActive ? "#1b5e20" : "rgba(255,255,255,0.82)",
                    borderColor: isActive ? "#1b5e20" : "rgba(0,0,0,0.12)",
                    color: isActive ? "white" : "rgba(0,0,0,0.78)",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeSection === "thread" ? (
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Fil équipe coachs + joueur + parent(s)</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                Participants: {teamParticipantNames.length ? teamParticipantNames.join(", ") : "—"}
              </div>
            </div>

            {(loadingTeamThread && !teamThreadId) || loadingTeamMessages ? (
              <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
              </div>
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
                      const mine = m.sender_user_id === currentUserId;
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
        </div>
        ) : null}

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
                      <div style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1fr)", gap: 10, alignItems: "start" }}>
                        <div
                          aria-hidden
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.14)",
                            background: "rgba(255,255,255,0.9)",
                            color: "rgba(0,0,0,0.66)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
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

                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button className="btn" type="button" onClick={() => setViewerDocument(d)}>
                          Voir
                        </button>
                        {String(d.uploaded_by ?? "") === currentUserId ? (
                          <>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => void renameDocument(d)}
                              disabled={renamingDocumentId === d.id || deletingDocumentId === d.id}
                            >
                              {renamingDocumentId === d.id ? "..." : "Renommer"}
                            </button>
                            <button
                              className="btn btn-danger soft"
                              type="button"
                              onClick={() => void deleteDocument(d)}
                              disabled={deletingDocumentId === d.id || renamingDocumentId === d.id}
                            >
                              {deletingDocumentId === d.id ? "..." : "Supprimer"}
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
        <option value="week">{t("common.thisWeek")}</option>
        <option value="month">{t("common.thisMonth")}</option>
        <option value="last3">{t("common.last3Months")}</option>
        <option value="all">{t("common.allActivity")}</option>
        <option value="custom">{t("common.custom")}</option>
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
</div>

        {/* ===== Trainings KPIs ===== */}
        {activeSection === "trainings" ? (
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
                        <span className="pill-soft">⛳ {sessions.length} {t("golfDashboard.sessions")}</span>
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

            {isPerformanceEnabled ? (
              <div className="glass-card" style={{ gridColumn: "1 / -1" }}>
                <div className="card-title">{t("golfDashboard.feelingsAverage")}</div>

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
            ) : null}
          </div>
        </div>
        ) : null}

        {/* ===== Graphes trainings ===== */}
        {activeSection === "trainings" ? (
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
                    {weeklyObjectiveMinutes > 0 ? (
                      <ReferenceLine
                        y={weeklyObjectiveMinutes}
                        stroke="rgba(185,28,28,0.9)"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        ifOverflow="extendDomain"
                        label={{
                          value: pickLocaleText(locale, "Objectif", "Goal"),
                          position: "right",
                          fill: "rgba(185,28,28,0.9)",
                          fontSize: 11,
                          fontWeight: 900,
                        }}
                      />
                    ) : null}
                    <Bar dataKey="minutes" name={t("golfDashboard.minutesPerWeek")} fill="rgba(53,72,59,0.65)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {weeklyObjectiveMinutes > 0 ? (
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>
                {pickLocaleText(locale, "Objectif hebdomadaire", "Weekly goal")}: {weeklyObjectiveMinutes} min
              </div>
            ) : null}
          </div>
        </div>
        ) : null}

        {activeSection === "trainings" && isPerformanceEnabled ? (
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

                      <Line type="monotone" dataKey="motivation" name={t("common.motivation")} stroke="#1D4ED8" strokeWidth={3} dot={false} />
                      <Line type="monotone" dataKey="difficulty" name={t("common.difficulty")} stroke="#16A34A" strokeWidth={3} strokeDasharray="4 6" dot={false} />
                      <Line type="monotone" dataKey="satisfaction" name={t("common.satisfaction")} stroke="#DC2626" strokeWidth={3} strokeDasharray="10 6" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeSection === "trainings" && isPerformanceEnabled ? (
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

        {activeSection === "rounds" ? (
          <div className="glass-section">
            <div className="glass-card">
              {loadingRounds ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
              ) : rounds.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("golfDashboard.noRoundsInPeriod")}</div>
              ) : (
                <div className="marketplace-list marketplace-list-top">
                  {rounds.map((r) => {
                    const date = new Intl.DateTimeFormat(dateLocale, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(r.start_at));
                    const roundTypeLabel =
                      r.round_type === "competition"
                        ? pickLocaleText(locale, "Compétition", "Competition")
                        : pickLocaleText(locale, "Entraînement", "Training");
                    const cfg = [String(r.course_name ?? "").trim(), String(r.tee_name ?? "").trim()].filter(Boolean).join(" • ");
                    const fwPct =
                      typeof r.fairways_hit === "number" && typeof r.fairways_total === "number" && r.fairways_total > 0
                        ? `${Math.round((r.fairways_hit / r.fairways_total) * 100)}%`
                        : "—";
                    return (
                      <Link key={r.id} href={`/player/golf/rounds/${r.id}/scorecard`} className="marketplace-link">
                        <div className="marketplace-item">
                          <div style={{ display: "grid", gap: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                              <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
                                <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                  {date}
                                </div>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <span className="pill-soft">{roundTypeLabel}</span>
                                  {cfg ? (
                                    <span className="truncate" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>
                                      ⛳ {cfg}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.60)" }}>{t("rounds.score")}</div>
                                <div style={{ fontWeight: 1200, fontSize: 36, lineHeight: 1 }}>{r.total_score ?? "—"}</div>
                              </div>
                            </div>
                            <div className="hr-soft" style={{ margin: "2px 0" }} />
                            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                              {pickLocaleText(locale, "Putts", "Putts")}: <span style={{ fontWeight: 900 }}>{r.total_putts ?? "—"}</span>
                              {" • "}
                              GIR: <span style={{ fontWeight: 900 }}>{r.gir ?? "—"}</span>
                              {" • "}
                              {t("golfDashboard.fairwaysHit")}: <span style={{ fontWeight: 900 }}>{fwPct}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <span className="btn">{t("rounds.scorecard")}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

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

        {/* ===== Training → Course analysis ===== */}
        {activeSection === "stats" && isPerformanceEnabled ? (
          <div className="glass-section">
            <div className="glass-card">
              <div className="card-title">{t("golfDashboard.trainingToRoundAnalysis")}</div>

              {loadingTrainLookback ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("golfDashboard.analyzing")}</div>
              ) : !corr ? (
                <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, lineHeight: 1.45 }}>
                  {t("golfDashboard.notEnoughDataForCorrelation")}
                  <br />
                  {t("golfDashboard.correlationNeed").replace("{days}", String(LOOKBACK_DAYS))}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                    {t("golfDashboard.correlationIntro").replace("{days}", String(LOOKBACK_DAYS))}
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {[
                      { label: t("golfDashboard.correlation.volumeScore"), r: corr.mins_vs_score, goodWhen: "neg" as const },
                      { label: t("golfDashboard.correlation.puttingPutts"), r: corr.putting_vs_putts, goodWhen: "neg" as const },
                      { label: t("golfDashboard.correlation.longFairways"), r: corr.long_vs_fairway, goodWhen: "pos" as const },
                      { label: t("golfDashboard.correlation.shortGir"), r: corr.short_vs_gir, goodWhen: "pos" as const },
                      { label: t("golfDashboard.correlation.mentalDoubles"), r: corr.mental_vs_doubles, goodWhen: "neg" as const },
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
                            {x.r == null ? "—" : `${good ? "▲" : "▼"} ${t(st.labelKey)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hr-soft" />

                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>{t("golfDashboard.adviceTitle")}</div>

                    {courseAdvice.length === 0 ? (
                      <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("golfDashboard.noAdviceYet")}</div>
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

                  </div>
                </div>
              )}
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
