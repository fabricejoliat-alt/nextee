"use client";
import { adminFetch } from "@/lib/adminFetch";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./LegalAdminWorkspace.module.css";

type Row = { id: string; user_id: string; status: string; contact_email: string | null; requested_at: string; due_at: string; last_error: string | null; confirmation_sent_at: string | null };
export default function AccountDeletionAdmin() {
  const [rows, setRows] = useState<Row[]>([]), [selected, setSelected] = useState("");
  const [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load() {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await adminFetch("/api/admin/legal/account-deletions", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setRows(data.requests);
  }
  async function execute(id: string) {
    setBusy(true); setMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await adminFetch("/api/admin/legal/account-deletions", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, confirm_request_id: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(data.message ?? "Compte supprimé et confirmation disponible.");
      setSelected(""); setConfirmation("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Traitement indisponible."); }
    finally { await load().catch(() => undefined); setBusy(false); }
  }
  return <section className={styles.panel}>
    <h2>Suppressions de comptes</h2>
    <p>Demandes confirmées par le titulaire avec son mot de passe. Traiter au plus tard à la date indiquée. Une suppression efface les accès à tous les clubs et ne peut pas être annulée après son lancement.</p>
    <button disabled={busy} onClick={() => void load().catch((e) => setMessage(e.message))}>Charger les suppressions</button>
    {message && <p role="status">{message}</p>}
    {rows.map((row) => <details key={row.id}>
      <summary>{row.contact_email ?? row.user_id} · {row.status === "completed" ? "Terminé" : row.status === "processing" ? "À reprendre" : "À traiter"} · échéance {new Date(row.due_at).toLocaleDateString("fr-CH")}</summary>
      <p>Compte : {row.user_id}. Demande : {row.id}.</p>
      {row.status !== "completed" && new Date(row.due_at).getTime() < Date.now() && <p role="alert">Échéance dépassée : traiter cette demande en priorité.</p>}
      {row.last_error && <p role="alert">{row.last_error}</p>}
      {row.status === "completed" ? <p>Le reçu confirme la suppression. {row.contact_email ? row.confirmation_sent_at ? "Courriel envoyé." : "Courriel en attente de nouvelle tentative." : "Le titulaire utilise son lien de suivi."}</p> : <>
        <button disabled={busy} onClick={() => { setSelected(row.id); setConfirmation(""); }}>Préparer la suppression définitive</button>
        {selected === row.id && <div>
          <p>Les fichiers, données personnelles et compte de connexion seront supprimés. Les comptes des enfants, des autres membres et les structures du club seront conservés.</p>
          <label>Saisir SUPPRIMER pour cette demande <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} autoComplete="off" /></label>
          <button disabled={busy || confirmation !== "SUPPRIMER"} onClick={() => void execute(row.id)}>{busy ? "Traitement…" : "Supprimer définitivement ce compte"}</button>
        </div>}
      </>}
    </details>)}
  </section>;
}
