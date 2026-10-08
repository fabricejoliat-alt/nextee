"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { legalAdminGroups } from "@/lib/legalAdminGroups";
import styles from "./LegalAdminWorkspace.module.css";

type Translation = { title?: string; body?: string; action_label?: string; status?: string; source_revision?: number };
type Doc = { id: string; document_key: string; kind: string; purpose_key: string; scope: string; club_id: string | null; audience_roles: string[]; action_kind: string; required: boolean; active: boolean; applicability: { status?: string; rule?: string; [key: string]: unknown }; required_locales: string[] };
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
const translationStatusLabels: Record<string, string> = {
  needs_review: "à relire", approved: "approuvée", proposed: "proposée",
};
const translationStatusLabel = (status?: string) => status ? translationStatusLabels[status] ?? status : "manquante";

export default function LegalAdminWorkspace() {
  const { t } = useI18n();
  const [docs, setDocs] = useState<Doc[]>([]); const [drafts, setDrafts] = useState<Draft[]>([]); const [versions, setVersions] = useState<Version[]>([]);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [clubTemplatePurposes, setClubTemplatePurposes] = useState<string[]>([]);
  const [templateClubId, setTemplateClubId] = useState("");
  const [selected, setSelected] = useState(""); const [locale, setLocale] = useState("fr"); const [form, setForm] = useState<Translation>({});
  const [message, setMessage] = useState(""); const [summary, setSummary] = useState(""); const [busy, setBusy] = useState(false);
  const [variables, setVariables] = useState<string[]>([]);
  const [publicationConfirmed, setPublicationConfirmed] = useState(false);
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [enforcementEnabled, setEnforcementEnabled] = useState<boolean | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [key, setKey] = useState(""); const [kind, setKind] = useState("terms"); const [action, setAction] = useState("accept");
  const [audience, setAudience] = useState("player,parent,coach,manager");
  const [purpose, setPurpose] = useState(""); const [scope, setScope] = useState("platform");
  const [clubId, setClubId] = useState(""); const [required, setRequired] = useState(false);
  const [documentSearch, setDocumentSearch] = useState("");
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
    setClubTemplatePurposes(data.club_template_purposes ?? []);
    setEnforcementEnabled(data.enforcement_enabled); setActivationConfirmed(false);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(String(e))); }, [load]);
  const document = docs.find((d) => d.id === selected);
  const selectedClubTemplateDocuments = docs.filter((d) => d.scope !== "platform" && d.club_id === templateClubId
    && clubTemplatePurposes.includes(d.purpose_key));
  const audienceConfigured = document?.applicability.status === "approved" && document.applicability.rule === "all_members";
  const { groups, fixtures } = useMemo(() => legalAdminGroups(docs), [docs]);
  const filteredGroups = useMemo(() => groups.filter((group) => {
    const query = documentSearch.trim().toLocaleLowerCase("fr");
    return !query || [group.label, group.key, ...group.documents.flatMap((doc) => [doc.document_key, doc.purpose_key,
      kindLabels[doc.kind] ?? doc.kind, clubs.find((club) => club.id === doc.club_id)?.name ?? ""])].some((value) => value.toLocaleLowerCase("fr").includes(query));
  }), [clubs, groups, documentSearch]);
  const selectedGroup = groups.find((group) => group.documents.some((doc) => doc.id === selected));
  const draft = drafts.find((d) => d.document_id === selected);
  const sharedDrafts = selectedGroup?.shared ? selectedGroup.documents.map((doc) => drafts.find((item) => item.document_id === doc.id)) : [];
  const sharedTextAligned = Boolean(selectedGroup?.shared && draft && sharedDrafts.every((item) => item
    && item.source_revision === draft.source_revision
    && JSON.stringify([...item.allowed_variables].sort()) === JSON.stringify([...draft.allowed_variables].sort())
    && ["title", "body", "action_label"].every((field) => (item.translations?.[locale]?.[field as keyof Translation] ?? "")
      === (draft.translations?.[locale]?.[field as keyof Translation] ?? ""))));
  const sharedExpectedDrafts = selectedGroup?.shared ? Object.fromEntries(selectedGroup.documents.map((doc) => {
    const item = drafts.find((candidate) => candidate.document_id === doc.id);
    return [doc.id, item ? { source_revision: item.source_revision, translations: item.translations } : null];
  })) : null;
  const history = useMemo(() => versions.filter((v) => v.document_id === selected), [versions, selected]);
  const previous = history[0];
  const requiredDocuments = docs.filter((item) => item.document_key.startsWith("activitee_") && item.required);
  const missingRequiredDocuments = requiredDocuments.filter((item) => !item.active);
  const requiredDocumentsReady = requiredDocuments.length > 0
    && requiredDocuments.every((item) => item.active)
    && ["terms", "privacy"].every((kind) => requiredDocuments.some((item) =>
      item.scope === "platform" && item.kind === kind && item.active));
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
    summary.trim() !== draft.change_summary.trim() ||
    JSON.stringify([...variables].sort()) !== JSON.stringify([...draft.allowed_variables].sort()) ||
    (form.title ?? "") !== (draft.translations?.[locale]?.title ?? "") ||
    (form.body ?? "") !== (draft.translations?.[locale]?.body ?? "") ||
    (form.action_label ?? "") !== (draft.translations?.[locale]?.action_label ?? "")));
  const languagesReady = Boolean(document && draft && document.required_locales.every((language) => {
    const translation = draft.translations?.[language];
    return translation?.status === "approved" && translation.source_revision === draft.source_revision;
  }));
  useEffect(() => { setPublicationConfirmed(false); }, [selected, document, draft, previous]);
  useEffect(() => { setEditorDirty(false); }, [selected, draft]);
  useEffect(() => { setForm(draft?.translations?.[locale] ?? {}); }, [draft, locale]);
  useEffect(() => { setSummary(draft?.change_summary ?? ""); setVariables(draft?.allowed_variables ?? []); }, [draft]);
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch("/api/admin/legal", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await load(); setMessage(payload.operation === "create_club_templates" ? t("organization.draftCreated") : "Enregistré.");
      if (data.id) setSelected(data.id);
    } catch (error) {
      if (["publish", "set_enforcement", "set_document_active"].includes(String(payload.operation))) {
        setPublicationConfirmed(false); setActivationConfirmed(false); await load().catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "Erreur");
    } finally { setBusy(false); }
  }
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" /><span>Documents juridiques</span></nav>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>Gouvernance documentaire</span><h1>Documents juridiques</h1>
        <p>Préparer, publier et activer les textes destinés aux utilisateurs.</p></div>
      <span className={styles.heroBadge}><FileText size={16} aria-hidden="true" /> {enforcementEnabled === null ? "État en cours" : enforcementEnabled ? "Contrôle actif" : "Contrôle inactif"}</span>
    </header>
    {message && <p role="status" className={styles.statusMessage}>{message}</p>}
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Activation du module</h2><span>{enforcementEnabled ? "Contrôle des CGU et notices actif" : "Les accès ne sont pas encore conditionnés aux documents"}</span></div></div>
      <p>Active d’abord chaque document requis publié. Les CGU et la notice de confidentialité de la plateforme doivent être actives avant le contrôle global.</p>
      <p>Les autorisations parentales et les consentements facultatifs sont présentés et décidés séparément.</p>
      <p>Ce contrôle ne révoque pas les liens de fichiers déjà publics ni les traitements lancés hors des parcours utilisateur.</p>
      {enforcementEnabled && <p>Désactiver le contrôle rend les parcours accessibles sans effacer les documents publiés ni l’historique des décisions.</p>}
      {!enforcementEnabled && !requiredDocumentsReady && <p role="status">Documents requis actifs : {requiredDocuments.filter((item) => item.active).length}/{requiredDocuments.length}. Termine leur publication et leur activation pour débloquer ce contrôle.</p>}
      {!enforcementEnabled && missingRequiredDocuments.length > 0 && <ul className={styles.missingDocuments}>
        {missingRequiredDocuments.map((item) => {
          const itemDraft = drafts.find((entry) => entry.document_id === item.id);
          const languagesPending = item.required_locales.filter((language) => {
            const translation = itemDraft?.translations?.[language];
            return translation?.status !== "approved" || translation.source_revision !== itemDraft?.source_revision;
          });
          const steps = [
            languagesPending.length ? `${languagesPending.length} langue${languagesPending.length > 1 ? "s" : ""} à approuver` : null,
            item.applicability.status !== "approved" || item.applicability.rule !== "all_members" ? "public à configurer" : null,
            !versions.some((version) => version.document_id === item.id) ? "version à publier" : null,
            "document à activer",
          ].filter(Boolean).join(" · ");
          const clubName = item.club_id ? clubs.find((club) => club.id === item.club_id)?.name ?? item.club_id : "plateforme";
          return <li key={item.id}><strong>{kindLabels[item.kind] ?? item.kind} — {clubName}</strong><span>{steps}</span></li>;
        })}
      </ul>}
      {!enforcementEnabled && <label className={styles.activationConfirmation}><input type="checkbox" disabled={busy || !requiredDocumentsReady}
        checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} />
        Je confirme la mise en service du contrôle pour les comptes concernés.</label>}
      <button className={enforcementEnabled ? undefined : styles.primaryButton}
        disabled={busy || enforcementEnabled === null || (!enforcementEnabled && (!requiredDocumentsReady || !activationConfirmed))}
        onClick={() => mutate({ operation: "set_enforcement", enabled: !enforcementEnabled, expected_enabled: enforcementEnabled })}>
        {enforcementEnabled ? "Désactiver le contrôle" : "Activer le contrôle"}</button>
    </section>
    {clubTemplatePurposes.length === 3 && <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>{t("organization.templatesTitle")}</h2><span>3 modèles disponibles</span></div></div>
      <p>{t("organization.templatesLead")}</p>
      <label>Club <select disabled={busy} value={templateClubId} onChange={(event) => setTemplateClubId(event.target.value)}>
        <option value="">{t("organization.choose")}</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
      </select></label>
      {templateClubId && selectedClubTemplateDocuments.length > 0 && <p role="status">{selectedClubTemplateDocuments.length} document{selectedClubTemplateDocuments.length > 1 ? "s" : ""} déjà créé{selectedClubTemplateDocuments.length > 1 ? "s" : ""} pour ce club.</p>}
      <div className={styles.actionRow}><button className={styles.primaryButton}
        disabled={busy || !templateClubId || selectedClubTemplateDocuments.length > 0}
        onClick={() => mutate({ operation: "create_club_templates", club_id: templateClubId })}>
        <Plus size={16} aria-hidden="true" /> {t("organization.createDrafts")}
      </button></div>
    </section>}
    <section className={styles.panel}>
      <div className={styles.sectionHeader}><div><h2>Créer un brouillon</h2><span>Nouveau document</span></div></div>
      <div className={styles.formGrid}>
        <label>Clé <input disabled={busy} value={key} onChange={(e) => setKey(e.target.value)} placeholder="conditions-utilisation" /></label>
        <label>Finalité <input disabled={busy} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="utilisation du service" /></label>
        <label>Type <select disabled={busy} value={kind} onChange={(e) => { const next = e.target.value; setKind(next);
          setAction(({ terms: "accept", privacy: "acknowledge", parent_authorization: "authorize", specific_consent: "consent", junior_notice: "read" } as Record<string,string>)[next]);
          if (next === "parent_authorization") setScope("organization"); }}>{["terms","privacy","parent_authorization","specific_consent","junior_notice"].map((v) => <option key={v} value={v}>{kindLabels[v]}</option>)}</select></label>
        <label>Action <select disabled={busy} value={action} onChange={(e) => setAction(e.target.value)}>{["accept","acknowledge","authorize","consent","read"].map((v) => <option key={v} value={v}>{actionLabels[v]}</option>)}</select></label>
        <label>Audience <input disabled={busy} value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
        <label>Portée <select disabled={busy} value={scope} onChange={(e) => setScope(e.target.value)}><option value="platform">Plateforme</option><option value="organization">{t("organization.context")}</option></select></label>
        {scope !== "platform" && <label>{t("organization.context")} <select disabled={busy} value={clubId} onChange={(e) => setClubId(e.target.value)}><option value="">{t("organization.choose")}</option>{clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className={styles.checkboxField}><input disabled={busy} type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Validation requise</label>
      </div><button className={styles.primaryButton} disabled={busy || !key || !purpose.trim() || (scope !== "platform" && !clubId)} onClick={() => mutate({ operation: "create", key, kind,
        purpose_key: purpose, action, audience: audience.split(",").map((x) => x.trim()), scope, club_id: scope !== "platform" ? clubId : null,
        required })}><Plus size={16} aria-hidden="true" /> Créer le brouillon</button>
    </section>
    <section className={styles.workspaceGrid}>
      <div className={styles.panel}><div className={styles.sectionHeader}><div><h2>Modèles ActiviTee</h2><span>{groups.length} modèle{groups.length > 1 ? "s" : ""}</span></div></div>
        <label className={styles.searchField}><Search size={16} aria-hidden="true" /><input disabled={busy} value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Rechercher un modèle ou un club" aria-label="Rechercher un modèle ou un club" /></label>
        {filteredGroups.length ? <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Modèle</th><th>Portée</th><th>État</th></tr></thead><tbody>
          {filteredGroups.map((group) => <tr key={group.key} className={selectedGroup?.key === group.key ? styles.selectedRow : ""}>
            <td data-label="Modèle"><button type="button" disabled={busy} className={styles.docSelect} aria-current={selectedGroup?.key === group.key ? "true" : undefined} onClick={() => setSelected(group.documents[0].id)}>{group.label}<span>{group.shared ? `${group.documents.length} clubs · ${kindLabels[group.documents[0].kind] ?? group.documents[0].kind}` : group.documents[0].document_key}</span></button></td>
            <td data-label="Portée">{group.shared ? `${group.documents.length} ${t("organization.context")}` : group.documents[0].scope !== "platform" ? clubs.find((club) => club.id === group.documents[0].club_id)?.name ?? t("organization.context") : t("organization.platform")}</td>
            <td data-label="État"><span className={group.documents.every((doc) => doc.active) ? styles.activeBadge : styles.inactiveBadge}>{group.documents.every((doc) => doc.active) ? "Actif" : group.documents.some((doc) => doc.active) ? "Mixte" : "Inactif"}</span></td>
          </tr>)}</tbody></table></div> : <p className={styles.emptyState}>{groups.length ? "Aucun modèle ne correspond à cette recherche." : "Aucun modèle pour le moment."}</p>}
        {fixtures.length > 0 && <details><summary>{fixtures.length} documents de test masqués</summary>
          <div className={styles.fixtureList}>{fixtures.map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => setSelected(item.id)}>{item.document_key}</button>)}</div>
        </details>}
      </div>
      <div className={`${styles.panel} ${styles.editorPanel}`}>
        {!document ? <p>Sélectionne un document.</p> : <>
          <h2>{selectedGroup?.label ?? document.document_key}</h2><p>{document.scope !== "platform" ? t("organization.context") : t("organization.platform")} · {document.audience_roles.join(", ")} · public {audienceConfigured ? "configuré" : "à configurer"}</p>
          {selectedGroup?.shared && <div className={styles.clubSwitcher}><label>Club concerné <select disabled={busy || editorDirty} value={selected} onChange={(event) => setSelected(event.target.value)}>{selectedGroup.documents.map((item) => <option key={item.id} value={item.id}>{clubs.find((club) => club.id === item.club_id)?.name ?? item.document_key}</option>)}</select></label>
            <p>Le texte peut être enregistré pour tous les clubs. Le public, l’approbation et la publication se contrôlent ensuite pour chaque club.</p>
            {editorDirty && <><p role="status">Enregistre ou annule tes modifications avant de changer de club.</p><button type="button" disabled={busy} onClick={() => {
              setForm(draft?.translations?.[locale] ?? {}); setSummary(draft?.change_summary ?? "");
              setVariables(draft?.allowed_variables ?? []); setEditorDirty(false);
            }}>Annuler les modifications</button></>}
            {!sharedTextAligned && <p role="status">Les brouillons de ce modèle diffèrent entre clubs. Vérifie-les avant une sauvegarde commune.</p>}
          </div>}
          <fieldset className={styles.fieldset}><legend>Variables du modèle</legend>
            <p>Les valeurs viennent des profils et du club au moment de l’affichage. Modifier cette liste relance la revue des quatre langues.</p>
            {(["child_name", "club_name", "organization_name", "user_name"] as const).map((name) => <label key={name} style={{ marginRight: 16 }}>
              <input disabled={busy} type="checkbox" checked={variables.includes(name)} onChange={(event) => { setEditorDirty(true); setVariables((current) => event.target.checked
                ? [...current, name] : current.filter((item) => item !== name)); }} /> {name}</label>)}
            <div className={styles.actionRow}><button disabled={busy || !draft || JSON.stringify([...variables].sort()) === JSON.stringify([...(draft?.allowed_variables ?? [])].sort())}
              onClick={() => mutate({ operation: "save_variables", document_id: selected, expected_revision: draft?.source_revision,
                variables })}>Enregistrer les variables</button></div>
          </fieldset>
          <div className={styles.languageTabs} role="tablist" aria-label="Langues">{langs.map((l) => <button disabled={busy} role="tab" aria-selected={l === locale} key={l} onClick={() => setLocale(l)}>{l.toUpperCase()} · {translationStatusLabel(draft?.translations?.[l]?.status)}</button>)}</div>
          <label style={{ display: "block", marginTop: 16 }}>Titre<input disabled={busy} style={{ display: "block", width: "100%" }} value={form.title ?? ""} onChange={(e) => { setEditorDirty(true); setForm({ ...form, title: e.target.value }); }} /></label>
          <label style={{ display: "block", marginTop: 12 }}>Texte<textarea disabled={busy} style={{ display: "block", width: "100%", minHeight: 240 }} value={form.body ?? ""} onChange={(e) => { setEditorDirty(true); setForm({ ...form, body: e.target.value }); }} /></label>
          <label style={{ display: "block", marginTop: 12 }}>Libellé de validation<input disabled={busy} style={{ display: "block", width: "100%" }} value={form.action_label ?? ""} onChange={(e) => { setEditorDirty(true); setForm({ ...form, action_label: e.target.value }); }} /></label>
          <div className={styles.actionRow}><button className={styles.primaryButton} disabled={busy || Boolean(selectedGroup?.shared && !sharedTextAligned)} onClick={() => mutate({ operation: "save_translation", document_id: selected, locale, ...form, expected_revision: draft?.source_revision,
            ...(selectedGroup?.shared ? { group_purpose: selectedGroup.key, expected_drafts: sharedExpectedDrafts } : {}) })}>{selectedGroup?.shared ? `Enregistrer dans ${selectedGroup.documents.length} clubs` : "Enregistrer la langue"}</button>
          <button disabled={busy || unsavedTranslationChanges || !draft?.translations?.[locale]} onClick={() => mutate({ operation: "approve_translation", document_id: selected, locale, expected_revision: draft?.source_revision, expected_translation: draft?.translations?.[locale] })}>Approuver</button>
          {locale !== "fr" && <button disabled={busy || !draft?.translations?.fr?.body} onClick={async () => { setBusy(true); try { const token = (await supabase.auth.getSession()).data.session?.access_token; const response = await fetch("/api/admin/legal/translate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ document_id: selected, locale }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); setMessage("Proposition à relire."); } catch (error) { setMessage(error instanceof Error ? error.message : "Erreur"); } finally { setBusy(false); } }}>Proposer une traduction</button>}</div>
          <details><summary>Aperçu utilisateur</summary><h3>{form.title}</h3><p style={{ whiteSpace: "pre-wrap" }}>{form.body}</p><button disabled>{form.action_label}</button></details>
          <details><summary>Public concerné</summary>
            <p>Ce document s’adresse aux membres actifs des rôles indiqués ci-dessus{document.scope !== "platform" ? " dans le club sélectionné" : " sur la plateforme"}. Les liens parent–enfant sont vérifiés lors de la décision.</p>
            <button disabled={busy || document.active || audienceConfigured}
              onClick={() => mutate({ operation: "configure_audience", document_id: selected, expected: document.applicability })}>
              Configurer ce public</button>
          </details>
          <h3>Publication</h3><label>Résumé des changements<textarea disabled={busy} style={{ display: "block", width: "100%" }} value={summary} onChange={(e) => { setEditorDirty(true); setSummary(e.target.value); }} /></label>
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
              return <details key={language}><summary>{language.toUpperCase()} · {translationStatusLabel(newText?.status)} · révision {newText?.source_revision ?? "—"}</summary>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 16 }}>
                  <div><strong>Version publiée {previous?.version_number ?? "—"}</strong><p>{oldText?.title ?? "Aucune version"}</p><p style={{ whiteSpace: "pre-wrap" }}>{oldText?.body}</p><p>{oldText?.action_label}</p></div>
                  <div><strong>Brouillon à publier</strong><p>{newText?.title ?? "Titre manquant"}</p><p style={{ whiteSpace: "pre-wrap" }}>{newText?.body}</p><p>{newText?.action_label}</p></div>
                </div>
              </details>;
            })}
            {unsavedPublicationChanges && <p role="status">Enregistre les modifications affichées avant de publier.</p>}
            {!languagesReady && <p role="status">Toutes les langues requises doivent être approuvées pour la révision actuelle.</p>}
            <label style={{ display: "block", margin: "16px 0" }}><input disabled={busy} type="checkbox" checked={publicationConfirmed}
              onChange={(event) => setPublicationConfirmed(event.target.checked)} /> J’ai vérifié le public, le résumé et les textes de toutes les langues de ce brouillon.</label>
            <button className={styles.primaryButton} disabled={busy || !publicationConfirmed || !expectedPublication || unsavedPublicationChanges || !languagesReady || !draft?.change_summary.trim() || !audienceConfigured}
              onClick={() => mutate({ operation: "publish", document_id: selected, expected: expectedPublication })}>Publier cette version</button>
          </details>
          <h3>Activation du document</h3>
          <p>Version publiée : {previous ? `v${previous.version_number}` : "aucune"}. État : {document.active ? "actif" : "inactif"}.</p>
          {document.active && enforcementEnabled && document.required && document.document_key.startsWith("activitee_")
            && <p>Désactive d’abord le contrôle global pour retirer un document requis.</p>}
          <button className={document.active ? undefined : styles.primaryButton}
            disabled={busy || (!document.active && (!previous || !audienceConfigured))
              || (document.active && Boolean(enforcementEnabled) && document.required && document.document_key.startsWith("activitee_"))}
            onClick={() => mutate({ operation: "set_document_active", document_id: selected,
              enabled: !document.active, expected_enabled: document.active, expected_version: previous?.id ?? null })}>
            {document.active ? "Désactiver ce document" : "Activer ce document"}</button>
          <h3>Historique</h3>{history.map((v) => <details key={v.id}><summary>Version {v.version_number} · {new Date(v.published_at).toLocaleString()}</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(v.snapshot, null, 2)}</pre></details>)}
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
        <option value="">{t("organization.choose")}</option>{clubs.map((club) => <option value={club.id} key={club.id}>{club.name}</option>)}</select></label>
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
