"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Building2, CalendarDays, Layers3, Link2Off, UserCheck, UserCog, UserX, Users } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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
  profiles?: { first_name: string | null; last_name: string | null; username: string | null } | null;
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
  plannedEventsCount: number;
  pastEventsCount: number;
  roleCounts: Record<"manager" | "coach" | "player" | "parent", number>;
  juniorsWithoutParent: Array<{ id: string; first_name: string | null; last_name: string | null }>;
  topAttendance: Array<{ player_id: string; name: string; present: number; total: number; rate: number }>;
};

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
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [assiduityWindow, setAssiduityWindow] = useState<"30d" | "90d" | "6m" | "1y">("6m");
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [upcomingEvents, setUpcomingEvents] = useState<EventLite[]>([]);
  const [me, setMe] = useState<ProfileLite | null>(null);
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

      const { data: authRes, error: authErr } = await supabase.auth.getUser();
      const uid = authRes.user?.id;
      if (authErr || !uid) {
        setUpcomingEvents([]);
        setGroupNameById({});
        setMe(null);
        setLoading(false);
        return;
      }

      const meRes = await supabase
        .from("profiles")
        .select("first_name,last_name,avatar_url")
        .eq("id", uid)
        .maybeSingle();
      if (!meRes.error && meRes.data) {
        setMe(meRes.data as ProfileLite);
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) {
        setUpcomingEvents([]);
        setGroupNameById({});
        setStatsError(tr("Session invalide.", "Invalid session."));
        setLoading(false);
        return;
      }

      const clubsRes = await fetch("/api/manager/my-clubs", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const clubsJson = await clubsRes.json().catch(() => ({}));
      if (!clubsRes.ok) {
        setStatsError(String(clubsJson?.error ?? tr("Impossible de charger les clubs.", "Could not load clubs.")));
        setUpcomingEvents([]);
        setGroupNameById({});
        setLoading(false);
        return;
      }

      const managedClubs = (Array.isArray(clubsJson?.clubs) ? clubsJson.clubs : []) as ManagedClub[];
      const clubIds = Array.from(new Set(managedClubs.map((c) => String(c?.id ?? "").trim()).filter(Boolean)));

      if (clubIds.length === 0) {
        setUpcomingEvents([]);
        setGroupNameById({});
        setStats({
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
          plannedEventsCount: 0,
          pastEventsCount: 0,
          roleCounts: { manager: 0, coach: 0, player: 0, parent: 0 },
          juniorsWithoutParent: [],
          topAttendance: [],
        });
        setLoading(false);
        return;
      }

      const membersByClubRes = await Promise.all(
        clubIds.map(async (clubId) => {
          const res = await fetch(`/api/manager/clubs/${clubId}/members`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const json = await res.json().catch(() => ({}));
          return { clubId, ok: res.ok, error: json?.error as string | undefined, members: (json?.members ?? []) as MemberLite[] };
        })
      );

      const guardianByClubRes = await Promise.all(
        clubIds.map(async (clubId) => {
          const res = await fetch(`/api/manager/clubs/${clubId}/guardians`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const json = await res.json().catch(() => ({}));
          return { clubId, ok: res.ok, error: json?.error as string | undefined, data: json as GuardianApiResponse };
        })
      );

      const firstMembersErr = membersByClubRes.find((r) => !r.ok);
      const firstGuardiansErr = guardianByClubRes.find((r) => !r.ok);
      if (firstMembersErr || firstGuardiansErr) {
        setStatsError(
          String(
            firstMembersErr?.error ??
              firstGuardiansErr?.error ??
              tr("Impossible de charger les statistiques.", "Could not load dashboard statistics.")
          )
        );
      }

      const allMembers = membersByClubRes.flatMap((r) => (r.ok ? r.members : []));
      const uniqueUsers = new Set(allMembers.map((m) => String(m.user_id ?? "").trim()).filter(Boolean));
      const activeMembers = allMembers.filter((m) => Boolean(m.is_active));
      const activeUserIds = new Set(activeMembers.map((m) => String(m.user_id ?? "").trim()).filter(Boolean));

      const roleSetByUser: Record<"manager" | "coach" | "player" | "parent", Set<string>> = {
        manager: new Set<string>(),
        coach: new Set<string>(),
        player: new Set<string>(),
        parent: new Set<string>(),
      };
      activeMembers.forEach((m) => {
        if (m.role === "manager" || m.role === "coach" || m.role === "player" || m.role === "parent") {
          roleSetByUser[m.role].add(String(m.user_id ?? "").trim());
        }
      });

      const usernamesByUserId = new Map<string, string | null>();
      allMembers.forEach((m) => {
        const userId = String(m.user_id ?? "").trim();
        if (!userId || usernamesByUserId.has(userId)) return;
        usernamesByUserId.set(userId, m.profiles?.username ?? null);
      });

      const usersWithoutUsernameCount = Array.from(activeUserIds).filter((id) => {
        const v = usernamesByUserId.get(id);
        return !v || !String(v).trim();
      }).length;

      const playerIds = new Set<string>();
      const playerNameById = new Map<string, { id: string; first_name: string | null; last_name: string | null }>();
      guardianByClubRes.forEach((row) => {
        if (!row.ok || !row.data) return;
        (row.data.players ?? []).forEach((p) => {
          const pid = String(p.user_id ?? "").trim();
          if (!pid) return;
          playerIds.add(pid);
          if (!playerNameById.has(pid)) {
            playerNameById.set(pid, {
              id: pid,
              first_name: p.profiles?.first_name ?? null,
              last_name: p.profiles?.last_name ?? null,
            });
          }
        });
      });
      const linkedPlayers = new Set<string>();
      guardianByClubRes.forEach((row) => {
        if (!row.ok || !row.data) return;
        (row.data.links ?? []).forEach((l) => {
          const pid = String(l.player_id ?? "").trim();
          if (pid) linkedPlayers.add(pid);
        });
      });

      const juniorsWithoutParent = Array.from(playerIds)
        .filter((pid) => !linkedPlayers.has(pid))
        .map((pid) => playerNameById.get(pid) ?? { id: pid, first_name: null, last_name: null })
        .sort((a, b) =>
          `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr")
        );

      const groupsRes = await supabase
        .from("coach_groups")
        .select("id,name,club_id,is_active")
        .in("club_id", clubIds);
      const groups = groupsRes.error ? [] : ((groupsRes.data ?? []) as GroupRow[]);
      const groupMap: Record<string, string> = {};
      groups.forEach((g) => {
        groupMap[g.id] = g.name ?? tr("Groupe", "Group");
      });
      setGroupNameById(groupMap);

      const archivedGroups = groups.filter((g) => String(g.name ?? "").trim() === "__ARCHIVE_HISTORIQUE__");
      const activeGroups = groups.filter((g) => Boolean(g.is_active) && String(g.name ?? "").trim() !== "__ARCHIVE_HISTORIQUE__");
      const planningGroupIds = activeGroups.map((g) => g.id);

      const nowIso = new Date().toISOString();
      let plannedEventsCount = 0;
      let pastEventsCount = 0;
      let topAttendance: Array<{ player_id: string; name: string; present: number; total: number; rate: number }> = [];

      if (planningGroupIds.length > 0) {
        const sinceDate = new Date();
        if (assiduityWindow === "30d") sinceDate.setDate(sinceDate.getDate() - 30);
        else if (assiduityWindow === "90d") sinceDate.setDate(sinceDate.getDate() - 90);
        else if (assiduityWindow === "1y") sinceDate.setFullYear(sinceDate.getFullYear() - 1);
        else sinceDate.setMonth(sinceDate.getMonth() - 6);
        const sinceDateIso = sinceDate.toISOString();

        const [plannedCountRes, pastCountRes, assiduityEventsRes] = await Promise.all([
          supabase
            .from("club_events")
            .select("id", { count: "exact", head: true })
            .in("group_id", planningGroupIds)
            .eq("status", "scheduled")
            .gte("starts_at", nowIso),
          supabase
            .from("club_events")
            .select("id", { count: "exact", head: true })
            .in("group_id", planningGroupIds)
            .eq("status", "scheduled")
            .lt("starts_at", nowIso),
          supabase
            .from("club_events")
            .select("id")
            .in("group_id", planningGroupIds)
            .eq("status", "scheduled")
            .lt("starts_at", nowIso)
            .gte("starts_at", sinceDateIso)
            .order("starts_at", { ascending: false })
            .limit(2000),
        ]);

        if (!plannedCountRes.error) plannedEventsCount = plannedCountRes.count ?? 0;
        if (!pastCountRes.error) pastEventsCount = pastCountRes.count ?? 0;

        const assiduityEventIds = (assiduityEventsRes.data ?? []).map((r: any) => String(r.id ?? "").trim()).filter(Boolean);
        if (!assiduityEventsRes.error && assiduityEventIds.length > 0) {
          const attendanceRes = await supabase
            .from("club_event_attendees")
            .select("player_id,status")
            .in("event_id", assiduityEventIds);

          if (!attendanceRes.error) {
            const counters = new Map<string, { present: number; total: number }>();
            ((attendanceRes.data ?? []) as Array<{ player_id: string; status: EventAttendeeLite["status"] }>).forEach((row) => {
              const playerId = String(row.player_id ?? "").trim();
              if (!playerId) return;
              if (row.status !== "present" && row.status !== "absent" && row.status !== "excused") return;
              const current = counters.get(playerId) ?? { present: 0, total: 0 };
              current.total += 1;
              if (row.status === "present") current.present += 1;
              counters.set(playerId, current);
            });

            const namesByPlayerId = new Map<string, string>();
            allMembers.forEach((m) => {
              const userId = String(m.user_id ?? "").trim();
              if (!userId || namesByPlayerId.has(userId)) return;
              namesByPlayerId.set(userId, fullName(m.profiles?.first_name ?? null, m.profiles?.last_name ?? null));
            });

            topAttendance = Array.from(counters.entries())
              .filter(([, c]) => c.total > 0)
              .map(([player_id, c]) => {
                const rate = c.total > 0 ? c.present / c.total : 0;
                return {
                  player_id,
                  name: namesByPlayerId.get(player_id) ?? fullName(playerNameById.get(player_id)?.first_name, playerNameById.get(player_id)?.last_name),
                  present: c.present,
                  total: c.total,
                  rate,
                };
              })
              .filter((row) => row.total >= 3)
              .sort((a, b) => {
                if (b.rate !== a.rate) return b.rate - a.rate;
                if (b.present !== a.present) return b.present - a.present;
                return b.total - a.total;
              })
              .slice(0, 5);
          }
        }
      }

      setStats({
        clubsCount: clubIds.length,
        usersCount: uniqueUsers.size,
        activeUsersCount: activeUserIds.size,
        inactiveMemberships: allMembers.filter((m) => m.is_active === false).length,
        groupsCount: groups.length,
        activeGroupsCount: activeGroups.length,
        archivedGroupsCount: archivedGroups.length,
        playersCount: roleSetByUser.player.size,
        parentsCount: roleSetByUser.parent.size,
        juniorsWithoutParentCount: juniorsWithoutParent.length,
        usersWithoutUsernameCount,
        plannedEventsCount,
        pastEventsCount,
        roleCounts: {
          manager: roleSetByUser.manager.size,
          coach: roleSetByUser.coach.size,
          player: roleSetByUser.player.size,
          parent: roleSetByUser.parent.size,
        },
        juniorsWithoutParent,
        topAttendance,
      });

      if (planningGroupIds.length === 0) {
        setUpcomingEvents([]);
        setLoading(false);
        return;
      }

      const upcomingRes = await fetch("/api/manager/events/upcoming?limit=10", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const upcomingJson = await upcomingRes.json().catch(() => ({}));
      if (!upcomingRes.ok) {
        setStatsError(String(upcomingJson?.error ?? tr("Impossible de charger les événements.", "Could not load events.")));
        setLoading(false);
        return;
      }

      const upList = (Array.isArray(upcomingJson?.events) ? upcomingJson.events : []) as EventLite[];
      setUpcomingEvents(upList);
      setLoading(false);
    })();
  }, [locale, assiduityWindow]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return "Interclub";
    if (v === "camp") return tr("Stage", "Camp");
    if (v === "session") return tr("Séance", "Session");
    return tr("Événement", "Event");
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
    if (locale === "en") {
      return `${stats.clubsCount} managed club${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} active users`;
    }
    return `${stats.clubsCount} club${stats.clubsCount > 1 ? "s" : ""} géré${stats.clubsCount > 1 ? "s" : ""} • ${stats.activeUsersCount} utilisateurs actifs`;
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
              {
                key: "no-parent",
                label: tr("Juniors sans parent", "Juniors without parent"),
                value: stats.juniorsWithoutParentCount,
                icon: <Link2Off size={16} />,
                danger: stats.juniorsWithoutParentCount > 0,
              },
              {
                key: "no-username",
                label: tr("Sans username", "Without username"),
                value: stats.usersWithoutUsernameCount,
                icon: <UserX size={16} />,
              },
              { key: "clubs", label: tr("Clubs gérés", "Managed clubs"), value: stats.clubsCount, icon: <Building2 size={16} /> },
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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="pill-soft">{tr("Groupes actifs", "Active groups")}: {loading ? "…" : stats.activeGroupsCount}</span>
              <span className="pill-soft">{tr("Groupes archivés", "Archived groups")}: {loading ? "…" : stats.archivedGroupsCount}</span>
              <span className="pill-soft">{tr("Parents", "Parents")}: {loading ? "…" : stats.parentsCount}</span>
              <span className="pill-soft">{tr("Juniors", "Players")}: {loading ? "…" : stats.playersCount}</span>
              <span className="pill-soft">{tr("Événements planifiés", "Planned events")}: {loading ? "…" : stats.plannedEventsCount}</span>
              <span className="pill-soft">{tr("Événements passés", "Past events")}: {loading ? "…" : stats.pastEventsCount}</span>
              <span className="pill-soft">{tr("Memberships inactifs", "Inactive memberships")}: {loading ? "…" : stats.inactiveMemberships}</span>
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
                  {stats.juniorsWithoutParent.slice(0, 8).map((p) => (
                    <div key={p.id} className="pill-soft" style={{ justifyContent: "space-between" }}>
                      <span className="truncate">{fullName(p.first_name, p.last_name)}</span>
                    </div>
                  ))}
                </div>
                {stats.juniorsWithoutParent.length > 8 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75 }}>
                    +{stats.juniorsWithoutParent.length - 8} {tr("autres", "others")}
                  </div>
                ) : null}
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
                          {locale === "fr" ? opt.labelFr : opt.labelEn}
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
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
            ) : upcomingEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucun événement à venir.", "No upcoming event.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {upcomingEvents.slice(0, 10).map((e) => (
                  <Link key={e.id} href={`/manager/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link">
                    <div className="marketplace-item">
                      <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">
                        {eventTypeLabel(e.event_type)} — {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
                      </div>
                      <div style={{ opacity: 0.8, fontWeight: 750, fontSize: 12, marginTop: 4 }}>
                        <CalendarDays size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {fmtDateTime(e.starts_at, dateLocale)}
                      </div>
                      {e.location_text ? <div style={{ opacity: 0.72, fontWeight: 750, fontSize: 12, marginTop: 4 }}>📍 {e.location_text}</div> : null}
                    </div>
                  </Link>
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
