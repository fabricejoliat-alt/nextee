"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import campsStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/app/manager/training-volume/TrainingVolume.module.css";

type Club = { id: string; name: string };

type VolumeRow = {
  id?: string;
  ftem_code: string;
  level_label: string;
  handicap_label: string;
  handicap_min: string;
  handicap_max: string;
  motivation_text: string;
  minutes_offseason: string;
  minutes_inseason: string;
  sort_order: string;
};

type EditorState = {
  mode: "create" | "edit";
  index: number | null;
  original: VolumeRow | null;
  draft: VolumeRow;
};

type DefaultConfiguration = {
  rows: VolumeRow[];
  seasonMonths: number[];
  offseasonMonths: number[];
};

type EditorErrorKey = "ftem_code" | "level_label" | "handicap_min" | "handicap_max" | "minutes_offseason" | "minutes_inseason" | "sort_order";
type EditorErrors = Partial<Record<EditorErrorKey, string>>;

const MONTHS = [
  { value: 1, label: "Jan", fullLabel: "Janvier" },
  { value: 2, label: "Fév", fullLabel: "Février" },
  { value: 3, label: "Mar", fullLabel: "Mars" },
  { value: 4, label: "Avr", fullLabel: "Avril" },
  { value: 5, label: "Mai", fullLabel: "Mai" },
  { value: 6, label: "Juin", fullLabel: "Juin" },
  { value: 7, label: "Juil", fullLabel: "Juillet" },
  { value: 8, label: "Août", fullLabel: "Août" },
  { value: 9, label: "Sep", fullLabel: "Septembre" },
  { value: 10, label: "Oct", fullLabel: "Octobre" },
  { value: 11, label: "Nov", fullLabel: "Novembre" },
  { value: 12, label: "Déc", fullLabel: "Décembre" },
] as const;

const ALL_MONTHS = MONTHS.map((month) => month.value);

function toRow(input: unknown): VolumeRow {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    id: value.id ? String(value.id) : undefined,
    ftem_code: String(value.ftem_code ?? ""),
    level_label: String(value.level_label ?? ""),
    handicap_label: String(value.handicap_label ?? ""),
    handicap_min: value.handicap_min == null ? "" : String(value.handicap_min),
    handicap_max: value.handicap_max == null ? "" : String(value.handicap_max),
    motivation_text: String(value.motivation_text ?? ""),
    minutes_offseason: value.minutes_offseason == null ? "0" : String(value.minutes_offseason),
    minutes_inseason: value.minutes_inseason == null ? "0" : String(value.minutes_inseason),
    sort_order: value.sort_order == null ? "" : String(value.sort_order),
  };
}

function configurationSnapshot(rows: VolumeRow[], seasonMonths: number[]) {
  return JSON.stringify({
    season_months: [...seasonMonths].sort((left, right) => left - right),
    rows: rows.map((row) => ({
      ftem_code: row.ftem_code,
      level_label: row.level_label,
      handicap_label: row.handicap_label,
      handicap_min: row.handicap_min,
      handicap_max: row.handicap_max,
      motivation_text: row.motivation_text,
      minutes_offseason: row.minutes_offseason,
      minutes_inseason: row.minutes_inseason,
      sort_order: row.sort_order,
    })),
  });
}

function emptyRow(rows: VolumeRow[]): VolumeRow {
  const highestOrder = Math.max(0, ...rows.map((row) => Number(row.sort_order)).filter(Number.isFinite));
  return {
    ftem_code: "",
    level_label: "",
    handicap_label: "",
    handicap_min: "",
    handicap_max: "",
    motivation_text: "",
    minutes_offseason: "0",
    minutes_inseason: "0",
    sort_order: String(highestOrder + 10),
  };
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("fr-CH", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value);
}

function numericHandicapLabel(row: Pick<VolumeRow, "handicap_min" | "handicap_max">) {
  const minimum = optionalNumber(row.handicap_min);
  const maximum = optionalNumber(row.handicap_max);
  if (minimum == null && maximum == null) return "";
  if (minimum != null && Number.isFinite(minimum) && maximum != null && Number.isFinite(maximum)) {
    return minimum === maximum ? formatDecimal(minimum) : `${formatDecimal(minimum)} – ${formatDecimal(maximum)}`;
  }
  if (minimum != null && Number.isFinite(minimum)) return `Dès ${formatDecimal(minimum)}`;
  if (maximum != null && Number.isFinite(maximum)) return `Jusqu’à ${formatDecimal(maximum)}`;
  return "";
}

function handicapDisplay(row: VolumeRow) {
  const label = row.handicap_label.trim();
  if (label) return label.replace(/([+-]?\d+(?:[.,]\d+)?)\s*(?:-|a)\s*([+-]?\d+(?:[.,]\d+)?)/i, "$1 – $2");
  return numericHandicapLabel(row) || "—";
}

function rowWithDerivedHandicap(editor: EditorState) {
  const minimumChanged = editor.original?.handicap_min !== editor.draft.handicap_min;
  const maximumChanged = editor.original?.handicap_max !== editor.draft.handicap_max;
  const deriveLabel = !editor.original || minimumChanged || maximumChanged;
  return {
    ...editor.draft,
    ftem_code: editor.draft.ftem_code.trim().toUpperCase(),
    level_label: editor.draft.level_label.trim(),
    handicap_label: deriveLabel ? numericHandicapLabel(editor.draft) : editor.draft.handicap_label,
    motivation_text: editor.draft.motivation_text.trim(),
  };
}

function validateRow(draft: VolumeRow, rows: VolumeRow[], ignoredIndex: number | null): EditorErrors {
  const errors: EditorErrors = {};
  const code = draft.ftem_code.trim().toUpperCase();
  const order = optionalNumber(draft.sort_order);
  const minimum = optionalNumber(draft.handicap_min);
  const maximum = optionalNumber(draft.handicap_max);
  const offseasonMinutes = optionalNumber(draft.minutes_offseason);
  const inseasonMinutes = optionalNumber(draft.minutes_inseason);

  if (!code) errors.ftem_code = "Le code FTEM est obligatoire.";
  else if (rows.some((row, index) => index !== ignoredIndex && row.ftem_code.trim().toUpperCase() === code)) errors.ftem_code = "Ce code FTEM existe déjà.";
  if (!draft.level_label.trim()) errors.level_label = "Le nom du niveau est obligatoire.";

  if (Number.isNaN(minimum)) errors.handicap_min = "Saisissez une valeur numérique valide.";
  if (Number.isNaN(maximum)) errors.handicap_max = "Saisissez une valeur numérique valide.";
  if (minimum != null && maximum != null && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
    errors.handicap_min = "Le minimum doit être inférieur ou égal au maximum.";
    errors.handicap_max = "Le maximum doit être supérieur ou égal au minimum.";
  }

  if (!errors.handicap_min && !errors.handicap_max && minimum != null && maximum != null) {
    const overlap = rows.find((row, index) => {
      if (index === ignoredIndex) return false;
      const otherMinimum = optionalNumber(row.handicap_min);
      const otherMaximum = optionalNumber(row.handicap_max);
      if (otherMinimum == null || otherMaximum == null || Number.isNaN(otherMinimum) || Number.isNaN(otherMaximum)) return false;
      return minimum <= otherMaximum && maximum >= otherMinimum;
    });
    if (overlap) {
      const message = `Cette plage chevauche le niveau ${overlap.ftem_code}.`;
      errors.handicap_min = message;
      errors.handicap_max = message;
    }
  }

  if (offseasonMinutes == null || Number.isNaN(offseasonMinutes) || offseasonMinutes < 0 || !Number.isInteger(offseasonMinutes)) errors.minutes_offseason = "Saisissez un nombre entier positif ou nul.";
  if (inseasonMinutes == null || Number.isNaN(inseasonMinutes) || inseasonMinutes < 0 || !Number.isInteger(inseasonMinutes)) errors.minutes_inseason = "Saisissez un nombre entier positif ou nul.";
  if (order == null || Number.isNaN(order) || !Number.isInteger(order)) errors.sort_order = "Saisissez un ordre entier.";
  else if (rows.some((row, index) => index !== ignoredIndex && Number(row.sort_order) === order)) errors.sort_order = "Cet ordre est déjà utilisé.";

  return errors;
}

function firstConfigurationError(rows: VolumeRow[]) {
  for (let index = 0; index < rows.length; index += 1) {
    const message = Object.values(validateRow(rows[index], rows, index))[0];
    if (message) return `${rows[index].ftem_code || `Niveau ${index + 1}`} : ${message}`;
  }
  return "";
}

function uniqueDuplicateCode(code: string, rows: VolumeRow[]) {
  const existing = new Set(rows.map((row) => row.ftem_code.trim().toUpperCase()));
  const base = `${code.trim().toUpperCase() || "NIVEAU"}-COPIE`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export default function ManagerTrainingVolumePage() {
  const [clubId, setClubId] = useState("");
  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [seasonMonths, setSeasonMonths] = useState<number[]>([]);
  const [offseasonMonths, setOffseasonMonths] = useState<number[]>([]);
  const [defaultConfiguration, setDefaultConfiguration] = useState<DefaultConfiguration | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErrors, setEditorErrors] = useState<EditorErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const baseline = useRef("");

  const snapshot = useMemo(() => configurationSnapshot(rows, seasonMonths), [rows, seasonMonths]);
  const hasChanges = Boolean(baseline.current) && snapshot !== baseline.current;
  const editorHasChanges = Boolean(editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.original));
  const defaultSnapshot = useMemo(() => defaultConfiguration ? configurationSnapshot(defaultConfiguration.rows, defaultConfiguration.seasonMonths) : "", [defaultConfiguration]);
  const isDefaultConfiguration = Boolean(defaultSnapshot) && snapshot === defaultSnapshot;

  async function authHeader(json = false) {
    const { data } = await supabase.auth.getSession();
    return { ...(json ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadVolume(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/manager/clubs/${selectedClubId}/training-volume`, { headers: await authHeader(), cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? "Erreur de chargement."));
      const incomingSeason = Array.isArray(json?.settings?.season_months) ? json.settings.season_months.map(Number) : [];
      const nextSeason = ALL_MONTHS.filter((month) => incomingSeason.includes(month));
      const nextOffseason = ALL_MONTHS.filter((month) => !nextSeason.includes(month));
      const nextRows = (Array.isArray(json?.rows) ? json.rows : []).map(toRow);
      const incomingDefaultSeason = Array.isArray(json?.defaults?.settings?.season_months) ? json.defaults.settings.season_months.map(Number) : [];
      const nextDefaultSeason = ALL_MONTHS.filter((month) => incomingDefaultSeason.includes(month));
      const nextDefaultOffseason = ALL_MONTHS.filter((month) => !nextDefaultSeason.includes(month));
      const nextDefaultRows = (Array.isArray(json?.defaults?.rows) ? json.defaults.rows : []).map(toRow);
      setSeasonMonths(nextSeason);
      setOffseasonMonths(nextOffseason);
      setRows(nextRows);
      setDefaultConfiguration({ rows: nextDefaultRows, seasonMonths: nextDefaultSeason, offseasonMonths: nextDefaultOffseason });
      setEditor(null);
      setEditorErrors({});
      baseline.current = configurationSnapshot(nextRows, nextSeason);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de chargement.");
      setRows([]);
      setSeasonMonths([]);
      setOffseasonMonths([]);
      setDefaultConfiguration(null);
      baseline.current = "";
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeader(), cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(json?.error ?? "Erreur de chargement du club."));
        const clubs = (Array.isArray(json?.clubs) ? json.clubs : []).map((club: unknown) => {
          const value = club && typeof club === "object" ? club as Record<string, unknown> : {};
          return { id: String(value.id ?? ""), name: String(value.name ?? "Club") } satisfies Club;
        }).filter((club: Club) => Boolean(club.id));
        const activeClubId = clubs[0]?.id ?? "";
        setClubId(activeClubId);
        if (activeClubId) await loadVolume(activeClubId);
        else { setError("Aucun club accessible."); setLoading(false); }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Erreur de chargement.");
        setLoading(false);
      }
    })();
    // The page intentionally uses the first club from the manager context, like the other manager settings pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearFeedback() { setError(""); setSuccess(""); }

  function setMonthState(month: number, inSeason: boolean) {
    clearFeedback();
    setSeasonMonths((current) => inSeason ? [...current.filter((value) => value !== month), month].sort((left, right) => left - right) : current.filter((value) => value !== month));
    setOffseasonMonths((current) => inSeason ? current.filter((value) => value !== month) : [...current.filter((value) => value !== month), month].sort((left, right) => left - right));
  }

  function setAllMonths(inSeason: boolean) {
    clearFeedback();
    setSeasonMonths(inSeason ? [...ALL_MONTHS] : []);
    setOffseasonMonths(inSeason ? [] : [...ALL_MONTHS]);
  }

  function restoreDefaults() {
    if (!defaultConfiguration || isDefaultConfiguration || editor) return;
    if (!window.confirm("Rétablir les périodes et tous les niveaux FTEM avec les valeurs par défaut ?")) return;
    clearFeedback();
    setSeasonMonths([...defaultConfiguration.seasonMonths]);
    setOffseasonMonths([...defaultConfiguration.offseasonMonths]);
    setRows(defaultConfiguration.rows.map((row) => ({ ...row, id: undefined })));
    setEditorErrors({});
    const defaultsNeedSaving = Boolean(baseline.current) && defaultSnapshot !== baseline.current;
    setSuccess(defaultsNeedSaving
      ? "Les valeurs par défaut ont été restaurées. Enregistrez les modifications pour les appliquer."
      : "Les valeurs par défaut ont été restaurées.");
  }

  function openCreate() {
    clearFeedback();
    setEditorErrors({});
    const draft = emptyRow(rows);
    setEditor({ mode: "create", index: null, original: { ...draft }, draft });
  }

  function openEdit(row: VolumeRow, index: number) {
    clearFeedback();
    setEditorErrors({});
    setEditor({ mode: "edit", index, original: { ...row }, draft: { ...row } });
  }

  function openDuplicate(row: VolumeRow) {
    clearFeedback();
    const highestOrder = Math.max(0, ...rows.map((item) => Number(item.sort_order)).filter(Number.isFinite));
    const draft = { ...row, id: undefined, ftem_code: uniqueDuplicateCode(row.ftem_code, rows), level_label: `${row.level_label} (copie)`, sort_order: String(highestOrder + 10) };
    setEditorErrors({});
    setEditor({ mode: "create", index: null, original: { ...draft }, draft });
  }

  function updateDraft(patch: Partial<VolumeRow>) {
    setEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current);
    setEditorErrors({});
    clearFeedback();
  }

  function commitEditor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const validation = validateRow(editor.draft, rows, editor.mode === "edit" ? editor.index : null);
    setEditorErrors(validation);
    if (Object.keys(validation).length > 0) return;
    const committed = rowWithDerivedHandicap(editor);
    setRows((current) => {
      const next = editor.mode === "edit" && editor.index != null ? current.map((row, index) => index === editor.index ? committed : row) : [...current, committed];
      return next.sort((left, right) => Number(left.sort_order) - Number(right.sort_order));
    });
    setEditor(null);
    setEditorErrors({});
  }

  function removeRow(row: VolumeRow, index: number) {
    if (!window.confirm(`Supprimer le niveau « ${row.ftem_code} — ${row.level_label} » ?`)) return;
    clearFeedback();
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    if (editor?.mode === "edit" && editor.index === index) setEditor(null);
  }

  function moveEditedRow(direction: -1 | 1) {
    if (!editor || editor.mode !== "edit" || editor.index == null) return;
    const currentIndex = editor.index;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    clearFeedback();
    setRows((current) => {
      const next = [...current];
      [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
      return next.map((row, index) => ({ ...row, sort_order: String((index + 1) * 10) }));
    });
    setEditor((current) => current ? { ...current, index: targetIndex, draft: { ...current.draft, sort_order: String((targetIndex + 1) * 10) } } : current);
  }

  async function saveAll() {
    if (!clubId || !hasChanges || editor) return;
    const validationError = firstConfigurationError(rows);
    if (validationError) { setError(validationError); setSuccess(""); return; }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/training-volume`, {
        method: "PUT",
        headers: await authHeader(true),
        body: JSON.stringify({
          season_months: seasonMonths,
          offseason_months: offseasonMonths,
          rows: rows.map((row) => ({
            ftem_code: row.ftem_code.trim().toUpperCase(), level_label: row.level_label.trim(), handicap_label: row.handicap_label,
            handicap_min: row.handicap_min, handicap_max: row.handicap_max, motivation_text: row.motivation_text.trim(),
            minutes_offseason: row.minutes_offseason, minutes_inseason: row.minutes_inseason, sort_order: row.sort_order,
          })),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? "Erreur de sauvegarde."));
      baseline.current = configurationSnapshot(rows, seasonMonths);
      setSuccess("Les périodes et les niveaux FTEM ont été enregistrés.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  const errorMessages = Object.values(editorErrors);

  return <main className={campsStyles.page}>
    <nav className={campsStyles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/manager">Manager</Link><ChevronRight size={13} /><span>Paramètres</span><ChevronRight size={13} /><span>Volume d’entraînement</span></nav>
    <div className={campsStyles.topline}>
      <div><h1>Volume d’entraînement</h1><p className={campsStyles.lead}>Configurez les périodes de saison et les objectifs mensuels des niveaux FTEM.</p></div>
      <div className={campsStyles.actions}>{hasChanges || editorHasChanges ? <span className={styles.unsaved}>Modifications non enregistrées</span> : null}<button type="button" className={campsStyles.secondary} disabled={loading || saving || Boolean(editor) || !defaultConfiguration || isDefaultConfiguration} onClick={restoreDefaults}><RotateCcw size={16} />Rétablir les valeurs par défaut</button><button type="button" className={campsStyles.primary} disabled={!hasChanges || saving || loading || Boolean(editor)} onClick={() => void saveAll()}><Save size={16} />{saving ? "Enregistrement…" : "Enregistrer les modifications"}</button></div>
    </div>
    {error ? <div className={campsStyles.alertError} role="alert">{error}</div> : null}
    {success ? <div className={campsStyles.alertSuccess} role="status">{success}</div> : null}

    {loading ? <section className={campsStyles.panel}><ListLoadingBlock label="Chargement du volume d’entraînement…" /></section> : <>
      <section className={campsStyles.panel}>
        <div className={campsStyles.panelHeader}><div><h2>Périodes d’entraînement</h2><p>Définissez si chaque mois appartient à la saison ou à la période hors saison.</p></div><div className={campsStyles.actions}><button type="button" className={campsStyles.secondary} onClick={() => setAllMonths(true)}>Tout en saison</button><button type="button" className={campsStyles.secondary} onClick={() => setAllMonths(false)}>Tout hors saison</button></div></div>
        <div className={styles.monthGrid} aria-label="Période de chaque mois">{MONTHS.map((month) => {
          const inSeason = seasonMonths.includes(month.value);
          return <button key={month.value} type="button" role="switch" aria-checked={inSeason} aria-label={`${month.fullLabel} : ${inSeason ? "en saison" : "hors saison"}`} className={`${styles.month} ${inSeason ? styles.monthInSeason : styles.monthOffseason}`} onClick={() => setMonthState(month.value, !inSeason)}><span className={styles.monthName}>{month.label}</span><span className={styles.monthState}>{inSeason ? "En saison" : "Hors saison"}</span></button>;
        })}</div>
      </section>

      {editor ? <form className={campsStyles.panel} onSubmit={commitEditor} noValidate>
        <div className={campsStyles.panelHeader}><div><h2>{editor.mode === "create" ? "Ajouter un niveau FTEM" : `Modifier ${editor.draft.ftem_code}`}</h2><p>Les changements seront appliqués localement, puis enregistrés avec l’action générale de la page.</p></div><button type="button" className={campsStyles.iconButton} title="Fermer" aria-label="Fermer le formulaire" disabled={saving} onClick={() => { setEditor(null); setEditorErrors({}); }}><X size={16} /></button></div>
        {errorMessages.length > 1 ? <div className={campsStyles.alertError} role="alert"><div><strong>Corrigez les champs suivants :</strong><ul className={styles.errorList}>{Array.from(new Set(errorMessages)).map((message) => <li key={message}>{message}</li>)}</ul></div></div> : null}
        <div className={styles.editorGrid}>
          <Field label="Code FTEM" required error={editorErrors.ftem_code}><input value={editor.draft.ftem_code} onChange={(event) => updateDraft({ ftem_code: event.target.value })} /></Field>
          <Field label="Ordre" required error={editorErrors.sort_order}><input type="number" step="1" value={editor.draft.sort_order} onChange={(event) => updateDraft({ sort_order: event.target.value })} /></Field>
          <Field label="Nom du niveau" required full error={editorErrors.level_label}><input value={editor.draft.level_label} onChange={(event) => updateDraft({ level_label: event.target.value })} /></Field>
          <Field label="Handicap minimum" error={editorErrors.handicap_min}><input type="number" step="0.1" value={editor.draft.handicap_min} onChange={(event) => updateDraft({ handicap_min: event.target.value })} /></Field>
          <Field label="Handicap maximum" error={editorErrors.handicap_max}><input type="number" step="0.1" value={editor.draft.handicap_max} onChange={(event) => updateDraft({ handicap_max: event.target.value })} /></Field>
          <Field label="Minutes par mois hors saison" required error={editorErrors.minutes_offseason}><input type="number" min="0" step="1" value={editor.draft.minutes_offseason} onChange={(event) => updateDraft({ minutes_offseason: event.target.value })} /></Field>
          <Field label="Minutes par mois en saison" required error={editorErrors.minutes_inseason}><input type="number" min="0" step="1" value={editor.draft.minutes_inseason} onChange={(event) => updateDraft({ minutes_inseason: event.target.value })} /></Field>
          <Field label="Phrase de motivation" full><textarea rows={4} value={editor.draft.motivation_text} onChange={(event) => updateDraft({ motivation_text: event.target.value })} /></Field>
        </div>
        <div className={styles.editorFooter}><div className={campsStyles.actions}>{editor.mode === "edit" ? <><button type="button" className={campsStyles.secondary} disabled={saving || editor.index === 0} onClick={() => moveEditedRow(-1)}><ArrowUp size={15} />Monter</button><button type="button" className={campsStyles.secondary} disabled={saving || editor.index === rows.length - 1} onClick={() => moveEditedRow(1)}><ArrowDown size={15} />Descendre</button></> : null}</div><div className={campsStyles.actions}><button type="button" className={campsStyles.secondary} disabled={saving} onClick={() => { setEditor(null); setEditorErrors({}); }}>Annuler</button><button type="submit" className={campsStyles.primary} disabled={saving}>{editor.mode === "create" ? "Ajouter le niveau" : "Enregistrer le niveau"}</button></div></div>
      </form> : null}

      <section className={campsStyles.panel}>
        <div className={campsStyles.panelHeader}><div><h2>Niveaux FTEM</h2><p>{rows.length} niveau{rows.length > 1 ? "x" : ""} configuré{rows.length > 1 ? "s" : ""}.</p></div><button type="button" className={campsStyles.primary} disabled={saving || Boolean(editor)} onClick={openCreate}><Plus size={16} />Ajouter un niveau</button></div>
        {rows.length === 0 ? <div className={styles.emptyState}><div className={campsStyles.empty}>Aucun niveau FTEM n’est configuré.</div><button type="button" className={campsStyles.primary} disabled={saving || Boolean(editor)} onClick={openCreate}><Plus size={16} />Ajouter un niveau</button></div> : <div className={campsStyles.tableWrap}>
          <table className={`${campsStyles.table} ${styles.table}`}><thead><tr><th>FTEM</th><th>Niveau</th><th>Handicap</th><th>Hors saison</th><th>En saison</th><th>Motivation</th><th>Ordre</th><th>Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? `${row.ftem_code}-${index}`}>
            <td data-label="FTEM"><span className={styles.ftemCode}>{row.ftem_code || "—"}</span></td>
            <td data-label="Niveau"><div className={campsStyles.titleCell}><b>{row.level_label || "Sans nom"}</b></div></td>
            <td data-label="Handicap"><span className={styles.compactValue}>{handicapDisplay(row)}</span></td>
            <td data-label="Hors saison"><span className={styles.compactValue}>{row.minutes_offseason} min/mois</span></td>
            <td data-label="En saison"><span className={styles.compactValue}>{row.minutes_inseason} min/mois</span></td>
            <td data-label="Motivation"><span className={styles.motivation} title={row.motivation_text || undefined}>{row.motivation_text || "—"}</span></td>
            <td data-label="Ordre"><span className={styles.order}>{row.sort_order}</span></td>
            <td data-label="Actions"><div className={campsStyles.actions}><button type="button" className={campsStyles.iconButton} title="Modifier" aria-label={`Modifier ${row.ftem_code} — ${row.level_label}`} disabled={saving || Boolean(editor)} onClick={() => openEdit(row, index)}><Pencil size={15} /></button><button type="button" className={campsStyles.iconButton} title="Dupliquer" aria-label={`Dupliquer ${row.ftem_code} — ${row.level_label}`} disabled={saving || Boolean(editor)} onClick={() => openDuplicate(row)}><Copy size={15} /></button><button type="button" className={`${campsStyles.iconButton} ${campsStyles.dangerIcon}`} title="Supprimer" aria-label={`Supprimer ${row.ftem_code} — ${row.level_label}`} disabled={saving || Boolean(editor)} onClick={() => removeRow(row, index)}><Trash2 size={15} /></button></div></td>
          </tr>)}</tbody></table>
        </div>}
      </section>
    </>}
  </main>;
}

function Field({ label, required, full, error, children }: { label: string; required?: boolean; full?: boolean; error?: string; children: React.ReactNode }) {
  return <label className={`${campsStyles.field} ${full ? styles.fieldFull : ""}`}><span>{label}{required ? <span className={campsStyles.required}> *</span> : null}</span>{children}{error ? <small className={campsStyles.errorText} role="alert">{error}</small> : null}</label>;
}
