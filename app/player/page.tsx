"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

/* eslint-disable @next/next/no-img-element -- Marketplace thumbnails use user-managed Storage URLs. */

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlayerHomeBootstrapContext } from "@/components/player/PlayerHomeBootstrapContext";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { createAppNotification, getEventCoachUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { invalidateClientPageCacheByPrefix, readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import type { PlayerHomeSummary } from "@/lib/playerHomeSummary";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarCheck2, CheckCircle2, ClipboardCheck, MapPin, Medal, Newspaper, ShieldCheck, Target, type LucideIcon } from "lucide-react";
import type { ValidationDashboardPayload } from "@/lib/validations";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { etiquetteText } from "@/lib/etiquetteLabels";
import EtiquetteVisual from "@/components/etiquette/EtiquetteVisual";
import etiquetteVisualStyles from "@/components/etiquette/EtiquetteVisual.module.css";
import RulesVisual from "@/components/rules/RulesVisual";
import rulesVisualStyles from "@/components/rules/RulesVisual.module.css";
import dynamic from "next/dynamic";
import { buildManagementVolumeChartOption } from "@/lib/managementCharts";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import overviewStyles from "@/app/player/golf/PlayerGolfOverview.module.css";
import styles from "./PlayerDashboard.module.css";

type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

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
  viewerUserId: string;
  effectiveUserId: string;
  attendeeStatusByEventId: Record<string, "expected" | "present" | "absent" | "excused" | null>;
  clubNameById: Record<string, string>;
  groupNameById: Record<string, string>;
  coachNamesByEventId: Record<string, string[]>;
  eventStructureByEventId: Record<string, HomeEventStructureItem[]>;
  upcomingActivities: HomeUpcomingItem[];
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
const playerHomeCacheKey = (userId: string, viewerId: string, organizationIds: string[]) =>
  `page-cache:player-home:v4:${viewerId}:${userId}:${[...organizationIds].sort().join(",")}`;

const ActiviteeEChart = dynamic(() => import("@/components/ui/ActiviteeEChart"), {
  ssr: false,
  loading: () => <div className={playerUiStyles.skeleton} style={{ height: 260 }}><span /><span /><span /></div>,
});

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

/** Variation “dernière valeur vs précédente” (en ignorant les null) */
function deltaLastVsPrev(values: Array<number | null | undefined>) {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (v.length < 2) return null;
  const last = v[0];
  const prev = v[1];
  return Math.round((last - prev) * 10) / 10;
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
  const toneClass = tone === "positive" ? playerUiStyles.badgePositive : tone === "caution" ? playerUiStyles.badgeCaution : tone === "highlight" ? playerUiStyles.badgeHighlight : playerUiStyles.badgeNeutral;
  return <span className={`${playerUiStyles.badge} ${toneClass} ${styles.statusBadge}`}><Icon size={13} aria-hidden="true" />{children}</span>;
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
      if (!token || !active) return;
      try {
        const response = await fetch("/api/rules/overview", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as RulesHomeOverview;
        if (active && Array.isArray(payload.series)) setOverview(payload);
      } catch { /* Keep the useful static fallback when rules are unavailable. */ }
    })();
    return () => { active = false; };
  }, []);

  const tr = (fr: string, en: string, de?: string, it?: string) => pickLocaleText(locale, fr, en, de, it);
  const current = overview?.series.find(item => item.id === overview.currentSeriesId) ?? null;
  const month = current ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", { month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(new Date(current.discovery_starts_at)) : "";
  return <Link href="/player/rules" className={`${playerUiStyles.panel} ${styles.rulesCard}`}>
    <span className={`${playerUiStyles.panelHeader} ${styles.learningCardHeader}`}><span><h2>{tr("Règles de golf", "Golf rules")}</h2><p>{tr("Découvre les fiches de la série et prépare ton quiz.", "Explore the series cards and get ready for your quiz.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
    <span className={`${styles.rulesVisual} ${rulesVisualStyles.visual}`} aria-hidden="true"><RulesVisual /></span>
    <span className={styles.rulesBody}>
      {current ? <>
        <span className={styles.rulesCurrent}><small>{tr(`Série ${current.position} · ${month}`, `Series ${current.position} · ${month}`, `Serie ${current.position} · ${month}`, `Serie ${current.position} · ${month}`)}</small><strong>{current.title_i18n[locale] ?? current.title_i18n.fr}</strong></span>
        <p className={styles.rulesDescription}>{tr("Découvre les situations de la série à ton rythme, puis teste tes connaissances lors du quiz.", "Explore the situations in this series at your own pace, then test your knowledge in the quiz.")}</p>
      </> : <p>{tr("Six situations à découvrir dans la série en cours. Les bons réflexes, à ton rythme.", "Six situations in the current series. Learn the right reflexes at your own pace.")}</p>}
    </span>
  </Link>;
}

function PlayerEtiquetteHomeCard({ locale }: { locale: string }) {
  const labels = etiquetteText(locale);
  return <Link href="/player/etiquette" className={`${playerUiStyles.panel} ${styles.rulesCard} ${styles.etiquetteCard}`}>
    <span className={`${playerUiStyles.panelHeader} ${styles.learningCardHeader}`}><span><h2>{labels.title}</h2><p>{pickLocaleText(locale, "Les bons gestes à partager sur le parcours.", "Good habits to share on the course.", "Gute Gewohnheiten auf dem Platz.", "Buone abitudini da condividere sul campo.")}</p></span><ArrowRight size={16} aria-hidden="true" /></span>
    <span className={`${etiquetteVisualStyles.visual} ${styles.etiquetteVisual}`}><EtiquetteVisual /></span>
    <span className={styles.rulesBody}><span className={styles.rulesCurrent}><small>{labels.explore}</small><strong>{pickLocaleText(locale, "Joue juste, ensemble", "Play fair, play together", "Fair spielen, gemeinsam spielen", "Gioca lealmente, gioca insieme")}</strong></span><p className={styles.rulesDescription}>{pickLocaleText(locale, "Découvre les réflexes qui rendent chaque partie plus sûre et plus agréable pour tous.", "Discover the habits that make every round safer and more enjoyable for everyone.", "Entdecke, wie jede Runde für alle sicherer und angenehmer wird.", "Scopri i gesti che rendono ogni giro più sicuro e piacevole per tutti.")}</p></span>
  </Link>;
}

export default function PlayerHomePage() {
  const initialHomeRead = useContext(PlayerHomeBootstrapContext);
  const initialHomeReadOwner = useRef({});
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
  const [monthPlannedClubMinutes, setMonthPlannedClubMinutes] = useState<number>(0);
  const [monthPlannedClubEvents, setMonthPlannedClubEvents] = useState<Array<{ starts_at: string; ends_at: string | null; duration_minutes: number | null }>>([]);
  const [monthItems, setMonthItems] = useState<TrainingItemRow[]>([]);
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
  const [validationsLoading, setValidationsLoading] = useState(true);
  const [meritLoading, setMeritLoading] = useState(true);
  const [homeContext, setHomeContext] = useState<{
    userId: string; viewerId: string; role: "player" | "parent";
    organizationIds: string[]; performanceEnabled: boolean; handicap: number | null;
  } | null>(null);
  const [insightsError, setInsightsError] = useState(false);
  const [pendingTrainings, setPendingTrainings] = useState<PendingTraining[]>([]);
  const [attendanceInsight, setAttendanceInsight] = useState<AttendanceInsight | null>(null);
  const [meritInsight, setMeritInsight] = useState<MeritInsight>(null);
  const [validationDashboard, setValidationDashboard] = useState<ValidationDashboardPayload | null>(null);
  const [showProfilePhotoPrompt, setShowProfilePhotoPrompt] = useState(false);
  const [hidePhotoPromptForever, setHidePhotoPromptForever] = useState(false);

  const bucket = "marketplace";

  useEffect(() => {
    if (!homeContext) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const childQuery = homeContext.role === "parent" ? `?child_id=${encodeURIComponent(homeContext.userId)}` : "";
    const loadSummaries = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (signal.aborted) return;
      if (!token) throw new Error("Invalid session");
      const headers = { Authorization: `Bearer ${token}` };
      const { start, end } = monthRangeLocal(new Date());
      const previous = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const query = new URLSearchParams({ from: start.toISOString(), to: end.toISOString(), previous_from: previous.toISOString() });
      if (homeContext.role === "parent") query.set("child_id", homeContext.userId);
      // Each card family completes independently; a slow validation does not
      // hold attendance, monthly volume, or the upcoming-activity preview.
      const summary = async () => {
        try {
          const response = await fetch(`/api/player/home-summary?${query}`, { headers, cache: "no-store", signal });
          if (!response.ok) throw new Error("Unable to load Player summary");
          const data = await response.json() as PlayerHomeSummary & { volumeConfigs: Array<{
            rows: TrainingVolumeTargetRow[]; settings: { season_months: unknown; offseason_months: unknown } | null;
          }> };
          if (signal.aborted) return;
          setPendingTrainings(data.pendingTrainings);
          setAttendanceInsight(data.attendanceInsight);
          setMonthSessions(data.monthSessions);
          setMonthItems(data.monthItems as TrainingItemRow[]);
          setMonthClubEventDurationById(data.monthClubEventDurationById);
          setMonthPlannedClubEvents(data.monthPlannedClubEvents);
          setMonthPlannedClubMinutes(data.monthPlannedClubMinutes);
          const month = new Date().getMonth() + 1;
          const best = data.volumeConfigs.map(config => {
            const seasonMonths = parseMonthArray(config.settings?.season_months);
            const offseasonMonths = parseMonthArray(config.settings?.offseason_months);
            return { ...config, seasonMonths, offseasonMonths,
              objective: objectiveForMonth(pickTrainingVolumeTarget(homeContext.handicap, config.rows), seasonMonths, offseasonMonths, month) };
          }).sort((a, b) => b.objective - a.objective)[0];
          setTrainingVolumeRows(best?.rows ?? []);
          setTrainingSeasonMonths(best?.seasonMonths ?? []);
          setTrainingOffseasonMonths(best?.offseasonMonths ?? []);
        } catch {
          if (!signal.aborted) setInsightsError(true);
        } finally {
          if (!signal.aborted) { setLoading(false); setInsightsLoading(false); }
        }
      };
      const validations = async () => {
        try {
          const response = await fetch(`/api/player/validations${childQuery}`, { headers, cache: "no-store", signal });
          if (!response.ok) throw new Error("Unable to load validations");
          const data = await response.json() as ValidationDashboardPayload;
          if (!signal.aborted) setValidationDashboard(data);
        } catch { if (!signal.aborted) setInsightsError(true); }
        finally { if (!signal.aborted) setValidationsLoading(false); }
      };
      const merit = async () => {
        try {
          const organizationId = homeContext.organizationIds[0];
          if (!homeContext.performanceEnabled || !organizationId) return;
          const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
          const yearStart = `${today.slice(0, 4)}-01-01`;
          const previousMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
          const [ranking, previousRanking] = await Promise.all([
            supabase.rpc("om_ranking_snapshot", { p_org_id: organizationId, p_from: yearStart, p_as_of: today }).abortSignal(signal),
            previousMonthEnd >= yearStart ? supabase.rpc("om_ranking_snapshot", { p_org_id: organizationId, p_from: yearStart, p_as_of: previousMonthEnd }).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
          ]);
          if (signal.aborted) return;
          if (ranking.error) throw ranking.error;
          const rows = (ranking.data ?? []) as Array<{ player_id: string; rank_net: number }>;
          const mine = rows.find(row => row.player_id === homeContext.userId);
          if (mine && Number.isFinite(Number(mine.rank_net))) {
            const previousMine = !previousRanking.error ? ((previousRanking.data ?? []) as Array<{ player_id: string; rank_net: number }>).find(row => row.player_id === homeContext.userId) : null;
            setMeritInsight({ rank: Number(mine.rank_net), total: rows.length,
              change: previousMine && Number.isFinite(Number(previousMine.rank_net)) ? Number(previousMine.rank_net) - Number(mine.rank_net) : null });
          }
        } catch { if (!signal.aborted) setInsightsError(true); }
        finally { if (!signal.aborted) setMeritLoading(false); }
      };
      await Promise.all([summary(), validations(), merit()]);
    };
    void loadSummaries().catch(() => {
      if (!signal.aborted) { setInsightsError(true); setInsightsLoading(false); setValidationsLoading(false); setMeritLoading(false); setLoading(false); }
    });
    return () => controller.abort();
  }, [homeContext]);

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

  async function loadUpcomingPreview(userId: string, viewerUid: string, signal: AbortSignal) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token || signal.aborted) return;

      const query = new URLSearchParams();
      query.set("locale", locale);
      if (viewerUid && viewerUid !== userId) query.set("child_id", userId);
      const res = await fetch(`/api/player/home-upcoming?${query.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal,
      });
      const json = await res.json().catch(() => ({}));
      if (signal.aborted) return;
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
      if (!signal.aborted) setUpcomingActivities([]);
    } finally {
      if (!signal.aborted) setUpcomingLoading(false);
    }
  }

  async function loadLatestNews(userId: string, role: "player" | "parent", signal: AbortSignal) {
    try {
      setNewsLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (signal.aborted) return;
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
        signal,
      });
      const json = await res.json().catch(() => ({}));
      if (signal.aborted) return;
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to load news"));
      const rows = Array.isArray(json?.news) ? (json.news as HomeNewsItem[]) : [];
      setLatestNews(rows.slice(0, 3));
    } catch {
      if (signal.aborted) return;
      setLatestNews([]);
    } finally {
      if (!signal.aborted) setNewsLoading(false);
    }
  }

  async function loadLatestMarketplace(clubIds: string[], signal: AbortSignal) {
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
        .limit(3).abortSignal(signal);
      if (signal.aborted) return;

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
        .eq("sort_order", 0).abortSignal(signal);
      if (signal.aborted) return;

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
      if (signal.aborted) return;
      console.warn("player home marketplace load failed:", e);
      setLatestItems([]);
      setThumbByItemId({});
    } finally {
      if (!signal.aborted) setMarketplaceLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const load = async () => {
      try {
        const ctx = await resolveEffectivePlayerContext({ home: true, initialRead: initialHomeRead, initialReadOwner: initialHomeReadOwner.current });
        if (signal.aborted) return;
        if (!ctx.home) throw new Error("Player home context unavailable");
        const userId = ctx.effectiveUserId, viewerId = ctx.viewerUserId;
        const role = ctx.role === "parent" ? "parent" : "player";
        const organizationIds = ctx.home.organizations.map(organization => organization.id);
        const cached = readClientPageCache<PlayerHomePageCache>(playerHomeCacheKey(userId, viewerId, organizationIds), PLAYER_HOME_CACHE_TTL_MS);
        if (cached) {
          setLatestItems(cached.latestItems); setThumbByItemId(cached.thumbByItemId);
          setMonthSessions(cached.monthSessions); setMonthItems(cached.monthItems);
          setMonthClubEventDurationById(cached.monthClubEventDurationById ?? {});
          setMonthPlannedClubMinutes(cached.monthPlannedClubMinutes ?? 0);
          setUpcomingActivities(cached.upcomingActivities);
          setAttendeeStatusByEventId(cached.attendeeStatusByEventId);
          setClubNameById(cached.clubNameById); setGroupNameById(cached.groupNameById);
          setCoachNamesByEventId(cached.coachNamesByEventId ?? {}); setEventStructureByEventId(cached.eventStructureByEventId);
          setUpcomingLoading(false); setMarketplaceLoading(false);
        }
        setViewerUserId(viewerId); setEffectiveUserId(userId); setViewerRole(role);
        setProfile(ctx.home.profile); setClubs(ctx.home.organizations);
        setIsPerformanceEnabled(ctx.home.performanceEnabled); setHeroLoading(false);
        setHomeContext({ userId, viewerId, role, organizationIds,
          performanceEnabled: ctx.home.performanceEnabled, handicap: ctx.home.profile?.handicap ?? null });
        void loadUpcomingPreview(userId, viewerId, signal);
        void loadLatestNews(userId, role, signal);
        void loadLatestMarketplace(organizationIds, signal);
      } catch (cause) {
        if (signal.aborted) return;
        setError(cause instanceof Error ? cause.message : t("common.errorLoading"));
        setLoading(false); setHeroLoading(false); setUpcomingLoading(false);
        setMarketplaceLoading(false); setNewsLoading(false);
        setInsightsLoading(false); setValidationsLoading(false); setMeritLoading(false);
      }
    };
    void load();
    return () => controller.abort();
    // The shell remounts the page when the selected parent child changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || !effectiveUserId) return;
    writeClientPageCache(playerHomeCacheKey(effectiveUserId, viewerUserId, clubs.map(club => club.id)), {
      profile,
      clubs,
      latestItems,
      thumbByItemId,
      monthSessions,
      monthClubEventDurationById,
      monthPlannedClubMinutes,
      monthItems,
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
    if (!viewerUserId) return;
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

        <div className={playerUiStyles.page}>
          <div className={styles.firstRow}>
            <section id="player-upcoming-activities" className={playerUiStyles.panel}>
              <div className={playerUiStyles.panelHeader}>
                <div><h2>{pickLocaleText(locale, "Prochaines activités", "Upcoming activities")}</h2><p>{pickLocaleText(locale, "Les trois prochains rendez-vous.", "Your next three activities.")}</p></div>
                <Link className={playerUiStyles.textLink} href="/player/golf/trainings?type=all" aria-label={pickLocaleText(locale, "Voir mes activités", "View my activities")}><ArrowRight size={16} /></Link>
              </div>
              {upcomingLoading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : upcomingPreview.length ? (
                <div className={`${playerUiStyles.eventList} ${styles.alignedCardContent}`}>
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
                      ? (event.event_type === "competition" || event.event_type === "interclub"
                        ? "/player/golf/competitions/" + encodeURIComponent(event.id)
                        : "/player/golf/trainings/new?club_event_id=" + encodeURIComponent(event.id) + "&mode=view")
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
                      {event && isClubAttendanceEventType(event.event_type) ? <UpcomingAttendanceToggle variant={2} checked={status !== "absent" && status !== "excused"} onToggle={() => handleTrainingAttendanceToggle(event, status)} disabled={attendanceBusyEventId === event.id} absentLabel={pickLocaleText(locale, "Absent", "Absent")} presentLabel={pickLocaleText(locale, "Présent", "Present")} absentSentence={pickLocaleText(locale, "Absent", "Absent")} presentSentence={pickLocaleText(locale, "Présent", "Present")} ariaLabel={pickLocaleText(locale, `Présence pour ${title}`, `Attendance for ${title}`, `Anwesenheit für ${title}`, `Presenza per ${title}`)} /> : null}
                    </article>;
                  })}
                </div>
              ) : <div className={playerUiStyles.empty}>{pickLocaleText(locale, "Aucune activité planifiée.", "No upcoming activity.")}</div>}
            </section>

            <section className={playerUiStyles.panel}>
              <div className={playerUiStyles.panelHeader}><div><h2>{t("organization.newsTitle")}</h2><p>{t("organization.newsLead")}</p></div><Link className={playerUiStyles.textLink} href={allNewsHref} aria-label={pickLocaleText(locale, "Toutes les actualités", "All news")}><ArrowRight size={16} /></Link></div>
              {newsLoading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : latestNews.length ? (
                <div className={`${playerUiStyles.eventList} ${styles.alignedCardContent}`}>
                  {latestNews.map((news) => <Link key={news.id} href={allNewsHref} className={styles.newsHomeItem}>
                    {news.image_url ? <span className={styles.newsThumbnail}><img src={news.image_url} alt="" /></span> : <span className={playerUiStyles.dateBox}><Newspaper size={16} /></span>}
                    <div className={styles.newsHomeContent}>
                      <span className={styles.newsHomeDate}>{formatNewsPublishedLabel(news.published_at ?? news.scheduled_for ?? news.created_at, locale)}</span>
                      <b>{news.title}</b>
                      <span className={styles.newsHomeClub}>{news.club_name || clubNameById[news.club_id] || pickLocaleText(locale, "Club", "Club")}</span>
                      {news.summary ? <p className={styles.newsHomeSummary}>{truncate(news.summary, 92)}</p> : null}
                    </div>
                    <ArrowRight size={16} />
                  </Link>)}
                </div>
              ) : <div className={playerUiStyles.empty}>{pickLocaleText(locale, "Aucune actualité pour le moment.", "No news at the moment.")}</div>}
            </section>

            <section className={`${playerUiStyles.panel} ${styles.attentionCard}`}>
              <div className={playerUiStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Points d’attention", "Points of attention")}</h2><p>{pickLocaleText(locale, "Les éléments à vérifier prochainement.", "Things to review soon.")}</p></div></div>
              {upcomingLoading || insightsLoading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : (
                <div className={`${overviewStyles.attentionList} ${styles.attentionListCompact}`}>
                  {pendingTrainings.length ? <Link href="/player/golf/trainings/to-complete">
                    <span><ClipboardCheck size={17} /></span>
                    <div><b>{pendingTrainings.length} {pickLocaleText(locale, pendingTrainings.length === 1 ? "activité à évaluer" : "activités à évaluer", pendingTrainings.length === 1 ? "activity to evaluate" : "activities to evaluate")}</b><small>{pickLocaleText(locale, "Partager votre ressenti", "Share your feedback")}</small></div>
                    <ArrowRight size={15} />
                  </Link> : null}
                  {attentionEvents.map(({ event }) => <Link key={event.id} href={`/player/golf/trainings/new?club_event_id=${encodeURIComponent(event.id)}`}>
                    <span><AlertTriangle size={17} /></span>
                    <div><b>{pickLocaleText(locale, "Présence à confirmer", "Attendance to confirm")}</b><small>{event.title?.trim() || eventTypeLabel(event.event_type, locale)}</small></div>
                    <ArrowRight size={15} />
                  </Link>)}
                  {trainingsSummary.objective > 0 && trainingsSummary.percent < 100 && new Date().getDate() >= 20 ? (
                    <Link href="#player-training-volume"><span><Target size={17} /></span><div><b>{pickLocaleText(locale, "Objectif FTEM à poursuivre", "Keep working toward FTEM goal")}</b><small>{Math.round(trainingsSummary.percent)}% {pickLocaleText(locale, "réalisé", "completed")}</small></div><ArrowRight size={15} /></Link>
                  ) : null}
                  {!insightsError && !pendingTrainings.length && !attentionEvents.length && !(trainingsSummary.objective > 0 && trainingsSummary.percent < 100 && new Date().getDate() >= 20) ? <div className={overviewStyles.positiveState}><CalendarCheck2 size={20} /><b>{pickLocaleText(locale, "Tout est à jour", "Everything is up to date")}</b><small>{pickLocaleText(locale, "Aucune action nécessaire pour le moment.", "No action is needed right now.")}</small></div> : null}
                  {insightsError ? <div className={playerUiStyles.empty}>{pickLocaleText(locale, "Certaines données sont momentanément indisponibles.", "Some data is temporarily unavailable.")}</div> : null}
                </div>
              )}
            </section>

          </div>

          <section className={styles.learningSection}>
            <div className={styles.benchmarksHeader}><div><h2>{pickLocaleText(locale, "Mon parcours d’apprentissage", "My learning journey")}</h2><p>{pickLocaleText(locale, "Progresser dans mon jeu et enrichir mes connaissances.", "Improve my game and grow my knowledge.")}</p></div></div>
            <div className={styles.learningGrid}>
              <section className={`${playerUiStyles.panel} ${styles.homeValidationCard}`}>
                <div className={`${playerUiStyles.panelHeader} ${styles.learningCardHeader}`}><div><h2>{pickLocaleText(locale, "Mes prochaines validations", "My next validations")}</h2><p>{pickLocaleText(locale, "Les prochains objectifs de chaque section.", "The next goal in each section.")}</p></div><Link className={playerUiStyles.textLink} href="/player/validations" aria-label={pickLocaleText(locale, "Toutes mes validations", "All my validations")}><ArrowRight size={16} /></Link></div>
                {validationsLoading ? <div className={`${playerUiStyles.skeleton} ${styles.homeValidationLoading}`}><span /><span /><span /><span /></div> : validationHighlights.length ? (
                  <div className={`${playerUiStyles.eventList} ${styles.alignedCardContent}`}>
                    {validationHighlights.map(({ section, next }) => {
                      const attempts = next?.attempts.length ?? 0;
                      const href = `/player/validations?section_id=${encodeURIComponent(section.id)}${next ? `&exercise_id=${encodeURIComponent(next.id)}` : ""}`;
                      return <Link key={section.id} href={href} className={styles.validationHomeItem}>
                        <span className={styles.validationThumbnail}>
                          {next?.illustration_url ? <Image src={next.illustration_url} alt="" fill sizes="92px" /> : <ShieldCheck size={22} aria-hidden="true" />}
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
              <PlayerEtiquetteHomeCard locale={locale} />
            </div>
          </section>

          <section className={styles.benchmarksSection}>
            <div className={styles.benchmarksHeader}><div><h2>{pickLocaleText(locale, "Mes repères", "My benchmarks")}</h2><p>{pickLocaleText(locale, "Quelques indices en un coup d'oeil", "Your progress at a glance.")}</p></div></div>
            {insightsLoading || meritLoading ? <div className={styles.benchmarks}>{Array.from({ length: 2 }, (_, index) => <div className={`${styles.benchmark} ${styles.benchmarkSkeleton}`} key={index}><span /><span /><span /></div>)}</div> : <div className={styles.benchmarks}>
              <article className={styles.benchmark}>
                <div className={styles.benchmarkHeading}><span className={playerUiStyles.dateBox}><CalendarCheck2 size={17} /></span><h3>{pickLocaleText(locale, "Assiduité", "Attendance")}</h3><Link className={styles.benchmarkLink} href="/player/golf?section=stats" aria-label={pickLocaleText(locale, "Voir les statistiques d’assiduité", "View attendance statistics")}><ArrowRight size={15} /></Link></div>
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
                <div className={styles.benchmarkHeading}><span className={playerUiStyles.dateBox}><Medal size={17} /></span><h3>{pickLocaleText(locale, "Ordre du mérite", "Order of merit")}</h3><Link className={styles.benchmarkLink} href="/player/om" aria-label={pickLocaleText(locale, "Voir l’ordre du mérite", "View order of merit")}><ArrowRight size={15} /></Link></div>
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
            <section className={playerUiStyles.panel}>
              <div className={playerUiStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume d’entraînement du mois", "Monthly training volume")}</h2><p>{thisMonthTitle}</p></div></div>
              {loading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : <div className={styles.monthVolume}>
                {trainingsSummary.objective > 0 ? <Donut percent={trainingsSummary.percent} /> : <div className={playerUiStyles.empty}>{pickLocaleText(locale, "Objectif FTEM indisponible.", "FTEM goal unavailable.")}</div>}
                <strong>{trainingsSummary.totalMinutes} {t("common.min")}</strong>
                {trainingsSummary.objective > 0 ? <span>{pickLocaleText(locale, "sur", "of")} {trainingsSummary.objective} {t("common.min")}</span> : null}
                {trainingVolumeMotivation ? <p>{trainingVolumeMotivation}</p> : null}
              </div>}
            </section>
            <section className={playerUiStyles.panel}>
              <div className={playerUiStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Volume par semaine", "Weekly training volume")}</h2><p>{pickLocaleText(locale, "Réalisé et objectif FTEM pour chaque semaine du mois.", "Actual volume and FTEM goal for each week of the month.")}</p></div></div>
              {loading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : <><ActiviteeEChart ariaLabel={pickLocaleText(locale, "Volume hebdomadaire d’entraînement en minutes", "Weekly training volume in minutes")} option={buildManagementVolumeChartOption({ labels: weeklyVolume.map((item) => item.label), values: weeklyVolume.map((item) => item.minutes), valueLabel: t("golfDashboard.minutesPerWeek"), objective: weeklyVolume.map((item) => item.objective), objectiveLabel: pickLocaleText(locale, "Objectif FTEM", "FTEM goal") })} />{weeklyVolume.some((item) => item.objective != null) ? <small className={styles.chartNote}>{pickLocaleText(locale, "Objectif FTEM complet pour chaque semaine, y compris celles à cheval sur deux mois.", "Full FTEM goal for every week, including weeks spanning two months.")}</small> : null}</>}
            </section>
          </div>

          <section className={styles.marketplaceSection}>
            <div className={styles.benchmarksHeader}><div><h2>{t("nav.marketplace")}</h2><p>{pickLocaleText(locale, "Acheter, vendre et échanger au sein de vos clubs.", "Buy, sell and exchange within your clubs.")}</p></div></div>
            <section className={playerUiStyles.panel}>
              <div className={playerUiStyles.panelHeader}><div><h2>{pickLocaleText(locale, "Dernières annonces", "Latest listings")}</h2><p>{pickLocaleText(locale, "Les dernières annonces de vos clubs.", "Latest listings from your clubs.")}</p></div><Link className={playerUiStyles.textLink} href="/player/marketplace">{pickLocaleText(locale, "Toutes les annonces", "All listings")} <ArrowRight size={14} /></Link></div>
              {marketplaceLoading ? <div className={playerUiStyles.skeleton}><span /><span /><span /></div> : latestItems.length ? (
                <div className={"marketplace-list " + styles.marketplaceGrid}>
                  {latestItems.map((item) => <Link key={item.id} href={"/player/marketplace/" + item.id} className="marketplace-link"><div className="marketplace-item"><div className="marketplace-row">
                    <div className="marketplace-thumb">
                      <img src={thumbByItemId[item.id] || placeholderThumb} alt={item.title} loading="lazy" />
                    </div>
                    <div className="marketplace-body"><div className="marketplace-item-title">{truncate(item.title, 80)}</div>{compactMeta(item, locale) ? <div className="marketplace-meta">{compactMeta(item, locale)}</div> : null}<div className="marketplace-price-row"><div className="marketplace-price-pill">{priceLabel(item, t)}</div></div></div>
                  </div></div></Link>)}
                </div>
              ) : <div className={playerUiStyles.empty}>{t("marketplace.none")}</div>}
            </section>
          </section>
        </div>
      </div>
      {showProfilePhotoPrompt ? (
        <div
          className={styles.photoPromptOverlay}
          onClick={() => {
            if (typeof window !== "undefined" && viewerUserId) {
              window.localStorage.setItem(`player:photo-prompt:dismissed:${viewerUserId}`, "1");
            }
            setShowProfilePhotoPrompt(false);
          }}
        >
          <div
            className={styles.photoPrompt}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-photo-prompt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.photoPromptIntro}>
              <div className={styles.photoPromptPreview}>
                <div className={styles.photoPromptInitials}>
                  {getInitials(profile)}
                </div>
                <div className={styles.photoPromptArrow}>
                  <ArrowRight size={18} />
                </div>
                <div className={styles.photoPromptExample}>
                  <img
                    src="https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=160&q=80"
                    alt=""
                  />
                </div>
              </div>
              <h2 id="player-photo-prompt-title">{t("playerPhoto.title")}</h2>
              <p>{t("playerPhoto.description")}</p>
            </div>

            <label className={styles.photoPromptCheck}>
              <input
                type="checkbox"
                checked={hidePhotoPromptForever}
                onChange={(e) => setHidePhotoPromptForever(e.target.checked)}
              />
              <span>{t("playerPhoto.hide")}</span>
            </label>

            <div className={styles.photoPromptActions}>
              <button
                type="button"
                className={playerUiStyles.secondary}
                onClick={() => {
                  if (typeof window !== "undefined" && viewerUserId && hidePhotoPromptForever) {
                    window.localStorage.setItem(`player:photo-prompt:dismissed:${viewerUserId}`, "1");
                  }
                  setShowProfilePhotoPrompt(false);
                }}
              >
                {t("playerPhoto.later")}
              </button>
              <button
                type="button"
                className={playerUiStyles.primary}
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
                {t("playerPhoto.add")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
