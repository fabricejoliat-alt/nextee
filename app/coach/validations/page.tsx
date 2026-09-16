"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, Flag, ImageIcon, Search, ShieldCheck, Target, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { getValidationBadgeLabel, type ValidationExerciseItem, type ValidationSectionItem } from "@/lib/validations";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import styles from "./CoachValidations.module.css";

type Challenger = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type Exercise = ValidationExerciseItem & { challengers: Challenger[] };
type Section = Omit<ValidationSectionItem, "validated_count" | "total_count" | "badge" | "exercises"> & { exercises: Exercise[] };
type SelectedExercise = Exercise & { sectionName: string };

function fullName(player: Challenger) { return `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || "Joueur"; }
function initials(player: Challenger) { return `${player.first_name?.[0] ?? ""}${player.last_name?.[0] ?? ""}`.toUpperCase() || "J"; }

function getValidationBadgeFromCounts(exercises: Exercise[]) {
  const validated = exercises.filter((exercise) => exercise.is_validated).length;
  if (exercises.length > 0 && validated >= exercises.length) return "elite";
  if (validated >= 13) return "gold";
  if (validated >= 10) return "silver";
  if (validated >= 5) return "bronze";
  return "none";
}

export default function CoachValidationsPage() {
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [query, setQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [selectedExercise, setSelectedExercise] = useState<SelectedExercise | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) throw new Error("Pas de session.");
      const response = await fetch("/api/coach/validations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Erreur de chargement.");
      setSections((payload.sections ?? []) as Section[]);
    } catch (cause) {
      setSections([]);
      setError(cause instanceof Error ? cause.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!activeSectionId || !sections.some((section) => section.id === activeSectionId)) setActiveSectionId(sections[0]?.id ?? "");
  }, [activeSectionId, sections]);
  useEffect(() => {
    if (!selectedExercise) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedExercise(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedExercise]);

  const normalizedQuery = query.trim().toLocaleLowerCase("fr");
  const visibleSections = useMemo(() => sections.map((section) => ({ ...section, exercises: [...section.exercises].sort((a, b) => a.sequence_no - b.sequence_no).filter((exercise) => !normalizedQuery || [exercise.name, exercise.objective ?? "", exercise.short_description ?? "", exercise.detailed_description ?? "", exercise.equipment ?? "", exercise.validation_rule_text ?? ""].some((value) => value.toLocaleLowerCase("fr").includes(normalizedQuery)))})).filter((section) => section.exercises.length > 0), [normalizedQuery, sections]);
  const totalExercises = sections.reduce((count, section) => count + section.exercises.length, 0);
  const validatedExercises = sections.reduce((count, section) => count + section.exercises.filter((exercise) => exercise.is_validated).length, 0);
  const displayedSections = activeSectionId ? visibleSections.filter((section) => section.id === activeSectionId) : visibleSections;
  const displayedExercises = displayedSections.reduce((count, section) => count + section.exercises.length, 0);

  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><ChevronRight size={14} aria-hidden="true"/><span>Validations</span></nav>
    <div className={styles.topline}><div><h1>Validations</h1><p>Consultez les défis techniques et les juniors à accompagner dans leur progression.</p></div><div className={styles.summary}><ClipboardCheck size={18} aria-hidden="true"/><span><b>{totalExercises}</b> défi{totalExercises > 1 ? "s" : ""}</span></div></div>
    {error ? <div className={styles.errorAlert} role="alert"><div><b>Impossible de charger les validations.</b><span>{error}</span></div><button type="button" onClick={() => void load()}>Réessayer</button></div> : null}
    <div className={styles.metrics} aria-label="Synthèse des validations"><div><span>Défis disponibles</span><strong>{totalExercises || "—"}</strong><small>Référentiel commun</small></div><div><span>Défis validés</span><strong>{loading ? "—" : validatedExercises}</strong><small>Selon les juniors suivis</small></div><div><span>Secteurs</span><strong>{sections.length || "—"}</strong><small>Putting, petit jeu et plus</small></div></div>
    <section className={styles.catalogPanel} aria-labelledby="validation-catalog-title"><div className={styles.panelHeader}><div><h2 id="validation-catalog-title">Catalogue des validations</h2><p>Recherchez un défi ou consultez les consignes par secteur.</p></div></div><div className={styles.toolbar}><label className={styles.searchField}><Search size={16} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un défi" aria-label="Rechercher un défi"/></label><span className={styles.resultCount}>{loading ? "Chargement…" : `${displayedExercises} défi${displayedExercises > 1 ? "s" : ""}`}</span></div></section>
    {sections.length > 0 ? <ManagerStatisticsTabs<string> items={sections.map((section) => ({ value: section.id, label: section.name }))} value={activeSectionId} onChange={setActiveSectionId} ariaLabel="Secteurs de validation" /> : null}
    {loading ? <div className={styles.skeletons} aria-live="polite"><i/><i/><i/></div> : displayedSections.length === 0 ? <div className={styles.emptyState}><ClipboardCheck size={22} aria-hidden="true"/><strong>Aucun défi trouvé</strong><span>Essayez un autre terme de recherche.</span></div> : <div className={styles.sectionStack}>{displayedSections.map((section) => { const badge = getValidationBadgeFromCounts(section.exercises); const badgeLabel = getValidationBadgeLabel(locale, badge); return <section className={styles.sectionPanel} key={section.id}><header className={styles.sectionHeader}><div><div className={styles.sectionTitleRow}><h2>{section.name}</h2>{badge !== "none" ? <span className={`${styles.badge} ${styles[`badge${badge[0].toUpperCase()}${badge.slice(1)}`]}`}>{badgeLabel}</span> : null}</div><p>{section.exercises.length} défi{section.exercises.length > 1 ? "s" : ""} à consulter</p></div></header><div className={styles.exerciseList}>{section.exercises.map((exercise) => <article className={styles.exerciseRow} key={exercise.id}><div className={styles.exerciseTop}><span className={styles.sequence}>{exercise.sequence_no}</span><div className={styles.exerciseIdentity}><h3>{exercise.name}</h3><span>{exercise.level != null ? `Niveau ${exercise.level}` : "Niveau non défini"}</span></div><button type="button" className={styles.challengerButton} onClick={() => setSelectedExercise({ ...exercise, sectionName: section.name })}><Users size={15} aria-hidden="true"/>Challengers{exercise.challengers.length ? ` (${exercise.challengers.length})` : ""}</button></div><div className={styles.exerciseContent}>{exercise.illustration_url ? <img className={styles.exerciseIllustration} src={exercise.illustration_url} alt={`Illustration : ${exercise.name}`}/> : <div className={styles.exerciseIllustrationEmpty} aria-label="Aucune illustration disponible"><ImageIcon size={18} aria-hidden="true"/><span>Illustration à venir</span></div>}<div className={styles.detailGrid}>{exercise.objective ? <Detail icon={<Target size={14}/>} label="Objectif" value={exercise.objective}/> : null}{exercise.detailed_description || exercise.short_description ? <Detail icon={<ClipboardCheck size={14}/>} label="Consigne" value={exercise.detailed_description || exercise.short_description || ""}/> : null}{exercise.equipment ? <Detail icon={<Flag size={14}/>} label="Matériel" value={exercise.equipment}/> : null}{exercise.validation_rule_text ? <Detail icon={<ShieldCheck size={14}/>} label="Règle de validation" value={exercise.validation_rule_text}/> : null}</div></div></article>)}</div></section>; })}</div>}
    {selectedExercise ? <div className={styles.modalOverlay} role="presentation"><button className={styles.modalBackdrop} type="button" aria-label="Fermer les challengers" onClick={() => setSelectedExercise(null)}/><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="challengers-title"><header className={styles.modalHeader}><div><span className={styles.modalEyebrow}>{selectedExercise.sectionName} · défi {selectedExercise.sequence_no}</span><h2 id="challengers-title">Challengers</h2><p>{selectedExercise.name}</p></div><button type="button" className={styles.closeButton} onClick={() => setSelectedExercise(null)} aria-label="Fermer" title="Fermer"><X size={17} aria-hidden="true"/></button></header><div className={styles.modalBody}>{selectedExercise.challengers.length === 0 ? <div className={styles.modalEmpty}><Users size={21} aria-hidden="true"/><strong>Aucun junior bloqué à ce niveau</strong><span>Les juniors suivis ont validé ce défi ou ne l’ont pas encore atteint.</span></div> : <div className={styles.challengerList}>{selectedExercise.challengers.map((player) => <Link className={styles.challengerRow} href={`/coach/players/${player.id}?returnTo=%2Fcoach%2Fvalidations`} key={player.id}>{player.avatar_url ? <img src={player.avatar_url} alt=""/> : <span className={styles.avatarFallback}>{initials(player)}</span>}<span><b>{fullName(player)}</b><small>Ouvrir le suivi du junior</small></span><ChevronRight size={17} aria-hidden="true"/></Link>)}</div>}</div></section></div> : null}
  </div>;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className={styles.detail}><span>{icon}</span><div><b>{label}</b><p>{value}</p></div></div>;
}
