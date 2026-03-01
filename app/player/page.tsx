"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { createAppNotification, getEventCoachUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { invalidateClientPageCacheByPrefix, readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { PlusCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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

type PlayerHomePageCache = {
  profile: Profile | null;
  clubs: Club[];
  latestItems: Item[];
  thumbByItemId: Record<string, string>;
  monthSessions: TrainingSessionRow[];
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
};

const PLAYER_HOME_CACHE_TTL_MS = 45_000;
const playerHomeCacheKey = (userId: string) => `page-cache:player-home:${userId}`;

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

function monthRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function monthTitle(now = new Date(), locale = "fr-CH") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(now).toUpperCase();
}

function fmtDateLabelNoTime(iso: string, locale: "fr" | "en") {
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

function fmtHourLabel(iso: string, locale: "fr" | "en") {
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

function eventTypeLabel(v: HomePlannedEventRow["event_type"], locale: "fr" | "en") {
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

/** Flèche “inverse” (pour putts): down=vert, up=rouge */
function ArrowOnlyInverseGoodDown({ delta }: { delta: number | null }) {
  if (delta == null || !Number.isFinite(delta)) return <span className="sense-val">—</span>;
  const up = delta > 0;
  const down = delta < 0;
  // ✅ inverse couleurs
  const cls = down ? "sense-val up" : up ? "sense-val down" : "sense-val";
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

export default function PlayerHomePage() {
  const { t, locale } = useI18n();
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [heroLoading, setHeroLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);

  const [latestItems, setLatestItems] = useState<Item[]>([]);
  const [thumbByItemId, setThumbByItemId] = useState<Record<string, string>>({});

  const [monthSessions, setMonthSessions] = useState<TrainingSessionRow[]>([]);
  const [monthItems, setMonthItems] = useState<TrainingItemRow[]>([]);

  // ✅ Rounds month + previous month (pour tendances focus)
  const [roundsMonth, setRoundsMonth] = useState<GolfRoundRow[]>([]);
  const [roundsPrevMonth, setRoundsPrevMonth] = useState<GolfRoundRow[]>([]);
  const [playedHolesMonthByRoundId, setPlayedHolesMonthByRoundId] = useState<Record<string, number>>({});
  const [playedHolesPrevMonthByRoundId, setPlayedHolesPrevMonthByRoundId] = useState<Record<string, number>>({});
  const [holesPlayedMonth, setHolesPlayedMonth] = useState<number>(0);
  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [effectiveUserId, setEffectiveUserId] = useState<string>("");
  const [attendeeStatusByEventId, setAttendeeStatusByEventId] = useState<Record<string, "expected" | "present" | "absent" | "excused" | null>>({});
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [eventStructureByEventId, setEventStructureByEventId] = useState<Record<string, HomeEventStructureItem[]>>({});
  const [upcomingActivities, setUpcomingActivities] = useState<HomeUpcomingItem[]>([]);
  const [upcomingIndex, setUpcomingIndex] = useState(0);
  const [attendanceBusyEventId, setAttendanceBusyEventId] = useState<string>("");

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

  const trainingsSummary = useMemo(() => {
    const totalMinutes = monthSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
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

    const objective = 500;
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
  }, [monthSessions, monthItems, t]);

  const topMax = useMemo(() => {
    const m = trainingsSummary.top.reduce((max, x) => Math.max(max, x.minutes), 0);
    return m || 1;
  }, [trainingsSummary.top]);

  // ===== Focus calculé depuis golf_rounds (comme dashboard) =====
  const focusFromRounds = useMemo(() => {
    const girPctVals = roundsMonth
      .map((r) => {
        if (typeof r.gir !== "number") return null;
        const played = playedHolesMonthByRoundId[r.id] ?? 0;
        if (played <= 0) return null;
        return (r.gir / played) * 100;
      })
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const fwPctVals = roundsMonth
      .map((r) => {
        if (typeof r.fairways_hit !== "number" || typeof r.fairways_total !== "number" || r.fairways_total <= 0) return null;
        return (r.fairways_hit / r.fairways_total) * 100;
      })
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const puttVals = roundsMonth
      .map((r) => {
        const played = playedHolesMonthByRoundId[r.id] ?? 0;
        if (played !== 18) return null;
        return typeof r.total_putts === "number" ? r.total_putts : null;
      })
      .filter((x): x is number => typeof x === "number");

    const girPctAvg = girPctVals.length ? Math.round((girPctVals.reduce((a, b) => a + b, 0) / girPctVals.length) * 10) / 10 : null;
    const fwPctAvg = fwPctVals.length ? Math.round((fwPctVals.reduce((a, b) => a + b, 0) / fwPctVals.length) * 10) / 10 : null;
    const puttAvg = puttVals.length ? Math.round((puttVals.reduce((a, b) => a + b, 0) / puttVals.length) * 10) / 10 : null;

    return { girPctAvg, fwPctAvg, puttAvg };
  }, [roundsMonth, playedHolesMonthByRoundId]);

  const prevFocusFromRounds = useMemo(() => {
    const girPctVals = roundsPrevMonth
      .map((r) => {
        if (typeof r.gir !== "number") return null;
        const played = playedHolesPrevMonthByRoundId[r.id] ?? 0;
        if (played <= 0) return null;
        return (r.gir / played) * 100;
      })
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const fwPctVals = roundsPrevMonth
      .map((r) => {
        if (typeof r.fairways_hit !== "number" || typeof r.fairways_total !== "number" || r.fairways_total <= 0) return null;
        return (r.fairways_hit / r.fairways_total) * 100;
      })
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const puttVals = roundsPrevMonth
      .map((r) => {
        const played = playedHolesPrevMonthByRoundId[r.id] ?? 0;
        if (played !== 18) return null;
        return typeof r.total_putts === "number" ? r.total_putts : null;
      })
      .filter((x): x is number => typeof x === "number");

    const girPctAvg = girPctVals.length ? Math.round((girPctVals.reduce((a, b) => a + b, 0) / girPctVals.length) * 10) / 10 : null;
    const fwPctAvg = fwPctVals.length ? Math.round((fwPctVals.reduce((a, b) => a + b, 0) / fwPctVals.length) * 10) / 10 : null;
    const puttAvg = puttVals.length ? Math.round((puttVals.reduce((a, b) => a + b, 0) / puttVals.length) * 10) / 10 : null;

    return { girPctAvg, fwPctAvg, puttAvg };
  }, [roundsPrevMonth, playedHolesPrevMonthByRoundId]);

  const focusDelta = useMemo(() => {
    const d = (cur: number | null, prev: number | null) => {
      if (cur == null || prev == null) return null;
      const v = cur - prev;
      return v === 0 ? 0 : v;
    };
    return {
      gir: d(focusFromRounds.girPctAvg, prevFocusFromRounds.girPctAvg),
      fw: d(focusFromRounds.fwPctAvg, prevFocusFromRounds.fwPctAvg),
      putt: d(focusFromRounds.puttAvg, prevFocusFromRounds.puttAvg),
    };
  }, [focusFromRounds, prevFocusFromRounds]);

  async function load() {
    setLoading(true);
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
      const pageCache = readClientPageCache<PlayerHomePageCache>(
        playerHomeCacheKey(effectiveUid),
        PLAYER_HOME_CACHE_TTL_MS
      );
      if (pageCache) {
        setProfile(pageCache.profile);
        setClubs(pageCache.clubs);
        setLatestItems(pageCache.latestItems);
        setThumbByItemId(pageCache.thumbByItemId);
        setMonthSessions(pageCache.monthSessions);
        setMonthItems(pageCache.monthItems);
        setRoundsMonth(pageCache.roundsMonth);
        setRoundsPrevMonth(pageCache.roundsPrevMonth);
        setPlayedHolesMonthByRoundId(pageCache.playedHolesMonthByRoundId);
        setPlayedHolesPrevMonthByRoundId(pageCache.playedHolesPrevMonthByRoundId);
        setHolesPlayedMonth(pageCache.holesPlayedMonth);
        setViewerUserId(pageCache.viewerUserId || viewerUid);
        setEffectiveUserId(pageCache.effectiveUserId || effectiveUid);
        setAttendeeStatusByEventId(pageCache.attendeeStatusByEventId);
        setClubNameById(pageCache.clubNameById);
        setGroupNameById(pageCache.groupNameById);
        setEventStructureByEventId(pageCache.eventStructureByEventId);
        setUpcomingActivities(pageCache.upcomingActivities);
        setLoading(false);
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
      setHeroLoading(false);
      return;
    }

    const [profRes, memRes] = await Promise.all([
      supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").eq("id", effectiveUid).maybeSingle(),
      supabase.from("club_members").select("club_id").eq("user_id", effectiveUid).eq("is_active", true),
    ]);

    if (profRes.error) {
      setError(profRes.error.message);
      setLoading(false);
      setHeroLoading(false);
      return;
    }
    setProfile((profRes.data ?? null) as Profile | null);
    if (memRes.error) {
      setError(memRes.error.message);
      setClubs([]);
      setLatestItems([]);
      setThumbByItemId({});
      setMonthSessions([]);
      setMonthItems([]);
      setRoundsMonth([]);
      setRoundsPrevMonth([]);
      setLoading(false);
      setHeroLoading(false);
      writeHeroCache(effectiveUid, { profile: (profRes.data ?? null) as Profile | null, clubs: [] });
      return;
    }

    const cids = ((memRes.data ?? []) as ClubMember[]).map((m) => m.club_id).filter(Boolean);

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

    // Latest marketplace items
    if (cids.length > 0) {
      const itemsRes = await supabase
        .from("marketplace_items")
        .select("id,title,created_at,price,is_free,category,condition,brand,model,club_id")
        .in("club_id", cids)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3);

      if (itemsRes.error) {
        setLatestItems([]);
        setThumbByItemId({});
      } else {
        const list = (itemsRes.data ?? []) as Item[];
        setLatestItems(list);

        const ids = list.map((x) => x.id);
        if (ids.length > 0) {
          const imgRes = await supabase.from("marketplace_images").select("item_id,path,sort_order").in("item_id", ids).eq("sort_order", 0);

          if (!imgRes.error) {
            const map: Record<string, string> = {};
            (imgRes.data ?? []).forEach((r: MarketplaceImageRow) => {
              const { data } = supabase.storage.from(bucket).getPublicUrl(r.path);
              if (data?.publicUrl) map[r.item_id] = data.publicUrl;
            });
            setThumbByItemId(map);
          } else {
            setThumbByItemId({});
          }
        } else {
          setThumbByItemId({});
        }
      }
    } else {
      setLatestItems([]);
      setThumbByItemId({});
    }

    // Trainings month
    const { start, end } = monthRangeLocal(new Date());
    const sRes = await supabase
      .from("training_sessions")
      .select("id,start_at,total_minutes,motivation,difficulty,satisfaction")
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
    } else {
      setMonthSessions([]);
      setMonthItems([]);
    }

    // Upcoming activities (same family as /player/golf/trainings planned list)
    const nowIso = new Date().toISOString();
    const futureSessionsRes = await supabase
      .from("training_sessions")
      .select("id,start_at,location_text,session_type,club_id,club_event_id")
      .eq("user_id", effectiveUid)
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true });
    const futureSessions = !futureSessionsRes.error ? (futureSessionsRes.data ?? []) as HomeSessionRow[] : [];

    const attendeeRes = await supabase
      .from("club_event_attendees")
      .select("event_id,status")
      .eq("player_id", effectiveUid);
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
        .order("starts_at", { ascending: true });
      if (!plannedRes.error) plannedEvents = (plannedRes.data ?? []) as HomePlannedEventRow[];
    }

    const plannedCompetitionsRes = await supabase
      .from("player_activity_events")
      .select("id,event_type,title,starts_at,ends_at,location_text,status")
      .eq("user_id", effectiveUid)
      .eq("status", "scheduled")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true });
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
    setUpcomingIndex(0);

    // Rounds month + prev month (GIR/fairways/putts)
    try {
      const { start: curStart, end: curEnd } = monthRangeLocal(new Date());

      const curR = await supabase
        .from("golf_rounds")
        .select("id,start_at,gir,fairways_hit,fairways_total,total_putts")
        .eq("user_id", effectiveUid)
        .gte("start_at", curStart.toISOString())
        .lt("start_at", curEnd.toISOString())
        .order("start_at", { ascending: false });

      setRoundsMonth((curR.data ?? []) as GolfRoundRow[]);
      const monthRoundIds = ((curR.data ?? []) as GolfRoundRow[]).map((r) => r.id).filter(Boolean);
      if (monthRoundIds.length > 0) {
        const holesRes = await supabase
          .from("golf_round_holes")
          .select("round_id,score")
          .in("round_id", monthRoundIds);
        const byRound: Record<string, number> = {};
        ((holesRes.data ?? []) as Array<{ round_id: string | null; score: number | null }>).forEach((h) => {
          if (!h?.round_id) return;
          if (typeof h.score !== "number") return;
          byRound[h.round_id] = (byRound[h.round_id] ?? 0) + 1;
        });
        setPlayedHolesMonthByRoundId(byRound);
        setHolesPlayedMonth(Object.values(byRound).reduce((sum, n) => sum + n, 0));
      } else {
        setPlayedHolesMonthByRoundId({});
        setHolesPlayedMonth(0);
      }

      const prevStart = new Date(curStart.getFullYear(), curStart.getMonth() - 1, 1, 0, 0, 0, 0);
      const prevEnd = new Date(curStart.getFullYear(), curStart.getMonth(), 1, 0, 0, 0, 0);

      const prevR = await supabase
        .from("golf_rounds")
        .select("id,start_at,gir,fairways_hit,fairways_total,total_putts")
        .eq("user_id", effectiveUid)
        .gte("start_at", prevStart.toISOString())
        .lt("start_at", prevEnd.toISOString())
        .order("start_at", { ascending: false });

      setRoundsPrevMonth((prevR.data ?? []) as GolfRoundRow[]);
      const prevRoundIds = ((prevR.data ?? []) as GolfRoundRow[]).map((r) => r.id).filter(Boolean);
      if (prevRoundIds.length > 0) {
        const prevHolesRes = await supabase
          .from("golf_round_holes")
          .select("round_id,score")
          .in("round_id", prevRoundIds);
        const byRoundPrev: Record<string, number> = {};
        ((prevHolesRes.data ?? []) as Array<{ round_id: string | null; score: number | null }>).forEach((h) => {
          if (!h?.round_id) return;
          if (typeof h.score !== "number") return;
          byRoundPrev[h.round_id] = (byRoundPrev[h.round_id] ?? 0) + 1;
        });
        setPlayedHolesPrevMonthByRoundId(byRoundPrev);
      } else {
        setPlayedHolesPrevMonthByRoundId({});
      }
    } catch {
      setRoundsMonth([]);
      setRoundsPrevMonth([]);
      setPlayedHolesMonthByRoundId({});
      setPlayedHolesPrevMonthByRoundId({});
      setHolesPlayedMonth(0);
    }

    setLoading(false);
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
      monthItems,
      roundsMonth,
      roundsPrevMonth,
      playedHolesMonthByRoundId,
      playedHolesPrevMonthByRoundId,
      holesPlayedMonth,
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
    monthItems,
    roundsMonth,
    roundsPrevMonth,
    playedHolesMonthByRoundId,
    playedHolesPrevMonthByRoundId,
    holesPlayedMonth,
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
        const localeKey = locale === "fr" ? "fr" : "en";
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
          (locale === "fr" ? "Joueur" : "Player");

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
            title: locale === "fr" ? "Présence confirmée" : "Attendance confirmed",
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

  const roundsMonthCount = roundsMonth.length;
  const currentUpcoming = upcomingActivities[upcomingIndex] ?? null;
  const activityCategoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      warmup_mobility: t("cat.warmup_mobility"),
      long_game: t("cat.long_game"),
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
    <div className="player-dashboard-bg">
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
              <div>Handicap {typeof profile?.handicap === "number" ? profile.handicap.toFixed(1) : "—"}</div>
            </div>

            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: "#ffd1d1", fontWeight: 800 }}>{error}</div>}

        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{locale === "fr" ? "Prochaine activité" : "Upcoming activity"}</div>

          <div className="glass-card">
            {currentUpcoming ? (
              <>
                {currentUpcoming.kind === "event" ? (() => {
                  const e = currentUpcoming.event;
                  const clubName = clubNameById[e.club_id] ?? t("common.club");
                  const groupName = e.group_id ? groupNameById[e.group_id] : null;
                  const eventEnd =
                    e.ends_at ??
                    new Date(new Date(e.starts_at).getTime() + Math.max(1, Number(e.duration_minutes ?? 0)) * 60_000).toISOString();
                  const isMultiDay = !sameDay(e.starts_at, eventEnd);
                  const eventType = eventTypeLabel(e.event_type, locale === "fr" ? "fr" : "en");
                  const attendanceStatus = attendeeStatusByEventId[e.id] ?? null;
                  const isTraining = e.event_type === "training";
                  const isCollapsedTraining = isTraining && attendanceStatus === "absent";
                  const eventStructure = eventStructureByEventId[e.id] ?? [];
                  const showEventStructure = isTraining && attendanceStatus === "present" && eventStructure.length > 0;
                  let eventTitle = eventType;
                  const customName = (e.title ?? "").trim();
                  if (e.event_type === "training") {
                    const trainingGroupLabel = groupName || (locale === "fr" ? "Groupe" : "Group");
                    eventTitle = `${locale === "fr" ? "Entraînement" : "Training"} • ${trainingGroupLabel}`;
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
                              {fmtDateLabelNoTime(e.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(eventEnd, locale === "fr" ? "fr" : "en")}
                            </div>
                          ) : (
                            <div>
                              {fmtDateLabelNoTime(e.starts_at, locale === "fr" ? "fr" : "en")}{" "}
                              <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                {locale === "fr"
                                  ? `• de ${fmtHourLabel(e.starts_at, "fr")} à ${fmtHourLabel(eventEnd, "fr")}`
                                  : `• from ${fmtHourLabel(e.starts_at, "en")} to ${fmtHourLabel(eventEnd, "en")}`}
                              </span>
                            </div>
                          )}
                        </div>
                        {isTraining ? (
                          <AttendanceToggle
                            checked={attendanceStatus === "present"}
                            onToggle={() => updateTrainingAttendance(e, attendanceStatus === "present" ? "absent" : "present")}
                            disabled={attendanceBusyEventId === e.id}
                            disabledCursor="wait"
                            ariaLabel={locale === "fr" ? "Basculer présence" : "Toggle attendance"}
                            leftLabel={locale === "fr" ? "Absent" : "Absent"}
                            rightLabel={locale === "fr" ? "Présent" : "Present"}
                          />
                        ) : null}
                      </div>

                      <div className="hr-soft" style={{ margin: "1px 0" }} />

                      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                        <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                          {eventTitle}
                        </div>
                        {isTraining && !isCollapsedTraining ? (
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                            {locale === "fr" ? "Organisé par" : "Organized by"} {clubName}
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
                          <div>{fmtDateLabelNoTime(c.starts_at, locale === "fr" ? "fr" : "en")}</div>
                        ) : (
                          <div>
                            {fmtDateLabelNoTime(c.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(c.ends_at, locale === "fr" ? "fr" : "en")}
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
                  const clubName = s.session_type === "club" && s.club_id ? clubNameById[s.club_id] ?? t("common.club") : null;
                  const sessionTitle =
                    s.session_type === "club"
                      ? `${locale === "fr" ? "Entraînement" : "Training"}${clubName ? ` • ${clubName}` : ""}`
                      : `${s.session_type === "private" ? (locale === "fr" ? "Cours privé" : "Private lesson") : (locale === "fr" ? "Entraînement individuel" : "Individual training")}`;
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                        <div>{fmtDateLabelNoTime(s.start_at, locale === "fr" ? "fr" : "en")}</div>
                        {hasDisplayableTime(s.start_at) ? (
                          <div style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>{fmtHourLabel(s.start_at, locale === "fr" ? "fr" : "en")}</div>
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
                {locale === "fr" ? "Aucune activité planifiée." : "No upcoming activity."}
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
              {locale === "fr" ? "Précédent" : "Previous"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setUpcomingIndex((i) => Math.min(upcomingActivities.length - 1, i + 1))}
              disabled={upcomingIndex >= upcomingActivities.length - 1 || upcomingActivities.length === 0}
            >
              {locale === "fr" ? "Suivant" : "Next"}
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
                  <span className="big-number">{trainingsSummary.totalMinutes}</span>
                  <span className="unit">{t("playerHome.minutesUnit")}</span>
                </div>

                <div className="hr-soft" />

                <div style={{ fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>{t("playerHome.goal")}: {trainingsSummary.objective} {t("common.min")}</div>

                <div style={{ marginTop: 10 }}>
                  <span className="pill-soft">⛳ {trainingsSummary.count} {t("golfDashboard.sessions")}</span>
                </div>
              </div>

              <div className="donut-wrap">
                <Donut percent={trainingsSummary.percent} />
              </div>
            </div>
          </div>

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

          <Link href="/player/golf/trainings/new" className="cta-green">
            <PlusCircle size={18} />
            {t("player.newTraining")}
          </Link>
        </section>

        {/* ===== Volume de jeu ===== */}
        <section className="glass-section">
          <div className="section-title">{t("golfDashboard.playVolume")}</div>

          <div className="glass-card">
            <div
              style={{
                marginTop: 4,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* PARCOURS */}
              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.55)",
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
                  {roundsMonthCount}
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

              {/* TROUS */}
              <div
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.55)",
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
                  {holesPlayedMonth}
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
          </div>

          <div className="glass-card" style={{ marginTop: 12 }}>
            <div className="card-title">{t("playerHome.focus")}</div>

            <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
              <div className="sense-row">
                <div>{t("golfDashboard.gir")}</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focusFromRounds.girPctAvg == null ? "—" : `${focusFromRounds.girPctAvg}%`}</div>
                  <ArrowOnly delta={focusDelta.gir} />
                </div>
              </div>

              <div className="sense-row">
                <div>{locale === "fr" ? "Nombre de putts (sur 18 trous)" : "Putts (18-hole rounds)"}</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focusFromRounds.puttAvg == null ? "—" : `${focusFromRounds.puttAvg}`}</div>
                  {/* ✅ inverse couleurs (baisse = bon = vert) */}
                  <ArrowOnlyInverseGoodDown delta={focusDelta.putt} />
                </div>
              </div>

              <div className="sense-row">
                <div>{t("golfDashboard.fairwaysHit")}</div>
                <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <div className="sense-val">{focusFromRounds.fwPctAvg == null ? "—" : `${focusFromRounds.fwPctAvg}%`}</div>
                  <ArrowOnly delta={focusDelta.fw} />
                </div>
              </div>
            </div>
          </div>

          <Link href="/player/golf/rounds/new" className="cta-green">
            <PlusCircle size={18} />
            {t("player.newRound")}
          </Link>
        </section>

        {/* ===== Marketplace ===== */}
        <section className="glass-section">
          <div className="section-title">{t("nav.marketplace")}</div>

          {loading ? (
            <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
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
