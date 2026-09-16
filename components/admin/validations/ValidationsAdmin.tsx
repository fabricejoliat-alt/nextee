"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, ClipboardCheck, ImageIcon, ImagePlus, LoaderCircle, Pencil, Search, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./ValidationsAdmin.module.css";

type SectionRow = { id: string; slug: string; name: string; sort_order: number; is_active: boolean };
type ExerciseRow = { id: string; section_id: string; external_code: string | null; sequence_no: number; level: number | null; name: string; objective: string | null; short_description: string | null; detailed_description: string | null; equipment: string | null; validation_rule_text: string | null; illustration_url: string | null; is_active: boolean };

const emptyText = (value: string | null | undefined) => value ?? "";
const exerciseCode = (exercise: ExerciseRow) => exercise.external_code?.trim() || `Exercice ${exercise.sequence_no}`;

export default function ValidationsAdmin() {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [draft, setDraft] = useState<ExerciseRow | null>(null);
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState("");
  const [uploadingIllustration, setUploadingIllustration] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function getToken() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? ""; }
  async function load() {
    setLoading(true); setError(null);
    try {
      const token = await getToken(); if (!token) throw new Error("Pas de session.");
      const response = await fetch("/api/admin/validations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de chargement.");
      setSections((data.sections ?? []) as SectionRow[]); setExercises((data.exercises ?? []) as ExerciseRow[]);
    } catch (cause) { setSections([]); setExercises([]); setError(cause instanceof Error ? cause.message : "Erreur de chargement."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const sectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections]);
  const visibleExercises = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    return exercises.filter((exercise) => sectionFilter === "all" || exercise.section_id === sectionFilter).filter((exercise) => !normalized || [exercise.name, exercise.external_code ?? "", sectionById.get(exercise.section_id)?.name ?? "", exercise.objective ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(normalized))).sort((a, b) => ((sectionById.get(a.section_id)?.sort_order ?? 0) - (sectionById.get(b.section_id)?.sort_order ?? 0)) || a.sequence_no - b.sequence_no);
  }, [exercises, query, sectionById, sectionFilter]);

  function updateDraft(patch: Partial<ExerciseRow>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  async function toggleExerciseStatus(exercise: ExerciseRow) {
    const nextStatus = !exercise.is_active;
    setSavingStatusId(exercise.id); setError(null); setNotice(null);
    try {
      const token = await getToken(); if (!token) throw new Error("Pas de session.");
      const response = await fetch(`/api/admin/validations/exercises/${exercise.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: exercise.name, level: exercise.level, objective: exercise.objective, short_description: exercise.short_description, detailed_description: exercise.detailed_description, equipment: exercise.equipment, validation_rule_text: exercise.validation_rule_text, illustration_url: exercise.illustration_url, is_active: nextStatus }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de sauvegarde.");
      setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, is_active: nextStatus } : item));
      setNotice(`« ${exercise.name} » est désormais ${nextStatus ? "actif" : "inactif"}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde."); }
    finally { setSavingStatusId(""); }
  }
  async function uploadIllustration(file: File) {
    if (!draft) return;
    if (!file.type.startsWith("image/")) { setError("Choisissez une image PNG, JPEG ou WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("L’image est trop lourde (5 Mo maximum)."); return; }
    setUploadingIllustration(true); setError(null); setNotice(null);
    try {
      const token = await getToken(); if (!token) throw new Error("Pas de session.");
      const formData = new FormData(); formData.set("image", file);
      const response = await fetch(`/api/admin/validations/exercises/${draft.id}/image`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur lors de l’import de l’image.");
      updateDraft({ illustration_url: String(data.illustration_url ?? "") || null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur lors de l’import de l’image."); }
    finally { setUploadingIllustration(false); }
  }
  async function saveExercise() {
    if (!draft) return; setSaving(true); setError(null); setNotice(null);
    try {
      const token = await getToken(); if (!token) throw new Error("Pas de session.");
      const response = await fetch(`/api/admin/validations/exercises/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: draft.name, level: draft.level, objective: draft.objective, short_description: draft.short_description, detailed_description: draft.detailed_description, equipment: draft.equipment, validation_rule_text: draft.validation_rule_text, illustration_url: draft.illustration_url, is_active: draft.is_active }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de sauvegarde.");
      setNotice(`« ${draft.name} » a été enregistré.`); setDraft(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde."); }
    finally { setSaving(false); }
  }

  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true"/><span>Gestion des validations</span></nav>
    <div className={styles.topline}><div><h1>Gestion des validations</h1><p>Gérez le référentiel commun des exercices et leurs intitulés pour tous les clubs.</p></div><div className={styles.summary} aria-label={`${exercises.length} exercices configurés`}><ClipboardCheck size={18} aria-hidden="true"/><span><b>{exercises.length}</b> exercice{exercises.length > 1 ? "s" : ""}</span></div></div>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}{notice ? <div className={styles.successAlert} role="status"><Check size={16} aria-hidden="true"/>{notice}</div> : null}
    <section className={styles.panel} aria-labelledby="validations-list-title">
      <div className={styles.panelHeader}><div><h2 id="validations-list-title">Exercices de validation</h2><p>Les modifications sont partagées dans l’ensemble de la plateforme.</p></div></div>
      <div className={styles.toolbar}><label className={styles.searchField}><Search size={16} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un exercice" aria-label="Rechercher un exercice"/></label><label className={styles.filterField}><span>Section</span><select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}><option value="all">Toutes les sections</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label></div>
      <div className={styles.meta}><span>{loading ? "Chargement…" : `${visibleExercises.length} exercice${visibleExercises.length > 1 ? "s" : ""}`}</span><span>{exercises.filter((exercise) => exercise.is_active).length} actif{exercises.filter((exercise) => exercise.is_active).length > 1 ? "s" : ""}</span></div>
      {loading ? <div className={styles.loading} aria-live="polite"><i/><i/><i/><i/></div> : visibleExercises.length === 0 ? <div className={styles.emptyState}><ClipboardCheck size={21} aria-hidden="true"/><strong>Aucun exercice trouvé</strong><span>Modifiez votre recherche ou le filtre de section.</span></div> : <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Exercice</th><th>Section</th><th>Niveau</th><th>Objectif</th><th>État</th><th aria-label="Actions"/></tr></thead><tbody>{visibleExercises.map((exercise) => { const section = sectionById.get(exercise.section_id); const statusSaving = savingStatusId === exercise.id; return <tr key={exercise.id}><td data-label="Exercice"><div className={styles.exerciseName}><span>{exercise.sequence_no}</span><div><b>{exercise.name}</b></div></div></td><td data-label="Section"><span className={styles.sectionTag}>{section?.name ?? "Non classée"}</span></td><td data-label="Niveau">{exercise.level ?? "—"}</td><td data-label="Objectif"><span className={styles.objective}>{exercise.objective || "Non renseigné"}</span></td><td data-label="État"><button type="button" className={`${styles.status} ${styles.statusButton} ${exercise.is_active ? styles.statusActive : styles.statusInactive}`} onClick={() => void toggleExerciseStatus(exercise)} disabled={statusSaving} aria-pressed={exercise.is_active} aria-label={`${exercise.is_active ? "Désactiver" : "Activer"} ${exercise.name}`} title={exercise.is_active ? "Cliquer pour désactiver" : "Cliquer pour activer"}>{statusSaving ? "…" : exercise.is_active ? "Actif" : "Inactif"}</button></td><td className={styles.actionCell} data-label="Actions"><button type="button" className={styles.iconButton} onClick={() => setDraft({ ...exercise })} aria-label={`Modifier ${exercise.name}`} title={`Modifier ${exercise.name}`}><Pencil size={15} aria-hidden="true"/></button></td></tr>; })}</tbody></table></div>}
    </section>
    {draft ? <div className={styles.modalOverlay} role="presentation"><button type="button" className={styles.modalBackdrop} aria-label="Fermer l’édition" onClick={() => !saving && setDraft(null)}/><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="validation-exercise-title"><div className={styles.modalHeader}><div><span className={styles.modalEyebrow}>{sectionById.get(draft.section_id)?.name ?? "Validation"} · exercice {exerciseCode(draft)}</span><h2 id="validation-exercise-title">Modifier l’exercice</h2></div><button type="button" className={styles.closeButton} onClick={() => setDraft(null)} disabled={saving || uploadingIllustration} aria-label="Fermer" title="Fermer"><X size={17} aria-hidden="true"/></button></div><div className={styles.modalBody}><div className={styles.formGrid}><label className={`${styles.field} ${styles.fieldWide}`}><span>Intitulé de l’exercice</span><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} required/></label><label className={styles.field}><span>Niveau</span><input type="number" value={draft.level ?? ""} onChange={(event) => updateDraft({ level: event.target.value === "" ? null : Number(event.target.value) })}/></label><label className={styles.checkField}><input type="checkbox" checked={draft.is_active} onChange={(event) => updateDraft({ is_active: event.target.checked })}/><span><b>Exercice actif</b><small>Visible dans les validations.</small></span></label><label className={`${styles.field} ${styles.fieldWide}`}><span>Objectif</span><input value={emptyText(draft.objective)} onChange={(event) => updateDraft({ objective: event.target.value })}/></label><label className={`${styles.field} ${styles.fieldWide}`}><span>Description courte</span><input value={emptyText(draft.short_description)} onChange={(event) => updateDraft({ short_description: event.target.value })}/></label><label className={`${styles.field} ${styles.fieldWide}`}><span>Description détaillée</span><textarea rows={5} value={emptyText(draft.detailed_description)} onChange={(event) => updateDraft({ detailed_description: event.target.value })}/></label><label className={styles.field}><span>Matériel</span><input value={emptyText(draft.equipment)} onChange={(event) => updateDraft({ equipment: event.target.value })}/></label><label className={`${styles.field} ${styles.fieldWide}`}><span>Règle de validation</span><textarea className={styles.compactTextArea} rows={2} value={emptyText(draft.validation_rule_text)} onChange={(event) => updateDraft({ validation_rule_text: event.target.value })}/></label><div className={`${styles.field} ${styles.fieldWide}`}><span>Illustration</span><div className={styles.illustrationField}>{draft.illustration_url ? <img src={draft.illustration_url} alt={`Illustration de ${draft.name}`} /> : <div className={styles.illustrationEmpty}><ImageIcon size={20} aria-hidden="true"/><span>Aucune image importée</span></div>}<div className={styles.illustrationActions}><input id="validation-illustration" className={styles.visuallyHidden} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingIllustration} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadIllustration(file); }}/><label htmlFor="validation-illustration" className={styles.secondaryButton}>{uploadingIllustration ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true"/> : <ImagePlus size={15} aria-hidden="true"/>}{uploadingIllustration ? "Import en cours…" : draft.illustration_url ? "Remplacer l’image" : "Importer une image"}</label>{draft.illustration_url ? <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ illustration_url: null })} disabled={uploadingIllustration}>Retirer</button> : null}<small>PNG, JPEG ou WebP · 5 Mo maximum.</small></div></div></div></div><div className={styles.referenceNote}><ShieldCheck size={16} aria-hidden="true"/><span>Cette modification sera appliquée à tous les clubs et à leurs juniors.</span></div></div><div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => setDraft(null)} disabled={saving || uploadingIllustration}>Annuler</button><button type="button" className={styles.primaryButton} onClick={() => void saveExercise()} disabled={saving || uploadingIllustration || !draft.name.trim()}>{saving ? "Enregistrement…" : "Enregistrer les modifications"}</button></div></section></div> : null}
  </div>;
}
