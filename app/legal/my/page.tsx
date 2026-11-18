"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DeleteAccountLink from "@/components/legal/DeleteAccountLink";
import { ArrowRight, Check, ChevronDown, Download, FileText, Globe2, LockKeyhole, LogOut, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./MyLegalPage.module.css";
import { parentAuthorizationItems, type LegalChild } from "@/lib/parentAuthorization";
import { buildLegalChecklist, type ChecklistDocument } from "@/lib/legalChecklist";
import { requiresParentCode } from "@/lib/legalParentConfirmation";

type Doc = ChecklistDocument;
type Presentation = { id: string; rendered_snapshot: { title: string; body: string; action_label: string; version_number: number; locale: string }; expires_at: string };
type Decision = { id: string; actor_id: string; beneficiary_id: string; decision: string; rendered_snapshot: { title: string; body: string; locale: string }; decided_at: string };
type Child = LegalChild;
type MissingAction = { document_id: string; document_key: string; kind: string; club_id: string | null; role: string; version_id: string | null; beneficiary_id?: string };
type AccessState = { state: "loading" | "error" } | { state: "ready"; enforcementEnabled: boolean; missing: MissingAction[]; destination: string; consentRequired: boolean; parentConsentRequired: boolean; playerProfileRequired: boolean; pendingClubNames: string[] };
const homeDestinations = new Set(["/admin", "/manager", "/coach", "/player"]);
const languages = [{ code: "fr", label: "Français" }, { code: "en", label: "English" }, { code: "de", label: "Deutsch" }, { code: "it", label: "Italiano" }];
const decisionLabels: Record<string, string> = { accepted: "Accepté", acknowledged: "Lu et confirmé", authorized: "Autorisé", consented: "Consentement donné", refused: "Refusé", withdrawn: "Retiré" };
function DecisionHistory({ rows, onDownload, empty }: { rows: Decision[]; onDownload: (row: Decision) => void; empty: string }) {
  if (!rows.length) return <p className={styles.emptyHistory}>{empty}</p>;
  return <div className={styles.historyList}>{rows.map((row) => <details key={row.id} className={styles.historyItem}>
    <summary className={styles.historySummary}><span className={styles.historyIcon}><FileText size={18} aria-hidden="true" /></span><span className={styles.historyTitle}><strong>{row.rendered_snapshot.title}</strong><small>{new Date(row.decided_at).toLocaleString("fr-CH")} · {row.rendered_snapshot.locale.toUpperCase()}</small></span><span className={styles.historyDecision}>{decisionLabels[row.decision] ?? row.decision}</span><ChevronDown size={17} className={styles.chevron} aria-hidden="true" /></summary>
    <div className={styles.historyBody}><p className={styles.proofMeta}>Acteur : {row.actor_id} · Bénéficiaire : {row.beneficiary_id}</p><div className={styles.proofText}>{row.rendered_snapshot.body}</div><button type="button" className={styles.secondaryButton} onClick={() => onDownload(row)}><Download size={16} aria-hidden="true" /> Télécharger la preuve</button></div>
  </details>)}</div>;
}
export default function MyLegalPage() {
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
      setDocs(d.documents); setHistory(h.decisions); setChildren(c.children); setParentConfirmation(c.parent_confirmation ?? { email_ready: false, delivery_ready: false, code_required: true });
      setAccess({ state: "ready", enforcementEnabled: gate.enforcement_enabled,
        missing: [...new Map([...gate.missing, ...(gate.organization_missing ?? [])].map((item: MissingAction) => [`${item.document_id}:${item.club_id}:${item.beneficiary_id ?? "self"}`, item])).values()] as MissingAction[], destination: redirect.redirectTo, consentRequired: redirect.consentRequired === true,
        parentConsentRequired: redirect.parentConsentRequired === true, playerProfileRequired: redirect.playerProfileRequired === true,
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
  const open = useCallback(async (d: Doc, childId?: string) => { setBusy(true); setStatus(""); setSelected(d); setPresentation(null); setCode(""); setPendingKey(""); setParentConsentChecked(false);
    triggerButton.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    try { const result = await api("/api/legal/present", { document_id: d.id, beneficiary_id: childId || undefined,
      role: childId ? "parent" : d.eligible_role, locale }); setPresentation(result.presentation); setSubject(childId ?? "self"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); } finally { setBusy(false); } }, [api, locale]);
  const requestedDocumentOpened = useRef(false);
  useEffect(() => {
    if (loading || requestedDocumentOpened.current) return;
    const query = new URLSearchParams(window.location?.search ?? "");
    const documentId = query.get("document");
    if (!documentId) return;
    requestedDocumentOpened.current = true;
    const beneficiary = query.get("beneficiary");
    const item = buildLegalChecklist(docs, children, locale).find(item => item.doc?.id === documentId
      && (item.child?.child_id ?? null) === beneficiary);
    if (item?.doc && item.actionable) void open(item.doc, item.child?.child_id);
    else setStatus("Ce document n’est pas disponible pour ce compte. Consultez les documents ci-dessous.");
  }, [loading, docs, children, locale, open]);
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
  const parentItems = parentAuthorizationItems(docs, children, locale);
  const checklist = buildLegalChecklist(docs, children, locale);
  const unanswered = checklist.filter(item => item.requiredResponse && !item.complete);
  const groups = [...new Map(checklist.map(item => [item.organizationId, item.organizationName])).entries()];
  const verifiedChildren = children.filter((child) => child.can_decide ?? child.representation_verified);
  const accessMissing = access.state === "ready" && access.enforcementEnabled ? access.missing : [];
  const destination = access.state === "ready" ? access.destination : "";
  const juniorConsentMissing = access.state === "ready" && access.consentRequired;
  const pendingClubNames = access.state === "ready" ? access.pendingClubNames ?? [] : [];
  const parentConsentMissing = access.state === "ready" && (access.parentConsentRequired);
  const playerProfileMissing = access.state === "ready" && access.playerProfileRequired;
  const parentCodeRequired = requiresParentCode(subject === "self", selected, parentConfirmation.code_required);
  const canEnter = access.state === "ready" && accessMissing.length === 0 && (destination === "/admin" || unanswered.length === 0) && !juniorConsentMissing && !parentConsentMissing && !playerProfileMissing && homeDestinations.has(destination);
  const currentHistoryChild = children.find((child) => `${child.child_id}:${child.club_id}` === historyChild);
  const subjectName = children.find((child) => child.child_id === subject)?.child_name ?? "votre enfant";
  async function showChildHistory(child: Child) {
    setHistoryChild(`${child.child_id}:${child.club_id}`); setChildHistory([]);
    try { const result = await api(`/api/legal/history?beneficiary_id=${encodeURIComponent(child.child_id)}&club_id=${encodeURIComponent(child.club_id)}`);
      setChildHistory(result.decisions); setStatus(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Indisponible"); }
  }
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.hero}><span className={styles.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> Mon espace</span><h1>Documents et consentements</h1><p>Répondez à chaque document pour vous et vos enfants, puis accédez à votre espace.</p></header>
    <div className={styles.content}>
      <div className={styles.listToolbar}><div><strong>Mes consentements</strong><p>Une réponse est nécessaire pour chaque document.</p></div>
        <label className={styles.languageSelect}><Globe2 size={17} aria-hidden="true" /><span>Langue</span><select value={locale} onChange={(event) => { setLocale(event.target.value); closePresentation(); }}>{languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>
      </div>
      <section className={styles.accessCard} aria-labelledby="access-title">
        <div className={styles.accessHeading}><span className={styles.accessIcon}><ShieldCheck size={21} aria-hidden="true" /></span><div><h2 id="access-title">Accès à ActiviTee</h2>
          {canEnter ? <p>{access.state === "ready" && access.enforcementEnabled
            ? "Toutes les réponses ont été enregistrées. Vous pouvez rejoindre votre espace."
            : "Vous pouvez rejoindre votre espace ActiviTee."}</p>
            : access.state === "loading" ? <p>Vérification de vos documents et de votre accès…</p>
            : access.state === "error" ? <p>Impossible de vérifier votre accès pour le moment. Réessayez en actualisant la page.</p>
            : unanswered.length || accessMissing.length || juniorConsentMissing || parentConsentMissing || playerProfileMissing ? <p>{unanswered.length ? `${unanswered.length} réponse${unanswered.length > 1 ? "s" : ""} à enregistrer avant d’accéder à votre espace.` : "Votre accès nécessite encore une vérification."}</p>
            : <p>Aucun espace ActiviTee n’est associé à ce compte. Contactez votre club.</p>}</div></div>
        {loading ? <p className={styles.emptyHistory}>Chargement des consentements…</p> : groups.map(([organizationId, name]) =>
          <section key={organizationId ?? "platform"} className={styles.consentGroup} aria-label={name}>
            <h3>{name}</h3>
            <ul className={styles.consentList}>{checklist.filter(item => item.organizationId === organizationId).map(item =>
              <li key={item.key} className={`${styles.consentRow}${!item.complete ? ` ${styles.consentRowPending}` : ""}`}>
                <div className={styles.consentDetails}><span className={styles.consentPerson}>{item.child ? `Pour ${item.child.child_name ?? "mon enfant"}` : "Pour vous"}</span>
                  <strong>{item.title}</strong>
                  <span className={item.complete ? styles.responseComplete : styles.responsePending}>
                    {item.complete ? <Check size={15} aria-hidden="true" /> : <TriangleAlert size={18} className={styles.pendingIcon} aria-hidden="true" />}{item.complete ? decisionLabels[item.decision ?? ""] ?? "Réponse enregistrée" : "À répondre"}
                  </span>{item.note && <small>{item.note}</small>}
                </div>
                <button type="button" className={item.complete ? styles.secondaryButton : `${styles.secondaryButton} ${styles.pendingButton}`} disabled={busy || !item.actionable || !item.doc}
                  onClick={() => item.doc && open(item.doc, item.child?.child_id)}>{item.complete ? "Consulter" : "Lire et répondre"}<ArrowRight size={15} aria-hidden="true" /></button>
              </li>)}</ul>
          </section>)}
        {!loading && !checklist.length && <p className={styles.emptyHistory}>Aucun consentement à renseigner.</p>}
        {playerProfileMissing && <div className={styles.parentConsentNotice}>
          <LockKeyhole size={19} aria-hidden="true" /><div><strong>Date de naissance et statut à vérifier</strong>
            <p>Votre compte est indiqué comme majeur, mais sa date de naissance ne permet pas de confirmer ce statut. Demandez à votre club de vérifier et corriger votre fiche.</p>
            <p>Vous pourrez ensuite valider vos propres documents et accéder à votre espace.</p></div>
        </div>}
        {juniorConsentMissing && <div className={styles.parentConsentNotice}>
          <LockKeyhole size={19} aria-hidden="true" /><div><strong>Autorisation parentale d’utilisation d’ActiviTee</strong>
            {pendingClubNames.length > 0 && <p>Autorisation encore nécessaire pour {pendingClubNames.join(", ")}.</p>}
            <p>Un de tes parents doit se connecter avec son propre compte et autoriser ton utilisation auprès de {pendingClubNames.length === 1 ? "ce club" : "chaque club concerné"}. Tu ne peux pas donner cet accord depuis ton compte Junior.</p>
            <p>Si tu es majeur, demande à ton club de vérifier ta date de naissance et ton statut.</p></div>
        </div>}
        {(juniorConsentMissing || playerProfileMissing) && <button type="button" className={styles.secondaryButton}
          onClick={() => refresh().catch((error) => setStatus(error instanceof Error ? error.message : "Vérification indisponible."))}>
          Vérifier à nouveau
        </button>}
        {canEnter ? <Link className={styles.primaryButton} href={destination}>Accéder à ActiviTee <ArrowRight size={17} aria-hidden="true" /></Link>
          : <button type="button" className={styles.primaryButton} disabled>Accéder à ActiviTee <ArrowRight size={17} aria-hidden="true" /></button>}
      </section>
      {status && <p className={styles.notice} role="status">{status}</p>}
      <details className={styles.historyArchive} open><summary>Historique des réponses <ChevronDown size={17} aria-hidden="true" /></summary>
      <section className={styles.section} aria-labelledby="history-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>Vos preuves</span><h2 id="history-title">Historique de mes décisions</h2></div></div><DecisionHistory rows={history} onDownload={download} empty="Aucune décision enregistrée pour le moment." /></section>
      {verifiedChildren.length > 0 && <section className={styles.section} aria-labelledby="children-title"><div className={styles.sectionHeading}><div><span className={styles.sectionEyebrow}>Représentation parentale</span><h2 id="children-title">Décisions concernant mes enfants</h2></div></div>
        <div className={styles.childTabs}>{verifiedChildren.map((child) => <button type="button" key={`${child.child_id}-${child.club_id}`} className={styles.textButton} onClick={() => showChildHistory(child)}>{child.child_name ?? "Mon enfant"} <span>· {child.club_name ?? "votre organisation"}</span></button>)}</div>
        {historyChild && <div className={styles.childHistory}><h3>{currentHistoryChild?.child_name ?? "Mon enfant"}</h3><DecisionHistory rows={childHistory} onDownload={download} empty="Aucune décision enregistrée pour cet enfant." /></div>}
      </section>}
      </details>
      <footer className={styles.footer}><div><Link href="/legal">Textes publics</Link><Link href="/legal/request">Demande relative à mes données</Link><DeleteAccountLink variant="text" /></div><button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }}><LogOut size={16} aria-hidden="true" /> Se déconnecter</button></footer>
    </div>
  </div>
  {presentation && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closePresentation(); }}><section role="dialog" aria-modal="true" aria-labelledby="legal-title" className={styles.modal}>
    <div className={styles.modalHeader}><div><span className={styles.sectionEyebrow}>Document à lire</span><h2 id="legal-title">{presentation.rendered_snapshot.title}</h2><p>Version {presentation.rendered_snapshot.version_number} · {presentation.rendered_snapshot.locale.toUpperCase()}</p></div><button ref={closeButton} type="button" className={styles.closeButton} aria-label="Fermer le document" onClick={closePresentation}><X size={21} aria-hidden="true" /></button></div>
    <div className={styles.modalScroll}>{status && <p className={styles.notice} role="status">{status}</p>}<article className={styles.legalText}>{presentation.rendered_snapshot.body}</article>
      {selected?.kind === "parent_authorization" && <label className={styles.parentConsentCheck}><input type="checkbox" checked={parentConsentChecked} onChange={(event) => setParentConsentChecked(event.target.checked)} /><span>Je confirme être habilité à autoriser {subjectName} et avoir lu ce document.</span></label>}
      {subject !== "self" && <div className={styles.confirmationBox}><div className={styles.confirmationHeading}><LockKeyhole size={19} aria-hidden="true" /><strong>Confirmation parentale</strong></div>
        {parentCodeRequired ? <><p>Cette décision concerne {subjectName}. Une confirmation par code envoyé à votre adresse e-mail vérifiée est nécessaire.</p>
          {!parentConfirmation.email_ready && <p>Demandez à votre club de renseigner et vérifier votre adresse e-mail pour recevoir ce code.</p>}
          {parentConfirmation.email_ready && !parentConfirmation.delivery_ready && <p>L’envoi des codes est temporairement indisponible. Contactez l’assistance à info@activitee.golf.</p>}
          <div className={styles.confirmationControls}><button type="button" className={styles.secondaryButton} disabled={busy || !parentConfirmation.email_ready || !parentConfirmation.delivery_ready} onClick={sendCode}>Envoyer un code</button><label>Code reçu <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label></div></>
          : <><p>Cette décision concerne {subjectName}. Aucun code supplémentaire n’est nécessaire : votre compte Parent, votre lien avec ce junior et votre adresse e-mail vérifiée sont contrôlés. Votre décision reste enregistrée avec ce document et sa version.</p>
            {!parentConfirmation.email_ready && <p>Votre adresse e-mail doit être vérifiée avant de confirmer cette décision.</p>}</>}</div>}
    </div>
    <div className={styles.modalFooter}><button type="button" className={styles.primaryButton} disabled={busy || (selected?.kind === "parent_authorization" && !parentConsentChecked) || (subject !== "self" && (!parentConfirmation.email_ready || (parentCodeRequired && !/^\d{6}$/.test(code))))} onClick={() => decide(({ accept: "accepted", acknowledge: "acknowledged", authorize: "authorized", consent: "consented", read: "acknowledged" } as Record<string,string>)[selected?.action_kind ?? "accept"])}><Check size={17} aria-hidden="true" /> {presentation.rendered_snapshot.action_label}</button><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => decide("refused")}>Refuser</button>{(selected?.kind === "specific_consent" || (selected?.kind === "parent_authorization" && parentItems.some((item) => item.doc?.id === selected.id && item.child.child_id === subject && item.complete))) && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => decide("withdrawn")}>Retirer mon consentement</button>}<button type="button" className={styles.textButton} onClick={closePresentation}>Fermer</button></div>
  </section></div>}
  </main>;
}
