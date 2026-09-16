"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Bell, CalendarCheck2, CalendarDays, ChevronRight, ClipboardCheck, Layers3, Link2Off, Newspaper, Plus, RefreshCw, UserCheck, Users } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
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
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
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
          setStatsError(pickLocaleText(locale, "Session invalide.", "Invalid session."));
          return;
        }
        const homeRes = await fetch(`/api/manager/dashboard/home?window=${encodeURIComponent(assiduityWindow)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const homeJson = await homeRes.json().catch(() => ({}));
        if (!homeRes.ok) {
          setStatsError(String(homeJson?.error ?? pickLocaleText(locale, "Impossible de charger les statistiques.", "Could not load dashboard statistics.")));
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
        setStatsError(e instanceof Error ? e.message : pickLocaleText(locale, "Impossible de charger les statistiques.", "Could not load dashboard statistics."));
        setUpcomingEvents([]);
        setGroupNameById({});
      } finally {
        setLoading(false);
      }
    })();
  }, [locale, refreshNonce]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return "Interclub";
    if (v === "camp") return tr("Stage/Camp", "Camp");
    if (v === "session") return tr("Séance", "Session");
    if (v === "competition") return tr("Compétition", "Competition");
    return tr("Événement", "Event");
  }

  function displayHello() {
    const first = (me?.first_name ?? "").trim();
    if (!first) return `${tr("Salut", "Hello")} 👋`;
    return `${tr("Salut", "Hello")} ${first} 👋`;
  }

  const displayedUpcomingEvents = upcomingEvents.slice(0, 10);
  const upcomingEventColumnSize = Math.ceil(displayedUpcomingEvents.length / 2);
  const upcomingEventColumns = upcomingEventColumnSize > 0
    ? [
        displayedUpcomingEvents.slice(0, upcomingEventColumnSize),
        displayedUpcomingEvents.slice(upcomingEventColumnSize),
      ].filter((column) => column.length > 0)
    : [];

  const heroClubLine = useMemo(() => {
    if (stats.clubsCount <= 0) return "—";
    return pickLocaleText(
      locale,
      `${stats.clubsCount} club${stats.clubsCount > 1 ? "s" : ""} géré${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} utilisateurs actifs`,
      `${stats.clubsCount} managed club${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} active users`
    );
  }, [locale, stats.clubsCount, stats.activeUsersCount]);

  const overviewCards = [
    { label: tr("Utilisateurs actifs", "Active users"), value: stats.activeUsersCount, detail: `${stats.usersCount} ${tr("au total", "total")}`, icon: UserCheck, href: "/manager/user-management/players" },
    { label: tr("Juniors", "Players"), value: stats.playersCount, detail: locale === "fr" ? `${stats.girlsCount} fille${stats.girlsCount > 1 ? "s" : ""} et ${stats.boysCount} garçon${stats.boysCount > 1 ? "s" : ""}` : `${stats.girlsCount} girl${stats.girlsCount === 1 ? "" : "s"} and ${stats.boysCount} boy${stats.boysCount === 1 ? "" : "s"}`, icon: Users, href: "/manager/user-management/players" },
    { label: tr("Groupes actifs", "Active groups"), value: stats.activeGroupsCount, detail: `${stats.archivedGroupsCount} ${tr("archivés", "archived")}`, icon: Layers3, href: "/manager/groups" },
    { label: tr("Événements passés", "Past events"), value: stats.pastEventsCount, detail: tr("Historique du club", "Club history"), icon: CalendarDays, href: "/manager/calendar" },
    { label: tr("Événements à venir", "Upcoming events"), value: stats.plannedEventsCount, detail: tr("Planning du club", "Club calendar"), icon: CalendarDays, href: "/manager/calendar" },
    { label: tr("Notifications", "Notifications"), value: stats.unreadNotificationsCount, detail: tr("Notifications envoyées", "Sent notifications"), icon: Bell, href: "/manager/notifications" },
  ];

  const quickLinks = [
    { label: tr("Ajouter une activité", "Add an activity"), detail: tr("Planifier une activité", "Schedule an activity"), icon: Plus, href: "/manager/events/new" },
    { label: tr("Gérer les juniors", "Manage juniors"), detail: tr("Joueurs, parents et encadrants", "Players, parents and staff"), icon: Users, href: "/manager/user-management/players" },
    { label: tr("Gérer les groupes", "Manage groups"), detail: tr("Composition et planning", "Members and calendar"), icon: Layers3, href: "/manager/groups" },
    { label: tr("Publier une actualité", "Publish news"), detail: tr("Informer les membres", "Keep members informed"), icon: Newspaper, href: "/manager/news" },
  ];

  const attentionItems = [
    stats.juniorsWithoutParentCount > 0 ? { href: "/manager/user-management/players", icon: Link2Off, label: `${stats.juniorsWithoutParentCount} ${tr("juniors sans parent lié", "players without a linked parent")}`, detail: tr("Ouvrir les fiches juniors", "Open junior profiles") } : null,
    stats.usersWithoutUsernameCount > 0 ? { href: "/manager/access", icon: Users, label: `${stats.usersWithoutUsernameCount} ${tr("comptes incomplets", "incomplete accounts")}`, detail: tr("Compléter les informations d’accès", "Complete access information") } : null,
    stats.groupsWithoutHeadCoachCount > 0 ? { href: "/manager/groups", icon: Users, label: `${stats.groupsWithoutHeadCoachCount} ${tr("groupes sans coach principal", "groups without a head coach")}`, detail: tr("Vérifier l’encadrement des groupes", "Review group staffing") } : null,
    stats.pendingAttendanceCount > 0 ? { href: "/manager/performance/coaches", icon: CalendarCheck2, label: `${stats.pendingAttendanceCount} ${tr("présences à renseigner", "attendance records to complete")}`, detail: tr("Consulter le suivi des activités", "Review activity tracking") } : null,
    stats.activitiesAwaitingCoachEvaluationCount > 0 ? { href: "/manager/performance/coaches", icon: ClipboardCheck, label: `${stats.activitiesAwaitingCoachEvaluationCount} ${tr("activités à évaluer par les coachs", "activities awaiting coach evaluation")}`, detail: tr("Consulter les évaluations à compléter", "Review evaluations to complete") } : null,
    stats.inactiveMemberships > 0 ? { href: "/manager/access", icon: UserCheck, label: `${stats.inactiveMemberships} ${tr("accès inactifs", "inactive access records")}`, detail: tr("Examiner les accès aux familles", "Review family access") } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null).slice(0, 6);

  return (
    <div className={styles.page}>
      <nav aria-label={tr("Fil d’Ariane", "Breadcrumb")} style={{ display: "flex", alignItems: "center", minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        {tr("Espace manager", "Manager workspace")}
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{loading ? `${tr("Bonjour", "Hello")}…` : displayHello()}</h1>
          <p className={styles.lead}>{heroClubLine}</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
          <RefreshCw size={16} className={loading ? styles.spin : undefined} />
          {loading ? tr("Actualisation…", "Refreshing…") : tr("Actualiser", "Refresh")}
        </button>
      </div>

      {statsError ? <div className={styles.errorAlert} role="alert">{statsError}</div> : null}

      {!loading ? <section className={styles.quickPanel} aria-labelledby="manager-attention-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="manager-attention-title">{tr("Points d’attention", "Points of attention")}</h2>
              <p>{tr("Quelques éléments utiles à vérifier en priorité.", "A few useful items to review first.")}</p>
            </div>
          </div>
          {attentionItems.length ? <div className={styles.quickGrid}>{attentionItems.map((item) => { const Icon = item.icon; return <Link key={`${item.href}-${item.label}`} href={item.href} className={`${styles.quickLink} ${styles.attentionLink}`}><span><Icon size={18} /></span><div><b>{item.label}</b><small>{item.detail}</small></div><ChevronRight size={17} /></Link>; })}</div> : <p className={styles.attentionEmpty}>{tr("Aucun point d’attention prioritaire pour le moment.", "No priority item needs attention right now.")}</p>}
        </section> : null}

      <section className={styles.overview} aria-labelledby="manager-overview-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-overview-title">{tr("Vue d’ensemble", "Overview")}</h2><p>{tr("Les indicateurs essentiels de votre organisation.", "Key indicators for your organization.")}</p></div></div>
        <div className={styles.statsGrid}>
          {overviewCards.map((card) => { const Icon = card.icon; return <article className={styles.statCard} key={card.label}><div className={styles.statTop}><span className={styles.statIcon}><Icon size={20} /></span><Link href={card.href} aria-label={card.label}><ChevronRight size={18} /></Link></div><span>{card.label}</span><b>{loading ? "—" : card.value}</b><small>{card.detail}</small></article>; })}
        </div>
      </section>

      <section className={styles.quickPanel} aria-labelledby="manager-shortcuts-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-shortcuts-title">{tr("Raccourcis", "Shortcuts")}</h2><p>{tr("Accédez rapidement aux tâches les plus fréquentes.", "Quick access to frequent tasks.")}</p></div></div>
        <div className={styles.quickGrid}>
          {quickLinks.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={styles.quickLink}><span><Icon size={18} /></span><div><b>{item.label}</b><small>{item.detail}</small></div><ChevronRight size={17} /></Link>; })}
        </div>
      </section>

      <section className={styles.quickPanel} aria-labelledby="manager-events-title">
        <div className={styles.sectionHeading}><div><h2 id="manager-events-title">{tr("Prochains événements", "Upcoming events")}</h2><p>{tr("Les dix prochaines activités planifiées.", "The next ten scheduled activities.")}</p></div><Link href="/manager/calendar" className={styles.refreshButton}>{tr("Voir le calendrier", "View calendar")}</Link></div>
        {loading ? <ListLoadingBlock label={t("common.loading")} /> : upcomingEvents.length === 0 ? <div>{tr("Aucun événement à venir.", "No upcoming event.")}</div> : (
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
                        <Link href={event.href ?? `/manager/groups/${event.group_id}/planning/${event.id}`}><b>{eventTypeLabel(event.event_type)} — {event.label ?? groupNameById[event.group_id] ?? tr("Groupe", "Group")}</b></Link>
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
