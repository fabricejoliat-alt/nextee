"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./LegalAdminWorkspace.module.css";

type Translation = { title?: string; body?: string; action_label?: string; status?: string; source_revision?: number };
type Doc = { id: string; document_key: string; kind: string; purpose_key: string; scope: string; club_id: string | null; audience_roles: string[]; action_kind: string; required: boolean; active: boolean; applicability: { status?: string; [key: string]: unknown }; required_locales: string[] };
type Draft = { document_id: string; source_revision: number; change_summary: string; allowed_variables: string[]; translations: Record<string, Translation> };
type Version = { id: string; document_id: string; version_number: number; published_at: string; snapshot: { translations?: Record<string, Translation>; change_summary?: string; [key: string]: unknown } };
const langs = ["fr", "en", "de", "it"];
const kindLabels: Record<string, string> = {
  terms: "Conditions d’utilisation", privacy: "Confidentialité", parent_authorization: "Autorisation parentale",
  specific_consent: "Consentement spécifique", junior_notice: "Notice junior",
};
const actionLabels: Record<string, string> = {
  accept: "Accepter", acknowledge: "Confirmer la lecture", authorize: "Autoriser", consent: "Consentir", read: "Lire",
};

export default function LegalAdminWorkspace() {
  const [docs, setDocs] = useState<Doc[]>([]); const [drafts, setDrafts] = useState<Draft[]>([]); const [versions, setVersions] = useState<Version[]>([]);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState(""); const [locale, setLocale] = useState("fr"); const [form, setForm] = useState<Translation>({});
  const [message, setMessage] = useState(""); const [summary, setSummary] = useState(""); const [busy, setBusy] = useState(false);
  const [variables, setVariables] = useState<string[]>([]);
  const [publicationConfirmed, setPublicationConfirmed] = useState(false);
  const [key, setKey] = useState(""); const [kind, setKind] = useState("terms"); const [action, setAction] = useState("accept");
  const [audience, setAudience] = useState("player,parent,coach,manager");
  const [purpose, setPurpose] = useState(""); const [scope, setScope] = useState("platform");
  const [clubId, setClubId] = useState(""); const [required, setRequired] = useState(false);
  const [documentSearch, setDocumentSearch] = useState("");
  const [ruleNote, setRuleNote] = useState("");
  const [ruleType, setRuleType] = useState("manual_review_required");
  const [requests, setRequests] = useState<Array<{ id: string; contact_email: string; request_kind: string; status: string; created_at: string; description: string }>>([]);
  const [requestNote, setRequestNote] = useState("");
  const [decisions, setDecisions] = useState<Array<{ id: string; actor_id: string; beneficiary_id: string; decision: string; rendered_snapshot: { title?: string; body?: string; locale?: string }; decided_at: string }>>([]);
  const [conflicts, setConflicts] = useState<Array<{ document_id: string; beneficiary_id: string; club_scope: string | null; decision: string; decided_at: string }>>([]);
  const [resolutionReason, setResolutionReason] = useState("");
  const [representativeClub, setRepresentativeClub] = useState("");
  const [representativeCandidates, setRepresentativeCandidates] = useState<Array<{ guardian_id: string; child_id: string; guardian_name: string; child_name: string }>>([]);
  const [representativeAssertions, setRepresentativeAssertions] = useState<Array<{ guardian_id: string; child_id: string; status: string }>>([]);
  const [representativePair, setRepresentativePair] = useState(""); const [representativeBasis, setRepresentativeBasis] = useState("");
  const load = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/admin/legal", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setDocs(data.documents); setDrafts(data.drafts); setVersions(data.versions); setClubs(data.clubs ?? []);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(String(e))); }, [load]);
  const document = docs.find((d) => d.id === selected);
  const filteredDocs = useMemo(() => docs.filter((doc) => {
    const query = documentSearch.trim().toLocaleLowerCase("fr");
    return !query || [doc.document_key, doc.purpose_key, kindLabels[doc.kind] ?? doc.kind,
      clubs.find((club) => club.id === doc.club_id)?.name ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(query));
  }), [clubs, docs, documentSearch]);
  const draft = drafts.find((d) => d.document_id === selected);
  const history = useMemo(() => versions.filter((v) => v.document_id === selected), [versions, selected]);
  const previous = history[0];
  const expectedPublication = document && draft ? {
    document: { document_key: document.document_key, kind: document.kind, purpose_key: document.purpose_key,
      scope: document.scope, club_id: document.club_id, audience_roles: document.audience_roles,
      action_kind: document.action_kind, required: document.required, active: document.active, applicability: document.applicability,
      required_locales: document.required_locales },
    draft: { source_revision: draft.source_revision, change_summary: draft.change_summary,
      allowed_variables: draft.allowed_variables, translations: draft.translations },
    latest_version_id: previous?.id ?? null,
  } : null;
  const unsavedTranslationChanges = Boolean(draft && (
    (form.title ?? "") !== (draft.translations?.[locale]?.title ?? "") ||
    (form.body ?? "") !== (draft.translations?.[locale]?.body ?? "") ||
    (form.action_label ?? "") !== (draft.translations?.[locale]?.action_label ?? "")));
  const unsavedPublicationChanges = Boolean(draft && (
    summary.trim() !== draft.change_summary ||
    JSON.stringify([...variables].sort()) !== JSON.stringify([...draft.allowed_variables].sort()) ||
    (form.title ?? "") !== (draft.translations?.[locale]?.title ?? "") ||
    (form.body ?? "") !== (draft.translations?.[locale]?.body ?? "") ||
    (form.action_label ?? "") !== (draft.translations?.[locale]?.action_label ?? "")));
  const languagesReady = Boolean(document && draft && document.required_locales.every((language) => {
    const translation = draft.translations?.[language];
    return translation?.status === "approved" && translation.source_revision === draft.source_revision;
  }));
  useEffect(() => { setPublicationConfirmed(false); }, [selected, document, draft, previous]);
  useEffect(() => { setForm(draft?.translations?.[locale] ?? {}); }, [draft, locale]);
  useEffect(() => { setSummary(draft?.change_summary ?? ""); setVariables(draft?.allowed_variables ?? []); }, [draft]);
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch("/api/admin/legal", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await load(); setMessage("Enregistré."); if (data.id) setSelected(data.id);
    } catch (error) {
      if (payload.operation === "publish") { setPublicationConfirmed(false); await load().catch(() => undefined); }
      setMessage(error instanceof Error ? error.message : "Erreur");
    } finally { setBusy(false); }
  }
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" /><span>Documents juridiques</span></nav>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>Gouvernance documentaire</span><h1>Documents juridiques</h1>
        <p>Préparer, relire et publier les textes destinés aux utilisateurs. L’activation reste soumise à une validation juridique distincte.</p></div>
      <span className={styles.heroBadge}><FileText size={16} aria-hidden="true" /> Registre inactif</span>
    </header>
    {message && <p role="status" className={styles.statusMessage}>{message}</p>}
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Créer un brouillon</h2><span>Nouveau document</span></div></div>
      <div className={styles.formGrid}>
        <label>Clé <input disabled={busy} value={key} onChange={(e) => setKey(e.target.value)} placeholder="conditions-utilisation" /></label>
        <label>Finalité <input disabled={busy} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="utilisation du service" /></label>
        <label>Type <select disabled={busy} value={kind} onChange={(e) => { const next = e.target.value; setKind(next);
          setAction(({ terms: "accept", privacy: "acknowledge", parent_authorization: "authorize", specific_consent: "consent", junior_notice: "read" } as Record<string,string>)[next]);
          if (next === "parent_authorization") setScope("club"); }}>{["terms","privacy","parent_authorization","specific_consent","junior_notice"].map((v) => <option key={v} value={v}>{kindLabels[v]}</option>)}</select></label>
        <label>Action <select disabled={busy} value={action} onChange={(e) => setAction(e.target.value)}>{["accept","acknowledge","authorize","consent","read"].map((v) => <option key={v} value={v}>{actionLabels[v]}</option>)}</select></label>
        <label>Audience <input disabled={busy} value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
        <label>Portée <select disabled={busy} value={scope} onChange={(e) => setScope(e.target.value)}><option value="platform">Plateforme</option><option value="club">Club</option></select></label>
        {scope === "club" && <label>Club <select disabled={busy} value={clubId} onChange={(e) => setClubId(e.target.value)}><option value="">Choisir un club</option>{clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className={styles.checkboxField}><input disabled={busy} type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Validation requise</label>
      </div><button className={styles.primaryButton} disabled={busy || !key || !purpose.trim() || (scope === "club" && !clubId)} onClick={() => mutate({ operation: "create", key, kind,
        purpose_key: purpose, action, audience: audience.split(",").map((x) => x.trim()), scope, club_id: scope === "club" ? clubId : null,
        required })}><Plus size={16} aria-hidden="true" /> Créer le brouillon</button>
    </section>
    <section className={styles.workspaceGrid}>
      <div className={styles.panel}><div className={styles.sectionHeader}><div><h2>Documents</h2><span>{docs.length} document{docs.length > 1 ? "s" : ""}</span></div></div>
        <label className={styles.searchField}><Search size={16} aria-hidden="true" /><input disabled={busy} value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Rechercher un document" aria-label="Rechercher un document" /></label>
        {filteredDocs.length ? <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Document</th><th>Portée</th><th>État</th></tr></thead><tbody>
          {filteredDocs.map((d) => <tr key={d.id} className={selected === d.id ? styles.selectedRow : ""}>
            <td data-label="Document"><button type="button" disabled={busy} className={styles.docSelect} aria-current={selected === d.id ? "true" : undefined} onClick={() => setSelected(d.id)}>{d.document_key}<span>{kindLabels[d.kind] ?? d.kind}</span></button></td>
            <td data-label="Portée">{d.scope === "club" ? clubs.find((club) => club.id === d.club_id)?.name ?? "Club" : "Plateforme"}</td>
            <td data-label="État"><span className={d.active ? styles.activeBadge : styles.inactiveBadge}>{d.active ? "Actif" : "Inactif"}</span></td>
          </tr>)}</tbody></table></div> : <p className={styles.emptyState}>{docs.length ? "Aucun document ne correspond à cette recherche." : "Aucun document pour le moment."}</p>}
      </div>
      <div className={`${styles.panel} ${styles.editorPanel}`}>
        {!document ? <p>Sélectionne un document.</p> : <>
          <h2>{document.document_key}</h2><p>{document.scope} · {document.audience_roles.join(", ")} · règle {document.applicability.status ?? "à valider"}</p>
          <fieldset className={styles.fieldset}><legend>Variables du modèle</legend>
            <p>Les valeurs viennent des profils et du club au moment de l’affichage. Modifier cette liste relance la revue des quatre langues.</p>
            {(["child_name", "club_name", "user_name"] as const).map((name) => <label key={name} style={{ marginRight: 16 }}>
              <input disabled={busy} type="checkbox" checked={variables.includes(name)} onChange={(event) => setVariables((current) => event.target.checked
                ? [...current, name] : current.filter((item) => item !== name))} /> {name}</label>)}
            <div className={styles.actionRow}><button disabled={busy || !draft || JSON.stringify([...variables].sort()) === JSON.stringify([...(draft?.allowed_variables ?? [])].sort())}
              onClick={() => mutate({ operation: "save_variables", document_id: selected, expected_revision: draft?.source_revision,
                variables })}>Enregistrer les variables</button></div>
          </fieldset>
          <div className={styles.languageTabs} role="tablist" aria-label="Langues">{langs.map((l) => <button disabled={busy} role="tab" aria-selected={l === locale} key={l} onClick={() => setLocale(l)}>{l.toUpperCase()} · {draft?.translations?.[l]?.status ?? "manquante"}</button>)}</div>
          <label style={{ display: "block", marginTop: 16 }}>Titre<input disabled={busy} style={{ display: "block", width: "100%" }} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label style={{ display: "block", marginTop: 12 }}>Texte<textarea disabled={busy} style={{ display: "block", width: "100%", minHeight: 240 }} value={form.body ?? ""} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <label style={{ display: "block", marginTop: 12 }}>Libellé de validation<input disabled={busy} style={{ display: "block", width: "100%" }} value={form.action_label ?? ""} onChange={(e) => setForm({ ...form, action_label: e.target.value })} /></label>
          <div className={styles.actionRow}><button className={styles.primaryButton} disabled={busy} onClick={() => mutate({ operation: "save_translation", document_id: selected, locale, ...form, expected_revision: draft?.source_revision })}>Enregistrer la langue</button>
          <button disabled={busy || unsavedTranslationChanges || !draft?.translations?.[locale]} onClick={() => mutate({ operation: "approve_translation", document_id: selected, locale, expected_revision: draft?.source_revision, expected_translation: draft?.translations?.[locale] })}>Approuver</button>
          {locale !== "fr" && <button disabled={busy || !draft?.translations?.fr?.body} onClick={async () => { setBusy(true); try { const token = (await supabase.auth.getSession()).data.session?.access_token; const response = await fetch("/api/admin/legal/translate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ document_id: selected, locale }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); setMessage("Proposition à relire."); } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } finally { setBusy(false); } }}>Proposer une traduction</button>}</div>
          <details><summary>Aperçu utilisateur</summary><h3>{form.title}</h3><p style={{ whiteSpace: "pre-wrap" }}>{form.body}</p><button disabled>{form.action_label}</button></details>
          <details><summary>Règle d’applicabilité (revue juridique)</summary>
            <p>Indiquer la juridiction, la base, l’âge/capacité, la qualité du représentant et la fonction concernée dans une configuration relue. Aucune règle universelle n’est préremplie.</p>
            <label>Règle <select disabled={busy} value={ruleType} onChange={(e) => setRuleType(e.target.value)}><option value="manual_review_required">À implémenter après revue</option><option value="all_members">Tous les membres actifs de l’audience</option></select></label>
            <textarea disabled={busy} aria-label="Justification de la revue juridique" placeholder="Référence et justification de la revue juridique" value={ruleNote} onChange={(e) => setRuleNote(e.target.value)} style={{ width: "100%" }} />
            <button disabled={busy || ruleNote.trim().length < 20} onClick={() => mutate({ operation: "review_rule", document_id: selected, note: ruleNote,
              configuration: { status: "approved", rule: ruleType, rationale: ruleNote } })}>Enregistrer la revue</button>
          </details>
          <h3>Publication</h3><label>Résumé des changements<textarea disabled={busy} style={{ display: "block", width: "100%" }} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <button disabled={busy} onClick={() => mutate({ operation: "summary", document_id: selected, summary })}>Enregistrer le résumé</button>
          <details><summary>Comparer et publier</summary>
            <p>Version à créer : {previous ? previous.version_number + 1 : 1}. Statut : {document.active ? "actif" : "inactif"}. La publication ne change pas ce statut.</p>
            <p>Type : {document.kind} · Finalité : {document.purpose_key} · Portée : {document.scope}{document.club_id ? ` (${clubs.find((club) => club.id === document.club_id)?.name ?? document.club_id})` : ""} · Action : {document.action_kind} · Validation requise : {document.required ? "oui" : "non"}.</p>
            <p>Audience : {document.audience_roles.join(", ")}. Langues requises : {document.required_locales.join(", ")}. Variables : {draft?.allowed_variables.join(", ") || "aucune"}.</p>
            <details><summary>Comparer la configuration et la règle</summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 16 }}>
                <div><strong>Version publiée {previous?.version_number ?? "—"}</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{previous ? JSON.stringify({
                  purpose_key: previous.snapshot.purpose_key, scope: previous.snapshot.scope, club_id: previous.snapshot.club_id,
                  audience_roles: previous.snapshot.audience_roles, action_kind: previous.snapshot.action_kind,
                  required: previous.snapshot.required, applicability: previous.snapshot.applicability,
                  required_locales: previous.snapshot.required_locales, allowed_variables: previous.snapshot.allowed_variables,
                }, null, 2) : "Aucune version"}</pre></div>
                <div><strong>Brouillon à publier</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({
                  purpose_key: document.purpose_key, scope: document.scope, club_id: document.club_id,
                  audience_roles: document.audience_roles, action_kind: document.action_kind,
                  required: document.required, applicability: document.applicability,
                  required_locales: document.required_locales, allowed_variables: draft?.allowed_variables,
                }, null, 2)}</pre></div>
              </div>
            </details>
            <p>Résumé précédent : {previous?.snapshot.change_summary ?? "aucun"}. Nouveau résumé : {draft?.change_summary || "à enregistrer"}.</p>
            {document.required_locales.map((language) => {
              const oldText = previous?.snapshot.translations?.[language];
              const newText = draft?.translations?.[language];
              return <details key={language}><summary>{language.toUpperCase()} · {newText?.status ?? "manquante"} · révision {newText?.source_revision ?? "—"}</summary>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 16 }}>
                  <div><strong>Version publiée {previous?.version_number ?? "—"}</strong><p>{oldText?.title ?? "Aucune version"}</p><p style={{ whiteSpace: "pre-wrap" }}>{oldText?.body}</p><p>{oldText?.action_label}</p></div>
                  <div><strong>Brouillon à publier</strong><p>{newText?.title ?? "Titre manquant"}</p><p style={{ whiteSpace: "pre-wrap" }}>{newText?.body}</p><p>{newText?.action_label}</p></div>
                </div>
              </details>;
            })}
            {unsavedPublicationChanges && <p role="status">Enregistre les modifications affichées avant de publier.</p>}
            {!languagesReady && <p role="status">Toutes les langues requises doivent être approuvées pour la révision actuelle.</p>}
            <label style={{ display: "block", margin: "16px 0" }}><input disabled={busy} type="checkbox" checked={publicationConfirmed}
              onChange={(event) => setPublicationConfirmed(event.target.checked)} /> J’ai relu la portée, la règle, le résumé et les textes de toutes les langues de ce brouillon.</label>
            <button className={styles.primaryButton} disabled={busy || !publicationConfirmed || !expectedPublication || unsavedPublicationChanges || !languagesReady || !draft?.change_summary.trim() || document.applicability.status !== "approved"}
              onClick={() => mutate({ operation: "publish", document_id: selected, expected: expectedPublication })}>Publier cette version</button>
          </details><h3>Historique</h3>{history.map((v) => <details key={v.id}><summary>Version {v.version_number} · {new Date(v.published_at).toLocaleString()}</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(v.snapshot, null, 2)}</pre></details>)}
        </>}
      </div>
    </section>
    <section className={styles.panel}>
      <h2>Décisions enregistrées</h2><p>Accès réservé aux administrateurs de la plateforme. Les résultats sont limités à 100 événements.</p>
      <button onClick={async () => { try { const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await fetch(`/api/admin/legal/decisions${selected ? `?document_id=${selected}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error); setDecisions(data.decisions); } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } }}>Charger les décisions{selected ? " du document sélectionné" : ""}</button>
      {decisions.map((row) => <details key={row.id}><summary>{row.rendered_snapshot.title ?? "Document"} · {row.decision} · {new Date(row.decided_at).toLocaleString()}</summary>
        <p>Acteur : {row.actor_id} · Bénéficiaire : {row.beneficiary_id} · langue : {row.rendered_snapshot.locale}</p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{row.rendered_snapshot.body}</pre></details>)}
    </section>
    <section className={styles.panel}>
      <h2>Demandes relatives aux données</h2><button onClick={async () => { try { const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await fetch("/api/admin/legal/requests", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error); setRequests(data.requests); } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } }}>Charger les demandes</button>
      <label>Note de suivi<input disabled={busy} value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="Contrôles effectués et décision" style={{ display: "block", width: "100%" }} /></label>
      {requests.map((row) => <details key={row.id}><summary>{row.request_kind} · {row.status} · {new Date(row.created_at).toLocaleString()}</summary>
        <p>{row.contact_email} · {row.description}</p>
        <button disabled={requestNote.trim().length < 10} onClick={async () => { try { const token = (await supabase.auth.getSession()).data.session?.access_token;
          const response = await fetch("/api/admin/legal/requests", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id: row.id, status: "identity_check", note: requestNote }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage("Suivi enregistré.");
          setRequests((current) => current.map((item) => item.id === row.id ? { ...item, status: "identity_check" } : item)); }
          catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } }}>Marquer pour vérification d’identité</button></details>)}
    </section>
    <section className={styles.panel}>
      <h2>Retraits à résoudre</h2>
      <p>Une nouvelle autorisation reste bloquée jusqu’à une résolution motivée. Le retrait demeure dans l’historique.</p>
      <button onClick={async () => { try { const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await fetch("/api/admin/legal/conflicts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error); setConflicts(data.conflicts); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } }}>Charger les retraits</button>
      <label>Motif de résolution<textarea disabled={busy} value={resolutionReason} onChange={(e) => setResolutionReason(e.target.value)}
        placeholder="Contrôles réalisés et justification de la réautorisation" style={{ display: "block", width: "100%" }} /></label>
      {conflicts.map((row) => <details key={`${row.document_id}-${row.beneficiary_id}-${row.club_scope}`}>
        <summary>{row.decision} · {new Date(row.decided_at).toLocaleString()} · {row.beneficiary_id.slice(0, 8)}</summary>
        <p>Document : {row.document_id} · Club : {row.club_scope ?? "plateforme"} · Bénéficiaire : {row.beneficiary_id}</p>
        <button disabled={resolutionReason.trim().length < 20 || busy} onClick={async () => { setBusy(true); try {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const response = await fetch("/api/admin/legal/conflicts", { method: "POST", headers: {
            Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({
              document_id: row.document_id, beneficiary_id: row.beneficiary_id, club_scope: row.club_scope, reason: resolutionReason }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setConflicts((current) => current.filter((item) => item !== row)); setResolutionReason(""); setMessage("Résolution enregistrée.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } finally { setBusy(false); } }}>Enregistrer la résolution</button>
      </details>)}
    </section>
    <section className={styles.panel}>
      <h2>Qualité de représentant</h2>
      <p>Le lien familial et l’accès au club sont contrôlés par le serveur. La qualité permettant une décision parentale nécessite une revue distincte et motivée.</p>
      <p>La liste est limitée à 500 adhésions actives ; la recherche ciblée reste à ajouter pour les clubs plus grands.</p>
      <label>Club <select disabled={busy} value={representativeClub} onChange={(e) => { setRepresentativeClub(e.target.value); setRepresentativeCandidates([]); setRepresentativePair(""); }}>
        <option value="">Choisir un club</option>{clubs.map((club) => <option value={club.id} key={club.id}>{club.name}</option>)}</select></label>
      <button disabled={!representativeClub || busy} onClick={async () => { try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await fetch(`/api/admin/legal/representatives?club_id=${encodeURIComponent(representativeClub)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setRepresentativeCandidates(data.candidates); setRepresentativeAssertions(data.assertions);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } }}>Charger les liens du club</button>
      <label>Parent et enfant <select disabled={busy} value={representativePair} onChange={(e) => setRepresentativePair(e.target.value)}>
        <option value="">Choisir un lien</option>{representativeCandidates.map((pair) => <option
          key={`${pair.guardian_id}:${pair.child_id}`} value={`${pair.guardian_id}:${pair.child_id}`}>
          {pair.guardian_name} → {pair.child_name} · {representativeAssertions.find((row) => row.guardian_id === pair.guardian_id && row.child_id === pair.child_id)?.status ?? "non vérifié"}
        </option>)}</select></label>
      <label>Origine et motif de la revue<textarea disabled={busy} value={representativeBasis} onChange={(e) => setRepresentativeBasis(e.target.value)}
        placeholder="Décrire la vérification réalisée, sans joindre systématiquement une pièce d’identité" style={{ display: "block", width: "100%" }} /></label>
      <button disabled={!representativePair || representativeBasis.trim().length < 20 || busy} onClick={async () => {
        const [guardian_id, child_id] = representativePair.split(":"); setBusy(true); try {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const response = await fetch("/api/admin/legal/representatives", { method: "POST", headers: {
            Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({
              guardian_id, child_id, club_id: representativeClub, status: "verified", basis: representativeBasis }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setRepresentativeAssertions((current) => [...current.filter((row) => row.guardian_id !== guardian_id || row.child_id !== child_id),
            { guardian_id, child_id, status: "verified" }]); setRepresentativeBasis(""); setMessage("Qualité vérifiée et tracée.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } finally { setBusy(false); }
      }}>Enregistrer la vérification</button>
      <button disabled={!representativePair || representativeBasis.trim().length < 20 || busy} onClick={async () => {
        const [guardian_id, child_id] = representativePair.split(":"); setBusy(true); try {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const response = await fetch("/api/admin/legal/representatives", { method: "POST", headers: {
            Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({
              guardian_id, child_id, club_id: representativeClub, status: "revoked", basis: representativeBasis }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          setRepresentativeAssertions((current) => [...current.filter((row) => row.guardian_id !== guardian_id || row.child_id !== child_id),
            { guardian_id, child_id, status: "revoked" }]); setRepresentativeBasis(""); setMessage("Qualité révoquée et tracée.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } finally { setBusy(false); }
      }}>Révoquer la qualité</button>
    </section>
  </div>;
}
