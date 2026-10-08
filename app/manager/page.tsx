"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Bell, CalendarCheck2, CalendarDays, ChevronRight, ClipboardCheck, Layers3, Link2Off, Newspaper, Plus, RefreshCw, UserCheck, Users } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerActivityLabel, managerCount, managerFormat, managerLocaleTag } from "@/lib/managerLocale";
import { readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";

type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | "competition";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
  label?: string;
  href?: string;
};
type ProfileLite = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type DashboardStats = {
  clubsCount: number;
  usersCount: number;
  activeUsersCount: number;
  inactiveMemberships: number;
  groupsCount: number;
  activeGroupsCount: number;
  archivedGroupsCount: number;
  playersCount: number;
  parentsCount: number;
  juniorsWithoutParentCount: number;
  usersWithoutUsernameCount: number;
  groupsWithoutHeadCoachCount: number;
  pendingAttendanceCount: number;
  activitiesAwaitingCoachEvaluationCount: number;
  unreadNotificationsCount: number;
  trainingsCount: number;
  girlsCount: number;
  boysCount: number;
  juniorsAverageAge: number | null;
  plannedEventsCount: number;
  pastEventsCount: number;
  roleCounts: Record<"manager" | "coach" | "player" | "parent", number>;
  juniorsWithoutParent: Array<{ id: string; first_name: string | null; last_name: string | null }>;
  topAttendance: Array<{ player_id: string; name: string; present: number; total: number; rate: number }>;
};
type ManagerHomeCache = {
  groupNameById: Record<string, string>;
  upcomingEvents: EventLite[];
  me: ProfileLite | null;
  stats: DashboardStats;
};

const EMPTY_STATS: DashboardStats = {
  clubsCount: 0,
  usersCount: 0,
  activeUsersCount: 0,
  inactiveMemberships: 0,
  groupsCount: 0,
  activeGroupsCount: 0,
  archivedGroupsCount: 0,
  playersCount: 0,
  parentsCount: 0,
  juniorsWithoutParentCount: 0,
  usersWithoutUsernameCount: 0,
  groupsWithoutHeadCoachCount: 0,
  pendingAttendanceCount: 0,
  activitiesAwaitingCoachEvaluationCount: 0,
  unreadNotificationsCount: 0,
  trainingsCount: 0,
  girlsCount: 0,
  boysCount: 0,
  juniorsAverageAge: null,
  plannedEventsCount: 0,
  pastEventsCount: 0,
  roleCounts: { manager: 0, coach: 0, player: 0, parent: 0 },
  juniorsWithoutParent: [],
  topAttendance: [],
};

const managerHomeCacheKey = (userId: string, window: "30d" | "90d" | "6m" | "1y") =>
  `page-cache:manager-home-v6:${userId}:${window}`;
const MANAGER_HOME_CACHE_TTL_MS = 60_000;

function eventDateParts(iso: string, locale: string) {
  const date = new Date(iso);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date);
  return {
    day: format({ weekday: "short" }).replace(".", ""),
    number: date.getDate(),
    month: format({ month: "short" }).replace(".", ""),
    time: format({ hour: "2-digit", minute: "2-digit" }),
  };
}

function eventScheduleLabel(event: EventLite, locale: string) {
  if (event.event_type !== "competition") return eventDateParts(event.starts_at, locale).time;
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  const start = format(event.starts_at);
  const end = event.ends_at ? format(event.ends_at) : start;
  return start === end ? start : `${start} — ${end}`;
}

export default function ManagerHomePage() {
  const { t, locale } = useI18n();
  const count = (key: string, value: number) => managerCount(t, locale, `manager.home.${key}`, value);
  const format = (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.home.${key}`, values);
  const dateLocale = managerLocaleTag(locale);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statsError, setStatsError] = useState<string | null>(null);
  const assiduityWindow = "6m" as const;
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [upcomingEvents, setUpcomingEvents] = useState<EventLite[]>([]);
  const [me, setMe] = useState<ProfileLite | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setStatsError(null);
      try {
        const { data: authRes, error: authErr } = await supabase.auth.getUser();
        const uid = authRes.user?.id;
        if (authErr || !uid) {
          setUpcomingEvents([]);
          setGroupNameById({});
          setMe(null);
          return;
        }

        const cache = refreshNonce === 0
          ? readClientPageCache<ManagerHomeCache>(managerHomeCacheKey(uid, assiduityWindow), MANAGER_HOME_CACHE_TTL_MS)
          : null;
        if (cache) {
          setGroupNameById(cache.groupNameById);
          setUpcomingEvents(cache.upcomingEvents);
          setMe(cache.me);
          setStats(cache.stats);
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) {
          setUpcomingEvents([]);
          setGroupNameById({});
          setStatsError(t("manager.home.invalidSession"));
          return;
        }
        const homeRes = await fetch(`/api/manager/dashboard/home?window=${encodeURIComponent(assiduityWindow)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const homeJson = await homeRes.json().catch(() => ({}));
        if (!homeRes.ok) {
          setStatsError(String(homeJson?.error ?? t("manager.home.loadError")));
          setUpcomingEvents([]);
          setGroupNameById({});
          return;
        }

        const groupMap = (homeJson?.groupNameById ?? {}) as Record<string, string>;
        const upList = (homeJson?.upcomingEvents ?? []) as EventLite[];
        const nextMe = (homeJson?.me ?? null) as ProfileLite | null;
        const nextStats = homeJson?.stats as DashboardStats | undefined;

        setGroupNameById(groupMap);
        setUpcomingEvents(upList);
        setMe(nextMe);
        if (nextStats) setStats(nextStats);

        writeClientPageCache<ManagerHomeCache>(managerHomeCacheKey(uid, assiduityWindow), {
          groupNameById: groupMap,
          upcomingEvents: upList,
          me: nextMe,
          stats: nextStats ?? EMPTY_STATS,
        });
      } catch (e: unknown) {
        setStatsError(e instanceof Error ? e.message : t("manager.home.loadError"));
        setUpcomingEvents([]);
        setGroupNameById({});
      } finally {
        setLoading(false);
      }
    })();
  }, [t, refreshNonce]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    return managerActivityLabel(t, v);
  }

  function displayHello() {
    const first = (me?.first_name ?? "").trim();
    if (!first) return `${t("manager.home.hello")} 👋`;
    return `${t("manager.home.hello")} ${first} 👋`;
  }

  const displayedUpcomingEvents = upcomingEvents.slice(0, 10);
  const upcomingEventColumnSize = Math.ceil(displayedUpcomingEvents.length / 2);
  const upcomingEventColumns = upcomingEventColumnSize > 0
    ? [
        displayedUpcomingEvents.slice(0, upcomingEventColumnSize),
        displayedUpcomingEvents.slice(upcomingEventColumnSize),
      ].filter((column) => column.length > 0)
    : [];

  const heroClubLine = stats.clubsCount > 0
    ? `${t(stats.clubsCount===1?"organization.managedOrganization":"organization.managedOrganizations").replace("{count}",String(stats.clubsCount))} • ${count("user", stats.activeUsersCount)}`
    : "—";

  const overviewCards = [
    { label: t("manager.home.activeUsers"), value: stats.activeUsersCount, detail: format("total", { count: stats.usersCount.toLocaleString(dateLocale) }), icon: UserCheck, href: "/manager/user-management/players" },
    { label: t("manager.nav.juniors"), value: stats.playersCount, detail: format("genderSummary", { girls: count("girl", stats.girlsCount), boys: count("boy", stats.boysCount) }), icon: Users, href: "/manager/user-management/players" },
    { label: t("manager.home.activeGroups"), value: stats.activeGroupsCount, detail: format("archived", { count: stats.archivedGroupsCount.toLocaleString(dateLocale) }), icon: Layers3, href: "/manager/groups" },
    { label: t("manager.home.pastEvents"), value: stats.pastEventsCount, detail: t("organization.organizationHistory"), icon: CalendarDays, href: "/manager/calendar" },
    { label: t("manager.home.upcomingEvents"), value: stats.plannedEventsCount, detail: t("organization.organizationCalendar"), icon: CalendarDays, href: "/manager/calendar" },
    { label: t("manager.nav.notifications"), value: stats.unreadNotificationsCount, detail: t("manager.home.sentNotifications"), icon: Bell, href: "/manager/notifications" },
  ];

  const quickLinks = [
    { label: t("manager.home.addActivity"), detail: t("manager.home.scheduleActivity"), icon: Plus, href: "/manager/events/new" },
    { label: t("manager.home.manageJuniors"), detail: t("manager.home.people"), icon: Users, href: "/manager/user-management/players" },
    { label: t("manager.home.manageGroups"), detail: t("manager.home.membersCalendar"), icon: Layers3, href: "/manager/groups" },
    { label: t("manager.home.publishNews"), detail: t("manager.home.informMembers"), icon: Newspaper, href: "/manager/news" },
  ];

  const attentionItems = [
    stats.juniorsWithoutParentCount > 0 ? { href: "/manager/user-management/players", icon: Link2Off, label: count("withoutParent", stats.juniorsWithoutParentCount), detail: t("manager.home.openJuniors") } : null,
    stats.usersWithoutUsernameCount > 0 ? { href: "/manager/access", icon: Users, label: count("incompleteAccounts", stats.usersWithoutUsernameCount), detail: t("manager.home.completeAccess") } : null,
    stats.groupsWithoutHeadCoachCount > 0 ? { href: "/manager/groups", icon: Users, label: count("withoutHead", stats.groupsWithoutHeadCoachCount), detail: t("manager.home.reviewStaffing") } : null,
    stats.pendingAttendanceCount > 0 ? { href: "/manager/performance/coaches", icon: CalendarCheck2, label: count("attendance", stats.pendingAttendanceCount), detail: t("manager.home.reviewActivities") } : null,
    stats.activitiesAwaitingCoachEvaluationCount > 0 ? { href: "/manager/performance/coaches", icon: ClipboardCheck, label: count("evaluations", stats.activitiesAwaitingCoachEvaluationCount), detail: t("manager.home.reviewEvaluations") } : null,
    stats.inactiveMemberships > 0 ? { href: "/manager/access", icon: UserCheck, label: count("inactiveAccess", stats.inactiveMemberships), detail: t("manager.home.reviewFamilies") } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null).slice(0, 6);

  return (
    <div className={styles.page}>
      <nav aria-label={t("common.breadcrumb")} style={{ display: "flex", alignItems: "center", minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        {t("manager.home.workspace")}
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{loading ? `${t("manager.home.loadingHello")}…` : displayHello()}</h1>
          <p className={styles.lead}>{heroClubLine}</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
          <RefreshCw size={16} className={loading ? styles.spin : undefined} />
          {loading ? t("manager.refreshing") : t("manager.refresh")}
        </button>
      </div>

      {statsError ? <div className={styles.errorAlert} role="alert">{statsError}</div> : null}

      {!loading ? <section className={styles.quickPanel} aria-labelledby="manager-attention-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="manager-attention-title">{t("manager.home.attention")}</h2>
              <p>{t("manager.home.attentionHelp")}</p>
            </div>
          </div>
          {attentionItems.length ? <div className={styles.quickGrid}>{attentionItems.map((item) => { const Icon = item.icon; return <Link key={`${item.href}-${item.label}`} href={item.href} className={`${styles.quickLink} ${styles.attentionLink}`}><span><Icon size={18} /></span><div><b>{item.label}</b><small>{item.detail}</small></div><ChevronRight size={17} /></Link>; })}</div> : <p className={styles.attentionEmpty}>{t("manager.home.noAttention")}</p>}
        </section> : null}

      <section className={styles.overview} aria-labelledby="manager-overview-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-overview-title">{t("manager.home.overview")}</h2><p>{t("manager.home.overviewHelp")}</p></div></div>
        <div className={styles.statsGrid}>
          {overviewCards.map((card) => { const Icon = card.icon; return <article className={styles.statCard} key={card.label}><div className={styles.statTop}><span className={styles.statIcon}><Icon size={20} /></span><Link href={card.href} aria-label={card.label}><ChevronRight size={18} /></Link></div><span>{card.label}</span><b>{loading ? "—" : card.value.toLocaleString(dateLocale)}</b><small>{card.detail}</small></article>; })}
        </div>
      </section>

      <section className={styles.quickPanel} aria-labelledby="manager-shortcuts-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-shortcuts-title">{t("manager.home.shortcuts")}</h2><p>{t("manager.home.shortcutsHelp")}</p></div></div>
        <div className={styles.quickGrid}>
          {quickLinks.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={styles.quickLink}><span><Icon size={18} /></span><div><b>{item.label}</b><small>{item.detail}</small></div><ChevronRight size={17} /></Link>; })}
        </div>
      </section>

      <section className={styles.quickPanel} aria-labelledby="manager-events-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-events-title">{t("manager.home.nextEvents")}</h2><p>{t("manager.home.nextEventsHelp")}</p></div><Link href="/manager/calendar" className={styles.refreshButton}>{t("manager.home.viewCalendar")}</Link></div>
        {loading ? <ListLoadingBlock label={t("common.loading")} /> : upcomingEvents.length === 0 ? <div>{t("manager.home.noEvents")}</div> : (
          <div className={`${styles.quickGrid} ${styles.eventColumns}`}>
            {upcomingEventColumns.map((column, columnIndex) => (
              <div className={styles.eventColumn} key={`event-column-${columnIndex}`}>
                {column.map((event) => {
                  const date = eventDateParts(event.starts_at, dateLocale);
                  return (
                    <article key={event.id} className={`${styles.quickLink} ${styles.eventQuickLink}`}>
                      <div className={styles.eventDate} aria-label={`${date.day} ${date.number} ${date.month}`}>
                        <span>{date.day}</span>
                        <b>{date.number}</b>
                        <span>{date.month}</span>
                      </div>
                      <div>
                        <Link href={event.href ?? `/manager/groups/${event.group_id}/planning/${event.id}`}><b>{eventTypeLabel(event.event_type)} — {event.label ?? groupNameById[event.group_id] ?? t("manager.performance.group")}</b></Link>
                        <small>{eventScheduleLabel(event, dateLocale)}{event.location_text ? ` · ${event.location_text}` : ""}</small>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
