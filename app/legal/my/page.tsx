"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Download, FileText, Globe2, LockKeyhole, LogOut, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import type { OrganizationAccessSummary } from "@/lib/organizationPolicy";
import { supabase } from "@/lib/supabaseClient";
import styles from "./MyLegalPage.module.css";
import { parentAuthorizationItems, type LegalChild } from "@/lib/parentAuthorization";

type Doc = { id: string; document_key: string; kind: string; purpose_key: string; scope: string; club_id: string | null; club_name: string | null; org_type?: string | null; audience_roles: string[]; eligible_role: string | null; action_kind: string; required: boolean;
  version: { id: string; version_number: number; published_at: string; snapshot: { translations?: Record<string, { title: string }> } } | null;
  own_choice: { version_id: string; decision: string } | null;
  state: { version_id: string; decision: string; conflict: boolean } | null };
type Presentation = { id: string; rendered_snapshot: { title: string; body: string; action_label: string; version_number: number; locale: string }; expires_at: string };
type Decision = { id: string; actor_id: string; beneficiary_id: string; decision: string; rendered_snapshot: { title: string; body: string; locale: string }; decided_at: string };
type Child = LegalChild;
type MissingAction = { document_id: string; document_key: string; kind: string; club_id: string | null; role: string; version_id: string | null };
type AccessState = { state: "loading" | "error" } | { state: "ready"; enforcementEnabled: boolean; missing: MissingAction[]; destination: string; consentRequired: boolean; parentConsentRequired: boolean; pendingClubNames: string[] };
const homeDestinations = new Set(["/admin", "/manager", "/coach", "/player"]);
const languages = [{ code: "fr", label: "Français" }, { code: "en", label: "English" }, { code: "de", label: "Deutsch" }, { code: "it", label: "Italiano" }];
const decisionLabels: Record<string, string> = { accepted: "Accepté", acknowledged: "Lu et confirmé", authorized: "Autorisé", consented: "Consentement donné", refused: "Refusé", withdrawn: "Retiré" };
const requiredActionLabels: Record<string, string> = { accept: "À accepter", acknowledge: "À lire et confirmer", read: "À lire et confirmer" };
function displayTitle(value: string, doc?: Doc) { return value.replace(/\{\{\s*(?:club_name|organization_name)\s*\}\}/gi, doc?.club_name ?? "votre organisation").replace(/\{\{\s*child_name\s*\}\}/gi, "votre enfant"); }
function DecisionHistory({ rows, onDownload, empty }: { rows: Decision[]; onDownload: (row: Decision) => void; empty: string }) {
  if (!rows.length) return <p className={styles.emptyHistory}>{empty}</p>;
  return <div className={styles.historyList}>{rows.map((row) => <details key={row.id} className={styles.historyItem}>
    <summary className={styles.historySummary}><span className={styles.historyIcon}><FileText size={18} aria-hidden="true" /></span><span className={styles.historyTitle}><strong>{row.rendered_snapshot.title}</strong><small>{new Date(row.decided_at).toLocaleString("fr-CH")} · {row.rendered_snapshot.locale.toUpperCase()}</small></span><span className={styles.historyDecision}>{decisionLabels[row.decision] ?? row.decision}</span><ChevronDown size={17} className={styles.chevron} aria-hidden="true" /></summary>
    <div className={styles.historyBody}><p className={styles.proofMeta}>Acteur : {row.actor_id} · Bénéficiaire : {row.beneficiary_id}</p><div className={styles.proofText}>{row.rendered_snapshot.body}</div><button type="button" className={styles.secondaryButton} onClick={() => onDownload(row)}><Download size={16} aria-hidden="true" /> Télécharger la preuve</button></div>
  </details>)}</div>;
}
export default function MyLegalPage() {
  const { t } = useI18n();
  const [organizationFilter, setOrganizationFilter] = useState("all");
  const [organizations, setOrganizations] = useState<OrganizationAccessSummary[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]); const [history, setHistory] = useState<Decision[]>([]);
  const [childHistory, setChildHistory] = useState<Decision[]>([]);
  const [children, setChildren] = useState<Child[]>([]); const [historyChild, setHistoryChild] = useState<string | null>(null);
  const [subject, setSubject] = useState(""); const [locale, setLocale] = useState("fr"); const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [selected, setSelected] = useState<Doc | null>(null); const [code, setCode] = useState(""); const [status, setStatus] = useState("");
  const [pendingKey, setPendingKey] = useState(""); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<AccessState>({ state: "loading" });
  const [parentConfirmation, setParentConfirmation] = useState({ email_ready: false, delivery_ready: false, code_required: true });
  const [parentConsentChecked, setParentConsentChecked] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null); const triggerButton = useRef<HTMLButtonElement | null>(null);
  const api = useCallback(async (path: string, body?: object) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Erreur"); return data;
  }, []);
  const refresh = useCallback(async (background = false) => {
    if (!background) setAccess({ state: "loading" });
    try {
      const [d, h, c, gate, redirect] = await Promise.all([
        api("/api/legal/documents"), api("/api/legal/history"), api("/api/legal/children"),
        api("/api/legal/status"), api("/api/auth/redirect", {}),
      ]);
      if (typeof gate.enforcement_enabled !== "boolean" || !Array.isArray(gate.missing)
        || typeof redirect.redirectTo !== "string") throw new Error("État de l’accès indisponible.");
      setOrganizations(gate.organizations ?? []);
      setDocs(d.documents); setHistory(h.decisions); setChildren(c.children); setParentConfirmation(c.parent_confirmation ?? { email_ready: false, delivery_ready: false, code_required: true });
      setAccess({ state: "ready", enforcementEnabled: gate.enforcement_enabled,
        missing: gate.missing, destination: redirect.redirectTo, consentRequired: redirect.consentRequired === true,
        parentConsentRequired: redirect.parentConsentRequired === true,
        pendingClubNames: Array.isArray(redirect.pendingClubNames) ? redirect.pendingClubNames.filter((name: unknown): name is string => typeof name === "string") : [] });
      setLoading(false);
    } catch (error) { setAccess({ state: "error" }); setLoading(false); throw error; }
  }, [api]);
  useEffect(() => {
    let initialRefreshInProgress = true;
    let focusRefreshInProgress = false;
    refresh().catch((e) => { setStatus(String(e)); setLoading(false); })
      .finally(() => { initialRefreshInProgress = false; });
    const onFocus = () => {
      if (document.visibilityState !== "visible" || initialRefreshInProgress || focusRefreshInProgress) return;
      focusRefreshInProgress = true;
      refresh(true).catch(() => {}).finally(() => { focusRefreshInProgress = false; });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [refresh]);
  useEffect(() => { if (!presentation) return; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setPresentation(null); triggerButton.current?.focus(); } };
    window.addEventListener("keydown", onKeyDown); return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKeyDown); }; }, [presentation]);
  function closePresentation() { setPresentation(null); triggerButton.current?.focus(); }
  async function open(d: Doc, childId?: string) { setBusy(true); setStatus(""); setSelected(d); setPresentation(null); setCode(""); setPendingKey(""); setParentConsentChecked(false);
    triggerButton.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    try { const result = await api("/api/legal/present", { document_id: d.id, beneficiary_id: childId || undefined,
      role: childId ? "parent" : d.eligible_role, locale }); setPresentation(result.presentation); setSubject(childId ?? "self"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  async function sendCode() { if (!presentation) return; setBusy(true); try { await api("/api/legal/parent-confirmation", { presentation_id: presentation.id });
    setStatus("Code envoyé à l’adresse vérifiée du parent."); } catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  async function decide(decision: string) { if (!presentation) return; setBusy(true); setStatus("");
    const key = pendingKey || crypto.randomUUID(); setPendingKey(key);
    try { await api("/api/legal/decide", { presentation_id: presentation.id, decision, idempotency_key: key, parent_code: code });
      setStatus("Décision enregistrée."); closePresentation(); setPendingKey(""); await refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }
  function download(row: Decision) { const blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `activitee-decision-${row.id}.json`;
    link.click(); URL.revokeObjectURL(url); }
  const parentItems = parentAuthorizationItems(docs, children, locale).filter(item => organizationFilter === "all" || item.child.club_id === organizationFilter);
  const personalDocs = docs.filter((doc) => (organizationFilter === "all" || doc.scope === "platform" || doc.club_id === organizationFilter) && !(doc.kind === "parent_authorization" && doc.purpose_key === "service.parent_authorization"));
  const requiredDocs = personalDocs.filter((doc) => doc.required);
  const optionalDocs = personalDocs.filter((doc) => !doc.required);
  const verifiedChildren = children.filter((child) => child.representation_verified);
  const accessMissing = access.state === "ready" && access.enforcementEnabled ? access.missing : [];
  const destination = access.state === "ready" ? access.destination : "";
  const juniorConsentMissing = access.state === "ready" && access.consentRequired;
  const pendingClubNames = access.state === "ready" ? access.pendingClubNames ?? [] : [];
  const parentConsentMissing = access.state === "ready" && (access.parentConsentRequired);
  const requiresParentCode = subject !== "self" && (selected?.kind !== "parent_authorization"
    || selected.purpose_key !== "service.parent_authorization" || parentConfirmation.code_required);
  const canEnter = access.state === "ready" && accessMissing.length === 0 && !juniorConsentMissing && !parentConsentMissing && homeDestinations.has(destination);
  const currentHistoryChild = children.find((child) => `${child.child_id}:${child.club_id}` === historyChild);
  const subjectName = children.find((child) => child.child_id === subject)?.child_name ?? "votre enfant";
  function renderDoc(doc: Doc) {
    const title = displayTitle(doc.version?.snapshot.translations?.[locale]?.title ?? doc.document_key, doc);
    const choice = doc.purpose_key === "coaching.rewrite" ? doc.own_choice : doc.state;
    const current = Boolean(doc.version && choice?.version_id === doc.version.id);
    const stateLabel = doc.kind === "parent_authorization" ? "Décision par enfant" : doc.state?.conflict ? "À examiner"
      : current ? decisionLabels[choice?.decision ?? ""] ?? choice?.decision : doc.required ? "À confirmer" : "Aucun choix";
    const childActions = (doc.kind === "parent_authorization" || doc.kind === "specific_consent")
      ? verifiedChildren.filter((child) => doc.scope === "platform" || child.club_id === doc.club_id) : [];
    return <article key={doc.id} className={styles.docCard}>
      <div className={styles.docTop}><span className={styles.docIcon}><FileText size={20} aria-hidden="true" /></span><span className={styles.statusPill}>{stateLabel}</span></div>
      <h3>{title}</h3>
      <p className={styles.docMeta}>Version {doc.version?.version_number ?? "—"} <span aria-hidden="true">·</span> {doc.scope === "platform" ? "ActiviTee" : doc.club_name ?? t("organization.context")}</p>
      <p className={styles.docDescription}>{doc.kind === "parent_authorization" ? "À lire et décider pour chaque enfant concerné."
        : doc.purpose_key === "coaching.rewrite" ? "Le choix du junior reste nécessaire, même avec l’accord du parent."
        : doc.required ? "Lisez cette version avant de confirmer votre choix." : "Vous pouvez donner ou retirer ce consentement à tout moment."}</p>
      <div className={styles.docActions}>
        {doc.kind !== "parent_authorization" && <button type="button" className={styles.primaryButton} disabled={busy || !doc.eligible_role || !doc.version} onClick={() => open(doc)}>Lire et décider <ArrowRight size={16} aria-hidden="true" /></button>}
        {childActions.map((child) => <button key={`${doc.id}-${child.child_id}-${child.club_id}`} type="button" className={styles.secondaryButton} disabled={busy || !doc.version} onClick={() => open(doc, child.child_id)}>Pour {child.child_name ?? "mon enfant"} <ArrowRight size={16} aria-hidden="true" /></button>)}
        {doc.kind === "parent_authorization" && !childActions.length && <p className={styles.noChild}>Aucun enfant lié à ce document.</p>}
      </div>
    </article>;
  }
  function documentGroups(items: Doc[]) {
    return Array.from(new Set(items.map(doc => doc.club_id))).map(id => <div key={id ?? "platform"}>
      <h3>{id ? items.find(doc => doc.club_id === id)?.club_name : t("organization.platform")}</h3>
      <div className={styles.cardGrid}>{items.filter(doc => doc.club_id === id).map(renderDoc)}</div>
    </div>);
  }
  async function showChildHistory(child: Child) {
    setHistoryChild(`${child.child_id}:${child.club_id}`); setChildHistory([]);
    try { const result = await api(`/api/legal/history?beneficiary_id=${encodeURIComponent(child.child_id)}&club_id=${encodeURIComponent(child.club_id)}`);
      setChildHistory(result.decisions); setStatus(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); }
  }
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.hero}><span className={styles.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> Mon espace</span><h1>Documents et consentements</h1><p>Retrouvez les textes qui vous concernent, consultez leur version actuelle et gardez une trace de vos décisions.</p></header>
    <div className={styles.content}>
      <div className={styles.documentControls}>
      <div className={styles.toolbar}><div><strong>Mes documents</strong><span>Les choix facultatifs restent indépendants des documents requis.</span></div>
        <label className={styles.languageSelect}><Globe2 size={17} aria-hidden="true" /><span>Langue</span><select value={locale} onChange={(event) => { setLocale(event.target.value); closePresentation(); }}>{languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>
      </div>
      <div className={styles.toolbar}><label className={styles.languageSelect}>{t("organization.context")} <select value={organizationFilter} onChange={event => setOrganizationFilter(event.target.value)}>
        <option value="all">{t("organization.all")}</option>{Array.from(new Map(organizations.map(org => [org.organization_id, org])).values()).map(org => <option key={org.organization_id} value={org.organization_id}>{org.name} · {t(`organization.${org.org_type}`)}</option>)}
      </select></label><span>{t("organization.ownAccess")}</span></div>
      {organizations.length > 0 && <div className={styles.childTabs}>{organizations.map(org => <span key={`${org.organization_id}:${org.player_id}`} className={styles.childButton}>{org.name} · {t(`organization.${org.org_type}`)} · {t(org.accessible ? "organization.ready" : "organization.legalNeeded")}</span>)}</div>}
      </div>
      <section className={styles.accessCard} aria-labelledby="access-title">
        <div className={styles.accessHeading}><span className={styles.accessIcon}><ShieldCheck size={21} aria-hidden="true" /></span><div><h2 id="access-title">Accès à ActiviTee</h2>
          {canEnter ? <p>{access.state === "ready" && access.enforcementEnabled
            ? "Vos documents requis sont à jour. Vous pouvez rejoindre votre espace."
            : "Vous pouvez rejoindre votre espace ActiviTee."}</p>
            : access.state === "loading" ? <p>Vérification de vos documents et de votre accès…</p>
            : access.state === "error" ? <p>Impossible de vérifier votre accès pour le moment. Réessayez en actualisant la page.</p>
            : accessMissing.length || juniorConsentMissing || parentConsentMissing ? <p>Voici les conditions à remplir avant d’accéder à votre espace.</p>
            : <p>Aucun espace ActiviTee n’est associé à ce compte. Contactez votre club.</p>}</div></div>
        {accessMissing.length > 0 && <ul className={styles.accessMissing}>{accessMissing.map((item) => {
          const doc = docs.find((entry) => entry.id === item.document_id);
          const title = displayTitle(doc?.version?.snapshot.translations?.[locale]?.title
            ?? doc?.version?.snapshot.translations?.fr?.title ?? item.document_key, doc);
          return <li key={item.document_id}><div><strong>{title}</strong><span>{requiredActionLabels[doc?.action_kind ?? ""] ?? "Décision requise"} · {doc?.club_name ?? "ActiviTee"} · {doc?.version ? `Version ${doc.version.version_number}` : "Version à vérifier"}</span></div>
            {doc?.version && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => open(doc)}>Lire et décider <ArrowRight size={15} aria-hidden="true" /></button>}</li>;
        })}</ul>}
        {juniorConsentMissing && <div className={styles.parentConsentNotice}>
          <LockKeyhole size={19} aria-hidden="true" /><div><strong>Autorisation parentale d’utilisation d’ActiviTee</strong>
            {pendingClubNames.length > 0 && <p>Autorisation encore nécessaire pour {pendingClubNames.join(", ")}.</p>}
            <p>Un de tes parents doit se connecter avec son propre compte et autoriser ton utilisation auprès de {pendingClubNames.length === 1 ? "ce club" : "chaque club concerné"}. Tu ne peux pas donner cet accord depuis ton compte Junior.</p>
            <p>Si tu es majeur, demande à ton club de vérifier ta date de naissance et ton statut.</p></div>
        </div>}
        {juniorConsentMissing && <button type="button" className={styles.secondaryButton}
          onClick={() => refresh().catch((error) => setStatus(error instanceof Error ? error.message : "Vérification indisponible."))}>
          Vérifier à nouveau
        </button>}
        {parentItems.length > 0 && <div className={styles.parentChildrenNotice}>
          <div className={styles.parentChildrenHeading}><LockKeyhole size={19} aria-hidden="true" /><div><strong>Autorisations pour mes enfants</strong>
            <p>{t("organization.legalScope")}</p></div></div>
          <ul>{parentItems.map((item) => <li key={item.key}><div className={styles.parentChildDetails}>
            <strong>{item.child.child_name ?? "Mon enfant"} <span>· {item.child.club_name ?? t("organization.context")}</span></strong>
            <span>{displayTitle(item.title,item.doc)}</span><small>{item.complete ? "Autorisation enregistrée" : item.conflict ? "Retrait ou refus à examiner avec l’organisation" : "Autorisation à donner"}{item.doc?.version ? ` · Version ${item.doc.version.version_number}` : ""}</small>
            {Boolean(item.child.other_clubs_pending?.length) && <small>L’accès de cet enfant reste aussi en attente auprès de {item.child.other_clubs_pending!.join(", ")}. Ce club doit activer votre accès Parent pour que vous puissiez y donner l’autorisation.</small>}
            {!item.child.can_authorize && <small>Votre club doit vérifier votre habilitation à autoriser cet enfant.</small>}
            {!item.doc?.version && <small>Le document de ce club n’est pas disponible. Contactez votre club.</small>}
          </div>{item.doc?.version && item.child.can_authorize && <button type="button" className={styles.secondaryButton} disabled={busy}
            onClick={() => open(item.doc!, item.child.child_id)}>{item.complete ? "Consulter l’autorisation" : "Lire et autoriser"}<ArrowRight size={15} aria-hidden="true" /></button>}</li>)}</ul>
        </div>}
        {canEnter ? <Link className={styles.primaryButton} href={destination}>Accéder à ActiviTee <ArrowRight size={17} aria-hidden="true" /></Link>
          : <button type="button" className={styles.primaryButton} disabled>Accéder à ActiviTee <ArrowRight size={17} aria-hidden="true" /></button>}
      </section>
      {status && <p className={styles.notice} role="status">{status}</p>}
      {loading ? <div className={styles.loadingGrid} aria-label="Chargement des documents"><div /><div /><div /></div> : <>
        {requiredDocs.length > 0 && <section className={styles.section} aria-labelledby="required-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>À consulter</span><h2 id="required-title">Documents requis</h2></div><span className={styles.count}>{requiredDocs.length}</span></div>{documentGroups(requiredDocs)}</section>}
        {optionalDocs.length > 0 && <section className={styles.section} aria-labelledby="optional-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>À votre choix</span><h2 id="optional-title">Consentements facultatifs</h2></div><span className={styles.count}>{optionalDocs.length}</span></div>{documentGroups(optionalDocs)}</section>}
        {!docs.length && <div className={styles.emptyDocuments}><Check size={22} aria-hidden="true" /><h2>Aucun document à traiter</h2><p>Vos documents apparaîtront ici lorsqu’ils vous concerneront.</p></div>}
      </>}
      <section className={styles.section} aria-labelledby="history-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>Vos preuves</span><h2 id="history-title">Historique de mes décisions</h2></div></div><DecisionHistory rows={history} onDownload={download} empty="Aucune décision enregistrée pour le moment." /></section>
      {verifiedChildren.length > 0 && <section className={styles.section} aria-labelledby="children-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>Représentation parentale</span><h2 id="children-title">Décisions concernant mes enfants</h2></div></div>
        <div className={styles.childTabs}>{verifiedChildren.map((child) => <button type="button" key={`${child.child_id}-${child.club_id}`} className={historyChild === `${child.child_id}:${child.club_id}` ? styles.activeChild : styles.childButton} onClick={() => showChildHistory(child)}>{child.child_name ?? "Mon enfant"} <span>· {child.club_name ?? t("organization.context")}</span></button>)}</div>
        {historyChild && <div className={styles.childHistory}><h3>{currentHistoryChild?.child_name ?? "Mon enfant"}</h3><DecisionHistory rows={childHistory} onDownload={download} empty="Aucune décision enregistrée pour cet enfant." /></div>}
      </section>}
      <footer className={styles.footer}><div><Link href="/legal">Textes publics</Link><Link href="/legal/request">Demande relative à mes données</Link></div><button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }}><LogOut size={16} aria-hidden="true" /> Se déconnecter</button></footer>
    </div>
  </div>
  {presentation && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closePresentation(); }}><section role="dialog" aria-modal="true" aria-labelledby="legal-title" className={styles.modal}>
    <div className={styles.modalHeader}><div><span className={styles.sectionEyebrow}>Document à lire</span><h2 id="legal-title">{presentation.rendered_snapshot.title}</h2><p>Version {presentation.rendered_snapshot.version_number} · {presentation.rendered_snapshot.locale.toUpperCase()}</p></div><button ref={closeButton} type="button" className={styles.closeButton} aria-label="Fermer le document" onClick={closePresentation}><X size={21} aria-hidden="true" /></button></div>
    <div className={styles.modalScroll}>{status && <p className={styles.notice} role="status">{status}</p>}<article className={styles.legalText}>{presentation.rendered_snapshot.body}</article>
      {selected?.kind === "parent_authorization" && <label className={styles.parentConsentCheck}><input type="checkbox" checked={parentConsentChecked} onChange={(event) => setParentConsentChecked(event.target.checked)} /><span>Je confirme être habilité à autoriser {subjectName} et avoir lu ce document.</span></label>}
      {subject !== "self" && <div className={styles.confirmationBox}><div className={styles.confirmationHeading}><LockKeyhole size={19} aria-hidden="true" /><strong>Confirmation parentale</strong></div>
        {requiresParentCode ? <><p>Cette décision concerne {subjectName}. Une confirmation par code envoyé à votre adresse e-mail vérifiée est nécessaire.</p>
          {!parentConfirmation.email_ready && <p>Demandez à votre club de renseigner et vérifier votre adresse e-mail pour recevoir ce code.</p>}
          {parentConfirmation.email_ready && !parentConfirmation.delivery_ready && <p>L’envoi des codes est temporairement indisponible. Contactez l’assistance à info@activitee.golf.</p>}
          <div className={styles.confirmationControls}><button type="button" className={styles.secondaryButton} disabled={busy || !parentConfirmation.email_ready || !parentConfirmation.delivery_ready} onClick={sendCode}>Envoyer un code</button><label>Code reçu <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label></div></>
          : <><p>Cette autorisation concerne {subjectName}. La confirmation par code est temporairement désactivée ; votre décision reste enregistrée avec ce document et sa version.</p>
            {!parentConfirmation.email_ready && <p>Votre adresse e-mail doit être vérifiée par le club avant de pouvoir autoriser l’accès.</p>}</>}</div>}
    </div>
    <div className={styles.modalFooter}><button type="button" className={styles.primaryButton} disabled={busy || (selected?.kind === "parent_authorization" && (!parentConsentChecked || !parentConfirmation.email_ready || (requiresParentCode && !/^\d{6}$/.test(code))))} onClick={() => decide(({ accept: "accepted", acknowledge: "acknowledged", authorize: "authorized", consent: "consented", read: "acknowledged" } as Record<string,string>)[selected?.action_kind ?? "accept"])}><Check size={17} aria-hidden="true" /> {presentation.rendered_snapshot.action_label}</button><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => decide("refused")}>Refuser</button>{(selected?.kind === "specific_consent" || (selected?.kind === "parent_authorization" && parentItems.some((item) => item.doc?.id === selected.id && item.child.child_id === subject && item.complete))) && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => decide("withdrawn")}>Retirer mon consentement</button>}<button type="button" className={styles.textButton} onClick={closePresentation}>Fermer</button></div>
  </section></div>}
  </main>;
}
