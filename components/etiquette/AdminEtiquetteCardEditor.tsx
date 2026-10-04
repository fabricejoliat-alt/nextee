"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, CircleAlert, Eye, Lightbulb, Save, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { etiquetteAdminText } from "@/lib/etiquetteAdminLabels";
import styles from "@/components/admin/rules/AdminRuleCardEditor.module.css";
import preview from "@/components/rules/CoachRulesWorkspace.module.css";

type Version = { id: string; card_id: string; version: number; locale: string; title: string; situation: string; simple_explanation: string;
  action_text: string; common_mistake: string; mission_text: string; coach_tip: string; official_reference: string;
  reference_version: string; reference_kind: string; image_url: string | null; image_alt: string; approved_at: string | null;
  editorial_status: string };
const required: Array<keyof Version> = ["title", "situation", "simple_explanation", "action_text", "common_mistake", "mission_text", "coach_tip", "official_reference", "reference_version"];

export default function AdminEtiquetteCardEditor({ cardVersionId }: { cardVersionId: string }) {
  const { locale } = useI18n();
  const a = etiquetteAdminText(locale);
  const router = useRouter();
  const [draft, setDraft] = useState<Version | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    try {
      const auth = await token();
      const response = await fetch(`/api/admin/etiquette/cards/${cardVersionId}`, { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.version) throw new Error(String(json.error ?? "Chargement impossible."));
      setDraft(json.version); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }, [cardVersionId, token]);
  useEffect(() => { void load(); }, [load]);
  const update = (field: keyof Version, value: string) => setDraft((current) => current ? { ...current, [field]: value } : current);
  async function act(action: "save" | "approve" | "new_version") {
    if (!draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const auth = await token();
      const response = await fetch(`/api/admin/etiquette/cards/${cardVersionId}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` }, body: JSON.stringify({ ...draft, action }) });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? "Enregistrement impossible."));
      if (action === "new_version") { router.push(`/admin/etiquette/cards/${json.cardVersionId}`); return; }
      setNotice(action === "approve" ? "Version approuvée. Le thème reste à publier." : "Fiche enregistrée.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  if (loading) return <main className={styles.loading} aria-busy="true"><i/><i/><i/></main>;
  if (!draft) return <main className={styles.empty}><CircleAlert/><h1>{a.card}</h1><p>{error}</p><Link href="/admin/etiquette">{a.back}</Link></main>;
  const locked = Boolean(draft.approved_at);
  const complete = required.every((field) => String(draft[field] ?? "").trim());
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">{a.admin}</Link><ChevronRight size={14}/><Link href="/admin/etiquette">{a.title}</Link><ChevronRight size={14}/><span>{draft.title}</span></nav>
    <header className={styles.topline}><div><p className={styles.eyebrow}>{a.version} {draft.version} · {a.sourceFrench}</p><h1>{draft.title}</h1><p>{a.cardLead}</p></div><span className={`${styles.status} ${locked ? styles.approved : ""}`}>{locked ? <><ShieldCheck size={15}/>{a.approvedVersion}</> : <><CircleAlert size={15}/>{a.required}</>}</span></header>
    {error && <div className={styles.error} role="alert"><CircleAlert size={17}/>{error}</div>}{notice && <div className={styles.success} role="status"><CheckCircle2 size={17}/>{notice}</div>}
    <section className={styles.panel}><div className={styles.panelHead}><div><span><BookOpen size={19}/></span><div><h2>{a.content}</h2><p>{a.contentHint}</p></div></div><button type="button" onClick={() => void act("save")} disabled={saving || locked}><Save size={15}/>{a.save}</button></div>
      <div className={styles.grid}><Field label={a.cardTitle} value={draft.title} disabled={locked} onChange={(value) => update("title", value)}/>
        <Area label={a.situation} value={draft.situation} disabled={locked} onChange={(value) => update("situation", value)}/>
        <Area label={a.understand} value={draft.simple_explanation} disabled={locked} onChange={(value) => update("simple_explanation", value)}/>
        <Area label={a.action} value={draft.action_text} disabled={locked} onChange={(value) => update("action_text", value)}/>
        <Area label={a.avoid} value={draft.common_mistake} disabled={locked} onChange={(value) => update("common_mistake", value)}/>
        <Area label={a.mission} value={draft.mission_text} disabled={locked} onChange={(value) => update("mission_text", value)}/>
        <Area label={a.coachTip} value={draft.coach_tip} disabled={locked} onChange={(value) => update("coach_tip", value)}/>
      </div></section>
    <section className={styles.panel}><div className={styles.panelHead}><div><span><ShieldCheck size={19}/></span><div><h2>{a.reference}</h2><p>{a.referenceHint}</p></div></div></div><div className={styles.grid}>
      <Field label={a.referenceName} value={draft.official_reference} disabled={locked} onChange={(value) => update("official_reference", value)}/>
      <Field label={a.referenceVersion} value={draft.reference_version} disabled={locked} onChange={(value) => update("reference_version", value)}/>
      <label><span>{a.kind}</span><select value={draft.reference_kind} disabled={locked} onChange={(event) => update("reference_kind", event.target.value)}><option value="rule">{a.rule}</option><option value="code">{a.code}</option><option value="club_guidance">{a.club}</option><option value="good_practice">{a.practice}</option></select></label>
      <Field label={a.imageUrl} value={draft.image_url ?? ""} disabled={locked} onChange={(value) => update("image_url", value)}/>
      <Field label={a.imageAlt} value={draft.image_alt} disabled={locked} onChange={(value) => update("image_alt", value)}/>
    </div></section>
    <section className={styles.panel}><div className={styles.panelHead}><div><span><Eye size={19}/></span><div><h2>{a.previewHeading}</h2><p>{a.previewHint}</p></div></div></div>
      <div className={styles.approvalBar}><div><ShieldCheck size={18}/><span><b>{locked ? a.approvedVersion : complete ? a.readyReview : a.incomplete}</b><small>{a.versionHint}</small></span></div><button type="button" onClick={() => setShowPreview(true)}><Eye size={15}/>{a.preview}</button>{locked ? <button type="button" onClick={() => void act("new_version")} disabled={saving}>{a.newVersion}</button> : <button type="button" onClick={() => void act("approve")} disabled={saving || !complete}><ShieldCheck size={15}/>{a.approve}</button>}</div>
    </section>
    {showPreview && <AccessibleDialog className={preview.dialog} labelledBy="etiquette-preview-title" onClose={() => setShowPreview(false)}><button type="button" className={preview.close} onClick={() => setShowPreview(false)} aria-label={a.close}><X size={20}/></button>{draft.image_url && <div className={preview.dialogImage}><Image src={draft.image_url} alt={draft.image_alt || draft.title} fill sizes="(max-width: 640px) 100vw, 640px" unoptimized/></div>}<div className={preview.dialogBody}>
      <span className={preview.dialogKicker}>{draft.official_reference}</span><h2 id="etiquette-preview-title">{draft.title}</h2>
      <div className={preview.dialogSection}><small>{a.situation}</small><p lang="fr">{draft.situation}</p></div><div className={preview.dialogSection}><small>{a.understand}</small><p lang="fr">{draft.simple_explanation}</p></div>
      <div className={preview.takeaway}><Lightbulb size={20}/><div><strong>{a.action}</strong><p lang="fr">{draft.action_text}</p></div></div>
      <div className={preview.dialogSection}><small>{a.avoid}</small><p lang="fr">{draft.common_mistake}</p></div><div className={preview.dialogSection}><small>{a.mission}</small><p lang="fr">{draft.mission_text}</p></div>
      <div className={preview.dialogSection}><small>{a.coachTip}</small><p lang="fr">{draft.coach_tip}</p></div></div></AccessibleDialog>}
  </main>;
}

function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) { return <label><span>{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}/></label>; }
function Area({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) { return <label className={styles.textArea}><span>{label}</span><textarea rows={4} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}/></label>; }
