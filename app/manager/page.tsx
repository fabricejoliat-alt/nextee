"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Bell, CalendarDays, Dumbbell, Layers3, Link2Off, MessageCircle, UserCheck, UserCog, Users } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { fetchEventMessageBadges, type EventMessageBadge } from "@/lib/messages/eventBadgesClient";

type GroupRow = { id: string; name: string | null; club_id: string; is_active: boolean | null };
type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};
type EventAttendeeLite = {
  event_id: string;
  player_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
};
type ProfileLite = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type ManagedClub = { id: string; name: string | null };
type MemberLite = {
  id: string;
  club_id: string;
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean | null;
  profiles?: {
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    sex: string | null;
    birth_date: string | null;
  } | null;
};
type GuardianApiResponse = {
  players: Array<{
    user_id: string;
    profiles?: { first_name: string | null; last_name: string | null } | null;
  }>;
  links: Array<{ player_id: string; guardian_user_id: string }>;
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
  messagesCount: number;
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

const managerHomeCacheKey = (userId: string, window: "30d" | "90d" | "6m" | "1y") =>
  `page-cache:manager-home:${userId}:${window}`;
const MANAGER_HOME_CACHE_TTL_MS = 60_000;

function fmtDateTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

export default function ManagerHomePage() {
  const { t, locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [assiduityWindow, setAssiduityWindow] = useState<"30d" | "90d" | "6m" | "1y">("6m");
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [upcomingEvents, setUpcomingEvents] = useState<EventLite[]>([]);
  const [me, setMe] = useState<ProfileLite | null>(null);
  const [messageBadgesByEventId, setMessageBadgesByEventId] = useState<Record<string, EventMessageBadge>>({});
  const [stats, setStats] = useState<DashboardStats>({
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
    messagesCount: 0,
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
  });

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

        const cache = readClientPageCache<ManagerHomeCache>(managerHomeCacheKey(uid, assiduityWindow), MANAGER_HOME_CACHE_TTL_MS);
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
          setStatsError(tr("Session invalide.", "Invalid session."));
          return;
        }
        const homeRes = await fetch(`/api/manager/dashboard/home?window=${encodeURIComponent(assiduityWindow)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const homeJson = await homeRes.json().catch(() => ({}));
        if (!homeRes.ok) {
          setStatsError(String(homeJson?.error ?? tr("Impossible de charger les statistiques.", "Could not load dashboard statistics.")));
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
        stats: nextStats ?? stats,
      });
      } catch (e: unknown) {
        setStatsError(e instanceof Error ? e.message : tr("Impossible de charger les statistiques.", "Could not load dashboard statistics."));
        setUpcomingEvents([]);
        setGroupNameById({});
      } finally {
        setLoading(false);
      }
    })();
  }, [locale, assiduityWindow]);

  useEffect(() => {
    const ids = Array.from(new Set(upcomingEvents.map((e) => String(e.id ?? "")).filter(Boolean)));
    if (ids.length === 0) {
      setMessageBadgesByEventId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const badges = await fetchEventMessageBadges(ids);
      if (!cancelled) setMessageBadgesByEventId(badges);
    })();
    return () => {
      cancelled = true;
    };
  }, [upcomingEvents]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return "Interclub";
    if (v === "camp") return tr("Stage/Camp", "Camp");
    if (v === "session") return tr("Séance", "Session");
    return tr("Événement", "Event");
  }

  function renderMessagePill(eventId: string) {
    const badge = messageBadgesByEventId[String(eventId)] ?? { thread_id: null, message_count: 0, unread_count: 0 };
    const hasMessages = (badge.message_count ?? 0) > 0;
    const hasUnread = (badge.unread_count ?? 0) > 0;
    return (
      <Link
        href={`/manager/messages?event_id=${encodeURIComponent(eventId)}`}
        className="pill-soft"
        title={tr("Messagerie", "Messages")}
        aria-label={tr("Ouvrir la messagerie de l'événement", "Open event messages")}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", flexShrink: 0 }}
      >
        <MessageCircle size={14} />
        {tr("Messagerie", "Messages")}
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 900,
            color: "white",
            background: !hasMessages ? "rgba(107,114,128,0.95)" : hasUnread ? "rgba(220,38,38,0.95)" : "rgba(22,163,74,0.95)",
          }}
        >
          {badge.message_count ?? 0}
        </span>
      </Link>
    );
  }

  function displayHello() {
    const first = (me?.first_name ?? "").trim();
    if (!first) return `${tr("Salut", "Hello")} 👋`;
    return `${tr("Salut", "Hello")} ${first} 👋`;
  }

  function initials() {
    const f = (me?.first_name ?? "").trim();
    const l = (me?.last_name ?? "").trim();
    return `${f ? f[0].toUpperCase() : ""}${l ? l[0].toUpperCase() : ""}` || "👤";
  }

  const heroClubLine = useMemo(() => {
    if (stats.clubsCount <= 0) return "—";
    return pickLocaleText(
      locale,
      `${stats.clubsCount} club${stats.clubsCount > 1 ? "s" : ""} géré${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} utilisateurs actifs`,
      `${stats.clubsCount} managed club${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} active users`
    );
  }, [locale, stats.clubsCount, stats.activeUsersCount]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        <div className="player-hero">
          <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <div className="avatar" aria-hidden="true" style={{ position: "relative", overflow: "hidden" }}>
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                  {initials()}
                </div>
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="hero-title" style={{ color: "rgba(17,24,39,0.95)" }}>
              {loading ? `${tr("Salut", "Hello")}…` : displayHello()}
            </div>
            <div className="hero-sub" style={{ color: "rgba(17,24,39,0.78)" }}>
              <div>HCP PRO</div>
            </div>
            <div className="hero-club truncate" style={{ color: "rgba(17,24,39,0.72)" }}>
              {heroClubLine}
            </div>
          </div>
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 14, marginTop: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            {[
              { key: "users", label: tr("Utilisateurs", "Users"), value: stats.usersCount, icon: <Users size={16} /> },
              { key: "active", label: tr("Actifs", "Active"), value: stats.activeUsersCount, icon: <UserCheck size={16} /> },
              { key: "groups", label: tr("Groupes", "Groups"), value: stats.activeGroupsCount, icon: <Layers3 size={16} /> },
              { key: "messages", label: tr("Nombre de messages", "Messages count"), value: stats.messagesCount, icon: <MessageCircle size={16} /> },
              {
                key: "notifications",
                label: tr("Nombre de notifications", "Notifications count"),
                value: stats.unreadNotificationsCount,
                icon: <Bell size={16} />,
              },
              {
                key: "trainings",
                label: tr("Nombre d'entraînements", "Trainings count"),
                value: stats.trainingsCount,
                icon: <Dumbbell size={16} />,
              },
              {
                key: "girls-boys",
                label: tr("Filles / Garçons", "Girls / Boys"),
                value: `${stats.girlsCount} / ${stats.boysCount}`,
                icon: <Users size={16} />,
              },
              {
                key: "avg-age",
                label: tr("Âge moyen des juniors", "Average junior age"),
                value: stats.juniorsAverageAge == null ? "—" : String(stats.juniorsAverageAge),
                icon: <CalendarDays size={16} />,
              },
              {
                key: "no-parent",
                label: tr("Juniors sans parent", "Juniors without parent"),
                value: stats.juniorsWithoutParentCount,
                icon: <Link2Off size={16} />,
                danger: stats.juniorsWithoutParentCount > 0,
              },
            ].map((card) => (
              <div
                key={card.key}
                className="glass-card"
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "14px 12px",
                  borderColor: card.danger ? "rgba(239,68,68,0.35)" : undefined,
                  background: card.danger ? "rgba(239,68,68,0.08)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>{card.label}</div>
                  <div style={{ opacity: 0.7 }}>{card.icon}</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{loading ? "…" : card.value}</div>
              </div>
            ))}
          </div>

          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="card-title" style={{ marginBottom: 0, fontSize: 16 }}>
                {tr("Répartition des rôles", "Role distribution")}
              </div>
              <span className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <UserCog size={14} />
                {tr("Actifs", "Active")}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 8,
              }}
            >
              {[
                { role: "manager", label: tr("Managers", "Managers"), value: stats.roleCounts.manager },
                { role: "coach", label: tr("Coachs", "Coaches"), value: stats.roleCounts.coach },
                { role: "player", label: tr("Juniors", "Players"), value: stats.roleCounts.player },
                { role: "parent", label: tr("Parents", "Parents"), value: stats.roleCounts.parent },
              ].map((r) => (
                <div key={r.role} style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.6)" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8 }}>{r.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{loading ? "…" : r.value}</div>
                </div>
              ))}
            </div>

            {statsError ? (
              <div style={{ color: "rgba(127,29,29,1)", fontWeight: 800 }}>{statsError}</div>
            ) : null}

            {loading ? null : stats.juniorsWithoutParent.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(127,29,29,1)" }}>
                  {tr("Juniors sans parent lié", "Juniors without linked parent")}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 6,
                  }}
                >
                  {stats.juniorsWithoutParent.map((p) => (
                    <div key={p.id} className="pill-soft" style={{ justifyContent: "space-between" }}>
                      <span className="truncate">{fullName(p.first_name, p.last_name)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(21,128,61,1)" }}>
                {tr("Tous les juniors actifs ont au moins un parent lié.", "All active players have at least one linked parent.")}
              </div>
            )}

            {loading ? null : (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>
                    {tr("Juniors les plus assidus", "Most consistent juniors")}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      { key: "30d", labelFr: "30j", labelEn: "30d" },
                      { key: "90d", labelFr: "90j", labelEn: "90d" },
                      { key: "6m", labelFr: "6 mois", labelEn: "6m" },
                      { key: "1y", labelFr: "1 an", labelEn: "1y" },
                    ].map((opt) => {
                      const active = assiduityWindow === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className="btn"
                          onClick={() => setAssiduityWindow(opt.key as "30d" | "90d" | "6m" | "1y")}
                          style={{
                            padding: "6px 10px",
                            minHeight: "unset",
                            borderRadius: 10,
                            fontSize: 12,
                            fontWeight: 900,
                            background: active ? "rgba(21,128,61,0.16)" : "rgba(255,255,255,0.8)",
                            borderColor: active ? "rgba(21,128,61,0.38)" : "rgba(0,0,0,0.15)",
                            color: active ? "rgba(20,83,45,1)" : "rgba(0,0,0,0.75)",
                          }}
                        >
                          {pickLocaleText(locale, opt.labelFr, opt.labelEn)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {stats.topAttendance.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 700 }}>
                    {tr("Pas assez de données pour établir un classement (minimum 3 présences planifiées).", "Not enough data to rank yet (minimum 3 planned attendances).")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {stats.topAttendance.map((row, idx) => (
                      <div
                        key={row.player_id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.1)",
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.65)",
                          padding: "8px 10px",
                          display: "grid",
                          gridTemplateColumns: "30px minmax(0,1fr) auto",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 900, opacity: 0.75 }}>#{idx + 1}</div>
                        <div className="truncate" style={{ fontWeight: 800 }}>{row.name}</div>
                        <div style={{ fontWeight: 900 }}>
                          {Math.round(row.rate * 100)}% ({row.present}/{row.total})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 14, marginTop: 14 }}>
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="card-title" style={{ marginBottom: 0, fontSize: 16 }}>
                {tr("Prochains événements du club", "Upcoming club events")}
              </div>
              <span className="pill-soft">{upcomingEvents.length}</span>
            </div>

            {loading ? (
              <ListLoadingBlock label={t("common.loading")} />
            ) : upcomingEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucun événement à venir.", "No upcoming event.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {upcomingEvents.slice(0, 10).map((e) => (
                  <div key={e.id} className="marketplace-item">
                    <Link href={`/manager/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link" style={{ textDecoration: "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">
                          {eventTypeLabel(e.event_type)} — {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
                        </div>
                        {renderMessagePill(e.id)}
                      </div>
                      <div style={{ opacity: 0.8, fontWeight: 750, fontSize: 12, marginTop: 4 }}>
                        <CalendarDays size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {fmtDateTime(e.starts_at, dateLocale)}
                      </div>
                      {e.location_text ? <div style={{ opacity: 0.72, fontWeight: 750, fontSize: 12, marginTop: 4 }}>📍 {e.location_text}</div> : null}
                    </Link>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/manager/events/new" style={{ width: "100%", justifyContent: "center" }}>
                {tr("Ajouter un événement", "Add event")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/manager/calendar" style={{ width: "100%", justifyContent: "center" }}>
                {tr("Gérer les événements", "Manage events")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
