"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, Upload } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";

type Club = { id: string; name: string };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Member = { id: string; role: string; is_active: boolean | null; player_consent_status: "granted" | "pending" | "refused" | "adult" | null; profiles: { first_name: string | null; last_name: string | null; birth_date: string | null; avatar_url: string | null } | null };
type SeasonRecord = { id: string; club_member_id: string; course_label: string | null; group_id: string | null; registration_status: "draft" | "active" | "waitlist" | "cancelled" | "completed"; membership_status: "pending" | "paid" | "waived" | "overdue"; playing_right_status: "pending" | "paid" | "waived" | "not_applicable" };

const consentLabel: Record<NonNullable<Member["player_consent_status"]>, string> = { granted: "Accordé", pending: "À obtenir", refused: "Refusé", adult: "Non requis / Majeur" };

function age(value: string | null | undefined) {
  if (!value) return "—";
  const birth = new Date(`${value}T00:00:00`); const now = new Date();
  let result = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) result -= 1;
  return String(result);
}

async function authHeaders() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }

export default function PlayersManagementPage() {
  const [clubId, setClubId] = useState(""); const [seasons, setSeasons] = useState<Season[]>([]); const [seasonId, setSeasonId] = useState("");
  const [members, setMembers] = useState<Member[]>([]); const [records, setRecords] = useState<SeasonRecord[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [query, setQuery] = useState(""); const [consentFilter, setConsentFilter] = useState<"all" | NonNullable<Member["player_consent_status"]>>("all");

  async function loadClub(id: string) {
    if (!id) return; setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const [membersResponse, seasonsResponse] = await Promise.all([fetch(`/api/manager/clubs/${id}/members`, { headers, cache: "no-store" }), fetch(`/api/manager/clubs/${id}/seasons`, { headers, cache: "no-store" })]);
      const membersJson = await membersResponse.json(); const seasonsJson = await seasonsResponse.json();
      if (!membersResponse.ok) throw new Error(membersJson.error ?? "Impossible de charger les juniors.");
      if (!seasonsResponse.ok) throw new Error(seasonsJson.error ?? "Impossible de charger les saisons.");
      const nextSeasons = seasonsJson.seasons ?? []; setMembers((membersJson.members ?? []).filter((item: Member) => item.role === "player" && item.is_active !== false)); setSeasons(nextSeasons); setSeasonId((current) => nextSeasons.some((season: Season) => season.id === current) ? current : (nextSeasons.find((season: Season) => season.is_current)?.id ?? nextSeasons[0]?.id ?? ""));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger la page."); } finally { setLoading(false); }
  }
  async function loadRecords() {
    if (!clubId || !seasonId) { setRecords([]); return; }
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/seasons/${seasonId}/records`, { headers: await authHeaders(), cache: "no-store" });
      const json = await response.json();
      if (response.status === 403) {
        // The directory remains usable when the optional season records are not accessible.
        setRecords([]);
        return;
      }
      if (!response.ok) throw new Error(json.error);
      setRecords(json.records ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger les données de saison."); }
  }
  useEffect(() => { void (async () => { const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders() }); const json = await response.json(); const next = (json.clubs ?? []) as Club[]; const initial = next[0]?.id ?? ""; setClubId(initial); if (initial) await loadClub(initial); else setLoading(false); })(); }, []);
  useEffect(() => { if (clubId) void loadClub(clubId); }, [clubId]);
  // The request only depends on the selected identifiers; the loader is local to this component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadRecords(); }, [clubId, seasonId]);

  const recordByMember = useMemo(() => new Map(records.map((record) => [record.club_member_id, record])), [records]);
  const rows = useMemo(() => members.map((member) => ({ member, record: recordByMember.get(member.id) })).filter(({ member }) => { const searchable = `${member.profiles?.first_name ?? ""} ${member.profiles?.last_name ?? ""}`.toLocaleLowerCase(); return (!query || searchable.includes(query.toLocaleLowerCase())) && (consentFilter === "all" || member.player_consent_status === consentFilter); }).sort((a, b) => `${a.member.profiles?.last_name} ${a.member.profiles?.first_name}`.localeCompare(`${b.member.profiles?.last_name} ${b.member.profiles?.first_name}`, "fr")), [members, recordByMember, query, consentFilter]);
  const incompleteCount = rows.filter(({ member, record }) => !member.profiles?.birth_date || !record).length;
  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>Gestion des utilisateurs / Juniors</nav>
    <div className={styles.topline}><div><h1>Juniors</h1><p className={styles.lead}>Le suivi administratif et sportif du club, saison par saison.</p></div><div className="user-mgmt-actions"><label className="groups-season-nav-select"><select aria-label="Saison" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={seasons.length === 0}>{seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · En cours" : ""}</option>)}</select></label><Link className="btn" href={`/manager/user-management/players/import?club=${clubId}`}><Upload size={14} />Importer un fichier Excel</Link><Link className="btn" href="/manager/user-management/players/new"><Plus size={14} />Ajouter un junior</Link></div></div>
    {error ? <div role="alert" className={styles.errorAlert}>{error}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label="Chargement des juniors…" /></section> : <>
      <section className={styles.overview}><div className={styles.statsGrid}><article className={styles.statCard}><span>Juniors actifs</span><b>{members.length}</b><small>dans le club</small></article><article className={styles.statCard}><span>Inscrits</span><b>{rows.filter(({ record }) => record?.registration_status === "active").length}</b><small>pour cette saison</small></article><article className={styles.statCard}><span>Dossiers incomplets</span><b>{incompleteCount}</b><small>profil ou saison à compléter</small></article></div></section>
      <section className={styles.quickPanel}><div className={styles.sectionHeading}><h2>Juniors</h2><button className={styles.refreshButton} type="button" onClick={() => { void loadClub(clubId); void loadRecords(); }}><RefreshCw size={14} />Actualiser</button></div><div className="user-mgmt-toolbar"><label className="user-mgmt-field" style={{ minWidth: 220 }}><span className="user-mgmt-field-label">Recherche</span><span style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "#778178" }} /><input value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: 33 }} placeholder="Nom ou prénom" /></span></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Consentement</span><select value={consentFilter} onChange={(event) => setConsentFilter(event.target.value as typeof consentFilter)}><option value="all">Tous les statuts</option><option value="pending">À obtenir</option><option value="granted">Accordé</option><option value="refused">Refusé</option><option value="adult">Non requis / Majeur</option></select></label></div><div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--players"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th>Âge</th><th>Statut</th><th>Consentement</th><th aria-label="Actions" /></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={6}><div className="marketplace-empty">Aucun junior ne correspond à la recherche.</div></td></tr> : rows.map(({ member, record }) => { const active = record?.registration_status === "active"; return <tr key={member.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{member.profiles?.avatar_url ? <img src={member.profiles.avatar_url} alt="" /> : [member.profiles?.first_name, member.profiles?.last_name].map((value) => value?.trim().charAt(0).toUpperCase()).join("") || "—"}</span></td><td><b>{[member.profiles?.last_name, member.profiles?.first_name].filter(Boolean).join(" ") || "Sans nom"}</b></td><td>{age(member.profiles?.birth_date)}</td><td><span className="pill-soft">{active ? "Actif" : "Inactif"}</span></td><td><span className="pill-soft">{member.player_consent_status ? consentLabel[member.player_consent_status] : "À obtenir"}</span></td><td><Link className="btn" aria-label="Éditer le junior" href={`/manager/user-management/players/${member.id}?club=${clubId}&season=${seasonId}`}>Éditer</Link></td></tr>; })}</tbody></table></div></section>
    </>}
  </div>;
}
