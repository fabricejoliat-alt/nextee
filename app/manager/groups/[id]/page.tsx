"use client";

import { useEffect, useMemo, useState } from "react";
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
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = String(params?.id ?? "");
  const requestedSeasonId = searchParams.get("season") ?? "";

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

    playerProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));

    setClubMembersPlayers(playerProfiles.filter((p) => p.id !== uid));
    setClubMembersCoaches(coachProfiles.filter((p) => p.id !== uid));
  }

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (authErr || !uid) {
      setErr("Session invalide. Reconnecte-toi.");
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
      setErr(t("coachGroupEdit.accessDeniedOrNotFound"));
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
      setErr(t("coachGroupEdit.accessDeniedOrNotFound"));
      setLoading(false);
      return;
    }

    setGroup(g);
    const loadedSeasons = (seasonsRes.data ?? []) as Season[];
    setSeasons(loadedSeasons);
    setSeasonId((current) => loadedSeasons.some((season) => season.id === current)
      ? current
      : loadedSeasons.find((season) => season.is_current)?.id ?? loadedSeasons[0]?.id ?? "");

    if (g) {
      setGroupName(g.name ?? "");
      setIsActive(!!g.is_active);
      setIsPerformance(!!g.is_performance);
    }

    const catRes = await supabase
      .from("coach_group_categories")
      .select("id,group_id,category")
      .eq("group_id", groupId)
      .order("category", { ascending: true });

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
  }

  useEffect(() => {
    if (!groupId) return;
    load();
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
      return { error: String(json?.error ?? "Action impossible.") };
    }

    return { error: null as string | null };
  }

  // --------- GROUP INFO ----------
  async function saveGroupInfo(e: React.FormEvent) {
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

    await load();
    setBusy(false);
  }

  // --------- CATEGORIES ----------
  const canAddCat = useMemo(() => {
    const v = newCat.trim();
    if (!v) return false;
    const exists = cats.some((c) => c.category.toLowerCase() === v.toLowerCase());
    return !exists;
  }, [newCat, cats]);

  async function addCategory() {
    const v = newCat.trim();
    if (!v || savingCat || busy) return;

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
  }

  // ✅ FIX RLS: delete category via RPC (security definer)
  async function removeCategory(catId: string) {
    if (!catId || busy) return;
    setBusy(true);
    setErr(null);

    const response = await fetch(`/api/manager/groups/${groupId}/categories/${catId}`, {
      method: "DELETE",
      headers: await authHeader(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(String(result.error ?? "La catégorie n’a pas pu être supprimée."));
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
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
  }

  // ✅ FIX RLS: delete player via RPC (security definer)
  async function removePlayerFromGroup(row: GroupPlayerRow) {
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
  }

  async function togglePlayerPerformance(playerUserId: string) {
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
  }

  async function removeCoachFromGroup(row: GroupCoachRow) {
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
  }

  // --------- DELETE GROUP ----------
  async function deleteGroup() {
    if (!group) return;

    const ok = window.confirm(
      `Supprimer le groupe "${group.name}" ?\n\nLes événements futurs de ce groupe seront supprimés.\nL'historique passé sera conservé.`
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
  }

  return (
    <main className={styles.page}>
      <nav className={actionStyles.breadcrumb} aria-label="Fil d’Ariane">
        <Link href="/manager/groups">Groupes</Link>
        <span aria-hidden="true">/</span>
        <span>{group?.name ?? "Groupe"}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{group?.name ?? "Groupe"}</h1>
          <p className={styles.lead}>Gérez les informations, les catégories, les juniors et l’encadrement du groupe.</p>
        </div>
        <div className={actionStyles.topActions}>
          <label className="groups-season-nav-select">
            <select aria-label="Saison" value={seasonId} onChange={(event) => {
              const nextSeasonId = event.target.value;
              setSeasonId(nextSeasonId);
              router.push(`/manager/groups/${groupId}?season=${encodeURIComponent(nextSeasonId)}`);
            }} disabled={seasons.length === 0}>
              {seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}
              {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · En cours" : ""}</option>)}
            </select>
          </label>
          {group ? (
            <Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>
              <CalendarDays size={16} aria-hidden="true" />
              Planification
            </Link>
          ) : null}
        </div>
      </div>

      {err ? <div className={actionStyles.errorAlert} role="alert">{err}</div> : null}

      {loading ? (
        <section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section>
      ) : !group ? (
        <section className={styles.quickPanel}>{t("coachGroupEdit.accessDeniedOrNotFound")}</section>
      ) : (
        <>
          <form className={styles.quickPanel} onSubmit={saveGroupInfo}>
            <div className={styles.sectionHeading}><div><h2>Informations du groupe</h2><p>Modifiez les paramètres généraux du groupe.</p></div></div>
            <div className="user-mgmt-form-grid">
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Nom du groupe <span aria-hidden="true">*</span></span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={busy} required />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
                <label className="user-mgmt-checkbox-label">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={busy} />
                  <span>Groupe actif</span>
                </label>
                <label className="user-mgmt-checkbox-label">
                  <input type="checkbox" checked={isPerformance} onChange={(e) => setIsPerformance(e.target.checked)} disabled={busy} />
                  <span>Mode performance</span>
                </label>
              </div>
            </div>
            <div className="user-mgmt-card-actions">
              <button className={actionStyles.primaryButton} type="submit" disabled={!canSaveInfo}>
                <Save size={16} aria-hidden="true" />{busy ? "Enregistrement…" : "Enregistrer les modifications"}
              </button>
            </div>
          </form>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Catégories</h2><p>Ajoutez les catégories qui structurent ce groupe.</p></div></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} disabled={busy} placeholder={t("coachGroupEdit.addCategoryPlaceholder")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }} />
                <button type="button" className={actionStyles.secondaryButton} onClick={() => void addCategory()} disabled={busy || savingCat || !canAddCat} aria-label="Ajouter une catégorie" title="Ajouter" style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#6d786e", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Catégories utilisées
                </div>
                {cats.length === 0 ? (
                  <p className="user-mgmt-empty-state">Aucune catégorie ajoutée.</p>
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
                          aria-label={`Supprimer ${cat.category}`}
                          title="Supprimer"
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
            <div className={styles.sectionHeading}><div><h2>Juniors</h2><p>Gérez les juniors associés à ce groupe.</p></div></div>
            <div style={{ display: "grid", gap: 20 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Junior(s) du groupe ({players.length})</div>
                {players.length === 0 ? <p className="user-mgmt-empty-state">Aucun junior dans ce groupe.</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th>Performance</th><th aria-label="Actions" /></tr></thead><tbody>{players.slice().sort((a,b) => fullName(a.profiles).localeCompare(fullName(b.profiles), "fr")).map((row) => <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => void togglePlayerPerformance(row.player_user_id)} disabled={busy || isPerformance}>{isPerformance ? "Activé (groupe)" : playerPerformanceById[row.player_user_id] ? "Activé" : "Désactivé"}</button></td><td><button type="button" className="btn btn-danger soft" onClick={() => void removePlayerFromGroup(row)} disabled={busy} aria-label="Retirer le junior" title="Retirer"><Trash2 size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="user-mgmt-field"><span className="user-mgmt-field-label">Ajouter un junior</span><input value={queryPlayers} onChange={(e) => setQueryPlayers(e.target.value)} disabled={busy} placeholder="Rechercher par nom…" /></label>
                {playerCandidates.length === 0 ? <p className="user-mgmt-empty-state">Aucun junior à ajouter.</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th aria-label="Actions" /></tr></thead><tbody>{playerCandidates.map((person) => <tr key={person.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(person)}</span></td><td><b>{fullName(person)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => void addPlayerToGroup(person)} disabled={busy} aria-label={`Ajouter ${fullName(person)}`} title="Ajouter" style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Coachs</h2><p>{t("coachGroupEdit.headCoachFixed")}</p></div></div>
            <div style={{ display: "grid", gap: 20 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Coach(s) du groupe ({coaches.length})</div>
                {coaches.length === 0 ? <div className={actionStyles.errorAlert} role="alert">Attention : ce groupe n’a aucun coach. Ajoutez-en au moins un avant de poursuivre.</div> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th>Rôle</th><th aria-label="Actions" /></tr></thead><tbody>{coaches.map((row) => { const isHead = row.is_head || group?.head_coach_user_id === row.coach_user_id; return <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td>{isHead ? <span className="pill-soft">Head coach</span> : "Coach"}</td><td>{isHead ? null : <button type="button" className="btn btn-danger soft" onClick={() => void removeCoachFromGroup(row)} disabled={busy} aria-label="Retirer le coach" title="Retirer"><Trash2 size={18} /></button>}</td></tr>; })}</tbody></table></div>}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="user-mgmt-field"><span className="user-mgmt-field-label">Ajouter un coach</span><input value={queryCoaches} onChange={(e) => setQueryCoaches(e.target.value)} disabled={busy} placeholder="Rechercher par nom…" /></label>
                {coachCandidates.length === 0 ? <p className="user-mgmt-empty-state">Aucun coach à ajouter.</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th aria-label="Actions" /></tr></thead><tbody>{coachCandidates.map((person) => <tr key={person.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(person)}</span></td><td><b>{fullName(person)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => void addCoachToGroup(person)} disabled={busy} aria-label={`Ajouter ${fullName(person)}`} title="Ajouter" style={{ width: 44, padding: 0 }}><PlusCircle size={18} /></button></td></tr>)}</tbody></table></div>}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Planification</h2><p>Consultez et gérez les entraînements de ce groupe.</p></div></div>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><span className="pill-soft">À venir : {planningSummary.upcomingCount}</span><span className="pill-soft">Planifiés : {planningSummary.totalScheduled}</span><span className="pill-soft">Récurrents : {planningSummary.recurringCount}</span></div>
              <p className="user-mgmt-empty-state" style={{ margin: 0 }}>{planningSummary.nextStartsAt ? `Prochain événement : ${new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(planningSummary.nextStartsAt))}` : t("coachGroupEdit.noUpcomingTraining")}</p>
              <div className="user-mgmt-card-actions"><Link className={actionStyles.primaryButton} href={`/manager/groups/${groupId}/planning${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}><CalendarDays size={16} />Gérer la planification</Link></div>
            </div>
          </section>

          <section className={actionStyles.dangerZone}>
            <div><div><h2>Supprimer le groupe</h2><p>Cette action est irréversible. Les événements futurs seront supprimés et l’historique passé sera conservé.</p></div></div>
            <button type="button" className={actionStyles.dangerButton} onClick={() => void deleteGroup()} disabled={busy}><Trash2 size={16} />Supprimer le groupe</button>
          </section>
        </>
      )}
    </main>
  );
}
