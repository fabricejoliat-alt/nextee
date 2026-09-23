"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { createAppNotification, getEventCoachUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { invalidateClientPageCacheByPrefix, readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BookOpen, CalendarCheck2, CheckCircle2, ClipboardCheck, Flag, MapPin, Medal, Newspaper, ShieldCheck, Target, type LucideIcon } from "lucide-react";
import type { ValidationDashboardPayload } from "@/lib/validations";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import ActiviteeEChart from "@/components/ui/ActiviteeEChart";
import { buildManagementVolumeChartOption } from "@/lib/managementCharts";
import coachStyles from "@/app/coach/CoachDashboard.module.css";
import validationStyles from "@/app/coach/validations/CoachValidations.module.css";
import styles from "./PlayerDashboard.module.css";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type ClubMember = { club_id: string };
type Club = { id: string; name: string | null };

type Item = {
  id: string;
  title: string;
  created_at: string;
  price: number | null;
  is_free: boolean | null;
  category: string | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  club_id: string;
};

type TrainingSessionRow = {
  id: string;
  start_at: string;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  session_type: "club" | "private" | "individual";
  club_event_id: string | null;
};

type TrainingItemRow = {
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

type GolfRoundRow = {
  id: string;
  start_at: string;
  gir: number | null;
  fairways_hit: number | null;
  fairways_total: number | null;
  total_putts: number | null;
  eagles?: number | null;
  birdies?: number | null;
  pars?: number | null;
  bogeys?: number | null;
  doubles_plus?: number | null;
};

type MarketplaceImageRow = {
  item_id: string;
  path: string;
  sort_order: number;
};

type HomeSessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  club_event_id: string | null;
};

type HomePlannedEventRow = {
  id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | "competition" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string;
  group_id: string | null;
  status: "scheduled" | "cancelled";
  competition_level?: "internal" | "club" | "regional" | "national" | "international" | null;
  competition_category?: "u10" | "u12" | "u14" | "u16" | "u18" | "all" | null;
  external_registration_url?: string | null;
  competition_note?: string | null;
};

type HomePlayerActivityRow = {
  id: string;
  event_type: "competition" | "camp";
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type HomeEventStructureItem = {
  event_id: string;
  category: string;
  minutes: number;
  note: string | null;
};

type HomeUpcomingItem =
  | { kind: "event"; key: string; dateIso: string; event: HomePlannedEventRow }
  | { kind: "session"; key: string; dateIso: string; session: HomeSessionRow }
  | { kind: "competition"; key: string; dateIso: string; competition: HomePlayerActivityRow };

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

type PlayerHomePageCache = {
  profile: Profile | null;
  clubs: Club[];
  latestItems: Item[];
  thumbByItemId: Record<string, string>;
  monthSessions: TrainingSessionRow[];
  monthClubEventDurationById?: Record<string, number>;
  monthPlannedClubMinutes?: number;
  monthItems: TrainingItemRow[];
  roundsMonth: GolfRoundRow[];
  roundsPrevMonth: GolfRoundRow[];
  playedHolesMonthByRoundId: Record<string, number>;
  playedHolesPrevMonthByRoundId: Record<string, number>;
  holesPlayedMonth: number;
  viewerUserId: string;
  effectiveUserId: string;
  attendeeStatusByEventId: Record<string, "expected" | "present" | "absent" | "excused" | null>;
  clubNameById: Record<string, string>;
  groupNameById: Record<string, string>;
  coachNamesByEventId: Record<string, string[]>;
  eventStructureByEventId: Record<string, HomeEventStructureItem[]>;
  upcomingActivities: HomeUpcomingItem[];
  playVolumeSummary?: PlayVolumeSummary;
};

type PlayVolumeSummary = {
  roundsCount: number;
  holesPlayed: number;
  girPctAvg: number | null;
  fwPctAvg: number | null;
  puttAvg: number | null;
  scramblingPct: number | null;
};

type HomeNewsItem = {
  id: string;
  club_id: string;
  club_name: string;
  title: string;
  image_url: string | null;
  summary: string | null;
  body: string;
  visible_on_home: boolean;
  published_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  linked_club_event_id: string | null;
  linked_camp_id: string | null;
  linked_content_type: "event" | "camp" | null;
  linked_content_label: string | null;
};

type PendingTraining = { id: string; dateIso: string; title: string; href: string };
type AttendanceInsight = { present: number; expected: number; rate: number; change: number | null };
type MeritInsight = { rank: number; total: number; change: number | null } | null;

const PLAYER_HOME_CACHE_TTL_MS = 45_000;
const playerHomeCacheKey = (userId: string) => `page-cache:player-home:v3:${userId}`;

type HeroCachePayload = {
  profile: Profile | null;
  clubs: Club[];
  updatedAt: number;
};

const HERO_CACHE_TTL_MS = 10 * 60 * 1000;
const PLAY_VOLUME_CACHE_TTL_MS = 15 * 60 * 1000;

function heroCacheKey(userId: string) {
  return `player:home:hero:${userId}`;
}

function readHeroCache(userId: string) {
  if (typeof window === "undefined" || !userId) return null as HeroCachePayload | null;
  try {
    const raw = window.localStorage.getItem(heroCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HeroCachePayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.updatedAt || Date.now() - parsed.updatedAt > HERO_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHeroCache(userId: string, payload: { profile: Profile | null; clubs: Club[] }) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const data: HeroCachePayload = {
      profile: payload.profile,
      clubs: payload.clubs,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(heroCacheKey(userId), JSON.stringify(data));
  } catch {
    // ignore cache write issues
  }
}

type PlayVolumeCachePayload = {
  summary: PlayVolumeSummary;
  updatedAt: number;
};

function playVolumeCacheKey(userId: string) {
  return `player:home:play-volume:${userId}`;
}

function readPlayVolumeCache(userId: string) {
  if (typeof window === "undefined" || !userId) return null as PlayVolumeCachePayload | null;
  try {
    const raw = window.localStorage.getItem(playVolumeCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayVolumeCachePayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.updatedAt || Date.now() - parsed.updatedAt > PLAY_VOLUME_CACHE_TTL_MS) return null;
    if (!parsed.summary || typeof parsed.summary !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePlayVolumeCache(userId: string, summary: PlayVolumeSummary) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const payload: PlayVolumeCachePayload = {
      summary,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(playVolumeCacheKey(userId), JSON.stringify(payload));
  } catch {
    // ignore cache write issues
  }
}

function displayHello(p: Profile | null | undefined, t: (key: string) => string) {
  const f = (p?.first_name ?? "").trim();
  if (!f) return t("playerHome.hello");
  return `${t("playerHome.hello")} ${f}`;
}

function getInitials(p?: Profile | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  if (!fi && !li) return "J";
  return `${fi}${li}`;
}

function truncate(s: string, max: number) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function avg(values: Array<number | null>) {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return Math.round((sum / v.length) * 10) / 10;
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

function monthRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function rollingYearWindows(now = new Date()) {
  const curEnd = new Date(now);
  const curStart = new Date(now);
  curStart.setFullYear(curStart.getFullYear() - 1);

  const prevEnd = new Date(curStart);
  const prevStart = new Date(curStart);
  prevStart.setFullYear(prevStart.getFullYear() - 1);

  return { curStart, curEnd, prevStart, prevEnd };
}

function isGIR(par: number | null, score: number | null, putts: number | null) {
  if (typeof par !== "number") return false;
  if (typeof score !== "number") return false;
  if (typeof putts !== "number") return false;
  return score - putts <= par - 2;
}

function roundPlayedHolesFromRound(r: GolfRoundRow) {
  const vals = [r.eagles, r.birdies, r.pars, r.bogeys, r.doubles_plus];
  if (vals.some((v) => typeof v === "number")) {
    return vals.reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
  }
  if (typeof r.fairways_total === "number") return r.fairways_total <= 7 ? 9 : 18;
  if (typeof r.total_putts === "number") return r.total_putts <= 22 ? 9 : 18;
  if (typeof r.gir === "number") return r.gir <= 9 ? 9 : 18;
  return 18;
}

function estimatedScramblingFromRounds(rounds: GolfRoundRow[], playedByRound: Record<string, number>) {
  let opp = 0;
  let success = 0;
  for (const r of rounds) {
    const played = playedByRound[r.id] ?? roundPlayedHolesFromRound(r);
    const gir = typeof r.gir === "number" ? r.gir : null;
    if (!played || gir == null) continue;
    const roundOpp = Math.max(played - gir, 0);
    if (roundOpp <= 0) continue;
    const parOrBetter =
      (typeof r.pars === "number" ? r.pars : 0) +
      (typeof r.birdies === "number" ? r.birdies : 0) +
      (typeof r.eagles === "number" ? r.eagles : 0);
    const roundSuccess = Math.min(roundOpp, Math.max(parOrBetter - gir, 0));
    opp += roundOpp;
    success += roundSuccess;
  }
  if (opp <= 0) return null;
  return Math.round((success / opp) * 1000) / 10;
}

function monthTitle(now = new Date(), locale = "fr-CH") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(now).toUpperCase();
}

function fmtDateLabelNoTime(iso: string, locale: string) {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(d);
  const dayMonth = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(d);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dayMonth}`;
}

function fmtHourLabel(iso: string, locale: string) {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
  }
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function formatNewsPublishedLabel(iso: string | null, locale: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (locale === "fr") {
    const datePart = new Intl.DateTimeFormat("fr-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News du ${datePart}`;
  }
  if (locale === "de") {
    const datePart = new Intl.DateTimeFormat("de-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News vom ${datePart}`;
  }
  if (locale === "it") {
    const datePart = new Intl.DateTimeFormat("it-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    return `News del ${datePart}`;
  }
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return `News from ${datePart}`;
}

function hasDisplayableTime(iso: string) {
  const d = new Date(iso);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

function sameDay(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventTypeLabel(v: HomePlannedEventRow["event_type"], locale: string) {
  if (locale === "en") {
    if (v === "training") return "Training";
    if (v === "interclub") return "Interclub";
    if (v === "camp") return "Camp";
    if (v === "session") return "Session";
    if (v === "competition") return "Competition";
    return "Event";
  }
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclubs";
  if (v === "camp") return "Stage";
  if (v === "session") return "Réunion";
  if (v === "competition") return "Compétition";
  return "Événement";
}

function clubCompetitionLevelLabel(value: HomePlannedEventRow["competition_level"]) {
  if (value === "internal") return "Tournoi interne";
  if (value === "club") return "Tournoi Club";
  if (value === "regional") return "Régional";
  if (value === "national") return "National";
  if (value === "international") return "International";
  return "—";
}

function clubCompetitionCategoryLabel(value: HomePlannedEventRow["competition_category"]) {
  return value === "all" ? "Tous" : String(value ?? "—").toUpperCase();
}

function priceLabel(it: Item, t: (key: string) => string) {
  if (it.is_free) return t("marketplace.free");
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

function marketplaceConditionLabel(locale: string, value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (locale !== "fr") return normalized;
  if (normalized === "New") return "Neuf";
  if (normalized === "Like new") return "Comme neuf";
  if (normalized === "Good condition") return "Bon état";
  if (normalized === "To repair") return "À réparer";
  return normalized;
}

function compactMeta(it: Item, locale: string) {
  const parts: string[] = [];
  if (it.category) parts.push(it.category);
  const conditionLabel = marketplaceConditionLabel(locale, it.condition);
  if (conditionLabel) parts.push(conditionLabel);
  const bm = `${it.brand ?? ""} ${it.model ?? ""}`.trim();
  if (bm) parts.push(bm);
  return parts.join(" • ");
}

function Donut({ percent }: { percent: number }) {
  const p = clamp(percent, 0, 100);
  const r = 54;
  const c = 2 * Math.PI * r;

  const [animatedP, setAnimatedP] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimatedP(p), 60);
    return () => clearTimeout(t);
  }, [p]);

  const dash = (animatedP / 100) * c;
  const done = p >= 100;

  return (
    <svg width="150" height="150" viewBox="0 0 140 140" aria-label={`Progression ${p}%`}>
      <defs>
        <linearGradient id="donutGrad" x1="70" y1="16" x2="124" y2="124" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--green-light)" />
          <stop offset="100%" stopColor="var(--green-dark)" />
        </linearGradient>
      </defs>

      <circle cx="70" cy="70" r={r} strokeWidth="14" className="donut-bg" fill="rgba(255,255,255,0.22)" />

      <circle
        cx="70"
        cy="70"
        r={r}
        strokeWidth="14"
        className="donut-fg"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 70 70)"
      />

      <text x="70" y="79" textAnchor="middle" className="donut-label">
        {Math.round(p)}%
      </text>

      <g className={`donut-check-wrap ${done ? "on" : ""}`}>
        <circle className="donut-check-circle" cx="70" cy="108" r={done ? 16 : 12} />
        <path className="donut-check" d="M64 110 l4 4 l9 -10" />
      </g>
    </svg>
  );
}

/** Flèche “standard”: up=vert, down=rouge (comme sensations) */
function ArrowOnly({ delta }: { delta: number | null }) {
  if (delta == null || !Number.isFinite(delta)) return <span className="sense-val">—</span>;
  const up = delta > 0;
  const down = delta < 0;
  const cls = up ? "sense-val up" : down ? "sense-val down" : "sense-val";
  const sign = up ? "▲" : down ? "▼" : "•";
  return <span className={cls}>{sign}</span>;
}

/** Variation “dernière valeur vs précédente” (en ignorant les null) */
function deltaLastVsPrev(values: Array<number | null | undefined>) {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length < 2) return null;
  const last = v[0];
  const prev = v[1];
  return Math.round((last - prev) * 10) / 10;
}

function eventStartKey(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 16);
}

function isClubAttendanceEventType(eventType: HomePlannedEventRow["event_type"]) {
  return eventType === "training" || eventType === "interclub" || eventType === "camp" || eventType === "event" || eventType === "session";
}

function UpcomingAttendanceToggle({
  variant,
  checked,
  onToggle,
  disabled,
  absentLabel,
  presentLabel,
  absentSentence,
  presentSentence,
  ariaLabel,
}: {
  variant: 0 | 1 | 2;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  absentLabel: string;
  presentLabel: string;
  absentSentence: string;
  presentSentence: string;
  ariaLabel: string;
}) {
  if (variant === 0) {
    return <button type="button" className={`player-home-attendance player-home-attendance--segments ${checked ? "is-present" : "is-absent"}`} role="switch" aria-checked={checked} aria-label={ariaLabel} onClick={onToggle} disabled={disabled}><span>{absentLabel}</span><span>{presentLabel}</span></button>;
  }
  if (variant === 1) {
    return <button type="button" className="player-home-attendance player-home-attendance--editorial" role="switch" aria-checked={checked} aria-label={ariaLabel} onClick={onToggle} disabled={disabled}><span>{checked ? presentLabel : absentLabel}</span><i aria-hidden="true" className={checked ? "is-present" : "is-absent"} /></button>;
  }
  return <button type="button" className={`player-home-attendance player-home-attendance--pill ${checked ? "is-present" : "is-absent"}`} role="switch" aria-checked={checked} aria-label={ariaLabel} onClick={onToggle} disabled={disabled}><i aria-hidden="true" /><span>{checked ? presentSentence : absentSentence}</span></button>;
}

function BenchmarkBadge({ icon: Icon, tone, children }: { icon: LucideIcon; tone: "positive" | "neutral" | "caution" | "highlight"; children: ReactNode }) {
  const toneClass = tone === "positive" ? validationStyles.badgeElite : tone === "caution" ? validationStyles.badgeBronze : tone === "highlight" ? validationStyles.badgeGold : validationStyles.badgeSilver;
  return <span className={`${validationStyles.badge} ${toneClass} ${styles.statusBadge}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}

function effectiveHomeSessionType(session: TrainingSessionRow | HomeSessionRow) {
  if (session.club_event_id) return "club" as const;
  return session.session_type;
}

function compactHomeNewsLinkedLabel(label: string | null, contentType: HomeNewsItem["linked_content_type"]) {
  if (!label) return null;
  const parts = label.split(" • ").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return label;
  if (contentType === "camp") return parts[0] ?? label;
  return parts.join(" • ");
}

type RulesHomeOverview = {
  currentSeriesId: string | null;
  series: Array<{ id: string; position: number; title_i18n: Record<string, string>; discovery_starts_at: string; quiz_opens_at: string; quiz_closes_at: string; results_published_at: string | null }>;
  cards: Array<{ card_version_id: string }>;
  quizAttempt: { status: "in_progress" | "submitted" | "expired" | "void"; submitted_at: string | null; total_score: number | null } | null;
};

function PlayerRulesHomeCard({ locale }: { locale: string }) {
  const [overview, setOverview] = useState<RulesHomeOverview | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const response = await fetch("/api/rules/overview", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as RulesHomeOverview;
        if (active && Array.isArray(payload.series)) setOverview(payload);
      } catch { /* Keep the useful static fallback when rules are unavailable. */ }
    })();
    return () => { active = false; };
  }, []);

  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const current = overview?.series.find(item => item.id === overview.currentSeriesId) ?? null;
  const cardCount = current ? overview?.cards.length ?? 0 : 6;
  const month = current ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(current.discovery_starts_at)) : "";
  return <Link href="/player/rules" className={`${coachStyles.panel} ${styles.rulesCard}`}>
    <span className={`${coachStyles.panelHeader} ${styles.learningCardHeader}`}><span><h2>{tr("Règles de golf", "Golf rules")}</h2><p>{tr("Découvre les fiches de la série et prépare ton quiz.", "Explore the series cards and get ready for your quiz.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
    <span className={styles.rulesVisual} aria-hidden="true"><span className={styles.rulesVisualBook}><BookOpen size={42} strokeWidth={1.4} /></span><span className={styles.rulesVisualDot}>{String(current?.position ?? 1).padStart(2, "0")}</span><span className={styles.rulesVisualDot}>{String(cardCount || 6).padStart(2, "0")}</span></span>
    <span className={styles.rulesBody}>
      {current ? <>
        <span className={styles.rulesCurrent}><small>{tr(`Série ${current.position} · ${month}`, `Series ${current.position} · ${month}`)}</small><strong>{current.title_i18n[locale] ?? current.title_i18n.fr}</strong></span>
        <p className={styles.rulesDescription}>{tr("Découvre les situations de la série à ton rythme, puis teste tes connaissances lors du quiz.", "Explore the situations in this series at your own pace, then test your knowledge in the quiz.")}</p>
      </> : <p>{tr("Six situations à découvrir dans la série en cours. Les bons réflexes, à ton rythme.", "Six situations in the current series. Learn the right reflexes at your own pace.")}</p>}
    </span>
  </Link>;
}

export default function PlayerHomePage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const dateLocale = pickLocaleText(locale, "fr-CH", "en-US");
  const [loading, setLoading] = useState(true);
  const [heroLoading, setHeroLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);

  const [latestItems, setLatestItems] = useState<Item[]>([]);
  const [thumbByItemId, setThumbByItemId] = useState<Record<string, string>>({});
  const [marketplaceLoading, setMarketplaceLoading] = useState(true);

  const [monthSessions, setMonthSessions] = useState<TrainingSessionRow[]>([]);
  const [monthClubEventDurationById, setMonthClubEventDurationById] = useState<Record<string, number>>({});
  const [monthClubEventDurationByStartKey, setMonthClubEventDurationByStartKey] = useState<Record<string, number>>({});
  const [monthPlannedClubMinutes, setMonthPlannedClubMinutes] = useState<number>(0);
  const [monthPlannedClubEvents, setMonthPlannedClubEvents] = useState<Array<{ starts_at: string; ends_at: string | null; duration_minutes: number | null }>>([]);
  const [monthItems, setMonthItems] = useState<TrainingItemRow[]>([]);
  const [playVolumeSummary, setPlayVolumeSummary] = useState<PlayVolumeSummary>({
    roundsCount: 0,
    holesPlayed: 0,
    girPctAvg: null,
    fwPctAvg: null,
    puttAvg: null,
    scramblingPct: null,
  });

  // ✅ Rounds month + previous month (pour tendances focus)
  const [roundsMonth, setRoundsMonth] = useState<GolfRoundRow[]>([]);
  const [roundsPrevMonth, setRoundsPrevMonth] = useState<GolfRoundRow[]>([]);
  const [playedHolesMonthByRoundId, setPlayedHolesMonthByRoundId] = useState<Record<string, number>>({});
  const [playedHolesPrevMonthByRoundId, setPlayedHolesPrevMonthByRoundId] = useState<Record<string, number>>({});
  const [scramblingPctMonth, setScramblingPctMonth] = useState<number | null>(null);
  const [scramblingPctPrevMonth, setScramblingPctPrevMonth] = useState<number | null>(null);
  const [holesPlayedMonth, setHolesPlayedMonth] = useState<number>(0);
  const [playVolumeLoading, setPlayVolumeLoading] = useState(true);
  const [playVolumeLoadedOnce, setPlayVolumeLoadedOnce] = useState(false);
  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [effectiveUserId, setEffectiveUserId] = useState<string>("");
  const [viewerRole, setViewerRole] = useState<"player" | "parent">("player");
  const [playerConsentStatus, setPlayerConsentStatus] = useState<"granted" | "pending" | "adult" | null>(null);
  const [consentResolved, setConsentResolved] = useState(false);
  const [isPerformanceEnabled, setIsPerformanceEnabled] = useState<boolean>(false);
  const [attendeeStatusByEventId, setAttendeeStatusByEventId] = useState<Record<string, "expected" | "present" | "absent" | "excused" | null>>({});
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [coachNamesByEventId, setCoachNamesByEventId] = useState<Record<string, string[]>>({});
  const [eventStructureByEventId, setEventStructureByEventId] = useState<Record<string, HomeEventStructureItem[]>>({});
  const [upcomingActivities, setUpcomingActivities] = useState<HomeUpcomingItem[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [latestNews, setLatestNews] = useState<HomeNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [attendanceBusyEventId, setAttendanceBusyEventId] = useState<string>("");
  const [trainingVolumeRows, setTrainingVolumeRows] = useState<TrainingVolumeTargetRow[]>([]);
  const [trainingSeasonMonths, setTrainingSeasonMonths] = useState<number[]>([]);
  const [trainingOffseasonMonths, setTrainingOffseasonMonths] = useState<number[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState(false);
  const [pendingTrainings, setPendingTrainings] = useState<PendingTraining[]>([]);
  const [attendanceInsight, setAttendanceInsight] = useState<AttendanceInsight | null>(null);
  const [meritInsight, setMeritInsight] = useState<MeritInsight>(null);
  const [validationDashboard, setValidationDashboard] = useState<ValidationDashboardPayload | null>(null);
  const [showProfilePhotoPrompt, setShowProfilePhotoPrompt] = useState(false);
  const [hidePhotoPromptForever, setHidePhotoPromptForever] = useState(false);

  const bucket = "marketplace";

  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    const loadInsights = async () => {
      setInsightsLoading(true);
      setInsightsError(false);
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token ?? "";
        const validationQuery = viewerRole === "parent" ? `?child_id=${encodeURIComponent(effectiveUserId)}` : "";
        const [attendeesResult, sessionsResult, validationsResult] = await Promise.all([
          supabase.from("club_event_attendees").select("event_id,status").eq("player_id", effectiveUserId),
          isPerformanceEnabled
            ? supabase.from("training_sessions").select("id,start_at,club_event_id,location_text,motivation,difficulty,satisfaction").eq("user_id", effectiveUserId).order("start_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          token ? fetch(`/api/player/validations${validationQuery}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null) : Promise.resolve(null),
        ]);
        if (attendeesResult.error) throw attendeesResult.error;
        if (sessionsResult.error) throw sessionsResult.error;
        const attendees = (attendeesResult.data ?? []) as Array<{ event_id: string; status: string | null }>;
        const sessions = (sessionsResult.data ?? []) as Array<{ id: string; start_at: string; club_event_id: string | null; location_text: string | null; motivation: number | null; difficulty: number | null; satisfaction: number | null }>;
        const eventIds = [...new Set(attendees.map((row) => row.event_id).filter(Boolean))];
        const sessionIds = sessions.map((row) => row.id);
        const [eventsResult, itemsResult] = await Promise.all([
          eventIds.length ? supabase.from("club_events").select("id,event_type,title,starts_at,ends_at,status,requires_evaluation").in("id", eventIds) : Promise.resolve({ data: [], error: null }),
          sessionIds.length ? supabase.from("training_session_items").select("session_id,minutes").in("session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
        ]);
        if (eventsResult.error) throw eventsResult.error;
        if (itemsResult.error) throw itemsResult.error;
        const events = (eventsResult.data ?? []) as Array<{ id: string; event_type: string; title: string | null; starts_at: string; ends_at: string | null; status: string; requires_evaluation: boolean }>;
        const statusById = new Map(attendees.map((row) => [row.event_id, row.status]));
        const itemMinutesBySession = new Map<string, number>();
        for (const row of (itemsResult.data ?? []) as Array<{ session_id: string; minutes: number }>) {
          itemMinutesBySession.set(row.session_id, Math.max(itemMinutesBySession.get(row.session_id) ?? 0, Number(row.minutes ?? 0)));
        }
        const completeSessions = new Set(sessions.filter((session) => (itemMinutesBySession.get(session.id) ?? 0) > 0 && typeof session.motivation === "number" && typeof session.difficulty === "number" && typeof session.satisfaction === "number").map((session) => session.id));
        const sessionsByEvent = new Map(sessions.filter((session) => session.club_event_id).map((session) => [session.club_event_id, session]));
        const now = Date.now();
        const pending: PendingTraining[] = [];
        if (isPerformanceEnabled) {
          for (const event of events) {
            if (event.status !== "scheduled" || !event.requires_evaluation || !["training", "camp"].includes(event.event_type) || new Date(event.ends_at ?? event.starts_at).getTime() >= now || ["absent", "excused", "not_registered"].includes(statusById.get(event.id) ?? "")) continue;
            const session = sessionsByEvent.get(event.id);
            if (session && completeSessions.has(session.id)) continue;
            pending.push({ id: event.id, dateIso: event.starts_at, title: event.title?.trim() || (event.event_type === "camp" ? "Stage" : "Entraînement"), href: session ? `/player/golf/trainings/${session.id}/edit` : `/player/golf/trainings/new?club_event_id=${encodeURIComponent(event.id)}` });
          }
          for (const session of sessions) {
            if (session.club_event_id || completeSessions.has(session.id) || new Date(session.start_at).getTime() >= now) continue;
            pending.push({ id: session.id, dateIso: session.start_at, title: "Entraînement individuel", href: `/player/golf/trainings/${session.id}/edit` });
          }
        }
        pending.sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());
        const currentStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        const previousStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();
        const attendanceFor = (from: number, to: number) => {
          let present = 0; let expected = 0;
          for (const event of events) {
            const date = new Date(event.starts_at).getTime();
            const status = statusById.get(event.id);
            if (date < from || date >= to || date >= now || event.status !== "scheduled" || !["training", "interclub", "camp", "event", "session"].includes(event.event_type) || !["present", "absent"].includes(status ?? "")) continue;
            expected += 1;
            if (status === "present") present += 1;
          }
          return { present, expected, rate: expected ? Math.round((present / expected) * 100) : 0 };
        };
        const currentAttendance = attendanceFor(currentStart, now);
        const previousAttendance = attendanceFor(previousStart, currentStart);
        let merit: MeritInsight = null;
        let partialError = false;
        if (isPerformanceEnabled && clubs[0]?.id) {
          const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
          const yearStart = `${today.slice(0, 4)}-01-01`;
          const ranking = await supabase.rpc("om_ranking_snapshot", { p_org_id: clubs[0].id, p_from: yearStart, p_as_of: today });
          if (ranking.error) partialError = true;
          else {
            const rows = (ranking.data ?? []) as Array<{ player_id: string; rank_net: number }>;
            const mine = rows.find((row) => row.player_id === effectiveUserId);
            if (mine && Number.isFinite(Number(mine.rank_net))) {
              let change: number | null = null;
              const previousMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
              if (previousMonthEnd >= yearStart) {
                const previousRanking = await supabase.rpc("om_ranking_snapshot", { p_org_id: clubs[0].id, p_from: yearStart, p_as_of: previousMonthEnd });
                if (!previousRanking.error) {
                  const previousMine = ((previousRanking.data ?? []) as Array<{ player_id: string; rank_net: number }>).find((row) => row.player_id === effectiveUserId);
                  if (previousMine && Number.isFinite(Number(previousMine.rank_net))) change = Number(previousMine.rank_net) - Number(mine.rank_net);
                }
              }
              merit = { rank: Number(mine.rank_net), total: rows.length, change };
            }
          }
        }
        let validation: ValidationDashboardPayload | null = null;
        if (token && !validationsResult) partialError = true;
        if (validationsResult) {
          if (!validationsResult.ok) partialError = true;
          else validation = await validationsResult.json() as ValidationDashboardPayload;
        }
        if (cancelled) return;
        setPendingTrainings(pending);
        setAttendanceInsight(currentAttendance.expected ? { ...currentAttendance, change: previousAttendance.expected ? currentAttendance.rate - previousAttendance.rate : null } : null);
        setMeritInsight(merit);
        setValidationDashboard(validation);
        setInsightsError(partialError);
      } catch (cause) {
        if (!cancelled) { console.warn("player dashboard insights failed:", cause); setInsightsError(true); }
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    };
    void loadInsights();
    return () => { cancelled = true; };
  }, [effectiveUserId, viewerRole, isPerformanceEnabled, clubs]);

  const placeholderThumb = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="180">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <path d="M70 118l28-28 26 26 18-18 28 28" fill="none" stroke="#9ca3af" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="92" cy="78" r="10" fill="#9ca3af"/>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const thisMonthTitle = useMemo(() => monthTitle(new Date(), dateLocale), [dateLocale]);

  const heroClubLine = useMemo(() => {
    const names = clubs.map((c) => c.name).filter(Boolean) as string[];
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [clubs]);

  const trainingVolumeObjective = useMemo(() => {
    const target = pickTrainingVolumeTarget(profile?.handicap ?? null, trainingVolumeRows);
    const nowMonth = new Date().getMonth() + 1;
    const inSeason =
      trainingSeasonMonths.includes(nowMonth) ||
      (!trainingOffseasonMonths.includes(nowMonth) && trainingSeasonMonths.length > 0);
    if (!target) return 0;
    return inSeason ? target.minutes_inseason : target.minutes_offseason;
  }, [profile?.handicap, trainingVolumeRows, trainingSeasonMonths, trainingOffseasonMonths]);

  const trainingVolumeLevel = useMemo(() => {
    const target = pickTrainingVolumeTarget(profile?.handicap ?? null, trainingVolumeRows);
    if (!target) return null;
    return target.level_label;
  }, [profile?.handicap, trainingVolumeRows]);

  const trainingVolumeMotivation = useMemo(() => {
    const target = pickTrainingVolumeTarget(profile?.handicap ?? null, trainingVolumeRows);
    const text = String(target?.motivation_text ?? "").trim();
    return text || null;
  }, [profile?.handicap, trainingVolumeRows]);

  const displayedTrainingVolumeObjective = useMemo(() => {
    if (trainingVolumeObjective <= 0) return 0;
    return trainingVolumeObjective * 4;
  }, [trainingVolumeObjective]);

  const monthManualSessions = useMemo(
    () =>
      monthSessions.filter(
        (session) =>
          !session.club_event_id &&
          (session.session_type === "individual" || session.session_type === "private")
      ),
    [monthSessions]
  );
  const monthManualMinutes = useMemo(
    () =>
      monthManualSessions.reduce(
        (sum, session) => sum + (Number(session.total_minutes ?? 0) || 0),
        0
      ),
    [monthManualSessions]
  );

  const monthEffectiveMinutes = useMemo(() => {
    if (isPerformanceEnabled) {
      return monthItems.reduce((sum, it) => sum + (it.minutes || 0), 0);
    }
    return monthPlannedClubMinutes + monthManualMinutes;
  }, [isPerformanceEnabled, monthItems, monthPlannedClubMinutes, monthManualMinutes]);

  const trainingsSummary = useMemo(() => {
    const totalMinutes = monthEffectiveMinutes;
    const count = monthSessions.length;

    const motivationAvg = avg(monthSessions.map((s) => s.motivation));
    const satisfactionAvg = avg(monthSessions.map((s) => s.satisfaction));
    const difficultyAvg = avg(monthSessions.map((s) => s.difficulty));

    const byCat: Record<string, number> = {};
    for (const it of monthItems) byCat[it.category] = (byCat[it.category] ?? 0) + (it.minutes || 0);

    const top = Object.entries(byCat)
      .map(([cat, minutes]) => ({
        cat: cat as TrainingItemRow["category"],
        label: t(`cat.${cat}`),
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3);

    const objective = displayedTrainingVolumeObjective;
    const percent = objective > 0 ? (totalMinutes / objective) * 100 : 0;

    // ✅ Tendance = dernière valeur vs précédente (ignorer null)
    // monthSessions est trié DESC (plus récent en premier)
    const deltaMotivation = deltaLastVsPrev(monthSessions.map((s) => s.motivation));
    const deltaDifficulty = deltaLastVsPrev(monthSessions.map((s) => s.difficulty));
    const deltaSatisfaction = deltaLastVsPrev(monthSessions.map((s) => s.satisfaction));

    return {
      totalMinutes,
      count,
      objective,
      percent,
      top,
      motivationAvg,
      difficultyAvg,
      satisfactionAvg,
      deltaMotivation,
      deltaDifficulty,
      deltaSatisfaction,
    };
  }, [monthEffectiveMinutes, monthSessions, monthItems, t, displayedTrainingVolumeObjective]);

  const topMax = useMemo(() => {
    const m = trainingsSummary.top.reduce((max, x) => Math.max(max, x.minutes), 0);
    return m || 1;
  }, [trainingsSummary.top]);

  // ===== Focus calculé depuis golf_rounds (comme dashboard) =====
  const focusFromRounds = playVolumeSummary;

  async function loadUpcomingPreview(userId: string, viewerUid?: string) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) return;

      const query = new URLSearchParams();
      if (viewerUid && viewerUid !== userId) query.set("child_id", userId);
      const res = await fetch(`/api/player/home-upcoming?${query.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to load upcoming preview"));

      setAttendeeStatusByEventId((prev) => ({ ...prev, ...(json?.attendeeStatusByEventId ?? {}) }));
      setClubNameById((prev) => ({ ...prev, ...(json?.clubNameById ?? {}) }));
      setGroupNameById((prev) => ({ ...prev, ...(json?.groupNameById ?? {}) }));
      setCoachNamesByEventId((prev) => ({ ...prev, ...(json?.coachNamesByEventId ?? {}) }));
      const structureMap = (json?.eventStructureByEventId ?? {}) as Record<string, HomeEventStructureItem[]>;
      if (Object.keys(structureMap).length > 0) {
        setEventStructureByEventId((prev) => ({ ...prev, ...structureMap }));
      }

      const previewUpcoming = (json?.upcomingActivities ?? []) as HomeUpcomingItem[];
      setUpcomingActivities(previewUpcoming);
      setUpcomingLoading(false);
    } catch {
      // keep default full-loading flow
    }
  }

  async function loadLatestNews(userId: string, role: "player" | "parent") {
    try {
      setNewsLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) {
        setLatestNews([]);
        return;
      }

      const query = new URLSearchParams();
      if (role === "parent" && userId) query.set("child_id", userId);
      const res = await fetch(`/api/player/news?${query.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to load news"));
      const rows = Array.isArray(json?.news) ? (json.news as HomeNewsItem[]) : [];
      setLatestNews(rows.slice(0, 3));
    } catch {
      setLatestNews([]);
    } finally {
      setNewsLoading(false);
    }
  }

  async function loadLatestMarketplace(clubIds: string[]) {
    if (latestItems.length === 0) setMarketplaceLoading(true);
    try {
      const dedupedClubIds = Array.from(new Set(clubIds.filter(Boolean)));
      if (dedupedClubIds.length === 0) {
        setLatestItems([]);
        setThumbByItemId({});
        return;
      }

      const itemsRes = await supabase
        .from("marketplace_items")
        .select("id,title,created_at,price,is_free,category,condition,brand,model,club_id")
        .in("club_id", dedupedClubIds)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3);

      if (itemsRes.error) {
        setLatestItems([]);
        setThumbByItemId({});
        return;
      }

      const list = (itemsRes.data ?? []) as Item[];
      setLatestItems(list);

      const ids = list.map((x) => x.id);
      if (ids.length === 0) {
        setThumbByItemId({});
        return;
      }

      const imgRes = await supabase
        .from("marketplace_images")
        .select("item_id,path,sort_order")
        .in("item_id", ids)
        .eq("sort_order", 0);

      if (imgRes.error) {
        setThumbByItemId({});
        return;
      }

      const map: Record<string, string> = {};
      (imgRes.data ?? []).forEach((r: MarketplaceImageRow) => {
        const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
        if (data?.publicUrl) map[r.item_id] = data.publicUrl;
      });
      setThumbByItemId(map);
    } catch (e) {
      console.warn("player home marketplace load failed:", e);
      setLatestItems([]);
      setThumbByItemId({});
    } finally {
      setMarketplaceLoading(false);
    }
  }

  async function loadRollingPlayVolume(effectiveUid: string, viewerUid: string) {
    if (!playVolumeLoadedOnce && playVolumeSummary.roundsCount === 0 && playVolumeSummary.holesPlayed === 0) {
      setPlayVolumeLoading(true);
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) {
        setPlayVolumeSummary({
          roundsCount: 0,
          holesPlayed: 0,
          girPctAvg: null,
          fwPctAvg: null,
          puttAvg: null,
          scramblingPct: null,
        });
        return;
      }

      const query = new URLSearchParams();
      if (viewerUid && viewerUid !== effectiveUid) query.set("child_id", effectiveUid);
      const res = await fetch(`/api/player/home-play-volume?${query.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to load play volume"));

      const summary: PlayVolumeSummary = {
        roundsCount: Number(json?.roundsCount ?? 0),
        holesPlayed: Number(json?.holesPlayed ?? 0),
        girPctAvg: typeof json?.girPctAvg === "number" ? json.girPctAvg : null,
        fwPctAvg: typeof json?.fwPctAvg === "number" ? json.fwPctAvg : null,
        puttAvg: typeof json?.puttAvg === "number" ? json.puttAvg : null,
        scramblingPct: typeof json?.scramblingPct === "number" ? json.scramblingPct : null,
      };
      setPlayVolumeSummary(summary);
      writePlayVolumeCache(effectiveUid, summary);
      setPlayVolumeLoadedOnce(true);
    } catch (e) {
      console.warn("player home play volume load failed:", e);
    } finally {
      setPlayVolumeLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setUpcomingLoading(true);
    setMarketplaceLoading(true);
    if (!playVolumeLoadedOnce) setPlayVolumeLoading(true);
    setError(null);
    setHeroLoading(true);

    let effectiveUid = "";
    let viewerUid = "";
    try {
      const ctx = await resolveEffectivePlayerContext();
      effectiveUid = ctx.effectiveUserId;
      viewerUid = ctx.viewerUserId;
      setViewerRole(ctx.role === "parent" ? "parent" : "player");
      setViewerUserId(viewerUid);
      setEffectiveUserId(effectiveUid);
      void loadLatestNews(effectiveUid, ctx.role === "parent" ? "parent" : "player");
      void loadRollingPlayVolume(effectiveUid, viewerUid);
      const performanceEnabled = await isEffectivePlayerPerformanceEnabled(effectiveUid);
      setIsPerformanceEnabled(performanceEnabled);
      const pageCache = readClientPageCache<PlayerHomePageCache>(
        playerHomeCacheKey(effectiveUid),
        PLAYER_HOME_CACHE_TTL_MS
      );
      const hasPageCache = Boolean(pageCache);
      if (pageCache) {
        setProfile(pageCache.profile);
        setClubs(pageCache.clubs);
        setLatestItems(pageCache.latestItems);
        setThumbByItemId(pageCache.thumbByItemId);
        setMarketplaceLoading(false);
        setMonthSessions(pageCache.monthSessions);
        setMonthClubEventDurationById(pageCache.monthClubEventDurationById ?? {});
        setMonthClubEventDurationByStartKey({});
        setMonthPlannedClubMinutes(pageCache.monthPlannedClubMinutes ?? 0);
        setMonthItems(pageCache.monthItems);
        setRoundsMonth(pageCache.roundsMonth);
        setRoundsPrevMonth(pageCache.roundsPrevMonth);
        setPlayedHolesMonthByRoundId(pageCache.playedHolesMonthByRoundId);
        setPlayedHolesPrevMonthByRoundId(pageCache.playedHolesPrevMonthByRoundId);
        setHolesPlayedMonth(pageCache.holesPlayedMonth);
        setPlayVolumeSummary(
          pageCache.playVolumeSummary ?? {
            roundsCount: pageCache.roundsMonth.length,
            holesPlayed: pageCache.holesPlayedMonth,
            girPctAvg: null,
            fwPctAvg: null,
            puttAvg: null,
            scramblingPct: null,
          }
        );
        setPlayVolumeLoadedOnce(true);
        setPlayVolumeLoading(false);
        setViewerUserId(pageCache.viewerUserId || viewerUid);
        setEffectiveUserId(pageCache.effectiveUserId || effectiveUid);
        setAttendeeStatusByEventId(pageCache.attendeeStatusByEventId);
        setClubNameById(pageCache.clubNameById);
        setGroupNameById(pageCache.groupNameById);
        setCoachNamesByEventId(pageCache.coachNamesByEventId ?? {});
        setEventStructureByEventId(pageCache.eventStructureByEventId);
        setUpcomingActivities(pageCache.upcomingActivities);
        setUpcomingLoading(false);
        setLoading(false);
      }
      void loadUpcomingPreview(effectiveUid, viewerUid);
      const heroCache = readHeroCache(effectiveUid);
      if (heroCache) {
        setProfile(heroCache.profile);
        setClubs(heroCache.clubs);
        setHeroLoading(false);
      }
      const playCache = readPlayVolumeCache(effectiveUid);
      if (playCache) {
        setPlayVolumeSummary(playCache.summary);
        setPlayVolumeLoadedOnce(true);
        setPlayVolumeLoading(false);
      }
    } catch {
      setError(t("roundsNew.error.invalidSession"));
      setLoading(false);
      setUpcomingLoading(false);
      setHeroLoading(false);
      setNewsLoading(false);
      return;
    }

    try {
      const [profRes, memRes] = await Promise.all([
      supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").eq("id", effectiveUid).maybeSingle(),
      supabase.from("club_members").select("club_id").eq("user_id", effectiveUid).eq("is_active", true),
      ]);

    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      setUpcomingLoading(false);
      setHeroLoading(false);
      return;
    }
    setProfile((profRes.data ?? null) as Profile | null);
    let cids: string[] = [];
    if (memRes.error) {
      // Non-blocking: home KPIs (rounds/stats) must still load even if memberships fail.
      console.warn("club_members load failed:", memRes.error.message);
      setClubs([]);
    } else {
      cids = ((memRes.data ?? []) as ClubMember[]).map((m) => m.club_id).filter(Boolean);
    }

    let heroClubs: Club[] = [];
    if (cids.length > 0) {
      const clubsRes = await supabase.from("clubs").select("id,name").in("id", cids);
      if (!clubsRes.error) {
        heroClubs = (clubsRes.data ?? []) as Club[];
        setClubs(heroClubs);
      } else {
        heroClubs = cids.map((id) => ({ id, name: null }));
        setClubs(heroClubs);
      }
    } else {
      heroClubs = [];
      setClubs([]);
    }
    setHeroLoading(false);
    writeHeroCache(effectiveUid, { profile: (profRes.data ?? null) as Profile | null, clubs: heroClubs });

    // Training volume config from active clubs: keep the highest monthly objective
    if (cids.length > 0) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (token) {
          const clubIds = Array.from(new Set(cids));
          const month = new Date().getMonth() + 1;
          const handicap = (profRes.data as Profile | null)?.handicap ?? null;

          const responses = await Promise.all(
            clubIds.map(async (clubId) => {
              const res = await fetch(
                `/api/player/clubs/${clubId}/training-volume?player_id=${encodeURIComponent(effectiveUid)}`,
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
        setTrainingVolumeRows([]);
        setTrainingSeasonMonths([]);
        setTrainingOffseasonMonths([]);
      }
    } else {
      setTrainingVolumeRows([]);
      setTrainingSeasonMonths([]);
      setTrainingOffseasonMonths([]);
    }

    if (cids.length > 0) {
      void loadLatestMarketplace(cids);
    } else {
      setLatestItems([]);
      setThumbByItemId({});
      setMarketplaceLoading(false);
    }

    // Trainings month
    const { start, end } = monthRangeLocal(new Date());
    const sRes = await supabase
      .from("training_sessions")
      .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id")
      .eq("user_id", effectiveUid)
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString())
      .order("start_at", { ascending: false });

    if (!sRes.error) {
      const sess = (sRes.data ?? []) as TrainingSessionRow[];
      setMonthSessions(sess);

      const sIds = sess.map((s) => s.id);
      if (sIds.length > 0) {
        const iRes = await supabase.from("training_session_items").select("session_id,category,minutes").in("session_id", sIds);
        setMonthItems((iRes.data ?? []) as TrainingItemRow[]);
      } else {
        setMonthItems([]);
      }

      const monthClubEventIds = Array.from(
        new Set(
          sess
            .filter((s) => effectiveHomeSessionType(s) === "club")
            .map((s) => s.club_event_id)
            .filter((v): v is string => Boolean(v))
        )
      );
      if (monthClubEventIds.length > 0) {
        const evRes = await supabase
          .from("club_events")
          .select("id,duration_minutes,starts_at,ends_at")
          .in("id", monthClubEventIds);
        const map: Record<string, number> = {};
        const byStartKey: Record<string, number> = {};
        if (!evRes.error) {
          (evRes.data ?? []).forEach(
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
        }
        const missingClubSessions = sess.filter((s) => effectiveHomeSessionType(s) === "club" && !s.club_event_id);
        if (missingClubSessions.length > 0) {
          const attendeeRes = await supabase
            .from("club_event_attendees")
            .select("event_id")
            .eq("player_id", effectiveUid)
            .eq("status", "present");
          const attendeeEventIds = Array.from(
            new Set(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => r.event_id).filter((v): v is string => Boolean(v)))
          );
          if (attendeeEventIds.length > 0) {
            const fallbackRes = await supabase
              .from("club_events")
              .select("starts_at,ends_at,duration_minutes")
              .in("id", attendeeEventIds)
              .gte("starts_at", start.toISOString())
              .lt("starts_at", end.toISOString());
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
        setMonthClubEventDurationById(map);
        setMonthClubEventDurationByStartKey(byStartKey);
      } else {
        setMonthClubEventDurationById({});
        setMonthClubEventDurationByStartKey({});
      }

      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", effectiveUid)
        .eq("status", "present");
      const attendeeEventIds = Array.from(
        new Set(((attendeeRes.data ?? []) as Array<{ event_id: string | null }>).map((r) => r.event_id).filter((v): v is string => Boolean(v)))
      );
      if (attendeeEventIds.length > 0) {
        const nowIso = new Date().toISOString();
        const plannedRes = await supabase
          .from("club_events")
          .select("id,starts_at,ends_at,duration_minutes,status")
          .in("id", attendeeEventIds)
          .neq("status", "cancelled")
          .gte("starts_at", start.toISOString())
          .lt("starts_at", end.toISOString())
          .lt("starts_at", nowIso);
        if (!plannedRes.error) {
          setMonthPlannedClubEvents((plannedRes.data ?? []) as Array<{ starts_at: string; ends_at: string | null; duration_minutes: number | null }>);
          const total = (plannedRes.data ?? []).reduce((sum, row: { starts_at: string | null; ends_at: string | null; duration_minutes: number | null }) => {
            const mins = Number(row.duration_minutes ?? 0);
            if (Number.isFinite(mins) && mins > 0) return sum + mins;
            if (row.starts_at && row.ends_at) {
              const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
              return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
            }
            return sum;
          }, 0);
          setMonthPlannedClubMinutes(total);
        } else {
          setMonthPlannedClubMinutes(0);
          setMonthPlannedClubEvents([]);
        }
      } else {
        setMonthPlannedClubMinutes(0);
        setMonthPlannedClubEvents([]);
      }
    } else {
      setMonthSessions([]);
      setMonthClubEventDurationById({});
      setMonthClubEventDurationByStartKey({});
      setMonthPlannedClubMinutes(0);
      setMonthItems([]);
    }

    // Upcoming activities are intentionally sourced only from the server preview API.
    // This avoids client-side permission or join differences that can overwrite
    // the correct camp-day list a few seconds later.

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.errorLoading"));
      setLatestItems([]);
      setThumbByItemId({});
      setMarketplaceLoading(false);
      setMonthSessions([]);
      setMonthClubEventDurationById({});
      setMonthClubEventDurationByStartKey({});
      setMonthPlannedClubMinutes(0);
      setMonthItems([]);
      setPlayVolumeLoading(false);
      setUpcomingActivities([]);
      setUpcomingLoading(false);
      setLatestNews([]);
      setNewsLoading(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || !effectiveUserId) return;
    writeClientPageCache(playerHomeCacheKey(effectiveUserId), {
      profile,
      clubs,
      latestItems,
      thumbByItemId,
      monthSessions,
      monthClubEventDurationById,
      monthPlannedClubMinutes,
      monthItems,
      roundsMonth,
      roundsPrevMonth,
      playedHolesMonthByRoundId,
      playedHolesPrevMonthByRoundId,
      holesPlayedMonth,
      playVolumeSummary,
      viewerUserId,
      effectiveUserId,
      attendeeStatusByEventId,
      clubNameById,
      groupNameById,
      coachNamesByEventId,
      eventStructureByEventId,
      upcomingActivities,
    });
  }, [
    loading,
    effectiveUserId,
    profile,
    clubs,
    latestItems,
    thumbByItemId,
    monthSessions,
    monthClubEventDurationById,
    monthPlannedClubMinutes,
    monthItems,
    roundsMonth,
    roundsPrevMonth,
    playedHolesMonthByRoundId,
    playedHolesPrevMonthByRoundId,
    holesPlayedMonth,
    playVolumeSummary,
    viewerUserId,
    attendeeStatusByEventId,
    clubNameById,
    groupNameById,
    coachNamesByEventId,
    eventStructureByEventId,
    upcomingActivities,
  ]);

  async function updateTrainingAttendance(event: HomePlannedEventRow, nextStatus: "present" | "absent") {
    if (!effectiveUserId || attendanceBusyEventId) return;
    setAttendanceBusyEventId(event.id);
    setError(null);

    const upd = await supabase
      .from("club_event_attendees")
      .update({ status: nextStatus })
      .eq("event_id", event.id)
      .eq("player_id", effectiveUserId);

    if (upd.error) {
      setError(upd.error.message);
      setAttendanceBusyEventId("");
      return;
    }

    setAttendeeStatusByEventId((prev) => ({ ...prev, [event.id]: nextStatus }));
    invalidateClientPageCacheByPrefix("page-cache:player-home:");
    invalidateClientPageCacheByPrefix("page-cache:player-trainings:");

    try {
      const coachRecipientIds = await getEventCoachUserIds(event.id, event.group_id);
      if (coachRecipientIds.length > 0 && viewerUserId) {
        const localeKey: "fr" | "en" = locale === "fr" ? "fr" : "en";
        const type = eventTypeLabel(event.event_type, localeKey);
        const eventEnd =
          event.ends_at ??
          new Date(new Date(event.starts_at).getTime() + Math.max(1, event.duration_minutes) * 60_000).toISOString();
        const profRes = await supabase
          .from("profiles")
          .select("first_name,last_name")
          .eq("id", effectiveUserId)
          .maybeSingle();
        const playerName =
          `${String(profRes.data?.first_name ?? "").trim()} ${String(profRes.data?.last_name ?? "").trim()}`.trim() ||
          (pickLocaleText(locale, "Joueur", "Player"));

        if (nextStatus === "absent") {
          const msg = await getNotificationMessage("notif.playerMarkedAbsent", localeKey, {
            playerName,
            eventType: type,
            dateTime: `${fmtDateLabelNoTime(event.starts_at, localeKey)} • ${fmtHourLabel(event.starts_at, localeKey)} → ${fmtHourLabel(eventEnd, localeKey)}`,
          });
          await createAppNotification({
            actorUserId: viewerUserId,
            kind: "player_marked_absent",
            title: msg.title,
            body: msg.body,
            data: { event_id: event.id, group_id: event.group_id, url: `/coach/groups/${event.group_id ?? ""}/planning/${event.id}` },
            recipientUserIds: coachRecipientIds,
          });
        } else {
          await createAppNotification({
            actorUserId: viewerUserId,
            kind: "player_marked_present",
            title: pickLocaleText(locale, "Présence confirmée", "Attendance confirmed"),
            body:
              locale === "fr"
                ? `${playerName} présent · ${type} · ${fmtDateLabelNoTime(event.starts_at, "fr")} ${fmtHourLabel(event.starts_at, "fr")}`
                : `${playerName} present · ${type} · ${fmtDateLabelNoTime(event.starts_at, "en")} ${fmtHourLabel(event.starts_at, "en")}`,
            data: { event_id: event.id, group_id: event.group_id, url: `/coach/groups/${event.group_id ?? ""}/planning/${event.id}` },
            recipientUserIds: coachRecipientIds,
          });
        }
      }
    } catch {
      // keep attendance update resilient
    }

    setAttendanceBusyEventId("");
  }

  function handleTrainingAttendanceToggle(
    event: HomePlannedEventRow,
    attendanceStatus: "expected" | "present" | "absent" | "excused" | null
  ) {
    const current: "present" | "absent" = attendanceStatus === "absent" ? "absent" : "present";
    const next: "present" | "absent" = current === "present" ? "absent" : "present";
    const ok = window.confirm(
      locale === "fr"
        ? next === "absent"
          ? "Confirmer le passage à absent ?"
          : "Confirmer le passage à présent ?"
        : next === "absent"
        ? "Confirm switch to absent?"
        : "Confirm switch to present?"
    );
    if (!ok) return;
    void updateTrainingAttendance(event, next);
  }

  const avatarUrl = useMemo(() => {
    const base = profile?.avatar_url?.trim() || "";
    if (!base) return null;
    return `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }, [profile?.avatar_url]);

  useEffect(() => {
    let cancelled = false;
    const loadConsent = async () => {
      if (viewerRole !== "player") {
        if (!cancelled) {
          setPlayerConsentStatus(null);
          setConsentResolved(true);
        }
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) {
        if (!cancelled) {
          setPlayerConsentStatus(null);
          setConsentResolved(true);
        }
        return;
      }
      const res = await fetch("/api/player/consent", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!cancelled) {
        setPlayerConsentStatus(
          res.ok && json?.viewerRole === "player"
            ? ((json?.player?.consentStatus ?? null) as "granted" | "pending" | "adult" | null)
            : null
        );
        setConsentResolved(true);
      }
    };
    setConsentResolved(false);
    void loadConsent();
    return () => {
      cancelled = true;
    };
  }, [viewerRole, viewerUserId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading || heroLoading || !consentResolved) {
      setShowProfilePhotoPrompt(false);
      return;
    }
    if (!viewerUserId || viewerRole !== "player" || playerConsentStatus == null || playerConsentStatus === "pending") {
      setShowProfilePhotoPrompt(false);
      return;
    }
    if (profile?.avatar_url?.trim()) {
      window.localStorage.removeItem(`player:photo-prompt:dismissed:${viewerUserId}`);
      setShowProfilePhotoPrompt(false);
      setHidePhotoPromptForever(false);
      return;
    }
    const dismissed = window.localStorage.getItem(`player:photo-prompt:dismissed:${viewerUserId}`);
    setShowProfilePhotoPrompt(!dismissed);
    setHidePhotoPromptForever(Boolean(dismissed));
  }, [consentResolved, heroLoading, loading, playerConsentStatus, profile?.avatar_url, viewerRole, viewerUserId]);

  // ✅ affichage sensations : valeur = moyenne du mois / flèche = tendance vs séance précédente
  const senseRightStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minWidth: 64,
    justifyContent: "flex-end",
  };

  const roundsMonthCount = playVolumeSummary.roundsCount;
  const holesPlayedDisplay = playVolumeSummary.holesPlayed;
  const focusTiles = useMemo(
    () => [
      {
        key: "gir",
        label: t("golfDashboard.gir"),
        value: focusFromRounds.girPctAvg == null ? "—" : `${focusFromRounds.girPctAvg}%`,
      },
      {
        key: "putts",
        label: pickLocaleText(locale, "Putts (18 trous)", "Putts (18 holes)"),
        value: focusFromRounds.puttAvg == null ? "—" : `${focusFromRounds.puttAvg}`,
      },
      {
        key: "fw",
        label: t("golfDashboard.fairwaysHit"),
        value: focusFromRounds.fwPctAvg == null ? "—" : `${focusFromRounds.fwPctAvg}%`,
      },
      {
        key: "scrambling",
        label: pickLocaleText(locale, "Scrambling", "Scrambling"),
        value: focusFromRounds.scramblingPct == null ? "—" : `${focusFromRounds.scramblingPct}%`,
      },
    ],
    [focusFromRounds.fwPctAvg, focusFromRounds.girPctAvg, focusFromRounds.puttAvg, focusFromRounds.scramblingPct, locale, t]
  );
  const upcomingPreview = upcomingActivities.slice(0, 3);
  const attentionEvents = upcomingActivities
    .filter((item): item is Extract<HomeUpcomingItem, { kind: "event" }> => item.kind === "event")
    .filter((item) => isClubAttendanceEventType(item.event.event_type))
    .filter((item) => attendeeStatusByEventId[item.event.id] == null || attendeeStatusByEventId[item.event.id] === "expected")
    .slice(0, 2);
  const validationHighlights = useMemo(() => {
    const sections = validationDashboard?.sections
      .filter((section) => section.is_active && section.exercises.length > 0)
      .sort((a, b) => a.sort_order - b.sort_order)
      .slice(0, 4) ?? [];
    return sections.map((section) => {
      const next = section.exercises.find((exercise) => exercise.is_unlocked && !exercise.is_validated)
        ?? section.exercises.find((exercise) => !exercise.is_validated)
        ?? section.exercises.at(-1)
        ?? null;
      return { section, next };
    });
  }, [validationDashboard]);
  const weeklyVolume = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const buckets: Array<{ key: string; label: string; minutes: number; objective: number | null }> = [];
    for (const date = new Date(first), index = { value: 1 }; date < end; date.setDate(date.getDate() + (index.value === 1 ? 7 - ((date.getDay() + 6) % 7) : 7)), index.value += 1) {
      const key = String(index.value);
      buckets.push({
        key,
        label: `${pickLocaleText(locale, "Sem.", "Week")} ${index.value}`,
        minutes: 0,
        objective: trainingVolumeObjective > 0 ? trainingVolumeObjective : null,
      });
    }
    for (const session of monthSessions) {
      const date = new Date(session.start_at);
      if (date < first || date >= end) continue;
      const week = Math.floor((date.getDate() + ((first.getDay() + 6) % 7) - 1) / 7);
      const bucket = buckets[week];
      if (bucket) {
        const itemsMinutes = monthItems.filter((item) => item.session_id === session.id).reduce((sum, item) => sum + Number(item.minutes ?? 0), 0);
        const sessionMinutes = isPerformanceEnabled ? itemsMinutes : session.club_event_id ? 0 : Number(session.total_minutes ?? 0);
        bucket.minutes += sessionMinutes || 0;
      }
    }
    if (!isPerformanceEnabled) for (const event of monthPlannedClubEvents) {
      const date = new Date(event.starts_at);
      const week = Math.floor((date.getDate() + ((first.getDay() + 6) % 7) - 1) / 7);
      const bucket = buckets[week];
      if (!bucket) continue;
      const duration = Number(event.duration_minutes ?? 0);
      const fallback = event.ends_at ? Math.max(0, Math.round((new Date(event.ends_at).getTime() - date.getTime()) / 60000)) : 0;
      bucket.minutes += duration > 0 ? duration : fallback;
    }
    return buckets;
  }, [locale, monthSessions, monthItems, isPerformanceEnabled, monthPlannedClubEvents, trainingVolumeObjective]);
  const allNewsHref = useMemo(() => {
    if (viewerRole === "parent" && effectiveUserId) {
      return `/player/news?child_id=${encodeURIComponent(effectiveUserId)}`;
    }
    return "/player/news";
  }, [viewerRole, effectiveUserId]);

  return (
    <div className="player-dashboard-bg player-home-page">
      <div className="app-shell">
        <div className="player-hero">
          <div className="avatar" aria-hidden="true" style={{ overflow: "hidden" }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 28,
                  letterSpacing: 1,
                  color: "white",
                  background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                }}
              >
                {getInitials(profile)}
              </div>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">
              {heroLoading && !profile ? `${t("playerHome.hello")}…` : displayHello(profile, t)}{" "}
              <span className="player-home-wave" role="img" aria-label="bonjour">
                👋
              </span>
            </div>

            <div className="hero-sub">
              <div>
                Handicap {typeof profile?.handicap === "number" ? profile.handicap.toFixed(1) : "—"}
                {trainingVolumeLevel ? ` • ${trainingVolumeLevel}` : ""}
              </div>
            </div>

            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: "#ffd1d1", fontWeight: 800 }}>{error}</div>}

        <div className={coachStyles.page}>
          <div className={styles.firstRow}>
            <section id="player-upcoming-activities" className={coachStyles.panel}>
              <div className={coachStyles.panelHeader}>
                <div><h2>{pickLocaleText(locale, "Prochaines activités", "Upcoming activities")}</h2><p>{pickLocaleText(locale, "Les trois prochains rendez-vous.", "Your next three activities.")}</p></div>
                <Link className={coachStyles.textLink} href="/player/golf/trainings?type=all" aria-label={pickLocaleText(locale, "Voir mon activité", "View my activity")}><ArrowRight size={16} /></Link>
              </div>
              {upcomingLoading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : upcomingPreview.length ? (
                <div className={`${coachStyles.eventList} ${styles.alignedCardContent}`}>
                  {upcomingPreview.map((item) => {
                    const event = item.kind === "event" ? item.event : null;
                    const session = item.kind === "session" ? item.session : null;
                    const competition = item.kind === "competition" ? item.competition : null;
                    const title = event
                      ? (event.title?.trim() || eventTypeLabel(event.event_type, locale))
                      : session
                        ? pickLocaleText(locale, "Entraînement", "Training")
                        : (competition?.title?.trim() || pickLocaleText(locale, "Compétition", "Competition"));
                    const location = event?.location_text || session?.location_text || competition?.location_text;
                    const href = event
                      ? (event.event_type === "training" || event.event_type === "session" || event.event_type === "camp"
                        ? "/player/golf/trainings/new?club_event_id=" + encodeURIComponent(event.id)
                        : "/player/golf/trainings?type=all")
                      : session
                        ? "/player/golf/trainings/" + session.id
                        : "/player/golf/trainings?type=all";
                    const organizer = event ? (coachNamesByEventId[event.id]?.join(", ") || clubNameById[event.club_id] || (event.group_id ? groupNameById[event.group_id] : "") || pickLocaleText(locale, "Club", "Club")) : session ? pickLocaleText(locale, "Entraînement personnel", "Personal training") : pickLocaleText(locale, "Compétition", "Competition");
                    const activityDetail = event?.event_type === "session" && event.title?.trim() ? event.title.trim() : organizer;
                    const status = event ? (attendeeStatusByEventId[event.id] ?? null) : null;
                    const activityDate = new Date(item.dateIso);
                    const dateDay = new Intl.DateTimeFormat(dateLocale, { weekday: "short" }).format(activityDate).replace(".", "");
                    const dateMonth = new Intl.DateTimeFormat(dateLocale, { month: "short" }).format(activityDate).replace(".", "");
                    const activityTime = new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit" }).format(activityDate);
                    const activityType = event ? eventTypeLabel(event.event_type, locale) : session ? pickLocaleText(locale, "Entraînement", "Training") : pickLocaleText(locale, "Compétition", "Competition");
                    return <article key={item.key} className={styles.activityItem}>
                      <div className={styles.activityDate} aria-label={new Intl.DateTimeFormat(dateLocale, { dateStyle: "full", timeStyle: "short" }).format(activityDate)}>
                        <span>{dateDay}</span><b>{activityDate.getDate()}</b><span>{dateMonth}</span><time dateTime={item.dateIso}>{activityTime}</time>
                      </div>
                      <div className={styles.activityBody}>
                        <Link className={styles.activityTitle} href={href}>{activityType}</Link>
                        <span className={styles.activityMeta}>{activityDetail}</span>
                        <span className={`planning-event-location ${styles.activityLocation}`}><MapPin size={14} aria-hidden="true" /><span>{location || pickLocaleText(locale, "Lieu non renseigné", "Location not specified")}</span></span>
                      </div>
                      {event && isClubAttendanceEventType(event.event_type) ? <UpcomingAttendanceToggle variant={2} checked={status !== "absent" && status !== "excused"} onToggle={() => handleTrainingAttendanceToggle(event, status)} disabled={attendanceBusyEventId === event.id} absentLabel={pickLocaleText(locale, "Absent", "Absent")} presentLabel={pickLocaleText(locale, "Présent", "Present")} absentSentence={pickLocaleText(locale, "Absent", "Absent")} presentSentence={pickLocaleText(locale, "Présent", "Present")} ariaLabel={pickLocaleText(locale, `Présence pour ${title}`, `Attendance for ${title}`)} /> : null}
                    </article>;
                  })}
                </div>
              ) : <div className={coachStyles.empty}>{pickLocaleText(locale, "Aucune activité planifiée.", "No upcoming activity.")}</div>}
            </section>

            <section className={coachStyles.panel}>
              <div className={coachStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Actualités de mes clubs", "News from my clubs")}</h2><p>{pickLocaleText(locale, "Les dernières nouvelles publiées par mes clubs.", "The latest news published by my clubs.")}</p></div><Link className={coachStyles.textLink} href={allNewsHref} aria-label={pickLocaleText(locale, "Toutes les actualités", "All news")}><ArrowRight size={16} /></Link></div>
              {newsLoading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : latestNews.length ? (
                <div className={`${coachStyles.eventList} ${styles.alignedCardContent}`}>
                  {latestNews.map((news) => <Link key={news.id} href={allNewsHref} className={styles.newsHomeItem}>
                    {news.image_url ? <span className={styles.newsThumbnail}><img src={news.image_url} alt="" /></span> : <span className={coachStyles.dateBox}><Newspaper size={16} /></span>}
                    <div className={styles.newsHomeContent}>
                      <span className={styles.newsHomeDate}>{formatNewsPublishedLabel(news.published_at ?? news.scheduled_for ?? news.created_at, locale)}</span>
                      <b>{news.title}</b>
                      <span className={styles.newsHomeClub}>{news.club_name || clubNameById[news.club_id] || pickLocaleText(locale, "Club", "Club")}</span>
                      {news.summary ? <p className={styles.newsHomeSummary}>{truncate(news.summary, 92)}</p> : null}
                    </div>
                    <ArrowRight size={16} />
                  </Link>)}
                </div>
              ) : <div className={coachStyles.empty}>{pickLocaleText(locale, "Aucune actualité pour le moment.", "No news at the moment.")}</div>}
            </section>

            <section className={`${coachStyles.panel} ${styles.attentionCard}`}>
              <div className={coachStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Points d’attention", "Points of attention")}</h2><p>{pickLocaleText(locale, "Les éléments à vérifier prochainement.", "Things to review soon.")}</p></div></div>
              {upcomingLoading || insightsLoading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : (
                <div className={coachStyles.taskList}>
                  {pendingTrainings.length ? <Link href="/player/golf/trainings/to-complete" className={coachStyles.taskWarning}>
                    <span><ClipboardCheck size={17} /></span>
                    <b>{pendingTrainings.length} {pickLocaleText(locale, pendingTrainings.length === 1 ? "activité à évaluer" : "activités à évaluer", pendingTrainings.length === 1 ? "activity to evaluate" : "activities to evaluate")}</b>
                    <ArrowRight size={15} />
                  </Link> : null}
                  {attentionEvents.map(({ event }) => <Link key={event.id} href={`/player/golf/trainings/new?club_event_id=${encodeURIComponent(event.id)}`} className={coachStyles.taskWarning}>
                    <span><AlertTriangle size={17} /></span>
                    <b>{pickLocaleText(locale, "Présence à confirmer", "Attendance to confirm")} · {event.title?.trim() || eventTypeLabel(event.event_type, locale)}</b>
                    <ArrowRight size={15} />
                  </Link>)}
                  {trainingsSummary.objective > 0 && trainingsSummary.percent < 100 && new Date().getDate() >= 20 ? (
                    <Link href="#player-training-volume" className={coachStyles.taskWarning}><span><Target size={17} /></span><b>{pickLocaleText(locale, "Objectif FTEM du mois à atteindre", "Monthly FTEM goal to reach")}</b><ArrowRight size={15} /></Link>
                  ) : null}
                  {!insightsError && !pendingTrainings.length && !attentionEvents.length && !(trainingsSummary.objective > 0 && trainingsSummary.percent < 100 && new Date().getDate() >= 20) ? <div className={coachStyles.empty}><CheckCircle2 size={20} />{pickLocaleText(locale, "Aucun point d’attention.", "Nothing needs attention.")}</div> : null}
                  {insightsError ? <div className={coachStyles.empty}>{pickLocaleText(locale, "Certaines données sont momentanément indisponibles.", "Some data is temporarily unavailable.")}</div> : null}
                </div>
              )}
            </section>

          </div>

          <section className={styles.learningSection}>
            <div className={styles.benchmarksHeader}><div><h2>{pickLocaleText(locale, "Mon parcours d’apprentissage", "My learning journey")}</h2><p>{pickLocaleText(locale, "Progresser dans mon jeu et enrichir mes connaissances.", "Improve my game and grow my knowledge.")}</p></div></div>
            <div className={styles.learningGrid}>
              <section className={`${coachStyles.panel} ${styles.homeValidationCard}`}>
                <div className={`${coachStyles.panelHeader} ${styles.learningCardHeader}`}><div><h2>{pickLocaleText(locale, "Mes prochaines validations", "My next validations")}</h2><p>{pickLocaleText(locale, "Les prochains objectifs de chaque section.", "The next goal in each section.")}</p></div><Link className={coachStyles.textLink} href="/player/validations" aria-label={pickLocaleText(locale, "Toutes mes validations", "All my validations")}><ArrowRight size={16} /></Link></div>
                {insightsLoading ? <div className={`${coachStyles.skeleton} ${styles.homeValidationLoading}`}><span /><span /><span /><span /></div> : validationHighlights.length ? (
                  <div className={`${coachStyles.eventList} ${styles.alignedCardContent}`}>
                    {validationHighlights.map(({ section, next }) => {
                      const attempts = next?.attempts.length ?? 0;
                      const href = `/player/validations?section_id=${encodeURIComponent(section.id)}${next ? `&exercise_id=${encodeURIComponent(next.id)}` : ""}`;
                      return <Link key={section.id} href={href} className={styles.validationHomeItem}>
                        <span className={styles.validationThumbnail}>
                          {next?.illustration_url ? <Image src={next.illustration_url} alt="" fill sizes="92px" unoptimized /> : <ShieldCheck size={22} aria-hidden="true" />}
                        </span>
                        <span className={styles.validationHomeContent}>
                          <small>{section.name}</small>
                          <b>{next?.name ?? pickLocaleText(locale, "Parcours terminé", "Journey completed")}</b>
                          <span>{attempts} {pickLocaleText(locale, attempts > 1 ? "tentatives" : "tentative", attempts > 1 ? "attempts" : "attempt")}</span>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>;
                    })}
                  </div>
                ) : <Link className={styles.homeValidationEmpty} href="/player/validations"><ShieldCheck size={22} /><span>{pickLocaleText(locale, "Découvrir mon parcours de validations", "Discover my validation journey")}</span><ArrowRight size={16} /></Link>}
              </section>

              <PlayerRulesHomeCard locale={locale} />
            </div>
          </section>

          <section className={styles.benchmarksSection}>
            <div className={styles.benchmarksHeader}><div><h2>{pickLocaleText(locale, "Mes repères", "My benchmarks")}</h2><p>{pickLocaleText(locale, "Votre progression en un coup d’œil.", "Your progress at a glance.")}</p></div></div>
            {insightsLoading ? <div className={styles.benchmarks}>{Array.from({ length: 2 }, (_, index) => <div className={`${styles.benchmark} ${styles.benchmarkSkeleton}`} key={index}><span /><span /><span /></div>)}</div> : <div className={styles.benchmarks}>
              <article className={styles.benchmark}>
                <div className={styles.benchmarkHeading}><span className={coachStyles.dateBox}><CalendarCheck2 size={17} /></span><h3>{pickLocaleText(locale, "Assiduité", "Attendance")}</h3><Link className={styles.benchmarkLink} href="/player/golf?section=stats" aria-label={pickLocaleText(locale, "Voir les statistiques d’assiduité", "View attendance statistics")}><ArrowRight size={15} /></Link></div>
                {attendanceInsight ? <>
                  <strong className={styles.attendanceValue}>{attendanceInsight.rate} %</strong>
                  <span>{attendanceInsight.present} {pickLocaleText(locale, "activités sur", "activities out of")} {attendanceInsight.expected}</span>
                  <div className={styles.benchmarkSignals}>
                    {attendanceInsight.change != null ? attendanceInsight.change > 0
                      ? <BenchmarkBadge icon={ArrowUp} tone="positive">+{attendanceInsight.change} {pickLocaleText(locale, "pts vs mois précédent", "pts vs previous month")}</BenchmarkBadge>
                      : attendanceInsight.change < 0
                        ? <BenchmarkBadge icon={ArrowDown} tone="caution">−{Math.abs(attendanceInsight.change)} {pickLocaleText(locale, "pts vs mois précédent", "pts vs previous month")}</BenchmarkBadge>
                        : <BenchmarkBadge icon={ArrowRight} tone="neutral">{pickLocaleText(locale, "Stable vs mois précédent", "Stable vs previous month")}</BenchmarkBadge>
                      : null}
                    {attendanceInsight.rate === 100 ? <BenchmarkBadge icon={CheckCircle2} tone="positive">{pickLocaleText(locale, "Objectif atteint", "Goal reached")}</BenchmarkBadge> : null}
                  </div>
                </> : <p>{pickLocaleText(locale, "L’assiduité apparaîtra après vos premières activités confirmées.", "Attendance will appear after your first confirmed activities.")}</p>}
              </article>
              <article className={styles.benchmark}>
                <div className={styles.benchmarkHeading}><span className={coachStyles.dateBox}><Medal size={17} /></span><h3>{pickLocaleText(locale, "Ordre du mérite", "Order of merit")}</h3><Link className={styles.benchmarkLink} href="/player/om" aria-label={pickLocaleText(locale, "Voir l’ordre du mérite", "View order of merit")}><ArrowRight size={15} /></Link></div>
                {meritInsight ? <>
                  <div className={styles.rankLine}>
                    <strong className={styles.rankValue}>{locale === "fr" ? <>{meritInsight.rank}<sup>{meritInsight.rank === 1 ? "er" : "e"}</sup></> : `#${meritInsight.rank}`}</strong>
                    {meritInsight.rank >= 1 && meritInsight.rank <= 3 ? <span className={styles.rankFlame} role="img" aria-label={pickLocaleText(locale, "Podium", "Podium")}>🔥</span> : null}
                  </div>
                  <span>{pickLocaleText(locale, "sur", "of")} {meritInsight.total} {pickLocaleText(locale, "joueurs", "players")}</span>
                  {meritInsight.change != null ? <div className={styles.benchmarkSignals}>
                    {meritInsight.change > 0 ? <BenchmarkBadge icon={ArrowUp} tone="positive">{meritInsight.change} {pickLocaleText(locale, meritInsight.change === 1 ? "place gagnée" : "places gagnées", meritInsight.change === 1 ? "place gained" : "places gained")}</BenchmarkBadge>
                      : meritInsight.change < 0 ? <BenchmarkBadge icon={ArrowDown} tone="caution">{Math.abs(meritInsight.change)} {pickLocaleText(locale, Math.abs(meritInsight.change) === 1 ? "place de moins" : "places de moins", Math.abs(meritInsight.change) === 1 ? "place lower" : "places lower")}</BenchmarkBadge>
                        : <BenchmarkBadge icon={ArrowRight} tone="neutral">{pickLocaleText(locale, "Classement stable", "Ranking stable")}</BenchmarkBadge>}
                  </div> : null}
                </> : <p>{pickLocaleText(locale, "Aucun classement net disponible pour le moment.", "No net ranking available yet.")}</p>}
              </article>
            </div>}
          </section>

          <div id="player-training-volume" className={styles.volumeRow}>
            <section className={coachStyles.panel}>
              <div className={coachStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume d’entraînement du mois", "Monthly training volume")}</h2><p>{thisMonthTitle}</p></div></div>
              {loading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : <div className={styles.monthVolume}>
                {trainingsSummary.objective > 0 ? <Donut percent={trainingsSummary.percent} /> : <div className={coachStyles.empty}>{pickLocaleText(locale, "Objectif FTEM indisponible.", "FTEM goal unavailable.")}</div>}
                <strong>{trainingsSummary.totalMinutes} {t("common.min")}</strong>
                {trainingsSummary.objective > 0 ? <span>{pickLocaleText(locale, "sur", "of")} {trainingsSummary.objective} {t("common.min")}</span> : null}
                {trainingVolumeMotivation ? <p>{trainingVolumeMotivation}</p> : null}
              </div>}
            </section>
            <section className={coachStyles.panel}>
              <div className={coachStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume par semaine", "Weekly training volume")}</h2><p>{pickLocaleText(locale, "Réalisé et objectif FTEM pour chaque semaine du mois.", "Actual volume and FTEM goal for each week of the month.")}</p></div></div>
              {loading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : <><ActiviteeEChart ariaLabel={pickLocaleText(locale, "Volume hebdomadaire d’entraînement en minutes", "Weekly training volume in minutes")} option={buildManagementVolumeChartOption({ labels: weeklyVolume.map((item) => item.label), values: weeklyVolume.map((item) => item.minutes), valueLabel: t("golfDashboard.minutesPerWeek"), objective: weeklyVolume.map((item) => item.objective), objectiveLabel: pickLocaleText(locale, "Objectif FTEM", "FTEM goal") })} />{weeklyVolume.some((item) => item.objective != null) ? <small className={styles.chartNote}>{pickLocaleText(locale, "Objectif FTEM complet pour chaque semaine, y compris celles à cheval sur deux mois.", "Full FTEM goal for every week, including weeks spanning two months.")}</small> : null}</>}
            </section>
          </div>

          <section className={styles.marketplaceSection}>
            <div className={styles.benchmarksHeader}><div><h2>{t("nav.marketplace")}</h2><p>{pickLocaleText(locale, "Acheter, vendre et échanger au sein de vos clubs.", "Buy, sell and exchange within your clubs.")}</p></div></div>
            <section className={coachStyles.panel}>
              <div className={coachStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Dernières annonces", "Latest listings")}</h2><p>{pickLocaleText(locale, "Les dernières annonces de vos clubs.", "Latest listings from your clubs.")}</p></div><Link className={coachStyles.textLink} href="/player/marketplace">{pickLocaleText(locale, "Toutes les annonces", "All listings")} <ArrowRight size={14} /></Link></div>
              {marketplaceLoading ? <div className={coachStyles.skeleton}><span /><span /><span /></div> : latestItems.length ? (
                <div className={"marketplace-list " + styles.marketplaceGrid}>
                  {latestItems.map((item) => <Link key={item.id} href={"/player/marketplace/" + item.id} className="marketplace-link"><div className="marketplace-item"><div className="marketplace-row">
                    <div className="marketplace-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbByItemId[item.id] || placeholderThumb} alt={item.title} loading="lazy" />
                    </div>
                    <div className="marketplace-body"><div className="marketplace-item-title">{truncate(item.title, 80)}</div>{compactMeta(item, locale) ? <div className="marketplace-meta">{compactMeta(item, locale)}</div> : null}<div className="marketplace-price-row"><div className="marketplace-price-pill">{priceLabel(item, t)}</div></div></div>
                  </div></div></Link>)}
                </div>
              ) : <div className={coachStyles.empty}>{t("marketplace.none")}</div>}
            </section>
          </section>
        </div>
      </div>
      {showProfilePhotoPrompt ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1400,
            background: "rgba(15, 23, 42, 0.38)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => {
            if (typeof window !== "undefined" && viewerUserId) {
              window.localStorage.setItem(`player:photo-prompt:dismissed:${viewerUserId}`, "1");
            }
            setShowProfilePhotoPrompt(false);
          }}
        >
          <div
            className="glass-card"
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.10)",
              boxShadow: "0 28px 80px rgba(15,23,42,0.22)",
              padding: 22,
              display: "grid",
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: "linear-gradient(135deg, #166534 0%, #15803d 100%)",
                    color: "#fff",
                    fontSize: 24,
                    fontWeight: 900,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
                  }}
                >
                  {getInitials(profile)}
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: "#f8fafc",
                    color: "#64748b",
                    border: "1px solid #e5e7eb",
                    flexShrink: 0,
                  }}
                >
                  <ArrowRight size={18} />
                </div>
                <div
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "2px solid #e5e7eb",
                    background: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=160&q=80"
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#1f2937" }}>Ajoute ta photo de profil</div>
              <div style={{ color: "#475569", fontSize: 15, lineHeight: 1.6 }}>
                Une photo rend ton profil plus sympa et permet aux coachs de t’identifier plus facilement dans l’application.
              </div>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#475569",
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={hidePhotoPromptForever}
                onChange={(e) => setHidePhotoPromptForever(e.target.checked)}
              />
              <span>Ne plus afficher</span>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (typeof window !== "undefined" && viewerUserId && hidePhotoPromptForever) {
                    window.localStorage.setItem(`player:photo-prompt:dismissed:${viewerUserId}`, "1");
                  }
                  setShowProfilePhotoPrompt(false);
                }}
              >
                Plus tard
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    if (viewerUserId && hidePhotoPromptForever) {
                      window.localStorage.setItem(`player:photo-prompt:dismissed:${viewerUserId}`, "1");
                    } else if (viewerUserId) {
                      window.localStorage.removeItem(`player:photo-prompt:dismissed:${viewerUserId}`);
                    }
                  }
                  setShowProfilePhotoPrompt(false);
                  router.push("/player/profile");
                }}
              >
                Ajouter ma photo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
