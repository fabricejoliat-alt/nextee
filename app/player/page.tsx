"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import CountUpNumber from "@/components/ui/CountUpNumber";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { createAppNotification, getEventCoachUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { invalidateClientPageCacheByPrefix, readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { fetchEventMessageBadges, type EventMessageBadge } from "@/lib/messages/eventBadgesClient";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { MessageCircle, PlusCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import MessageCountBadge from "@/components/messages/MessageCountBadge";

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

type AttendeeStatusRow = {
  event_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
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
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string;
  group_id: string | null;
  status: "scheduled" | "cancelled";
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

const PLAYER_HOME_CACHE_TTL_MS = 45_000;
const playerHomeCacheKey = (userId: string) => `page-cache:player-home:v2:${userId}`;

type HeroCachePayload = {
  profile: Profile | null;
  clubs: Club[];
  updatedAt: number;
};

const HERO_CACHE_TTL_MS = 10 * 60 * 1000;

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
  if (!fi && !li) return "👤";
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
    return "Event";
  }
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclubs";
  if (v === "camp") return "Stage";
  if (v === "session") return "Réunion";
  return "Événement";
}

function priceLabel(it: Item, t: (key: string) => string) {
  if (it.is_free) return t("marketplace.free");
  if (it.price == null) return "—";
  return `${it.price} CHF`;
}

function compactMeta(it: Item) {
  const parts: string[] = [];
  if (it.category) parts.push(it.category);
  if (it.condition) parts.push(it.condition);
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

function effectiveHomeSessionType(session: TrainingSessionRow | HomeSessionRow) {
  if (session.club_event_id) return "club" as const;
  return session.session_type;
}

export default function PlayerHomePage() {
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
  const [isPerformanceEnabled, setIsPerformanceEnabled] = useState<boolean>(false);
  const [attendeeStatusByEventId, setAttendeeStatusByEventId] = useState<Record<string, "expected" | "present" | "absent" | "excused" | null>>({});
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [eventStructureByEventId, setEventStructureByEventId] = useState<Record<string, HomeEventStructureItem[]>>({});
  const [upcomingActivities, setUpcomingActivities] = useState<HomeUpcomingItem[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingIndex, setUpcomingIndex] = useState(0);
  const [messageBadgesByEventId, setMessageBadgesByEventId] = useState<Record<string, EventMessageBadge>>({});
  const [attendanceBusyEventId, setAttendanceBusyEventId] = useState<string>("");
  const [trainingVolumeRows, setTrainingVolumeRows] = useState<TrainingVolumeTargetRow[]>([]);
  const [trainingSeasonMonths, setTrainingSeasonMonths] = useState<number[]>([]);
  const [trainingOffseasonMonths, setTrainingOffseasonMonths] = useState<number[]>([]);

  const bucket = "marketplace";

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

  const monthEffectiveMinutes = useMemo(() => {
    if (isPerformanceEnabled) {
      return monthSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    }
    const nonClubEffective = monthSessions
      .filter((s) => effectiveHomeSessionType(s) !== "club")
      .reduce((sum, s) => sum + (s.total_minutes || 0), 0);
    return monthPlannedClubMinutes + nonClubEffective;
  }, [isPerformanceEnabled, monthSessions, monthPlannedClubMinutes]);

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

  async function loadUpcomingPreview(userId: string) {
    const nowIso = new Date().toISOString();
    try {
      const [futureSessionsRes, attendeeRes, plannedCompetitionsRes] = await Promise.all([
        supabase
          .from("training_sessions")
          .select("id,start_at,location_text,session_type,club_id,club_event_id")
          .eq("user_id", userId)
          .gte("start_at", nowIso)
          .order("start_at", { ascending: true })
          .limit(3),
        supabase.from("club_event_attendees").select("event_id,status").eq("player_id", userId),
        supabase
          .from("player_activity_events")
          .select("id,event_type,title,starts_at,ends_at,location_text,status")
          .eq("user_id", userId)
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(3),
      ]);

      const statusMap: Record<string, "expected" | "present" | "absent" | "excused" | null> = {};
      const attendeeEventIds = new Set<string>();
      if (!attendeeRes.error) {
        (attendeeRes.data ?? []).forEach((r: AttendeeStatusRow) => {
          const eid = String(r.event_id ?? "");
          if (!eid) return;
          attendeeEventIds.add(eid);
          statusMap[eid] = (r.status ?? null) as "expected" | "present" | "absent" | "excused" | null;
        });
      }
      setAttendeeStatusByEventId((prev) => ({ ...prev, ...statusMap }));

      let plannedEvents: HomePlannedEventRow[] = [];
      if (attendeeEventIds.size > 0) {
        const plannedRes = await supabase
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status")
          .in("id", Array.from(attendeeEventIds))
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(3);
        if (!plannedRes.error) plannedEvents = (plannedRes.data ?? []) as HomePlannedEventRow[];
      }

      const futureSessions = !futureSessionsRes.error ? ((futureSessionsRes.data ?? []) as HomeSessionRow[]) : [];
      const plannedCompetitions = !plannedCompetitionsRes.error
        ? ((plannedCompetitionsRes.data ?? []) as HomePlayerActivityRow[])
        : [];

      const previewUpcoming: HomeUpcomingItem[] = [
        ...plannedEvents.map((event) => ({ kind: "event" as const, key: `event-${event.id}`, dateIso: event.starts_at, event })),
        ...futureSessions.map((session) => ({ kind: "session" as const, key: `session-${session.id}`, dateIso: session.start_at, session })),
        ...plannedCompetitions.map((competition) => ({
          kind: "competition" as const,
          key: `competition-${competition.id}`,
          dateIso: competition.starts_at,
          competition,
        })),
      ]
        .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime())
        .slice(0, 3);

      setUpcomingActivities(previewUpcoming);
      setUpcomingIndex((i) => {
        if (previewUpcoming.length === 0) return 0;
        return Math.min(i, previewUpcoming.length - 1);
      });
      setUpcomingLoading(false);
    } catch {
      // keep default full-loading flow
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

      setPlayVolumeSummary({
        roundsCount: Number(json?.roundsCount ?? 0),
        holesPlayed: Number(json?.holesPlayed ?? 0),
        girPctAvg: typeof json?.girPctAvg === "number" ? json.girPctAvg : null,
        fwPctAvg: typeof json?.fwPctAvg === "number" ? json.fwPctAvg : null,
        puttAvg: typeof json?.puttAvg === "number" ? json.puttAvg : null,
        scramblingPct: typeof json?.scramblingPct === "number" ? json.scramblingPct : null,
      });
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
      setViewerUserId(viewerUid);
      setEffectiveUserId(effectiveUid);
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
        setEventStructureByEventId(pageCache.eventStructureByEventId);
        setUpcomingActivities(pageCache.upcomingActivities);
        setUpcomingLoading(false);
        setLoading(false);
      }
      if (!hasPageCache) {
        void loadUpcomingPreview(effectiveUid);
      }
      const heroCache = readHeroCache(effectiveUid);
      if (heroCache) {
        setProfile(heroCache.profile);
        setClubs(heroCache.clubs);
        setHeroLoading(false);
      }
    } catch {
      setError(t("roundsNew.error.invalidSession"));
      setLoading(false);
      setUpcomingLoading(false);
      setHeroLoading(false);
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
        }
      } else {
        setMonthPlannedClubMinutes(0);
      }
    } else {
      setMonthSessions([]);
      setMonthClubEventDurationById({});
      setMonthClubEventDurationByStartKey({});
      setMonthPlannedClubMinutes(0);
      setMonthItems([]);
    }

    // Upcoming activities (same family as /player/golf/trainings planned list)
    try {
      const nowIso = new Date().toISOString();
      const futureSessionsRes = await supabase
        .from("training_sessions")
        .select("id,start_at,location_text,session_type,club_id,club_event_id")
        .eq("user_id", effectiveUid)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(60);
      const futureSessions = !futureSessionsRes.error ? (futureSessionsRes.data ?? []) as HomeSessionRow[] : [];

      const attendeeRes = await supabase
        .from("club_event_attendees")
        .select("event_id,status")
        .eq("player_id", effectiveUid)
        .in("status", ["expected", "present", "excused"])
        .limit(2000);
      const statusMap: Record<string, "expected" | "present" | "absent" | "excused" | null> = {};
      const attendeeEventIds = new Set<string>();
      if (!attendeeRes.error) {
        (attendeeRes.data ?? []).forEach((r: AttendeeStatusRow) => {
          const eid = String(r.event_id ?? "");
          if (!eid) return;
          attendeeEventIds.add(eid);
          statusMap[eid] = (r.status ?? null) as "expected" | "present" | "absent" | "excused" | null;
        });
      }
      setAttendeeStatusByEventId(statusMap);

      let plannedEvents: HomePlannedEventRow[] = [];
      if (attendeeEventIds.size > 0) {
        const plannedRes = await supabase
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,status")
          .in("id", Array.from(attendeeEventIds))
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(80);
        if (!plannedRes.error) plannedEvents = (plannedRes.data ?? []) as HomePlannedEventRow[];
      }

      const linkedFutureEventIds = new Set(
        futureSessions
          .map((session) => String(session.club_event_id ?? "").trim())
          .filter((id) => id.length > 0)
      );
      plannedEvents = plannedEvents.filter((event) => !linkedFutureEventIds.has(event.id));

      const plannedCompetitionsRes = await supabase
        .from("player_activity_events")
        .select("id,event_type,title,starts_at,ends_at,location_text,status")
        .eq("user_id", effectiveUid)
        .eq("status", "scheduled")
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(60);
      const plannedCompetitions = !plannedCompetitionsRes.error
        ? (plannedCompetitionsRes.data ?? []) as HomePlayerActivityRow[]
        : [];

      const clubIdSet = new Set<string>();
      plannedEvents.forEach((e) => clubIdSet.add(e.club_id));
      futureSessions.forEach((s) => {
        if (s.club_id) clubIdSet.add(s.club_id);
      });
      if (clubIdSet.size > 0) {
        const clubRes = await supabase.from("clubs").select("id,name").in("id", Array.from(clubIdSet));
        const map: Record<string, string> = {};
        if (!clubRes.error) {
          (clubRes.data ?? []).forEach((c: Club) => {
            map[String(c.id)] = c.name ?? t("common.club");
          });
        }
        setClubNameById(map);
      } else {
        setClubNameById({});
      }

      const groupIds = Array.from(new Set(plannedEvents.map((e) => e.group_id).filter((x): x is string => Boolean(x))));
      if (groupIds.length > 0) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (token) {
          const query = new URLSearchParams({
            ids: groupIds.join(","),
            child_id: effectiveUid,
          });
          const gRes = await fetch(`/api/player/group-names?${query.toString()}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const gJson = await gRes.json().catch(() => ({}));
          const gMap: Record<string, string> = {};
          ((gJson?.groups ?? []) as Array<{ id: string; name: string | null }>).forEach((g) => {
            gMap[g.id] = g.name ?? "Groupe";
          });
          setGroupNameById(gMap);
        } else {
          setGroupNameById({});
        }
      } else {
        setGroupNameById({});
      }

      if (plannedEvents.length > 0) {
        const structRes = await supabase
          .from("club_event_structure_items")
          .select("event_id,category,minutes,note")
          .in("event_id", plannedEvents.map((e) => e.id));
        const map: Record<string, HomeEventStructureItem[]> = {};
        if (!structRes.error) {
          (structRes.data ?? []).forEach((r: HomeEventStructureItem) => {
            const eid = String(r.event_id ?? "");
            if (!eid) return;
            if (!map[eid]) map[eid] = [];
            map[eid].push(r);
          });
        }
        setEventStructureByEventId(map);
      } else {
        setEventStructureByEventId({});
      }

      const upcoming: HomeUpcomingItem[] = [
        ...plannedEvents.map((event) => ({ kind: "event" as const, key: `event-${event.id}`, dateIso: event.starts_at, event })),
        ...futureSessions.map((session) => ({ kind: "session" as const, key: `session-${session.id}`, dateIso: session.start_at, session })),
        ...plannedCompetitions.map((competition) => ({
          kind: "competition" as const,
          key: `competition-${competition.id}`,
          dateIso: competition.starts_at,
          competition,
        })),
      ].sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());
      setUpcomingActivities(upcoming);
      setUpcomingIndex((i) => {
        if (upcoming.length === 0) return 0;
        return Math.min(i, upcoming.length - 1);
      });
      setUpcomingLoading(false);
    } catch (e) {
      // Non-blocking: keep dashboard visible even if upcoming widgets timeout.
      console.warn("player home upcoming load failed:", e);
      setUpcomingActivities([]);
      setUpcomingLoading(false);
    }

    void loadRollingPlayVolume(effectiveUid, viewerUid);

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

  useEffect(() => {
    const ids = Array.from(
      new Set(
        upcomingActivities
          .filter((x) => x.kind === "event")
          .map((x) => String((x as any).event?.id ?? ""))
          .filter(Boolean)
      )
    );
    if (ids.length === 0) {
      setMessageBadgesByEventId({});
      return;
    }
    let cancelled = false;
    const loadBadges = async () => {
      const badges = await fetchEventMessageBadges(ids);
      if (!cancelled) setMessageBadgesByEventId(badges);
    };

    void loadBadges();

    const onFocus = () => void loadBadges();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadBadges();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (viewerUserId) {
      channel = supabase
        .channel(`player-home-event-badges-${viewerUserId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "thread_messages" },
          () => {
            void loadBadges();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "thread_participants",
            filter: `user_id=eq.${viewerUserId}`,
          },
          () => {
            void loadBadges();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_threads" },
          () => {
            void loadBadges();
          }
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [upcomingActivities, viewerUserId]);

  const avatarUrl = useMemo(() => {
    const base = profile?.avatar_url?.trim() || "";
    if (!base) return null;
    return `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }, [profile?.avatar_url]);

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
  const currentUpcoming = upcomingActivities[upcomingIndex] ?? null;
  const activityCategoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      warmup_mobility: t("cat.warmup_mobility"),
      long_game: t("cat.long_game"),
      short_game_all: t("cat.short_game_all"),
      putting: t("cat.putting"),
      wedging: t("cat.wedging"),
      pitching: t("cat.pitching"),
      chipping: t("cat.chipping"),
      bunker: t("cat.bunker"),
      course: t("cat.course"),
      mental: t("cat.mental"),
      fitness: t("cat.fitness"),
      other: t("cat.other"),
    };
    return map[cat] ?? cat;
  };

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
            <div className="hero-title">{heroLoading && !profile ? `${t("playerHome.hello")}…` : `${displayHello(profile, t)} 👋`}</div>

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

        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{pickLocaleText(locale, "Prochaine activité", "Upcoming activity")}</div>

          <div className="glass-card">
            {upcomingLoading ? (
              <div aria-live="polite" aria-busy="true" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ height: 12, width: "46%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ height: 10, width: "34%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                </div>
                <div className="hr-soft" style={{ margin: "2px 0" }} />
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ height: 14, width: "64%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ height: 10, width: "52%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                  <div style={{ height: 10, width: "72%", borderRadius: 999, background: "linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.1), rgba(0,0,0,0.06))", backgroundSize: "200% 100%", animation: "soft-shimmer 1.2s ease-in-out infinite" }} />
                </div>
              </div>
            ) : currentUpcoming ? (
              <>
                {currentUpcoming.kind === "event" ? (() => {
                  const e = currentUpcoming.event;
                  const linkedSession = upcomingActivities.find(
                    (item): item is Extract<HomeUpcomingItem, { kind: "session" }> =>
                      item.kind === "session" && item.session.club_event_id === e.id
                  )?.session ?? null;
                  const clubName = clubNameById[e.club_id] ?? t("common.club");
                  const groupName = e.group_id ? groupNameById[e.group_id] : null;
                  const eventEnd =
                    e.ends_at ??
                    new Date(new Date(e.starts_at).getTime() + Math.max(1, Number(e.duration_minutes ?? 0)) * 60_000).toISOString();
                  const isMultiDay = !sameDay(e.starts_at, eventEnd);
                  const eventType = eventTypeLabel(e.event_type, pickLocaleText(locale, "fr", "en"));
                  const attendanceStatus = attendeeStatusByEventId[e.id] ?? null;
                  const isAttendanceEvent = isClubAttendanceEventType(e.event_type);
                  const isTraining = e.event_type === "training";
                  const isCollapsedTraining = isAttendanceEvent && attendanceStatus === "absent";
                  const eventStructure = eventStructureByEventId[e.id] ?? [];
                  const showEventStructure = isAttendanceEvent && attendanceStatus === "present" && eventStructure.length > 0;
                  let eventTitle = eventType;
                  const customName = (e.title ?? "").trim();
                  if (e.event_type === "training") {
                    const trainingGroupLabel = groupName || (pickLocaleText(locale, "Groupe", "Group"));
                    eventTitle = `${pickLocaleText(locale, "Entraînement", "Training")} • ${trainingGroupLabel}`;
                  }
                  if (e.event_type !== "training") {
                    eventTitle = customName ? `${eventType} • ${customName}` : eventType;
                  }
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                          {isMultiDay ? (
                            <div>
                              {fmtDateLabelNoTime(e.starts_at, pickLocaleText(locale, "fr", "en"))} {pickLocaleText(locale, "au", "to")} {fmtDateLabelNoTime(eventEnd, pickLocaleText(locale, "fr", "en"))}
                            </div>
                          ) : (
                            <div>
                              {fmtDateLabelNoTime(e.starts_at, pickLocaleText(locale, "fr", "en"))}{" "}
                              <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                {locale === "fr"
                                  ? `• de ${fmtHourLabel(e.starts_at, "fr")} à ${fmtHourLabel(eventEnd, "fr")}`
                                  : `• from ${fmtHourLabel(e.starts_at, "en")} to ${fmtHourLabel(eventEnd, "en")}`}
                              </span>
                            </div>
                          )}
                        </div>
                        {isAttendanceEvent ? (
                          <AttendanceToggle
                            checked={attendanceStatus === "present"}
                            onToggle={() => handleTrainingAttendanceToggle(e, attendanceStatus)}
                            disabled={attendanceBusyEventId === e.id}
                            disabledCursor="wait"
                            ariaLabel={pickLocaleText(locale, "Basculer présence", "Toggle attendance")}
                            leftLabel={pickLocaleText(locale, "Absent", "Absent")}
                            rightLabel={pickLocaleText(locale, "Présent", "Present")}
                          />
                        ) : null}
                      </div>

                      <div className="hr-soft" style={{ margin: "1px 0" }} />

                      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                            {eventTitle}
                          </div>
                        </div>
                        {isAttendanceEvent && !isCollapsedTraining ? (
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                            {pickLocaleText(locale, "Organisé par", "Organized by")} {clubName}
                          </div>
                        ) : null}
                      </div>

                      {!isCollapsedTraining ? (
                        <>
                          {e.location_text ? (
                            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                              📍 {e.location_text}
                            </div>
                          ) : null}
                          {showEventStructure ? <div className="hr-soft" style={{ margin: "2px 0" }} /> : null}
                          {showEventStructure ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.70)" }}>
                                {pickLocaleText(locale, "Structure planifiée:", "Planned structure:")}
                              </div>
                              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                                {eventStructure.map((p, i) => {
                                  const extra = (p.note ?? "").trim();
                                  return (
                                    <li key={`${p.event_id}-${i}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                      {activityCategoryLabel(p.category)} — {p.minutes} min
                                      {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                          {e.event_type === "training" ? (
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                              <Link className="btn" href={linkedSession ? `/player/golf/trainings/${linkedSession.id}` : `/player/golf/trainings/new?club_event_id=${e.id}`}>
                                {pickLocaleText(locale, "Détails", "Details")}
                              </Link>
                              {(() => {
                                const badge = messageBadgesByEventId[String(e.id)] ?? { thread_id: null, message_count: 0, unread_count: 0 };
                                return (
                                  <Link
                                    className="btn"
                                    href={linkedSession ? `/player/golf/trainings/${linkedSession.id}` : `/player/golf/trainings/new?club_event_id=${encodeURIComponent(e.id)}`}
                                    title={pickLocaleText(locale, "Messagerie", "Messages")}
                                    aria-label={pickLocaleText(locale, "Ouvrir la page de l'activité", "Open activity page")}
                                  >
                                    <MessageCircle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                    {pickLocaleText(locale, "Messagerie", "Messages")}
                                    <MessageCountBadge
                                      messageCount={badge.message_count ?? 0}
                                      unreadCount={badge.unread_count ?? 0}
                                      showZero
                                      style={{ marginLeft: 6 }}
                                    />
                                  </Link>
                                );
                              })()}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                })() : null}

                {currentUpcoming.kind === "competition" ? (() => {
                  const c = currentUpcoming.competition;
                  const typeLabelComp =
                    c.event_type === "camp"
                      ? locale === "fr"
                        ? "Stage"
                        : "Camp"
                      : locale === "fr"
                      ? "Compétition"
                      : "Competition";
                  const title = `${typeLabelComp}${(c.title ?? "").trim() ? ` • ${(c.title ?? "").trim()}` : ""}`;
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                        {sameDay(c.starts_at, c.ends_at) ? (
                          <div>{fmtDateLabelNoTime(c.starts_at, pickLocaleText(locale, "fr", "en"))}</div>
                        ) : (
                          <div>
                            {fmtDateLabelNoTime(c.starts_at, pickLocaleText(locale, "fr", "en"))} {pickLocaleText(locale, "au", "to")} {fmtDateLabelNoTime(c.ends_at, pickLocaleText(locale, "fr", "en"))}
                          </div>
                        )}
                      </div>
                      <div className="hr-soft" style={{ margin: "1px 0" }} />
                      <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                        {title}
                      </div>
                      {c.location_text ? (
                        <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                          📍 {c.location_text}
                        </div>
                      ) : null}
                    </div>
                  );
                })() : null}

                {currentUpcoming.kind === "session" ? (() => {
                  const s = currentUpcoming.session;
                  const normalizedSessionType = s.club_event_id ? "club" : s.session_type;
                  const clubName = normalizedSessionType === "club" && s.club_id ? clubNameById[s.club_id] ?? t("common.club") : null;
                  const sessionTitle =
                    normalizedSessionType === "club"
                      ? `${pickLocaleText(locale, "Entraînement", "Training")}${clubName ? ` • ${clubName}` : ""}`
                      : `${normalizedSessionType === "private" ? (pickLocaleText(locale, "Cours privé", "Private lesson")) : (pickLocaleText(locale, "Entraînement individuel", "Individual training"))}`;
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                        <div>{fmtDateLabelNoTime(s.start_at, pickLocaleText(locale, "fr", "en"))}</div>
                        {hasDisplayableTime(s.start_at) ? (
                          <div style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>{fmtHourLabel(s.start_at, pickLocaleText(locale, "fr", "en"))}</div>
                        ) : null}
                      </div>
                      <div className="hr-soft" style={{ margin: "1px 0" }} />
                      <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                        {sessionTitle}
                      </div>
                      {s.location_text ? (
                        <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                          📍 {s.location_text}
                        </div>
                      ) : null}
                    </div>
                  );
                })() : null}
              </>
            ) : (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                {pickLocaleText(locale, "Aucune activité planifiée.", "No upcoming activity.")}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button
              className="btn"
              type="button"
              onClick={() => setUpcomingIndex((i) => Math.max(0, i - 1))}
              disabled={upcomingIndex <= 0 || upcomingActivities.length === 0}
            >
              {pickLocaleText(locale, "Précédent", "Previous")}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setUpcomingIndex((i) => Math.min(upcomingActivities.length - 1, i + 1))}
              disabled={upcomingIndex >= upcomingActivities.length - 1 || upcomingActivities.length === 0}
            >
              {pickLocaleText(locale, "Suivant", "Next")}
            </button>
          </div>
        </section>

        {/* ===== Volume d’entrainement ===== */}
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{t("playerHome.trainingVolume")}</div>

          <div className="glass-card">
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12, alignItems: "center" }}>
              <div>
                <div className="muted-uc">{thisMonthTitle}</div>

                <div style={{ marginTop: 6 }}>
                  <CountUpNumber value={trainingsSummary.totalMinutes} durationMs={2000} className="big-number" />
                  <span className="unit">{t("playerHome.minutesUnit")}</span>
                </div>

                <div className="hr-soft" />

                {trainingsSummary.objective > 0 ? (
                  <div style={{ fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>
                    {t("playerHome.goal")}: {trainingsSummary.objective} {t("common.min")}
                  </div>
                ) : null}
                {trainingVolumeMotivation ? (
                  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>
                    {trainingVolumeMotivation}
                  </div>
                ) : null}

                <div style={{ marginTop: 10 }}>
                  <span className="pill-soft">⛳ {trainingsSummary.count} {t("golfDashboard.sessions")}</span>
                </div>
              </div>

              <div className="donut-wrap">
                <Donut percent={trainingsSummary.percent} />
              </div>
            </div>
          </div>

          {isPerformanceEnabled ? (
            <div className="grid-2" style={{ marginTop: 12 }}>
              {/* Top secteurs */}
              <div className="glass-card">
                <div className="card-title">{t("playerHome.topSections")}</div>

                {trainingsSummary.top.length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("playerHome.noDataThisMonth")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {trainingsSummary.top.map((x) => {
                      const w = Math.round((x.minutes / topMax) * 100);
                      return (
                        <div key={x.cat}>
                          <div className="bar-row">
                            <div>{x.label}</div>
                            <div>{x.minutes}min</div>
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

              {/* ✅ Sensations : moyenne du mois + flèche vs séance précédente */}
              <div className="glass-card">
                <div className="card-title">{t("trainingDetail.feelings")}</div>

                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <div className="sense-row">
                      <div>{t("common.motivation")}</div>
                      <div style={senseRightStyle}>
                        <span className="sense-val">{trainingsSummary.motivationAvg ?? "—"}</span>
                        <ArrowOnly delta={trainingsSummary.deltaMotivation} />
                      </div>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${clamp(((trainingsSummary.motivationAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="sense-row">
                      <div>{t("common.difficulty")}</div>
                      <div style={senseRightStyle}>
                        <span className="sense-val">{trainingsSummary.difficultyAvg ?? "—"}</span>
                        <ArrowOnly delta={trainingsSummary.deltaDifficulty} />
                      </div>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${clamp(((trainingsSummary.difficultyAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="sense-row">
                      <div>{t("common.satisfaction")}</div>
                      <div style={senseRightStyle}>
                        <span className="sense-val">{trainingsSummary.satisfactionAvg ?? "—"}</span>
                        <ArrowOnly delta={trainingsSummary.deltaSatisfaction} />
                      </div>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${clamp(((trainingsSummary.satisfactionAvg ?? 0) / 6) * 100, 0, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <Link href="/player/golf/trainings/new" className="cta-green">
            <PlusCircle size={18} />
            {t("player.newTraining")}
          </Link>
        </section>

        {/* ===== Volume de jeu ===== */}
        <section className="glass-section">
          <div className="section-title">
            {pickLocaleText(locale, "Volume de jeu de l'année", "Yearly play volume")}
          </div>

          <div className="glass-card">
            {playVolumeLoading && !playVolumeLoadedOnce ? (
              <div
                style={{
                  marginTop: 4,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
                aria-hidden="true"
              >
                {[0, 1].map((idx) => (
                  <div
                    key={`play-volume-skeleton-${idx}`}
                    style={{
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: "rgba(0,0,0,0.08)",
                      background: "rgba(255,255,255,0.72)",
                      borderRadius: 16,
                      padding: "18px 12px",
                      textAlign: "center",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ height: 28, width: "46%", margin: "0 auto", borderRadius: 999, background: "rgba(15,23,42,0.14)" }} />
                    <div style={{ height: 12, width: "54%", margin: "0 auto", borderRadius: 999, background: "rgba(15,23,42,0.10)" }} />
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  marginTop: 4,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  alignItems: "center",
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
                      color: "var(--green-dark)",
                    }}
                  >
                    <CountUpNumber value={roundsMonthCount} durationMs={900} />
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 14,
                      fontWeight: 900,
                      letterSpacing: 1,
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
                      color: "var(--green-dark)",
                    }}
                  >
                    <CountUpNumber value={holesPlayedDisplay} durationMs={1200} />
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 14,
                      fontWeight: 900,
                      letterSpacing: 1,
                    }}
                  >
                    {t("playerHome.holes").toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {isPerformanceEnabled ? (
            <div
              className="glass-card"
              style={{
                marginTop: 12,
                border: "1px solid rgba(15,23,42,0.08)",
                background: "rgba(255,255,255,0.82)",
              }}
            >
              <div className="card-title">{t("playerHome.focus")}</div>

              {playVolumeLoading && !playVolumeLoadedOnce ? (
                <div
                  style={{ marginTop: 10, display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                  aria-hidden="true"
                >
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={`focus-skeleton-${idx}`}
                      style={{
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.82)",
                        padding: 12,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          height: 10,
                          width: "62%",
                          borderRadius: 999,
                          background: "rgba(15,23,42,0.10)",
                        }}
                      />
                      <div
                        style={{
                          height: 16,
                          width: "48%",
                          borderRadius: 999,
                          background: "rgba(15,23,42,0.14)",
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10, display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  {focusTiles.map((tile) => (
                    <div
                      key={tile.key}
                      style={{
                        border: "1px solid rgba(15,23,42,0.09)",
                        borderRadius: 12,
                        padding: "12px 12px 11px",
                        background: "rgba(255,255,255,0.72)",
                        display: "grid",
                        gap: 6,
                        textAlign: "center",
                      }}
                    >
                      <div
                        className="truncate"
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          letterSpacing: 1,
                          color: "rgba(0,0,0,0.72)",
                          textTransform: "uppercase",
                        }}
                      >
                        {tile.label}
                      </div>
                      <div
                        style={{
                          fontSize: 28,
                          lineHeight: 1,
                          fontWeight: 950,
                          color: "var(--green-dark)",
                        }}
                      >
                        {tile.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <Link href="/player/golf/rounds/new" className="cta-green">
            <PlusCircle size={18} />
            {t("player.newRound")}
          </Link>
        </section>

        {/* ===== Marketplace ===== */}
        <section className="glass-section">
          <div className="section-title">{t("nav.marketplace")}</div>

          {marketplaceLoading ? (
            <div className="marketplace-list" style={{ marginTop: 10 }}>
              {[0, 1, 2].map((idx) => (
                <div key={`mk-skeleton-${idx}`} className="marketplace-item" aria-hidden="true">
                  <div className="marketplace-row">
                    <div
                      className="marketplace-thumb"
                      style={{
                        background:
                          "linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.14), rgba(0,0,0,0.08))",
                        backgroundSize: "200% 100%",
                        animation: "soft-shimmer 1.2s ease-in-out infinite",
                      }}
                    />
                    <div className="marketplace-body" style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          height: 12,
                          width: "72%",
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.14), rgba(0,0,0,0.08))",
                          backgroundSize: "200% 100%",
                          animation: "soft-shimmer 1.2s ease-in-out infinite",
                        }}
                      />
                      <div
                        style={{
                          height: 10,
                          width: "48%",
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.14), rgba(0,0,0,0.08))",
                          backgroundSize: "200% 100%",
                          animation: "soft-shimmer 1.2s ease-in-out infinite",
                        }}
                      />
                      <div
                        style={{
                          marginTop: 4,
                          height: 22,
                          width: 86,
                          borderRadius: 999,
                          background:
                            "linear-gradient(90deg, rgba(0,0,0,0.08), rgba(0,0,0,0.14), rgba(0,0,0,0.08))",
                          backgroundSize: "200% 100%",
                          animation: "soft-shimmer 1.2s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : latestItems.length === 0 ? (
            <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("marketplace.none")}</div>
          ) : (
            <div className="marketplace-list" style={{ marginTop: 10 }}>
              {latestItems.map((it) => {
                const img = thumbByItemId[it.id] || placeholderThumb;
                const meta = compactMeta(it);

                return (
                  <Link key={it.id} href={`/player/marketplace/${it.id}`} className="marketplace-link">
                    <div className="marketplace-item">
                      <div className="marketplace-row">
                        <div className="marketplace-thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={it.title} loading="lazy" />
                        </div>

                        <div className="marketplace-body">
                          <div className="marketplace-item-title">{truncate(it.title, 80)}</div>
                          {meta && <div className="marketplace-meta">{meta}</div>}

                          <div className="marketplace-price-row">
                            <div className="marketplace-price-pill">{priceLabel(it, t)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <Link href="/player/marketplace/new" className="cta-green">
            <PlusCircle size={18} />
            {t("player.newListing")}
          </Link>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
