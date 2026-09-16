"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./CoachPlayerTransferDialog.module.css";

type Group = { id: string; name: string };

export default function CoachPlayerTransferDialog({ playerId, playerName, sourceGroupId, onTransferred }: { playerId: string; playerName: string; sourceGroupId: string; onTransferred: () => void }) {
  const [open, setOpen] = useState(false); const [groups, setGroups] = useState<Group[]>([]); const [sourceName, setSourceName] = useState(""); const [destinationId, setDestinationId] = useState(""); const [futureCount, setFutureCount] = useState(0); const [action, setAction] = useState<"keep" | "remove_old" | "move">("keep"); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false); window.addEventListener("keydown", key); closeRef.current?.focus(); return () => window.removeEventListener("keydown", key); }, [open]);
  async function headers() { const session = await supabase.auth.getSession(); return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }; }
  async function show(event: React.MouseEvent) { event.stopPropagation(); setOpen(true); setLoading(true); setError(""); try { const response = await fetch(`/api/coach/players/${playerId}/transfer-group?sourceGroupId=${encodeURIComponent(sourceGroupId)}`, { headers: await headers(), cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setGroups(json.destinationGroups ?? []); setSourceName(json.sourceGroup?.name ?? "Groupe actuel"); setFutureCount(json.futureSourceEventsCount ?? 0); setDestinationId(json.destinationGroups?.[0]?.id ?? ""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); } finally { setLoading(false); } }
  async function confirm() { if (!destinationId) return; setSaving(true); setError(""); try { const response = await fetch(`/api/coach/players/${playerId}/transfer-group`, { method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ sourceGroupId, destinationGroupId: destinationId, futureEventsAction: action }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setOpen(false); onTransferred(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Déplacement impossible."); } finally { setSaving(false); } }
  return <>
    <button type="button" className={styles.trigger} onClick={show} title="Déplacer vers un groupe" aria-label={`Déplacer ${playerName} vers un autre groupe`}><ArrowRightLeft size={17} /></button>
    {open ? <div className={styles.backdrop} role="presentation" onMouseDown={() => setOpen(false)}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={`transfer-${playerId}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id={`transfer-${playerId}`}>Déplacer vers un groupe</h2><p>{playerName} · {sourceName}</p></div><button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Fermer"><X size={19} /></button></header>
      {loading ? <div className={styles.loading}>Chargement des groupes…</div> : <div className={styles.body}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <label><span>Groupe de destination</span><select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}><option value="">Choisir un groupe</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <fieldset><legend>Activités futures de l’ancien groupe ({futureCount})</legend>
          <label><input type="radio" name={`future-${playerId}`} checked={action === "keep"} onChange={() => setAction("keep")} /><span><b>Conserver les invitations existantes</b><small>Aucune activité passée n’est modifiée.</small></span></label>
          <label><input type="radio" name={`future-${playerId}`} checked={action === "remove_old"} onChange={() => setAction("remove_old")} /><span><b>Retirer des activités futures de l’ancien groupe</b><small>L’historique reste intact.</small></span></label>
          <label><input type="radio" name={`future-${playerId}`} checked={action === "move"} onChange={() => setAction("move")} /><span><b>Transférer les invitations futures</b><small>Retire celles de l’ancien groupe et ajoute celles du nouveau.</small></span></label>
        </fieldset>
      </div>}
      <footer><button type="button" className={styles.cancel} onClick={() => setOpen(false)}>Annuler</button><button type="button" className={styles.confirm} onClick={confirm} disabled={loading || saving || !destinationId}>{saving ? "Déplacement…" : "Confirmer le déplacement"}</button></footer>
    </section></div> : null}
  </>;
}
