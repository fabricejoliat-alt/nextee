"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "@/app/manager/camps/Camps.module.css";

type Club = { id: string; name: string | null };
type Membership = { club_id: string; user_id: string; role: string | null; is_active: boolean | null; can_transfer_players_between_club_groups?: boolean | null };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; sex: string | null };
type Player = Profile & { club_ids: string[]; club_names: string[] };

function name(profile: Pick<Profile, "first_name" | "last_name">) { return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "—"; }
function initials(profile: Profile) { return `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() || "J"; }
function sex(value: string | null) { return value === "male" ? "Garçon" : value === "female" ? "Fille" : value === "other" ? "Autre" : "Non défini"; }

export default function CoachPlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]); const [clubs, setClubs] = useState<Club[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState(""); const [clubFilter, setClubFilter] = useState("all"); const [sexFilter, setSexFilter] = useState("all");
  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    try {
      const auth = await supabase.auth.getUser(); if (!auth.data.user) throw new Error("Session invalide."); const userId = auth.data.user.id;
      const membershipsResult = await supabase.from("club_members").select("club_id,user_id,role,is_active,can_transfer_players_between_club_groups").eq("user_id", userId).eq("role", "coach").eq("is_active", true);
      if (membershipsResult.error) throw new Error(membershipsResult.error.message);
      const memberships = (membershipsResult.data ?? []) as Membership[]; const clubIds = [...new Set(memberships.map((row) => row.club_id))];
      if (!clubIds.length) { setPlayers([]); setClubs([]); return; }
      const [clubsResult, linksResult, headGroupsResult] = await Promise.all([
        supabase.from("clubs").select("id,name").in("id", clubIds),
        supabase.from("coach_group_coaches").select("group_id").eq("coach_user_id", userId),
        supabase.from("coach_groups").select("id").in("club_id", clubIds).eq("head_coach_user_id", userId),
      ]);
      if (clubsResult.error || linksResult.error || headGroupsResult.error) throw new Error(clubsResult.error?.message ?? linksResult.error?.message ?? headGroupsResult.error?.message);
      const clubList = ((clubsResult.data ?? []) as Club[]).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr")); setClubs(clubList);
      const groupIds = [...new Set([...(linksResult.data ?? []).map((row) => row.group_id), ...(headGroupsResult.data ?? []).map((row) => row.id)])];
      const assignedResult = groupIds.length ? await supabase.from("coach_group_players").select("player_user_id").in("group_id", groupIds) : { data: [], error: null };
      if (assignedResult.error) throw new Error(assignedResult.error.message);
      const assignedIds = new Set((assignedResult.data ?? []).map((row) => row.player_user_id));
      const transferableClubs = new Set(memberships.filter((row) => row.can_transfer_players_between_club_groups).map((row) => row.club_id));
      const playerMembersResult = await supabase.from("club_members").select("club_id,user_id,role,is_active").in("club_id", clubIds).eq("role", "player").eq("is_active", true);
      if (playerMembersResult.error) throw new Error(playerMembersResult.error.message);
      const playerMembers = ((playerMembersResult.data ?? []) as Membership[]).filter((row) => assignedIds.has(row.user_id) || transferableClubs.has(row.club_id));
      const playerIds = [...new Set(playerMembers.map((row) => row.user_id))];
      if (!playerIds.length) { setPlayers([]); return; }
      const profilesResult = await supabase.from("profiles").select("id,first_name,last_name,avatar_url,handicap,sex").in("id", playerIds); if (profilesResult.error) throw new Error(profilesResult.error.message);
      const clubNames = new Map(clubList.map((club) => [club.id, club.name ?? "Club"]));
      const memberClubs = new Map<string, Set<string>>(); playerMembers.forEach((row) => { const current = memberClubs.get(row.user_id) ?? new Set<string>(); current.add(row.club_id); memberClubs.set(row.user_id, current); });
      setPlayers(((profilesResult.data ?? []) as Profile[]).map((profile) => { const ids = [...(memberClubs.get(profile.id) ?? [])]; return { ...profile, club_ids: ids, club_names: ids.map((id) => clubNames.get(id) ?? "Club") }; }).sort((a, b) => name(a).localeCompare(name(b), "fr")));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); } finally { setLoading(false); }
  })(); }, []);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase("fr"); return players.filter((player) => (clubFilter === "all" || player.club_ids.includes(clubFilter)) && (sexFilter === "all" || (sexFilter === "none" ? !player.sex : player.sex === sexFilter)) && (!q || `${name(player)} ${player.club_names.join(" ")}`.toLocaleLowerCase("fr").includes(q))); }, [players, query, clubFilter, sexFilter]);
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><span>/</span><strong>Juniors</strong></nav>
    <header className={styles.topline}><div><h1>Juniors</h1><p className={styles.lead}>Consultez les juniors que vous accompagnez.</p></div></header>
    {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>Liste des juniors</h2><p>{loading ? "Chargement…" : `${filtered.length} junior${filtered.length > 1 ? "s" : ""}`}</p></div></div>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>Rechercher</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom ou club…" /></label>
        {clubs.length > 1 ? <label className={styles.field}><span>Club</span><select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}><option value="all">Tous les clubs</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? "Club"}</option>)}</select></label> : null}
        <label className={styles.field}><span>Genre</span><select value={sexFilter} onChange={(event) => setSexFilter(event.target.value)}><option value="all">Tous</option><option value="male">Garçon</option><option value="female">Fille</option><option value="other">Autre</option><option value="none">Non défini</option></select></label>
      </div>
      {loading ? <div className={styles.empty}>Chargement des juniors…</div> : !filtered.length ? <div className={styles.empty}><UserRound size={21} />Aucun junior trouvé dans votre périmètre.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Junior</th><th>Club</th><th>Genre</th><th>Handicap</th><th>Actions</th></tr></thead><tbody>{filtered.map((player) => <tr key={player.id}><td data-label="Junior"><div className={styles.person}><span className={styles.avatar}>{player.avatar_url ? <img src={player.avatar_url} alt="" /> : initials(player)}</span><b>{name(player)}</b></div></td><td data-label="Club">{player.club_names.join(" · ")}</td><td data-label="Genre">{sex(player.sex)}</td><td data-label="Handicap">{player.handicap == null ? "Données insuffisantes" : player.handicap.toFixed(1)}</td><td data-label="Actions"><Link className={styles.iconButton} href={`/coach/players/${player.id}?returnTo=${encodeURIComponent("/coach/players")}`} aria-label={`Consulter ${name(player)}`} title="Consulter"><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
