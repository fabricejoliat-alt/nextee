"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type Club = { id: string; name: string | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type Group = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null; clubs?: Club | null };
type GroupRow = Group & { categories: string[]; players: Profile[]; coaches: Profile[] };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };

function nameOf(profile?: Profile | null) { return [profile?.last_name, profile?.first_name].filter(Boolean).join(" ") || "—"; }
function initials(profile?: Profile | null) { return [profile?.first_name, profile?.last_name].map((value) => value?.trim().charAt(0).toUpperCase()).join("") || "—"; }
function Avatar({ profile }: { profile?: Profile | null }) { return <span className="user-mgmt-member-avatar" aria-hidden="true">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile)}</span>; }
async function authHeaders() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }

export default function GroupsManagementPage() {
  const searchParams = useSearchParams();
  const requestedClubId = searchParams.get("club") ?? "";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [hideArchived, setHideArchived] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(id: string, requestedSeasonId = seasonId) {
    if (!id) { setGroups([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: seasonData, error: seasonError } = await supabase.from("club_seasons").select("id,name,starts_on,ends_on,is_current").eq("club_id", id).order("starts_on", { ascending: true });
      if (seasonError) throw seasonError;
      const nextSeasons = (seasonData ?? []) as Season[];
      const activeSeasonId = nextSeasons.some((season) => season.id === requestedSeasonId) ? requestedSeasonId : nextSeasons.find((season) => season.is_current)?.id ?? nextSeasons[0]?.id ?? "";
      setSeasons(nextSeasons); setSeasonId(activeSeasonId);
      let groupQuery = supabase.from("coach_groups").select("id,club_id,name,is_active,head_coach_user_id,clubs:clubs(id,name)").eq("club_id", id);
      if (activeSeasonId) groupQuery = groupQuery.eq("club_season_id", activeSeasonId);
      const { data: groupData, error: groupError } = await groupQuery.order("name", { ascending: true });
      if (groupError) throw groupError;
      const base = (groupData ?? []).map((group: any) => ({ ...group, clubs: Array.isArray(group.clubs) ? group.clubs[0] ?? null : group.clubs ?? null })) as Group[];
      const ids = base.map((group) => group.id);
      if (!ids.length) { setGroups([]); return; }
      const [categories, players, coaches] = await Promise.all([
        supabase.from("coach_group_categories").select("group_id,category").in("group_id", ids),
        supabase.from("coach_group_players").select("group_id,profiles:player_user_id(id,first_name,last_name,avatar_url)").in("group_id", ids),
        supabase.from("coach_group_coaches").select("group_id,profiles:coach_user_id(id,first_name,last_name,avatar_url)").in("group_id", ids),
      ]);
      if (categories.error) throw categories.error; if (players.error) throw players.error; if (coaches.error) throw coaches.error;
      const categoriesByGroup = new Map<string, string[]>(); const playersByGroup = new Map<string, Profile[]>(); const coachesByGroup = new Map<string, Profile[]>();
      (categories.data ?? []).forEach((row: any) => categoriesByGroup.set(String(row.group_id), [...(categoriesByGroup.get(String(row.group_id)) ?? []), String(row.category)]));
      (players.data ?? []).forEach((row: any) => { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; if (profile) playersByGroup.set(String(row.group_id), [...(playersByGroup.get(String(row.group_id)) ?? []), profile as Profile]); });
      (coaches.data ?? []).forEach((row: any) => { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; if (profile) coachesByGroup.set(String(row.group_id), [...(coachesByGroup.get(String(row.group_id)) ?? []), profile as Profile]); });
      const headIds = Array.from(new Set(base.map((group) => group.head_coach_user_id).filter((coachId): coachId is string => Boolean(coachId))));
      const headProfiles = headIds.length ? await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", headIds) : { data: [], error: null };
      if (headProfiles.error) throw headProfiles.error;
      const headById = new Map(((headProfiles.data ?? []) as Profile[]).map((profile) => [profile.id, profile]));
      setGroups(base.map((group) => {
        const coaches = [...(coachesByGroup.get(group.id) ?? [])];
        const head = group.head_coach_user_id && headById.get(group.head_coach_user_id);
        if (head && !coaches.some((coach) => coach.id === head.id)) coaches.push(head);
        return { ...group, categories: Array.from(new Set(categoriesByGroup.get(group.id) ?? [])).sort((a, b) => a.localeCompare(b, "fr-CH")), players: (playersByGroup.get(group.id) ?? []).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "fr-CH")), coaches: coaches.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "fr-CH")) };
      }));
    } catch (cause) { setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "Impossible de charger les groupes."); } finally { setLoading(false); }
  }

  useEffect(() => { void (async () => { try { const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Impossible de charger les clubs."); const next = (json.clubs ?? []) as Club[]; const initial = next.some((club) => club.id === requestedClubId) ? requestedClubId : next[0]?.id ?? ""; setClubs(next); setClubId(initial); await load(initial, ""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger les clubs."); setLoading(false); } })(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedClubId]);

  const categories = useMemo(() => Array.from(new Set(groups.flatMap((group) => group.categories))).sort((a, b) => a.localeCompare(b, "fr-CH")), [groups]);
  const rows = useMemo(() => groups.filter((group) => { const haystack = `${group.name} ${group.categories.join(" ")} ${group.players.map(nameOf).join(" ")} ${group.coaches.map(nameOf).join(" ")}`.toLocaleLowerCase(); return (!hideArchived || group.is_active) && (!query || haystack.includes(query.toLocaleLowerCase())) && (!category || group.categories.includes(category)); }), [groups, query, category, hideArchived]);
  const active = groups.filter((group) => group.is_active).length; const players = groups.reduce((count, group) => count + group.players.length, 0);
  return <div className={`${styles.page} groups-management-page`}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>Encadrement / Groupes</nav>
    <div className={styles.topline}><div><h1>Groupes</h1><p className={styles.lead}>Organisez les juniors et l’encadrement par groupe.</p></div><div className={actionStyles.topActions}><label className="groups-season-nav-select"><select aria-label="Saison" value={seasonId} onChange={(event) => { setSeasonId(event.target.value); void load(clubId, event.target.value); }} disabled={!clubId || seasons.length === 0}>{seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · Saison en cours" : ""}</option>)}</select></label><Link className={actionStyles.primaryButton} href="/manager/groups/new"><Plus size={16} />Créer un groupe</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label="Chargement des groupes…" /></section> : <><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>Saison sélectionnée</h2><p>Les indicateurs affichés correspondent à la saison choisie.</p></div><label className="user-mgmt-field"><span className="user-mgmt-field-label">Saison</span><select value={seasonId} onChange={(event) => { setSeasonId(event.target.value); void load(clubId, event.target.value); }} disabled={!clubId || seasons.length === 0}>{seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · Saison en cours" : ""}</option>)}</select></label></div><div className={styles.statsGrid}><article className={styles.statCard}><span>Groupes actifs</span><b>{active}</b><small>dans le club</small></article><article className={styles.statCard}><span>Juniors attribués</span><b>{players}</b><small>dans les groupes</small></article><article className={styles.statCard}><span>Sans junior</span><b>{groups.filter((group) => group.is_active && group.players.length === 0).length}</b><small>à compléter</small></article></div></section><section className={styles.quickPanel}><div className={styles.sectionHeading}><h2>Groupes</h2></div><div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}><label className="user-mgmt-checkbox-label"><input type="checkbox" checked={hideArchived} onChange={(event) => setHideArchived(event.target.checked)} /><span>Masquer les groupes archivés</span></label></div><div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 240 }}><span className="user-mgmt-field-label">Recherche</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }} /><input value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: 33 }} placeholder="Groupe, junior ou coach" /></span></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Catégorie</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Toutes les catégories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--groups"><thead><tr><th>Groupe</th><th>Catégories</th><th>Juniors</th><th>Coachs</th><th>Statut</th><th aria-label="Actions" /></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "left" }}><div className="marketplace-empty">Aucun groupe ne correspond aux critères.</div></td></tr> : rows.map((group) => <tr key={group.id}><td><b>{group.name}</b></td><td>{group.categories.length ? <div className="user-mgmt-chip-list">{group.categories.map((item) => <span className="pill-soft" key={item}>{item}</span>)}</div> : "—"}</td><td>{group.players.length ? <div className="user-mgmt-avatar-stack">{group.players.slice(0, 4).map((profile) => <Avatar profile={profile} key={profile.id} />)}<span>{group.players.length}</span></div> : "—"}</td><td>{group.coaches.length ? <div className="user-mgmt-avatar-stack">{group.coaches.slice(0, 3).map((profile) => <Avatar profile={profile} key={profile.id} />)}<span>{group.coaches.length}</span></div> : "—"}</td><td><span className="pill-soft">{group.is_active ? "Actif" : "Inactif"}</span></td><td><Link className="btn" href={`/manager/groups/${group.id}`}>Éditer</Link></td></tr>)}</tbody></table></div></section></>}
  </div>;
}
