"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronRight, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "../../OrderOfMerit.module.css";

type Contest = {
  id: string;
  organization_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  contest_date: string;
};
type CandidatePlayer = { id: string; first_name: string | null; last_name: string | null };
type ResultRow = { player_id: string; rank: number; note: string };
type ProfileRelation = { first_name: string | null; last_name: string | null } | Array<{ first_name: string | null; last_name: string | null }> | null;
type GroupPlayerRecord = { player_user_id: string | null; profiles: ProfileRelation };
type ClubPlayerRecord = { user_id: string | null; profiles: ProfileRelation };

function profileFromRelation(value: ProfileRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function playerName(player: CandidatePlayer) {
  return `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || "Joueur";
}

function formatDate(value: string | undefined) {
  if (!value) return "Date à définir";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

export default function ManagerOMContestDetailPage() {
  const params = useParams<{ contestId: string }>();
  const contestId = params.contestId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [contest, setContest] = useState<Contest | null>(null);
  const [players, setPlayers] = useState<CandidatePlayer[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    const contestResponse = await supabase.from("om_internal_contests")
      .select("id,organization_id,group_id,title,description,contest_date")
      .eq("id", contestId).maybeSingle();
    if (contestResponse.error || !contestResponse.data) {
      setError(contestResponse.error?.message ?? "Concours introuvable.");
      setLoading(false);
      return;
    }
    const nextContest = contestResponse.data as Contest;
    setContest(nextContest);

    const resultsResponse = await supabase.from("om_internal_contest_results")
      .select("player_id,rank,note").eq("contest_id", contestId).order("rank", { ascending: true });
    if (resultsResponse.error) {
      setError(resultsResponse.error.message);
    } else {
      setRows(((resultsResponse.data ?? []) as Array<{ player_id: string; rank: number; note: string | null }>).map((row) => ({
        player_id: String(row.player_id ?? ""),
        rank: Number(row.rank ?? 1),
        note: String(row.note ?? ""),
      })));
    }

    let candidates: CandidatePlayer[] = [];
    if (nextContest.group_id) {
      const playersResponse = await supabase.from("coach_group_players")
        .select("player_user_id,profiles:player_user_id(first_name,last_name)").eq("group_id", nextContest.group_id);
      if (playersResponse.error) {
        setError(playersResponse.error.message);
      } else {
        candidates = ((playersResponse.data ?? []) as unknown as GroupPlayerRecord[]).map((row) => {
          const profile = profileFromRelation(row.profiles);
          return { id: String(row.player_user_id ?? ""), first_name: profile?.first_name ?? null, last_name: profile?.last_name ?? null };
        });
      }
    } else {
      const playersResponse = await supabase.from("club_members")
        .select("user_id,profiles:user_id(first_name,last_name)")
        .eq("club_id", nextContest.organization_id).eq("role", "player").eq("is_active", true);
      if (playersResponse.error) {
        setError(playersResponse.error.message);
      } else {
        candidates = ((playersResponse.data ?? []) as unknown as ClubPlayerRecord[]).map((row) => {
          const profile = profileFromRelation(row.profiles);
          return { id: String(row.user_id ?? ""), first_name: profile?.first_name ?? null, last_name: profile?.last_name ?? null };
        });
      }
    }
    const uniquePlayers = Array.from(new Map(candidates.filter((player) => player.id).map((player) => [player.id, player])).values());
    setPlayers(uniquePlayers.sort((a, b) => playerName(a).localeCompare(playerName(b), "fr")));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function addRow() {
    const availablePlayer = players.find((player) => !rows.some((row) => row.player_id === player.id));
    setRows((current) => [...current, { player_id: availablePlayer?.id ?? "", rank: current.length + 1, note: "" }]);
  }

  function updateRow(index: number, patch: Partial<ResultRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function saveRanking() {
    setError(null);
    setSuccess(null);
    const cleaned = rows.map((row) => ({ player_id: row.player_id, rank: Math.max(1, Number(row.rank || 1)), note: row.note.trim() })).filter((row) => row.player_id);
    if (new Set(cleaned.map((row) => row.player_id)).size !== cleaned.length) {
      setError("Chaque joueur doit apparaître une seule fois.");
      return;
    }
    const sorted = [...cleaned].sort((a, b) => a.rank - b.rank);
    const fullRanking = sorted.map((row) => ({
      rank: row.rank,
      player_id: row.player_id,
      player_name: playerName(players.find((player) => player.id === row.player_id) ?? { id: row.player_id, first_name: null, last_name: null }),
      note: row.note || null,
    }));
    setSaving(true);
    const response = await supabase.rpc("om_publish_internal_contest", { p_contest_id: contestId, p_rankings: sorted, p_full_ranking: fullRanking });
    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setSuccess("Le classement a été publié et les points ont été recalculés.");
    await load();
  }

  const remainingPlayers = useMemo(() => players.filter((player) => !rows.some((row) => row.player_id === player.id)).length, [players, rows]);

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d'Ariane"><Link href="/manager">Manager</Link><ChevronRight size={13} /><Link href="/manager/om/contests">Concours internes</Link><ChevronRight size={13} /><span>{contest?.title ?? "Classement"}</span></nav>
      <div className={styles.topline}><div><h1>{contest?.title ?? "Classement du concours"}</h1><p className={styles.lead}>{contest?.description || "Renseignez l'ordre d'arrivée pour calculer les points du concours interne."}</p></div><div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void saveRanking()} disabled={saving || loading}><Save size={16} />{saving ? "Publication..." : "Publier le classement"}</button></div></div>
      {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
      {success ? <div className={styles.alertSuccess} role="status">{success}</div> : null}
      <section className={styles.stats} aria-label="Résumé du concours"><div className={styles.stat}><span>Date</span><b style={{ fontSize: 17 }}>{formatDate(contest?.contest_date)}</b></div><div className={styles.stat}><span>Joueurs disponibles</span><b>{players.length}</b></div><div className={styles.stat}><span>Résultats saisis</span><b>{rows.length}</b></div><div className={styles.stat}><span>Encore disponibles</span><b>{remainingPlayers}</b></div></section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Classement</h2><p>Chaque joueur ne peut apparaître qu’une seule fois. La note est facultative.</p></div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={addRow} disabled={loading || remainingPlayers === 0}><Plus size={15} />Ajouter un joueur</button></div></div>
        {loading ? <ListLoadingBlock label="Chargement du concours..." /> : players.length === 0 ? <div className={styles.empty}>Aucun joueur disponible pour ce concours.</div> : rows.length === 0 ? <div className={styles.empty}>Aucun résultat saisi. Ajoutez un joueur pour commencer le classement.</div> : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Joueur</th><th>Classement</th><th>Note</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${index}:${row.player_id}`}><td data-label="Joueur"><select className={styles.tableControl} value={row.player_id} onChange={(event) => updateRow(index, { player_id: event.target.value })}><option value="">Choisir un joueur</option>{players.map((player) => <option key={player.id} value={player.id} disabled={rows.some((current, rowIndex) => rowIndex !== index && current.player_id === player.id)}>{playerName(player)}</option>)}</select></td><td data-label="Classement"><input className={styles.tableControl} type="number" min={1} value={row.rank} onChange={(event) => updateRow(index, { rank: Math.max(1, Number(event.target.value || 1)) })} /></td><td data-label="Note"><input className={styles.tableControl} value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} placeholder="Note facultative" /></td><td data-label="Actions"><div className={styles.actions}><button type="button" className={`${styles.iconButton} ${styles.dangerIcon}`} title="Retirer" aria-label="Retirer ce joueur" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button></div></td></tr>)}</tbody>
        </table></div>}
      </section>
    </main>
  );
}
