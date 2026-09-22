"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, PlusCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type GroupLite = { id: string; name: string; is_active: boolean; head_coach_user_id: string | null; club_id: string };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type GroupCategory = { group_id: string; category: string };
type GroupPlayer = { group_id: string; player_user_id: string };
type GroupCoach = { group_id: string; coach_user_id: string; is_head: boolean | null };
type PlayerMember = { id: string; user_id: string };
type SeasonRecord = { club_season_id: string; club_member_id: string; group_id: string | null };
type GroupDisplayFilter = "standard" | "with-specific" | "with-archived" | "all";

function isArchivedGroup(group: GroupLite) {
  return !group.is_active || group.name.trim().startsWith("__ARCHIVE_");
}

function isSpecificGroup(group: GroupLite) {
  const name = group.name.trim();
  return name === "Groupe spécifique" || name.startsWith("__EVENT_SPECIFIQUE__");
}

function fullName(profile?: ProfileLite | null) {
  const name = `${profile?.first_name?.trim() ?? ""} ${profile?.last_name?.trim() ?? ""}`.trim();
  return name || "Sans nom";
}

function initials(profile?: ProfileLite | null) {
  return `${profile?.first_name?.trim()?.[0] ?? ""}${profile?.last_name?.trim()?.[0] ?? ""}`.toUpperCase() || "?";
}

function Avatar({ profile }: { profile?: ProfileLite | null }) {
  return <span className="user-mgmt-member-avatar" aria-label={fullName(profile)}>{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile)}</span>;
}

export default function OrganizationGroupsBoard({ organizationId }: { organizationId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("Organisation");
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [coaches, setCoaches] = useState<ProfileLite[]>([]);
  const [categories, setCategories] = useState<GroupCategory[]>([]);
  const [groupPlayers, setGroupPlayers] = useState<GroupPlayer[]>([]);
  const [groupCoaches, setGroupCoaches] = useState<GroupCoach[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [playerMembers, setPlayerMembers] = useState<PlayerMember[]>([]);
  const [seasonRecords, setSeasonRecords] = useState<SeasonRecord[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [groupDisplayFilter, setGroupDisplayFilter] = useState<GroupDisplayFilter>("standard");
  const [draggedPlayer, setDraggedPlayer] = useState<{ userId: string; fromGroupId: string | null } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  async function load() {
    if (!organizationId) return;
    setLoading(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible de charger les groupes.");
      const loadedSeasons = (json.seasons ?? []) as Season[];
      setOrganizationName(String(json.organization?.name ?? "Organisation")); setGroups(json.groups ?? []); setPlayers(json.players ?? []); setCoaches(json.coaches ?? []);
      setCategories(json.categories ?? []); setGroupPlayers(json.groupPlayers ?? []); setGroupCoaches(json.groupCoaches ?? []);
      setSeasons(loadedSeasons); setPlayerMembers(json.playerMembers ?? []); setSeasonRecords(json.seasonRecords ?? []);
      setSeasonId((current) => current || loadedSeasons.find((season) => season.is_current)?.id || loadedSeasons[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Erreur de chargement."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void load();
    // The organization identifier is the sole route input for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function movePlayer(toGroupId: string) {
    if (!draggedPlayer || draggedPlayer.fromGroupId === toGroupId || moving) return;
    setMoving(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        body: JSON.stringify({ actorType: "player", userId: draggedPlayer.userId, fromGroupId: draggedPlayer.fromGroupId, toGroupId, removeFromSource: true, seasonId: seasonId || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Le déplacement du junior a échoué.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Le déplacement du junior a échoué."); }
    finally { setMoving(false); setDraggedPlayer(null); setDropTargetId(null); }
  }

  async function removePlayer(groupId: string, userId: string) {
    if (moving) return;
    setMoving(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify({ actorType: "player", groupId, userId, seasonId: seasonId || undefined }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Le junior n’a pas pu être retiré du groupe.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Le junior n’a pas pu être retiré du groupe."); }
    finally { setMoving(false); }
  }

  const playersById = useMemo(() => Object.fromEntries(players.map((player) => [player.id, player])), [players]);
  const coachesById = useMemo(() => Object.fromEntries(coaches.map((coach) => [coach.id, coach])), [coaches]);
  const categoriesByGroup = useMemo(() => {
    const result: Record<string, string[]> = {};
    categories.forEach(({ group_id, category }) => {
      const values = (result[group_id] ??= []);
      if (!values.includes(category)) values.push(category);
    });
    return result;
  }, [categories]);
  const legacyPlayerIdsByGroup = useMemo(() => {
    const result: Record<string, string[]> = {};
    groupPlayers.forEach(({ group_id, player_user_id }) => (result[group_id] ??= []).push(player_user_id));
    return result;
  }, [groupPlayers]);
  const seasonPlayerIdsByGroup = useMemo(() => {
    const memberUsers = Object.fromEntries(playerMembers.map((member) => [member.id, member.user_id]));
    const result: Record<string, string[]> = {};
    seasonRecords.filter((record) => record.club_season_id === seasonId && record.group_id).forEach((record) => {
      const userId = memberUsers[record.club_member_id]; if (userId && record.group_id) (result[record.group_id] ??= []).push(userId);
    });
    return result;
  }, [playerMembers, seasonId, seasonRecords]);
  const coachesByGroup = useMemo(() => {
    const result: Record<string, string[]> = {};
    groupCoaches.forEach(({ group_id, coach_user_id }) => (result[group_id] ??= []).push(coach_user_id));
    return result;
  }, [groupCoaches]);
  const availablePlayers = useMemo(() => players.slice().sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")), [players]);
  const visibleGroups = useMemo(() => groups.filter((group) => {
    const archived = isArchivedGroup(group);
    const specific = isSpecificGroup(group);
    if (groupDisplayFilter === "all") return true;
    if (groupDisplayFilter === "with-specific") return !archived;
    if (groupDisplayFilter === "with-archived") return !specific;
    return !archived && !specific;
  }).sort((a, b) => a.name.localeCompare(b.name, "fr")), [groupDisplayFilter, groups]);
  const selectedSeason = seasons.find((season) => season.id === seasonId);
  const creationHref = `/manager/groups/new?organizationId=${encodeURIComponent(organizationId)}${seasonId ? `&season=${encodeURIComponent(seasonId)}` : ""}`;

  return <main className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
      <Link href="/manager/organizations">Organisations</Link><span aria-hidden="true" style={{ margin: "0 8px" }}>/</span><span>{organizationName}</span><span aria-hidden="true" style={{ margin: "0 8px" }}>/</span><span>Groupes</span>
    </nav>
    <div className={styles.topline}><div><h1>Groupes</h1><p className={styles.lead}>Gérez les groupes, leurs juniors et leur encadrement pour chaque saison.</p></div><div className={actionStyles.topActions}><label className="groups-season-nav-select"><select aria-label="Groupes affichés" value={groupDisplayFilter} onChange={(event) => setGroupDisplayFilter(event.target.value as GroupDisplayFilter)}><option value="standard">Groupes standards</option><option value="with-specific">Inclure les spécifiques</option><option value="with-archived">Inclure les archivés</option><option value="all">Tous les groupes</option></select></label><label className="groups-season-nav-select"><select aria-label="Saison" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={loading || seasons.length === 0}>{seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · Saison en cours" : ""}</option>)}</select></label><Link className={actionStyles.primaryButton} href={creationHref}><PlusCircle size={17} />Ajouter un groupe</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    {loading ? <section className={styles.quickPanel}><p style={{ margin: 0, color: "#778178", fontSize: 13 }}>Chargement des groupes…</p></section> : visibleGroups.length === 0 ? <section className={styles.quickPanel}><p style={{ margin: 0, color: "#778178", fontSize: 13 }}>Aucun groupe ne correspond à ce filtre.</p></section> : <section className={styles.quickPanel}>
      <div className={styles.sectionHeading}><div><h2>Groupes {selectedSeason ? `· ${selectedSeason.name}` : ""}</h2><p>{visibleGroups.length} groupe{visibleGroups.length > 1 ? "s" : ""} configuré{visibleGroups.length > 1 ? "s" : ""}.</p></div></div>
      <div className="organization-available-players"><div className="organization-group-roster-title">Juniors du club <span>{availablePlayers.length}</span></div><div className="organization-group-player-list">{availablePlayers.length === 0 ? <span className="organization-group-empty">Aucun junior dans ce club.</span> : availablePlayers.map((player) => <button key={player.id} type="button" draggable={!moving} className="organization-group-player" title={`Glisser ${fullName(player)} vers un groupe`} onDragStart={() => setDraggedPlayer({ userId: player.id, fromGroupId: null })} onDragEnd={() => { setDraggedPlayer(null); setDropTargetId(null); }}><Avatar profile={player} /><span>{fullName(player)}</span></button>)}</div></div>
      <div className="organization-groups-grid">{visibleGroups.map((group) => {
        const playerIds = legacyPlayerIdsByGroup[group.id] ?? [];
        const assignedCoaches = groupCoaches.filter((coach) => coach.group_id === group.id);
        const coachIds = Array.from(new Set([...(coachesByGroup[group.id] ?? []), group.head_coach_user_id].filter((id): id is string => Boolean(id))));
        const displayCoachId = group.head_coach_user_id ?? assignedCoaches.find((coach) => coach.is_head)?.coach_user_id ?? (coachIds.length === 1 ? coachIds[0] : null);
        const displayCoach = coachesById[displayCoachId ?? ""];
        const cardHref = `/manager/groups/${group.id}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`;
        return <article className={`organization-group-card${dropTargetId === group.id ? " is-drop-target-card" : ""}`} key={group.id} onDragOver={(event) => { if (draggedPlayer && draggedPlayer.fromGroupId !== group.id) { event.preventDefault(); setDropTargetId(group.id); } }} onDragLeave={() => setDropTargetId((current) => current === group.id ? null : current)} onDrop={(event) => { event.preventDefault(); void movePlayer(group.id); }}>
          <div className="organization-group-card-header"><div><h3>{group.name}</h3><div className="organization-group-tags">{(categoriesByGroup[group.id] ?? []).length ? (categoriesByGroup[group.id] ?? []).map((category) => <span key={category} className="pill-soft">{category}</span>) : <span className="pill-soft">Sans catégorie</span>}{!group.is_active ? <span className="pill-soft">Inactif</span> : null}</div></div><Link href={cardHref} className={actionStyles.secondaryButton} aria-label={`Ouvrir ${group.name}`} title="Ouvrir le groupe" style={{ width: 40, padding: 0, justifyContent: "center" }}><ChevronRight size={18} /></Link></div>
          <div className={`organization-group-roster organization-group-dropzone${dropTargetId === group.id ? " is-drop-target" : ""}`} onDragOver={(event) => { if (draggedPlayer && draggedPlayer.fromGroupId !== group.id) { event.preventDefault(); setDropTargetId(group.id); } }} onDragLeave={() => setDropTargetId((current) => current === group.id ? null : current)} onDrop={(event) => { event.preventDefault(); void movePlayer(group.id); }}><div className="organization-group-roster-title">Juniors <span>{playerIds.length}</span></div><div className="organization-group-player-list" aria-label={`${playerIds.length} juniors`}>{playerIds.map((id) => <div key={id} draggable={!moving} className="organization-group-player" title={`Déplacer ${fullName(playersById[id])}`} onDragStart={() => setDraggedPlayer({ userId: id, fromGroupId: group.id })} onDragEnd={() => { setDraggedPlayer(null); setDropTargetId(null); }}><Avatar profile={playersById[id]} /><span>{fullName(playersById[id])}</span><button type="button" className="organization-group-player-remove" aria-label={`Retirer ${fullName(playersById[id])}`} title="Retirer du groupe" onClick={() => void removePlayer(group.id, id)} disabled={moving}>×</button></div>)}{playerIds.length === 0 ? <span className="organization-group-empty">Déposez un junior ici</span> : null}</div></div>
          <div className="organization-group-roster"><div className="organization-group-roster-title">Coachs <span>{coachIds.length}</span></div><div className="organization-group-coach">{displayCoach ? <><Avatar profile={displayCoach} /><span>{fullName(displayCoach)}</span></> : <span className="organization-group-empty">{coachIds.length ? "Aucun coach référent" : "Aucun coach"}</span>}</div></div>
          <div className="organization-group-card-footer"><Link href={cardHref} className={actionStyles.primaryButton}>Gérer le groupe</Link></div>
        </article>;
      })}</div>
    </section>}
  </main>;
}
