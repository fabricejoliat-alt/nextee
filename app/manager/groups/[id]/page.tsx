"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { managerGroupFeedback, managerGroupFormat } from "@/lib/managerGroupPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CalendarDays, PlusCircle, Save, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type Role = "coach" | "manager" | "player";

type Club = { id: string; name: string | null };

type CoachGroup = {
  id: string;
  created_at: string;
  club_id: string;
  name: string;
  is_active: boolean;
  is_performance: boolean;
  head_coach_user_id: string | null;
  clubs?: Club | null;
};

type ClubMemberRow = {
  club_id: string;
  user_id: string;
  is_active: boolean | null;
  is_performance: boolean | null;
  role: Role;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type GroupPlayerRow = {
  id: string;
  group_id: string;
  player_user_id: string;
  profiles?: ProfileLite | null;
};

type GroupCoachRow = {
  id: string;
  group_id: string;
  coach_user_id: string;
  is_head: boolean;
  profiles?: ProfileLite | null;
};

type CategoryRow = {
  id: string;
  group_id: string;
  category: string;
};

type PlannedEventLite = {
  id: string;
  starts_at: string;
  status: "scheduled" | "cancelled";
  series_id?: string | null;
};
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const s = `${f} ${l}`.trim();
  return s || "—";
}

function initials(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function avatarNode(p?: ProfileLite | null) {
  if (p?.avatar_url) {
    return (
      <img
        src={p.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(p);
}

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export default function CoachGroupEditPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = String(params?.id ?? "");
  const requestedSeasonId = searchParams.get("season") ?? "";

  const mutationPending = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);


  const [group, setGroup] = useState<CoachGroup | null>(null);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRow[]>([]);
  const [coaches, setCoaches] = useState<GroupCoachRow[]>([]);
  const [plannedEvents, setPlannedEvents] = useState<PlannedEventLite[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState(requestedSeasonId);

  // editable group info
  const [groupName, setGroupName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isPerformance, setIsPerformance] = useState(false);

  // categories
  const [newCat, setNewCat] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  // club members (for adding)
  const [clubMembersPlayers, setClubMembersPlayers] = useState<ProfileLite[]>([]);
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]); // ✅ only role=coach
  const [playerPerformanceById, setPlayerPerformanceById] = useState<Record<string, boolean>>({});
  const [queryPlayers, setQueryPlayers] = useState("");
  const [queryCoaches, setQueryCoaches] = useState("");

  async function loadClubMembers(cid: string, uid: string) {
    if (!cid) {
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
      return;
    }

    const { data: mem, error: memErr } = await supabase
      .from("club_members")
      .select("club_id,user_id,is_active,is_performance,role")
      .eq("club_id", cid)
      .eq("is_active", true);

    if (memErr) {
      console.error(memErr);
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
      return;
    }

    const members = (mem as ClubMemberRow[] | null) ?? [];
    const uniq = (arr: string[]) => Array.from(new Set(arr)).filter(Boolean);

    const playerIds = uniq(members.filter((m) => m.role === "player").map((m) => m.user_id));
    const perfByPlayer: Record<string, boolean> = {};
    members
      .filter((m) => m.role === "player")
      .forEach((m) => {
        perfByPlayer[m.user_id] = Boolean(m.is_performance);
      });
    setPlayerPerformanceById(perfByPlayer);

    // ✅ assistants = ONLY role "coach"
    const coachIds = uniq(members.filter((m) => m.role === "coach").map((m) => m.user_id));

    async function fetchProfiles(ids: string[]) {
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .in("id", ids);

      if (error) {
        console.error(error);
        return [];
      }
      return (data ?? []) as ProfileLite[];
    }

    const [playerProfiles, coachProfiles] = await Promise.all([
      fetchProfiles(playerIds),
      fetchProfiles(coachIds),
    ]);

    playerProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));

    setClubMembersPlayers(playerProfiles.filter((p) => p.id !== uid));
    setClubMembersCoaches(coachProfiles.filter((p) => p.id !== uid));
  }

  async function load(resetDraft = false) {
    try {
    setLoading(true);
    setErr(null);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (authErr || !uid) {
      setErr("manager.profile.invalidSession");
      setLoading(false);
      return;
    }

    const gRes = await supabase
      .from("coach_groups")
      .select(
        `
        id,created_at,club_id,name,is_active,is_performance,head_coach_user_id,
        clubs:clubs ( id, name )
      `
      )
      .eq("id", groupId)
      .maybeSingle();

    if (gRes.error) {
      setErr(gRes.error.message);
      setLoading(false);
      return;
    }

    const g = (gRes.data ?? null) as unknown as CoachGroup | null;
    if (!g) {
      setErr("manager.groups.notFound");
      setLoading(false);
      return;
    }

    const [managerRes, linkRes, seasonsRes] = await Promise.all([
      supabase
        .from("club_members")
        .select("id")
        .eq("club_id", g.club_id)
        .eq("user_id", uid)
        .eq("is_active", true)
        .eq("role", "manager")
        .maybeSingle(),
      supabase
        .from("coach_group_coaches")
        .select("id")
        .eq("group_id", groupId)
        .eq("coach_user_id", uid)
        .maybeSingle(),
      supabase
        .from("club_seasons")
        .select("id,name,starts_on,ends_on,is_current")
        .eq("club_id", g.club_id)
        .order("starts_on", { ascending: true }),
    ]);

    if (!managerRes.data && !linkRes.data) {
      setErr("manager.groups.notFound");
      setLoading(false);
      return;
    }

    if (seasonsRes.error) throw seasonsRes.error;
    setGroup(g);
    const loadedSeasons = (seasonsRes.data ?? []) as Season[];
    setSeasons(loadedSeasons);
    setSeasonId((current) => loadedSeasons.some((season) => season.id === current)
      ? current
      : loadedSeasons.find((season) => season.is_current)?.id ?? loadedSeasons[0]?.id ?? "");

    if (g && (!group || resetDraft)) {
      setGroupName(g.name ?? "");
      setIsActive(!!g.is_active);
      setIsPerformance(!!g.is_performance);
    }

    const catRes = await supabase
      .from("coach_group_categories")
      .select("id,group_id,category")
      .eq("group_id", groupId)
      .order("category", { ascending: true });

    if (catRes.error) throw catRes.error;
    setCats((catRes.data ?? []) as CategoryRow[]);

    const pRes = await supabase.from("coach_group_players").select("id,group_id,player_user_id,profiles:profiles ( id, first_name, last_name, handicap, avatar_url )").eq("group_id", groupId);
    if (pRes.error) throw new Error(pRes.error.message);
    setPlayers((pRes.data ?? []) as unknown as GroupPlayerRow[]);

    const cRes = await supabase
      .from("coach_group_coaches")
      .select(
        `
        id,group_id,
        coach_user_id,
        is_head,
        profiles:profiles ( id, first_name, last_name, handicap, avatar_url )
      `
      )
      .eq("group_id", groupId)
      .order("is_head", { ascending: false });

    if (cRes.error) throw cRes.error;
    setCoaches((cRes.data ?? []) as unknown as GroupCoachRow[]);

    const evRes = await supabase
      .from("club_events")
      .select("id,starts_at,status,series_id")
      .eq("group_id", groupId)
      .order("starts_at", { ascending: true });

    if (!evRes.error) setPlannedEvents((evRes.data ?? []) as PlannedEventLite[]);
    else setPlannedEvents([]);

    if (g?.club_id) {
      await loadClubMembers(g.club_id, uid);
    } else {
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
    }

    setLoading(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!groupId) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    if (requestedSeasonId && requestedSeasonId !== seasonId) setSeasonId(requestedSeasonId);
  }, [requestedSeasonId, seasonId]);

  const planningSummary = useMemo(() => {
    const now = Date.now();
    const scheduled = plannedEvents.filter((e) => e.status === "scheduled");
    const upcoming = scheduled.filter((e) => new Date(e.starts_at).getTime() >= now);
    const next = upcoming
      .slice()
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
    const recurringCount = scheduled.filter((e) => Boolean(e.series_id)).length;
    return {
      totalScheduled: scheduled.length,
      upcomingCount: upcoming.length,
      recurringCount,
      nextStartsAt: next?.starts_at ?? null,
    };
  }, [plannedEvents]);

  const canSaveInfo = useMemo(() => {
    if (busy) return false;
    if (!group) return false;
    if (groupName.trim().length < 2) return false;
    if (coaches.length === 0) return false;
    return true;
  }, [busy, coaches.length, group, groupName]);

  async function mutateGroupAssignment(
    method: "POST" | "DELETE",
    payload: Record<string, string>
  ) {
    if (!group?.club_id) return { error: "Groupe introuvable." };

    const headers = {
      "Content-Type": "application/json",
      ...(await authHeader()),
    };

    const res = await fetch(`/api/admin/organizations/${group.club_id}/group-assignments`, {
      method,
      headers,
      body: JSON.stringify(seasonId ? { ...payload, seasonId } : payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: String(json?.error ?? t("manager.administration.actionError")) };
    }

    return { error: null as string | null };
  }

  // --------- GROUP INFO ----------
  async function saveGroupInfo(e: React.FormEvent) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    e.preventDefault();
    if (!canSaveInfo || !group) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase
      .from("coach_groups")
      .update({
        name: groupName.trim(),
        is_active: isActive,
        is_performance: isPerformance,
      })
      .eq("id", group.id);

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load(true);
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  // --------- CATEGORIES ----------
  const canAddCat = useMemo(() => {
    const v = newCat.trim();
    if (!v) return false;
    const exists = cats.some((c) => c.category.toLowerCase() === v.toLowerCase());
    return !exists;
  }, [newCat, cats]);

  async function addCategory() {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    const v = newCat.trim();
    if (!v || !canAddCat || savingCat || busy) return;

    setSavingCat(true);
    const { error } = await supabase.from("coach_group_categories").insert({
      group_id: groupId,
      category: v,
    });

    if (error) {
      setErr(error.message);
      setSavingCat(false);
      return;
    }

    setNewCat("");
    await load();
    setSavingCat(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setSavingCat(false); mutationPending.current = false; }
  }

  // ✅ FIX RLS: delete category via RPC (security definer)
  async function removeCategory(catId: string) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!catId || busy) return;
    setBusy(true);
    setErr(null);

    const response = await fetch(`/api/manager/groups/${groupId}/categories/${catId}`, {
      method: "DELETE",
      headers: await authHeader(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(String(result.error ?? t("manager.groups.categoryDeleteError")));
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  // --------- PLAYERS ----------
  const playerIdsInGroup = useMemo(() => new Set(players.map((p) => p.player_user_id)), [players]);

  const playerCandidates = useMemo(() => {
    const query = queryPlayers.trim().toLowerCase();
    return clubMembersPlayers
      .filter((p) => !playerIdsInGroup.has(p.id))
      .filter((p) => !query || fullName(p).toLowerCase().includes(query))
      .slice(0, 30);
  }, [clubMembersPlayers, playerIdsInGroup, queryPlayers]);

  async function addPlayerToGroup(p: ProfileLite) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!groupId || busy) return;
    if (playerIdsInGroup.has(p.id)) return;

    setBusy(true);
    setErr(null);

    const { error } = await mutateGroupAssignment("POST", {
      actorType: "player",
      userId: p.id,
      toGroupId: groupId,
    });

    if (error) {
      setErr(error);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  // ✅ FIX RLS: delete player via RPC (security definer)
  async function removePlayerFromGroup(row: GroupPlayerRow) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!row?.player_user_id || busy) return;

    setBusy(true);
    setErr(null);

    const { error } = await mutateGroupAssignment("DELETE", {
      actorType: "player",
      userId: row.player_user_id,
      groupId,
    });

    if (error) {
      setErr(error);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  async function togglePlayerPerformance(playerUserId: string) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!group?.club_id || !playerUserId || busy) return;
    setBusy(true);
    setErr(null);

    const currentlyEnabled = Boolean(playerPerformanceById[playerUserId]);
    const { error } = await supabase.rpc("set_player_performance_mode", {
      p_org_id: group.club_id,
      p_player_id: playerUserId,
      p_enabled: !currentlyEnabled,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  // --------- COACHES ----------
  const coachIdsInGroup = useMemo(() => new Set(coaches.map((c) => c.coach_user_id)), [coaches]);

  const coachCandidates = useMemo(() => {
    const query = queryCoaches.trim().toLowerCase();
    return clubMembersCoaches
      .filter((p) => !coachIdsInGroup.has(p.id))
      .filter((p) => !query || fullName(p).toLowerCase().includes(query))
      .slice(0, 30);
  }, [clubMembersCoaches, coachIdsInGroup, queryCoaches]);

  async function addCoachToGroup(p: ProfileLite) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!groupId || busy) return;
    if (coachIdsInGroup.has(p.id)) return;

    setBusy(true);
    setErr(null);

    const { error } = await mutateGroupAssignment("POST", {
      actorType: "coach",
      userId: p.id,
      toGroupId: groupId,
    });

    if (error) {
      setErr(error);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  async function removeCoachFromGroup(row: GroupCoachRow) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!row?.coach_user_id || busy) return;
    if (row.is_head || group?.head_coach_user_id === row.coach_user_id) return;

    setBusy(true);
    setErr(null);

    const { error } = await mutateGroupAssignment("DELETE", {
      actorType: "coach",
      userId: row.coach_user_id,
      groupId,
    });
    if (error) {
      setErr(error);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  // --------- DELETE GROUP ----------
  async function deleteGroup() {
    if (mutationPending.current) return;
    mutationPending.current = true;
    try {
    if (!group) return;

    const ok = window.confirm(
      managerGroupFormat(t, "confirmDelete", { name: group.name })
    );
    if (!ok) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.rpc("coach_group_delete_keep_history", {
      p_group_id: group.id,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    router.push("/manager/groups");

    } catch (cause) {
      setErr(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setBusy(false); mutationPending.current = false; }
  }

  return (
    <main className={`${styles.page} ${groupStyles.page}`}>
      <nav className={actionStyles.breadcrumb} aria-label={t("manager.content.breadcrumb")}>
        <Link href="/manager/groups">{t("manager.content.groups")}</Link>
        <span aria-hidden="true">/</span>
        <span>{group?.name ?? t("manager.performance.group")}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{group?.name ?? t("manager.performance.group")}</h1>
          <p className={styles.lead}>{t("manager.groups.editLead")}</p>
        </div>
        <div className={actionStyles.topActions}>
          <label className="groups-season-nav-select">
            <select aria-label={t("manager.season")} value={seasonId} onChange={(event) => {
              const nextSeasonId = event.target.value;
              setSeasonId(nextSeasonId);
              router.push(`/manager/groups/${groupId}?season=${encodeURIComponent(nextSeasonId)}`);
            }} disabled={loading || busy || savingCat || seasons.length === 0}>
              {seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}
              {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</option>)}
            </select>
          </label>
          {group ? (
            <Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>
              <CalendarDays size={16} aria-hidden="true" />
              {t("manager.groups.planning")} </Link>
          ) : null}
        </div>
      </div>

      {err ? <div className={actionStyles.errorAlert} role="alert">{managerGroupFeedback(t, err)}</div> : null}

      {loading ? (
        <section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section>
      ) : !group ? (
        <section className={styles.quickPanel}>{t("manager.groups.notFound")}</section>
      ) : (
        <>
          <form className={styles.quickPanel} onSubmit={saveGroupInfo}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.groups.info")}</h2><p>{t("manager.groups.editInfoHelp")}</p></div></div>
            <div className="user-mgmt-form-grid">
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">{t("coach.group.name")} <span aria-hidden="true">*</span></span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={busy} required />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
                <label className="user-mgmt-checkbox-label">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={busy} />
                  <span>{t("manager.groups.active")}</span>
                </label>
                <label className="user-mgmt-checkbox-label">
                  <input type="checkbox" checked={isPerformance} onChange={(e) => setIsPerformance(e.target.checked)} disabled={busy} />
                  <span>{t("manager.groups.performanceMode")}</span>
                </label>
              </div>
            </div>
            <div className="user-mgmt-card-actions">
              <button className={actionStyles.primaryButton} type="submit" disabled={!canSaveInfo}>
                <Save size={16} aria-hidden="true" />{busy ? t("manager.saving") : t("manager.settings.volume.saveChanges")}
              </button>
            </div>
          </form>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("coach.group.categories")}</h2><p>{t("manager.groups.categoryEditHelp")}</p></div></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} disabled={busy} placeholder={t("manager.groups.categoryPlaceholder")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }} />
                <button type="button" className={actionStyles.secondaryButton} onClick={() => void addCategory()} disabled={busy || savingCat || !canAddCat} aria-label={t("coach.group.addCategory")} title={t("common.add")} style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#6d786e", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {t("manager.groups.currentCategories")} </div>
                {cats.length === 0 ? (
                  <p className="user-mgmt-empty-state">{t("manager.groups.noCategories")}</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {cats.map((cat) => (
                      <div key={cat.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span className="pill-soft">{cat.category}</span>
                        <button
                          type="button"
                          className="btn btn-danger soft"
                          onClick={() => void removeCategory(cat.id)}
                          disabled={busy}
                          aria-label={managerGroupFormat(t, "deleteNamed", { name: cat.category })}
                          title={t("manager.content.delete")}
                          style={{ padding: "8px 10px" }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.fields.player")}</h2><p>{t("manager.groups.juniorEditHelp")}</p></div></div>
            <div style={{ display: "grid", gap: 20 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{managerGroupFormat(t, "groupJuniors", { count: players.length.toLocaleString(managerLocaleTag(locale)) })}</div>
                {players.length === 0 ? <p className="user-mgmt-empty-state">{t("manager.groups.noJuniors")}</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.groups.avatar")} /><th>{t("manager.administration.fullName")}</th><th>{t("manager.nav.performance")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{players.slice().sort((a,b) => fullName(a.profiles).localeCompare(fullName(b.profiles), managerLocaleTag(locale))).map((row) => <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td data-label={t("manager.nav.performance")}><button type="button" className={actionStyles.secondaryButton} onClick={() => void togglePlayerPerformance(row.player_user_id)} disabled={busy || isPerformance}>{isPerformance ? t("manager.groups.enabledByGroup") : playerPerformanceById[row.player_user_id] ? t("manager.junior.edit.status.activated") : t("manager.groups.disabled")}</button></td><td><button type="button" className="btn btn-danger soft" onClick={() => void removePlayerFromGroup(row)} disabled={busy} aria-label={managerGroupFormat(t, "removeNamed", { name: fullName(row.profiles) })} title={t("manager.content.remove")}><Trash2 size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.administration.players.add")}</span><input value={queryPlayers} onChange={(e) => setQueryPlayers(e.target.value)} disabled={busy} placeholder={t("manager.groups.nameSearch")} /></label>
                {playerCandidates.length === 0 ? <p className="user-mgmt-empty-state">{t("manager.groups.noJuniorCandidates")}</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.groups.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{playerCandidates.map((person) => <tr key={person.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(person)}</span></td><td><b>{fullName(person)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => void addPlayerToGroup(person)} disabled={busy} aria-label={managerGroupFormat(t, "addNamed", { name: fullName(person) })} title={t("common.add")} style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.fields.coach")}</h2><p>{t("manager.groups.coachesHelp")}</p></div></div>
            <div style={{ display: "grid", gap: 20 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{managerGroupFormat(t, "groupCoaches", { count: coaches.length.toLocaleString(managerLocaleTag(locale)) })}</div>
                {coaches.length === 0 ? <div className={actionStyles.errorAlert} role="alert">{t("manager.groups.noCoachesWarning")}</div> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.groups.avatar")} /><th>{t("manager.administration.fullName")}</th><th>{t("manager.performance.role")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{coaches.map((row) => { const isHead = row.is_head || group?.head_coach_user_id === row.coach_user_id; return <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td data-label={t("manager.performance.role")}>{isHead ? <span className="pill-soft">{t("manager.groups.headCoach")}</span> : t("manager.performance.coach")}</td><td>{isHead ? null : <button type="button" className="btn btn-danger soft" onClick={() => void removeCoachFromGroup(row)} disabled={busy} aria-label={managerGroupFormat(t, "removeNamed", { name: fullName(row.profiles) })} title={t("manager.content.remove")}><Trash2 size={18} /></button>}</td></tr>; })}</tbody></table></div>}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.administration.coaches.add")}</span><input value={queryCoaches} onChange={(e) => setQueryCoaches(e.target.value)} disabled={busy} placeholder={t("manager.groups.nameSearch")} /></label>
                {coachCandidates.length === 0 ? <p className="user-mgmt-empty-state">{t("manager.groups.noCoachCandidates")}</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label={t("manager.groups.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("manager.content.actions")} /></tr></thead><tbody>{coachCandidates.map((person) => <tr key={person.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(person)}</span></td><td><b>{fullName(person)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => void addCoachToGroup(person)} disabled={busy} aria-label={managerGroupFormat(t, "addNamed", { name: fullName(person) })} title={t("common.add")} style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>{t("manager.groups.planning")}</h2><p>{t("manager.groups.planningHelp")}</p></div></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><span className="pill-soft">{managerGroupFormat(t, "upcomingCount", { count: planningSummary.upcomingCount.toLocaleString(managerLocaleTag(locale)) })}</span><span className="pill-soft">{managerGroupFormat(t, "scheduledCount", { count: planningSummary.totalScheduled.toLocaleString(managerLocaleTag(locale)) })}</span><span className="pill-soft">{managerGroupFormat(t, "recurringCount", { count: planningSummary.recurringCount.toLocaleString(managerLocaleTag(locale)) })}</span></div>
              <p className="user-mgmt-empty-state" style={{ margin: 0 }}>{planningSummary.nextStartsAt ? managerGroupFormat(t, "nextEvent", { date: new Intl.DateTimeFormat(managerLocaleTag(locale), { timeZone: "Europe/Zurich", weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(planningSummary.nextStartsAt)) }) : t("manager.groups.noUpcoming")}</p>
              <div className="user-mgmt-card-actions"><Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}><CalendarDays size={16} />{t("manager.groups.managePlanning")}</Link></div>
            </div>
          </section>

          <section className={actionStyles.dangerZone}>
            <div><div><h2>{t("manager.groups.delete")}</h2><p>{t("manager.groups.deleteHelp")}</p></div></div>
            <button type="button" className={actionStyles.dangerButton} onClick={() => void deleteGroup()} disabled={busy}><Trash2 size={16} />{t("manager.groups.delete")}</button>
          </section>
        </>
      )}
    </main>
  );
}
