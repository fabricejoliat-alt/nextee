"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { adminFetch } from "@/lib/adminFetch";
import styles from "./BrevoContactsAdmin.module.css";

type Snapshot = {
  config: { enabled: boolean; automatic: boolean; apiKeyConfigured: boolean; listId: number | null; webhookConfigured: boolean };
  stats: { contacts: number; pending: number; removals: number; failed: number; suppressed: number };
  control: { last_started_at: string | null; last_finished_at: string | null; last_error: string | null; lease_until: string | null; cooldown_until: string | null; target_list_id: number | null };
  contacts: { email: string; attributes: Record<string, string | boolean> }[];
  page: number;
};
const roleLabels: Record<string, string> = { player: "Joueur", parent: "Parent", coach: "Coach", manager: "Manager" };
function date(value: string | null) { return value ? new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(value)) : "Pas encore exécutée"; }

export default function BrevoContactsAdmin() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await adminFetch(`/api/admin/brevo-contacts?page=${page}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Chargement impossible.");
    if (!signal?.aborted) setData(body);
  }, [page]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  async function synchronize() {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await adminFetch("/api/admin/brevo-contacts", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Synchronisation impossible.");
      setNotice(body.status === "busy" ? "Une synchronisation est en cours ou Brevo demande de patienter."
        : body.status === "disabled" ? "La synchronisation est désactivée."
        : `${body.processed} contact(s) traité(s), ${body.failed} échec(s). ${data?.config.automatic ? "Les contacts restants seront repris automatiquement." : "Relancez un lot pour traiter les contacts restants."}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Synchronisation impossible."); }
    finally { setBusy(false); }
  }
  const ready = data?.config.enabled && data.config.apiKeyConfigured && data.config.listId && data.config.webhookConfigured
    && (!data.control.target_list_id || data.control.target_list_id === data.config.listId);
  return <div className={styles.page}>
    <nav><Link href="/admin">Administration</Link> / Contacts Brevo</nav>
    <header><h1>Contacts Brevo</h1><p>Retrouvez les joueurs, parents, coachs et managers dans votre répertoire Brevo.</p></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading && <p role="status">Chargement…</p>}
    {data && <>
      <section className={styles.card} aria-labelledby="brevo-status"><h2 id="brevo-status">{!data.config.enabled ? "Synchronisation désactivée" : data.config.automatic ? "Synchronisation automatique activée" : "Synchronisation manuelle"}</h2>
        <p>{data.config.automatic ? "Les coordonnées et rattachements sont vérifiés toutes les cinq minutes, puis envoyés par lots de 25 contacts." : "Lancez la synchronisation avec le bouton ci-dessous, par lots de 25 contacts. Aucun envoi automatique de contacts n’est activé."}</p>
        <dl className={styles.stats}>
          <div><dt>Contacts avec email</dt><dd>{data.stats.contacts}</dd></div>
          <div><dt>À mettre à jour</dt><dd>{data.stats.pending}</dd></div>
          <div><dt>À retirer</dt><dd>{data.stats.removals}</dd></div>
          <div><dt>En échec</dt><dd>{data.stats.failed}</dd></div>
          <div><dt>Adresses protégées des réinscriptions</dt><dd>{data.stats.suppressed}</dd></div>
        </dl>
        <p>Dernière exécution terminée : {date(data.control.last_finished_at)}</p>
        <p>Liste Brevo : {data.config.listId ?? "à configurer"} · Connexion : {data.config.apiKeyConfigured ? "clé configurée" : "à configurer"} · Retour des désabonnements : {data.config.webhookConfigured ? "secret configuré" : "à configurer"}</p>
        {!ready && <p className={styles.notice}>L’activation nécessite la connexion Brevo, une liste dédiée et le retour des désabonnements. L’aperçu ci-dessous reste disponible.</p>}
        {data.control.last_error && <p className={styles.error}>La dernière exécution a rencontré une erreur ({data.control.last_error}). {data.config.automatic ? "Les contacts concernés seront réessayés." : "Relancez un lot pour réessayer les contacts concernés."}</p>}
        <div className={styles.actions}><button type="button" disabled={!ready || busy || loading} onClick={() => void synchronize()}>{busy ? "Synchronisation…" : "Synchroniser maintenant"}</button>
          <button type="button" disabled={busy || loading} onClick={() => { setLoading(true); setError(""); void load().catch(cause => setError(cause.message)).finally(() => setLoading(false)); }}>Actualiser</button></div>
      </section>
      <section className={styles.card} aria-labelledby="brevo-preview"><h2 id="brevo-preview">Aperçu des contacts</h2>
        <p>Une adresse partagée correspond à un seul contact. Les rôles et clubs sont regroupés ; le nom d’un parent est privilégié pour une adresse familiale. Les comptes sans email réel sont exclus.</p>
        <p>Cette synchronisation n’enregistre aucun consentement à une newsletter. Les désabonnements Brevo sont conservés.</p>
        <div className={styles.table}><table><thead><tr><th>Email</th><th>Nom</th><th>Rôles</th><th>Clubs / organisations</th></tr></thead><tbody>
          {data.contacts.map(contact => <tr key={contact.email}><td>{contact.email}</td><td>{contact.attributes.ACTIVITEE_FIRSTNAME} {contact.attributes.ACTIVITEE_LASTNAME}</td>
            <td>{String(contact.attributes.ACTIVITEE_ROLES).split("|").filter(Boolean).map(role => roleLabels[role] ?? role).join(", ")}</td><td>{contact.attributes.ACTIVITEE_CLUBS}</td></tr>)}
          {!data.contacts.length && <tr><td colSpan={4}>Aucun contact sur cette page.</td></tr>}
        </tbody></table></div>
        <div className={styles.actions}><button disabled={page === 0 || loading || busy} onClick={() => setPage(p => p - 1)}>Précédent</button><span>Page {data.page + 1}</span><button disabled={(page + 1) * 50 >= data.stats.contacts || loading || busy} onClick={() => setPage(p => p + 1)}>Suivant</button></div>
      </section>
    </>}
  </div>;
}
