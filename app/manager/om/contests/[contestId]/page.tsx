"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type Contest = {
  id: string;
  organization_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  contest_date: string;
  full_ranking: any;
};

type CandidatePlayer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type ResultRow = {
  player_id: string;
  rank: number;
  note: string;
};

function labelByLocale(locale: string, fr: string, en: string, de: string, it: string) {
  if (locale === "fr") return fr;
  if (locale === "de") return de;
  if (locale === "it") return it;
  return en;
}

function playerName(p: CandidatePlayer) {
  const v = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return v || "—";
}

export default function ManagerOMContestDetailPage() {
  const { locale } = useI18n();
  const params = useParams<{ contestId: string }>();
  const contestId = params.contestId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [contest, setContest] = useState<Contest | null>(null);
  const [players, setPlayers] = useState<CandidatePlayer[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const actionButtonStyle: React.CSSProperties = {
    minHeight: 40,
    padding: "0 14px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };

  const txt = useMemo(
    () => ({
      back: labelByLocale(locale, "Retour OM", "Back to OM", "Zurueck zu OM", "Torna a OM"),
      title: labelByLocale(locale, "Classement du concours", "Contest ranking", "Wettbewerbsrangliste", "Classifica concorso"),
      loading: labelByLocale(locale, "Chargement…", "Loading…", "Laedt…", "Caricamento…"),
      save: labelByLocale(locale, "Publier le classement", "Publish ranking", "Rangliste veroeffentlichen", "Pubblica classifica"),
      addLine: labelByLocale(locale, "Ajouter un joueur", "Add player", "Spieler hinzufuegen", "Aggiungi giocatore"),
      player: labelByLocale(locale, "Joueur", "Player", "Spieler", "Giocatore"),
      rank: labelByLocale(locale, "Rang", "Rank", "Rang", "Posizione"),
      note: labelByLocale(locale, "Note", "Note", "Notiz", "Nota"),
      rankLabel: labelByLocale(locale, "Classement", "Ranking", "Klassierung", "Classifica"),
      scoreLabel: labelByLocale(locale, "Score", "Score", "Punktzahl", "Punteggio"),
      noPlayers: labelByLocale(locale, "Aucun joueur trouvé.", "No player found.", "Keine Spieler gefunden.", "Nessun giocatore trovato."),
      saved: labelByLocale(locale, "Classement publié.", "Ranking published.", "Rangliste veroeffentlicht.", "Classifica pubblicata."),
      duplicatePlayers: labelByLocale(
        locale,
        "Chaque joueur doit apparaître une seule fois.",
        "Each player must appear only once.",
        "Jeder Spieler darf nur einmal erscheinen.",
        "Ogni giocatore deve apparire una sola volta."
      ),
      contestNotFound: labelByLocale(locale, "Concours introuvable.", "Contest not found.", "Wettbewerb nicht gefunden.", "Concorso non trovato."),
    }),
    [locale]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const cRes = await supabase
        .from("om_internal_contests")
        .select("id,organization_id,group_id,title,description,contest_date,full_ranking")
        .eq("id", contestId)
        .maybeSingle();
      if (cRes.error) {
        setError(cRes.error.message);
        setLoading(false);
        return;
      }
      if (!cRes.data) {
        setError(txt.contestNotFound);
        setLoading(false);
        return;
      }
      const c = cRes.data as Contest;
      setContest(c);

      const resultsRes = await supabase
        .from("om_internal_contest_results")
        .select("player_id,rank,note")
        .eq("contest_id", contestId)
        .order("rank", { ascending: true });
      if (resultsRes.error) {
        setError(resultsRes.error.message);
      } else {
        setRows(
          (resultsRes.data ?? []).map((r: any) => ({
            player_id: String(r.player_id ?? ""),
            rank: Number(r.rank ?? 1),
            note: String(r.note ?? ""),
          }))
        );
      }

      if (c.group_id) {
        const pRes = await supabase
          .from("coach_group_players")
          .select("player_user_id,profiles:player_user_id(first_name,last_name)")
          .eq("group_id", c.group_id);
        if (pRes.error) {
          setError(pRes.error.message);
        } else {
          const mapped = (pRes.data ?? []).map((r: any) => ({
            id: String(r.player_user_id ?? ""),
            first_name: r.profiles?.first_name ?? null,
            last_name: r.profiles?.last_name ?? null,
          }));
          const uniq = Array.from(new Map(mapped.map((m) => [m.id, m])).values());
          setPlayers(uniq.sort((a, b) => playerName(a).localeCompare(playerName(b), "fr")));
        }
      } else {
        const pRes = await supabase
          .from("club_members")
          .select("user_id,profiles:user_id(first_name,last_name)")
          .eq("club_id", c.organization_id)
          .eq("role", "player")
          .eq("is_active", true);
        if (pRes.error) {
          setError(pRes.error.message);
        } else {
          const mapped = (pRes.data ?? []).map((r: any) => ({
            id: String(r.user_id ?? ""),
            first_name: r.profiles?.first_name ?? null,
            last_name: r.profiles?.last_name ?? null,
          }));
          const uniq = Array.from(new Map(mapped.map((m) => [m.id, m])).values());
          setPlayers(uniq.sort((a, b) => playerName(a).localeCompare(playerName(b), "fr")));
        }
      }

      setLoading(false);
    })();
  }, [contestId, txt.contestNotFound]);

  function addRow() {
    const fallbackPlayer = players[0]?.id ?? "";
    setRows((prev) => [...prev, { player_id: fallbackPlayer, rank: prev.length + 1, note: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<ResultRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function onSave() {
    setError(null);
    setSuccess(null);

    const cleaned = rows
      .map((r) => ({ player_id: r.player_id, rank: Math.max(1, Number(r.rank || 1)), note: r.note?.trim() || "" }))
      .filter((r) => r.player_id);

    const seen = new Set<string>();
    for (const row of cleaned) {
      if (seen.has(row.player_id)) {
        setError(txt.duplicatePlayers);
        return;
      }
      seen.add(row.player_id);
    }

    const sorted = cleaned.slice().sort((a, b) => a.rank - b.rank);
    const fullRanking = sorted.map((r) => {
      const p = players.find((x) => x.id === r.player_id);
      return {
        rank: r.rank,
        player_id: r.player_id,
        player_name: p ? playerName(p) : "—",
        note: r.note || null,
      };
    });

    setSaving(true);
    const rpc = await supabase.rpc("om_publish_internal_contest", {
      p_contest_id: contestId,
      p_rankings: sorted,
      p_full_ranking: fullRanking,
    });
    setSaving(false);
    if (rpc.error) {
      setError(rpc.error.message);
      return;
    }
    setSuccess(txt.saved);
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <Link className="btn" href="/manager/om">
              {txt.back}
            </Link>
          </div>
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            {loading ? (
              <ListLoadingBlock label={txt.loading} />
            ) : (
              <>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  {txt.title}
                </div>
                <div style={{ fontWeight: 800 }}>{contest?.title ?? "—"}</div>
                {contest?.description ? <div style={{ opacity: 0.8 }}>{contest.description}</div> : null}
                <div style={{ fontSize: 13, opacity: 0.75 }}>{contest?.contest_date ?? "—"}</div>

                {players.length === 0 ? (
                  <div style={{ opacity: 0.72 }}>{txt.noPlayers}</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={addRow} style={actionButtonStyle}>
                        <Plus size={15} />
                        {txt.addLine}
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns: "minmax(180px,1fr) 100px minmax(140px,1fr) auto",
                          alignItems: "center",
                          padding: "0 6px",
                          fontSize: 12,
                          fontWeight: 800,
                          opacity: 0.8,
                        }}
                      >
                        <div>{txt.player}</div>
                        <div>{txt.rankLabel}</div>
                        <div>{txt.scoreLabel}</div>
                        <div />
                      </div>
                      {rows.map((r, idx) => (
                        <div
                          key={`${idx}-${r.player_id}`}
                          className="marketplace-item"
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            display: "grid",
                            gap: 8,
                            gridTemplateColumns: "minmax(180px,1fr) 100px minmax(140px,1fr) auto",
                            alignItems: "center",
                          }}
                        >
                          <select className="search-input" value={r.player_id} onChange={(e) => updateRow(idx, { player_id: e.target.value })}>
                            <option value="">{txt.player}</option>
                            {players.map((p) => (
                              <option key={p.id} value={p.id}>
                                {playerName(p)}
                              </option>
                            ))}
                          </select>
                          <input
                            className="search-input"
                            type="number"
                            min={1}
                            value={r.rank}
                            onChange={(e) => updateRow(idx, { rank: Math.max(1, Number(e.target.value || 1)) })}
                            placeholder={txt.rank}
                          />
                          <input
                            className="search-input"
                            value={r.note}
                            onChange={(e) => updateRow(idx, { note: e.target.value })}
                            placeholder={txt.note}
                          />
                          <button type="button" className="btn btn-danger" onClick={() => removeRow(idx)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="button" className="cta-green cta-green-inline" onClick={onSave} disabled={saving} style={actionButtonStyle}>
                        <Save size={15} />
                        {txt.save}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {error ? (
          <div className="glass-section">
            <div className="marketplace-error">{error}</div>
          </div>
        ) : null}
        {success ? (
          <div className="glass-section">
            <div style={{ color: "#166534", fontWeight: 700 }}>{success}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
