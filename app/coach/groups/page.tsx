"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
// Reuse the Camps module so Coach tables remain visually identical to Manager tables.
import styles from "@/app/manager/camps/Camps.module.css";

type Group = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null; clubName: string; isAssigned: boolean; isHead: boolean; playerCount: number; coachCount: number; categories: string[]; nextActivity: string | null };
type RawGroup = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null };
const fmtDate = (value: string | null) => value ? new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Aucune activité planifiée";
function isOperationalGroup(group: RawGroup) {
  const name = group.name.trim();
  return group.is_active && name !== "Groupe spécifique" && !name.startsWith("__EVENT_SPECIFIQUE__") && !name.startsWith("__ARCHIVE_DELETED__");
}

export default function CoachGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState("");
  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    try {
      const auth = await supabase.auth.getUser(); if (!auth.data.user) throw new Error("Session invalide."); const userId = auth.data.user.id;
      const [memberships, links, headed] = await Promise.all([
        supabase.from("club_members").select("club_id,can_transfer_players_between_club_groups").eq("user_id", userId).eq("role", "coach").eq("is_active", true),
        supabase.from("coach_group_coaches").select("group_id,is_head").eq("coach_user_id", userId),
        supabase.from("coach_groups").select("id").eq("head_coach_user_id", userId),
      ]);
      if (memberships.error || links.error || headed.error) throw new Error(memberships.error?.message ?? links.error?.message ?? headed.error?.message);
      const clubIds = [...new Set((memberships.data ?? []).map((row) => row.club_id))];
      const transferClubs = new Set((memberships.data ?? []).filter((row) => row.can_transfer_players_between_club_groups).map((row) => row.club_id));
      const assignedIds = new Set([...(links.data ?? []).map((row) => row.group_id), ...(headed.data ?? []).map((row) => row.id)]);
      if (!clubIds.length) { setGroups([]); return; }
      const [groupResult, clubResult] = await Promise.all([supabase.from("coach_groups").select("id,club_id,name,is_active,head_coach_user_id").in("club_id", clubIds).eq("is_active", true), supabase.from("clubs").select("id,name").in("id", clubIds)]);
      if (groupResult.error || clubResult.error) throw new Error(groupResult.error?.message ?? clubResult.error?.message);
      const visible = ((groupResult.data ?? []) as RawGroup[]).filter((group) => isOperationalGroup(group) && (assignedIds.has(group.id) || transferClubs.has(group.club_id))); const ids = visible.map((group) => group.id); const clubNames = new Map((clubResult.data ?? []).map((club) => [club.id, club.name ?? "Club"]));
      if (!ids.length) { setGroups([]); return; }
      const [players, coaches, categories, events] = await Promise.all([
        supabase.from("coach_group_players").select("group_id").in("group_id", ids), supabase.from("coach_group_coaches").select("group_id").in("group_id", ids), supabase.from("coach_group_categories").select("group_id,category").in("group_id", ids), supabase.from("club_events").select("group_id,starts_at,status").in("group_id", ids).eq("status", "scheduled").gte("starts_at", new Date().toISOString()).order("starts_at"),
      ]);
      if (players.error || coaches.error || categories.error || events.error) throw new Error(players.error?.message ?? coaches.error?.message ?? categories.error?.message ?? events.error?.message);
      const count = (rows: Array<{ group_id: string }>, id: string) => rows.filter((row) => row.group_id === id).length;
      setGroups(visible.map((group) => ({ ...group, clubName: clubNames.get(group.club_id) ?? "Club", isAssigned: assignedIds.has(group.id), isHead: group.head_coach_user_id === userId || Boolean((links.data ?? []).find((row) => row.group_id === group.id)?.is_head), playerCount: count(players.data ?? [], group.id), coachCount: count(coaches.data ?? [], group.id), categories: (categories.data ?? []).filter((row) => row.group_id === group.id).map((row) => row.category), nextActivity: (events.data ?? []).find((row) => row.group_id === group.id)?.starts_at ?? null })).sort((a, b) => a.name.localeCompare(b.name, "fr")));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); } finally { setLoading(false); }
  })(); }, []);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase("fr"); return groups.filter((group) => !q || `${group.name} ${group.clubName} ${group.categories.join(" ")}`.toLocaleLowerCase("fr").includes(q)); }, [groups, query]);
  return <main className={styles.page}><nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><span>/</span><strong>Mes groupes</strong></nav><header className={styles.topline}><div><h1>Mes groupes</h1><p className={styles.lead}>Consultez vos groupes et leur prochaine activité.</p></div></header>{error ? <div className={styles.alertError} role="alert">{error}</div> : null}<section className={styles.panel}><div className={styles.panelHeader}><div><h2>Groupes suivis</h2><p>{loading ? "Chargement…" : `${filtered.length} groupe${filtered.length > 1 ? "s" : ""}`}</p></div></div><div className={styles.toolbar}><label className={styles.field}><span>Rechercher</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Groupe, club ou catégorie…" /></label></div>{loading ? <ListSkeleton /> : !filtered.length ? <div className={styles.empty}><Users size={21} />Aucun groupe dans votre périmètre.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Groupe</th><th>Club</th><th>Juniors</th><th>Coachs</th><th>Prochaine activité</th><th>Statut</th><th>Actions</th></tr></thead><tbody>{filtered.map((group) => <tr key={group.id}><td data-label="Groupe"><div className={styles.titleCell}><b>{group.name}</b><span className={styles.muted}>{group.categories.slice(0, 3).join(" · ") || "Sans catégorie"}{group.isHead ? " · Responsable" : !group.isAssigned ? " · Mobilité Head Coach" : ""}</span></div></td><td data-label="Club">{group.clubName}</td><td data-label="Juniors">{group.playerCount}</td><td data-label="Coachs">{group.coachCount}</td><td data-label="Prochaine activité">{fmtDate(group.nextActivity)}</td><td data-label="Statut"><span className={styles.badge}>Actif</span></td><td data-label="Actions"><Link className={styles.iconButton} href={`/coach/groups/${group.id}`} aria-label={`Consulter ${group.name}`} title="Consulter"><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>}</section></main>;
}

function ListSkeleton() { return <div className={styles.stack} aria-label="Chargement"><div className={styles.empty}>Chargement des groupes…</div></div>; }
