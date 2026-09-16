"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import EvaluationResponseField from "@/components/evaluations/EvaluationResponseField";
import {
  EVALUATION_ACTIVITY_TYPES,
  EVALUATION_DOMAINS,
  defaultEvaluationChoices,
  type EvaluationChoice,
  type EvaluationCriterion,
  type EvaluationResponseFormat,
  type EvaluationRespondent,
} from "@/lib/evaluationCriteria";
import styles from "@/app/manager/camps/Camps.module.css";

type Club = { id: string; name: string | null };
type Draft = Omit<EvaluationCriterion, "id" | "club_id" | "archived_at" | "used_count">;

const RESPONDENTS: Array<{ value: EvaluationRespondent; label: string }> = [
  { value: "coach", label: "Coach envers le joueur" }, { value: "player", label: "Joueur en auto-évaluation" }, { value: "both", label: "Les deux" },
];
const FORMATS: Array<{ value: EvaluationResponseFormat; label: string }> = [
  { value: "scale_1_6", label: "Échelle de 1 à 6" }, { value: "delta", label: "-1 / 0 / +1" },
  { value: "sentiment", label: "Négatif / neutre / positif" }, { value: "feeling", label: "Ressenti avec pictogrammes" },
  { value: "yes_no", label: "Oui / non" }, { value: "short_text", label: "Texte court" },
];
const TYPE_LABELS: Record<string, string> = { training: "Entraînement", interclub: "Interclub", camp: "Stage/camp", session: "Séance", event: "Événement", competition: "Compétition" };

function freshDraft(order = 10): Draft {
  return { name: "", description: null, respondent: "coach", response_format: "scale_1_6", choices_json: defaultEvaluationChoices("scale_1_6"), activity_types: ["training"], domain_key: "technique", domain_label: "Technique", is_required: false, is_active: true, sort_order: order };
}

export default function EvaluationCriteriaPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(freshDraft());

  async function token() { return (await supabase.auth.getSession()).data.session?.access_token ?? ""; }
  async function loadClubs() {
    const response = await fetch("/api/manager/my-clubs", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error ?? "Chargement impossible.");
    const next = (json.clubs ?? []) as Club[]; setClubs(next); setClubId((value) => value || next[0]?.id || "");
  }
  async function loadCriteria(id: string) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/manager/clubs/${id}/evaluation-criteria`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? "Chargement impossible.");
      setCriteria(json.criteria ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Chargement impossible."); } finally { setLoading(false); }
  }
  // Initial manager context is loaded once; the selected club drives the list query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadClubs().catch((e) => { setError(e.message); setLoading(false); }); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (clubId) void loadCriteria(clubId); }, [clubId]);

  const selectedDomain = useMemo(() => EVALUATION_DOMAINS.find((domain) => domain.value === draft.domain_key), [draft.domain_key]);
  function openNew(source?: EvaluationCriterion) {
    setEditingId(source ? "duplicate" : "new");
    setDraft(source ? { name: `${source.name} (copie)`, description: source.description, respondent: source.respondent, response_format: source.response_format, choices_json: source.choices_json.map((choice) => ({ ...choice })), activity_types: [...source.activity_types], domain_key: source.domain_key, domain_label: source.domain_label, is_required: source.is_required, is_active: true, sort_order: source.sort_order + 1 } : freshDraft((criteria.at(-1)?.sort_order ?? 0) + 10));
    setError(""); setSuccess("");
  }
  function openEdit(row: EvaluationCriterion) {
    setEditingId(row.id); setDraft({ name: row.name, description: row.description, respondent: row.respondent, response_format: row.response_format, choices_json: row.choices_json.map((choice) => ({ ...choice })), activity_types: [...row.activity_types], domain_key: row.domain_key, domain_label: row.domain_label, is_required: row.is_required, is_active: row.is_active, sort_order: row.sort_order });
  }
  function setFormat(format: EvaluationResponseFormat) { setDraft((current) => ({ ...current, response_format: format, choices_json: defaultEvaluationChoices(format) })); }
  async function save() {
    if (!draft.name.trim() || !draft.activity_types.length) { setError("Le nom et au moins un type d’activité sont requis."); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const isUpdate = editingId && !["new", "duplicate"].includes(editingId);
      const response = await fetch(`/api/manager/clubs/${clubId}/evaluation-criteria${isUpdate ? `/${editingId}` : ""}`, { method: isUpdate ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ ...draft, domain_label: selectedDomain?.label ?? draft.domain_label }) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? "Enregistrement impossible.");
      setEditingId(null); setSuccess(isUpdate ? "Critère modifié." : "Critère créé."); await loadCriteria(clubId);
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); } finally { setBusy(false); }
  }
  async function mutate(row: EvaluationCriterion, action: "toggle" | "archive" | "delete") {
    const destructive = action === "delete" ? "supprimer définitivement" : action === "archive" ? "archiver" : null;
    if (destructive && !window.confirm(`Voulez-vous ${destructive} « ${row.name} » ?`)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const deleting = action === "delete";
      const response = await fetch(`/api/manager/clubs/${clubId}/evaluation-criteria/${row.id}`, { method: deleting ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: deleting ? undefined : JSON.stringify(action === "archive" ? { action: "archive" } : { ...row, is_active: !row.is_active }) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? "Action impossible.");
      setSuccess(deleting ? "Critère supprimé." : action === "archive" ? "Critère archivé. Son historique est conservé." : "Statut mis à jour."); await loadCriteria(clubId);
    } catch (e) { setError(e instanceof Error ? e.message : "Action impossible."); } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <div className={styles.breadcrumb}><span>PARAMÈTRES</span><span>›</span><span>CRITÈRES D’ÉVALUATION</span></div>
    <div className={styles.topline}><div><h1>Critères d’évaluation</h1><p className={styles.lead}>Définissez les priorités propres au club. Les six critères standards restent toujours disponibles.</p></div><div className={styles.actions}><button className={styles.primary} onClick={() => openNew()}><Plus size={16}/>Créer un critère</button></div></div>
    {error ? <div className={styles.alertError}>{error}</div> : null}{success ? <div className={styles.alertSuccess}>{success}</div> : null}
    {clubs.length > 1 ? <label className={styles.field}><span>Club</span><select value={clubId} onChange={(e) => setClubId(e.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? "Club"}</option>)}</select></label> : null}
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>Critères personnalisés</h2><p>Actifs, inactifs et archivés. Un critère utilisé ne peut plus être supprimé.</p></div></div>
      {loading ? <div className={styles.empty}>Chargement…</div> : criteria.length === 0 ? <div className={styles.empty}>Aucun critère personnalisé. Créez votre premier focus d’activité.</div> : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.criteriaTable}`}>
            <thead><tr><th>Nom</th><th>Évaluateur</th><th>Format</th><th>Types d’activité</th><th>Domaine</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>{criteria.map((row) => (
              <tr key={row.id}>
                <td data-label="Nom"><div className={styles.titleCell}><b>{row.name}</b><span className={styles.muted}>{row.description || "Sans consigne"}</span></div></td>
                <td data-label="Évaluateur">{RESPONDENTS.find((item) => item.value === row.respondent)?.label}</td>
                <td data-label="Format">{FORMATS.find((item) => item.value === row.response_format)?.label}</td>
                <td data-label="Types">{row.activity_types.map((type) => TYPE_LABELS[type] ?? type).join(", ")}</td>
                <td data-label="Domaine">{row.domain_label}</td>
                <td data-label="Statut"><span className={`${styles.badge} ${row.archived_at ? styles.badgeArchived : !row.is_active ? styles.badgeDraft : ""}`}>{row.archived_at ? "Archivé" : row.is_active ? "Actif" : "Inactif"}</span></td>
                <td data-label="Actions"><div className={styles.actions}><button className={styles.iconButton} title="Modifier" onClick={() => openEdit(row)}><Pencil size={15}/></button><button className={styles.iconButton} title="Dupliquer" onClick={() => openNew(row)}><Copy size={15}/></button>{!row.archived_at ? <><button className={styles.iconButton} title={row.is_active ? "Désactiver" : "Activer"} onClick={() => void mutate(row, "toggle")}>{row.is_active ? "ON" : "OFF"}</button>{row.used_count ? <button className={`${styles.iconButton} ${styles.dangerIcon}`} title="Archiver" onClick={() => void mutate(row, "archive")}><Archive size={15}/></button> : <button className={`${styles.iconButton} ${styles.dangerIcon}`} title="Supprimer" onClick={() => void mutate(row, "delete")}><Trash2 size={15}/></button>}</> : null}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
    {editingId ? <section className={styles.panel} aria-label="Formulaire du critère"><div className={styles.panelHeader}><div><h2>{editingId === "new" || editingId === "duplicate" ? "Nouveau critère" : "Modifier le critère"}</h2><p>Les critères personnalisés sont facultatifs par défaut.</p></div><button className={styles.iconButton} onClick={() => setEditingId(null)}><X size={16}/></button></div>
      <div className={styles.grid2}><label className={styles.field}><span>Nom <b className={styles.required}>*</b></span><input value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label><label className={styles.field}><span>Évaluateur</span><select value={draft.respondent} onChange={(e) => setDraft({ ...draft, respondent: e.target.value as EvaluationRespondent })}>{RESPONDENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      <label className={styles.field}><span>Description / consigne</span><textarea maxLength={500} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}/></label>
      <div className={styles.grid3}><label className={styles.field}><span>Format</span><select value={draft.response_format} onChange={(e) => setFormat(e.target.value as EvaluationResponseFormat)}>{FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className={styles.field}><span>Domaine</span><select value={draft.domain_key} onChange={(e) => { const domain = EVALUATION_DOMAINS.find((item) => item.value === e.target.value); setDraft({ ...draft, domain_key: e.target.value, domain_label: domain?.label ?? e.target.value }); }}>{EVALUATION_DOMAINS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className={styles.field}><span>Ordre</span><input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}/></label></div>
      <div className={styles.selectionBlock}><span className={styles.muted}>Types d’activité</span><div className={styles.pillRow}>{EVALUATION_ACTIVITY_TYPES.map((type) => <label className={styles.check} key={type}><input type="checkbox" checked={draft.activity_types.includes(type)} onChange={(e) => setDraft({ ...draft, activity_types: e.target.checked ? [...draft.activity_types, type] : draft.activity_types.filter((value) => value !== type) })}/>{TYPE_LABELS[type]}</label>)}</div></div>
      {draft.response_format !== "short_text" ? <div className={styles.grid3}>{draft.choices_json.map((choice, index) => <label className={styles.field} key={`${choice.value}-${index}`}><span>Libellé « {String(choice.value)} »</span><input value={choice.label} onChange={(e) => setDraft({ ...draft, choices_json: draft.choices_json.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) })}/></label>)}</div> : null}
      <div className={styles.dayCard}><div className={styles.sectionTitle}><h3>Prévisualisation</h3><p>{draft.name || "Nom du critère"}{draft.is_required ? " · Obligatoire" : " · Facultatif"}</p></div><EvaluationResponseField name={draft.name || "Aperçu"} format={draft.response_format} choices={draft.choices_json as EvaluationChoice[]} value={null} onChange={() => {}}/></div>
      <div className={styles.pillRow}><label className={styles.check}><input type="checkbox" checked={draft.is_required} onChange={(e) => setDraft({ ...draft, is_required: e.target.checked })}/>Obligatoire</label><label className={styles.check}><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}/>Actif</label></div>
      <div className={styles.actions}><button className={styles.secondary} onClick={() => setEditingId(null)}>Annuler</button><button className={styles.primary} disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
    </section> : null}
  </div>;
}
