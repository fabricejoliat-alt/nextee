"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerSettingsPresentation } from "@/lib/managerSettingsPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useManagerClubChangeGuard } from "@/components/manager/useManagerClubChangeGuard";
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

const ALL_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

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

function uniqueDuplicateCode(code: string, rows: VolumeRow[]) {
  const existing = new Set(rows.map((row) => row.ftem_code.trim().toUpperCase()));
  const base = `${code.trim().toUpperCase() || "NIVEAU"}-COPIE`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export default function ManagerTrainingVolumePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requestedClubId = params.get("club") ?? "";
  const { format, count, errorText } = managerSettingsPresentation(t, locale);
  const MONTHS = ALL_MONTHS.map((value) => ({ value,
    label: new Intl.DateTimeFormat(managerLocaleTag(locale), { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, value - 1, 15))),
    fullLabel: new Intl.DateTimeFormat(managerLocaleTag(locale), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, value - 1, 15))),
  }));
  function formatDecimal(value: number) {
    return new Intl.NumberFormat(managerLocaleTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value);
  }

  function numericHandicapLabel(row: Pick<VolumeRow, "handicap_min" | "handicap_max">) {
    const minimum = optionalNumber(row.handicap_min);
    const maximum = optionalNumber(row.handicap_max);
    if (minimum == null && maximum == null) return "";
    if (minimum != null && Number.isFinite(minimum) && maximum != null && Number.isFinite(maximum)) {
      return minimum === maximum ? formatDecimal(minimum) : `${formatDecimal(minimum)} – ${formatDecimal(maximum)}`;
    }
    if (minimum != null && Number.isFinite(minimum)) return format("volume.from", { value: formatDecimal(minimum) });
    if (maximum != null && Number.isFinite(maximum)) return format("volume.upTo", { value: formatDecimal(maximum) });
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

    if (!code) errors.ftem_code = t("manager.settings.volume.codeRequired");
    else if (rows.some((row, index) => index !== ignoredIndex && row.ftem_code.trim().toUpperCase() === code)) errors.ftem_code = t("manager.settings.volume.duplicateCode");
    if (!draft.level_label.trim()) errors.level_label = t("manager.settings.volume.nameRequired");

    if (Number.isNaN(minimum)) errors.handicap_min = t("manager.settings.volume.validNumber");
    if (Number.isNaN(maximum)) errors.handicap_max = t("manager.settings.volume.validNumber");
    if (minimum != null && maximum != null && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > maximum) {
      errors.handicap_min = t("manager.settings.volume.minOrder");
      errors.handicap_max = t("manager.settings.volume.maxOrder");
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
        const message = format("volume.overlap", { code: overlap.ftem_code });
        errors.handicap_min = message;
        errors.handicap_max = message;
      }
    }

    if (offseasonMinutes == null || Number.isNaN(offseasonMinutes) || offseasonMinutes < 0 || !Number.isInteger(offseasonMinutes)) errors.minutes_offseason = t("manager.settings.volume.nonnegativeInteger");
    if (inseasonMinutes == null || Number.isNaN(inseasonMinutes) || inseasonMinutes < 0 || !Number.isInteger(inseasonMinutes)) errors.minutes_inseason = t("manager.settings.volume.nonnegativeInteger");
    if (order == null || Number.isNaN(order) || !Number.isInteger(order)) errors.sort_order = t("manager.settings.volume.integerOrder");
    else if (rows.some((row, index) => index !== ignoredIndex && Number(row.sort_order) === order)) errors.sort_order = t("manager.settings.volume.duplicateOrder");

    return errors;
  }

  function firstConfigurationError(rows: VolumeRow[]) {
    for (let index = 0; index < rows.length; index += 1) {
      const message = Object.values(validateRow(rows[index], rows, index))[0];
      if (message) return `${rows[index].ftem_code || format("volume.levelNumber", { number: index + 1 })} : ${message}`;
    }
    return "";
  }

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubsError, setClubsError] = useState(false);
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
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
  const loadSequence = useRef(0);
  const activeClubRef = useRef(clubId);
  activeClubRef.current = clubId;
  const [loadedClubId, setLoadedClubId] = useState("");
  const scopeReady = Boolean(clubId && loadedClubId === clubId && !loading && !error);
  const selectionKey = clubId || (requestedClubId ? `invalid:${requestedClubId}` : "none");

  const snapshot = useMemo(
    () => configurationSnapshot(rows, seasonMonths),
    [rows, seasonMonths]
  );
  const hasChanges = scopeReady && Boolean(baseline.current) && snapshot !== baseline.current;
  useManagerClubChangeGuard(Boolean(hasChanges || editor), t("manager.settings.volume.discardDraft"), saving);
  const editorHasChanges = scopeReady && Boolean(editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.original));
  const defaultSnapshot = useMemo(
    () => defaultConfiguration ? configurationSnapshot(defaultConfiguration.rows, defaultConfiguration.seasonMonths) : "",
    [defaultConfiguration]
  );
  const isDefaultConfiguration = Boolean(defaultSnapshot) && snapshot === defaultSnapshot;

  async function authHeader(json = false) {
    const { data } = await supabase.auth.getSession();
    return { ...(json ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadVolume(selectedClubId: string) {
    if (!selectedClubId) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    setSuccess("");
    setLoadedClubId("");
    setRows([]);
    setSeasonMonths([]);
    setOffseasonMonths([]);
    setDefaultConfiguration(null);
    setEditor(null);
    setEditorErrors({});
    baseline.current = "";
    try {
      const response = await fetch(`/api/manager/clubs/${selectedClubId}/training-volume`, { headers: await authHeader(), cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.loadError")));
      if (sequence !== loadSequence.current || activeClubRef.current !== selectedClubId) return;
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
      if (sequence !== loadSequence.current || activeClubRef.current !== selectedClubId) return;
      setError(cause instanceof Error ? cause.message : t("manager.settings.loadError"));
      setRows([]);
      setSeasonMonths([]);
      setOffseasonMonths([]);
      setDefaultConfiguration(null);
      baseline.current = "";
    } finally {
      if (sequence === loadSequence.current && activeClubRef.current === selectedClubId) { setLoadedClubId(selectedClubId); setLoading(false); }
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeader(), cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.clubLoadError")));
        const nextClubs = (Array.isArray(json?.clubs) ? json.clubs : []).map((club: unknown) => {
          const value = club && typeof club === "object" ? club as Record<string, unknown> : {};
          return { id: String(value.id ?? ""), name: String(value.name ?? t("manager.settings.club")) } satisfies Club;
        }).filter((club: Club) => Boolean(club.id));
        setClubs(nextClubs);
        setClubsLoaded(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("manager.settings.loadError"));
        setClubsError(true);
        setClubsLoaded(true);
        setLoading(false);
      }
    })();
    // Fetch the club list once; changing language must preserve the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubsLoaded || clubsError) return;
    if (clubId) void loadVolume(clubId);
    else { ++loadSequence.current; setLoadedClubId(""); setRows([]); setSeasonMonths([]); setOffseasonMonths([]); setDefaultConfiguration(null); baseline.current = ""; setError(t(requestedClubId ? "manager.clubUnavailable" : "manager.settings.noClub")); setLoading(false); }
    // The URL club determines the scope; a late response for another club is ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubsLoaded, clubsError, selectionKey]);

  function selectClub(id: string) {
    if (id === clubId || !clubs.some((club) => club.id === id) || saving) return;
    if ((hasChanges || editor) && !window.confirm(t("manager.settings.volume.discardDraft"))) return;
    const next = new URLSearchParams(params.toString()); next.set("club", id);
    router.replace(`/manager/training-volume?${next}`, { scroll: false });
  }

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
    if (!window.confirm(t("manager.settings.volume.restoreConfirm"))) return;
    clearFeedback();
    setSeasonMonths([...defaultConfiguration.seasonMonths]);
    setOffseasonMonths([...defaultConfiguration.offseasonMonths]);
    setRows(defaultConfiguration.rows.map((row) => ({ ...row, id: undefined })));
    setEditorErrors({});
    const defaultsNeedSaving = Boolean(baseline.current) && defaultSnapshot !== baseline.current;
    setSuccess(defaultsNeedSaving
      ? t("manager.settings.volume.restoredPending")
      : t("manager.settings.volume.restored"));
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
    const draft = { ...row, id: undefined, ftem_code: uniqueDuplicateCode(row.ftem_code, rows), level_label: format("volume.copyName", { name: row.level_label }), sort_order: String(highestOrder + 10) };
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
    if (!window.confirm(format("volume.deleteConfirm", { name: `${row.ftem_code} — ${row.level_label}` }))) return;
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
    if (!scopeReady || !hasChanges || editor || saving) return;
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
      if (!response.ok) throw new Error(String(json?.error ?? t("manager.settings.saveError")));
      if (activeClubRef.current === clubId) { baseline.current = configurationSnapshot(rows, seasonMonths); setSuccess(t("manager.settings.volume.saved")); }
    } catch (cause) {
      if (activeClubRef.current === clubId) setError(cause instanceof Error ? cause.message : t("manager.settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // Recompute displayed validation in the active language while retaining the draft.
  const displayedErrors = editor && Object.keys(editorErrors).length ? validateRow(editor.draft, rows, editor.mode === "edit" ? editor.index : null) : {};
  const errorMessages = Object.values(displayedErrors);

  return <main className={campsStyles.page}>
    <nav className={campsStyles.breadcrumb} aria-label={t("manager.settings.breadcrumb")}><Link href="/manager">{t("manager.settings.manager")}</Link><ChevronRight size={13} /><span>{t("manager.settings.settings")}</span><ChevronRight size={13} /><span>{t("manager.settings.volume.title")}</span></nav>
    <div className={campsStyles.topline}>
      <div><h1>{t("manager.settings.volume.title")}</h1><p className={campsStyles.lead}>{t("manager.settings.volume.lead")}</p></div>
      <div className={campsStyles.actions}><label className="groups-season-nav-select"><select aria-label={t("common.club")} value={clubId} onChange={(event) => selectClub(event.target.value)} disabled={!clubsLoaded || saving || !clubs.length}>{!clubId ? <option value="">{t(clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>{hasChanges || editorHasChanges ? <span className={styles.unsaved}>{t("manager.settings.volume.unsaved")}</span> : null}<button type="button" className={campsStyles.secondary} disabled={!scopeReady || saving || Boolean(editor) || !defaultConfiguration || isDefaultConfiguration} onClick={restoreDefaults}><RotateCcw size={16} />{t("manager.settings.volume.restore")}</button><button type="button" className={campsStyles.primary} disabled={!hasChanges || saving || loading || Boolean(editor)} onClick={() => void saveAll()}><Save size={16} />{saving ? t("manager.settings.saving") : t("manager.settings.volume.saveChanges")}</button></div>
    </div>
    {error ? <div className={campsStyles.alertError} role="alert">{errorText(error)}</div> : null}
    {success ? <div className={campsStyles.alertSuccess} role="status">{errorText(success)}</div> : null}

    {loading || (clubId && !error && !scopeReady) ? <section className={campsStyles.panel}><ListLoadingBlock label={t("manager.settings.volume.loading")} /></section> : scopeReady ? <>
      <section className={campsStyles.panel}>
        <div className={campsStyles.panelHeader}><div><h2>{t("manager.settings.volume.periods")}</h2><p>{t("manager.settings.volume.periodsHelp")}</p></div><div className={campsStyles.actions}><button type="button" className={campsStyles.secondary} onClick={() => setAllMonths(true)}>{t("manager.settings.volume.allInSeason")}</button><button type="button" className={campsStyles.secondary} onClick={() => setAllMonths(false)}>{t("manager.settings.volume.allOffseason")}</button></div></div>
        <div className={styles.monthGrid} aria-label={t("manager.settings.volume.monthPeriods")}>{MONTHS.map((month) => {
          const inSeason = seasonMonths.includes(month.value);
          return <button key={month.value} type="button" role="switch" aria-checked={inSeason} aria-label={format("volume.monthState", { month: month.fullLabel, state: t(inSeason ? "manager.settings.volume.inSeason" : "manager.settings.volume.offseason") })} className={`${styles.month} ${inSeason ? styles.monthInSeason : styles.monthOffseason}`} onClick={() => setMonthState(month.value, !inSeason)}><span className={styles.monthName}>{month.label}</span><span className={styles.monthState}>{inSeason ? t("manager.settings.volume.inSeason") : t("manager.settings.volume.offseason")}</span></button>;
        })}</div>
      </section>

      {editor ? <form className={campsStyles.panel} onSubmit={commitEditor} noValidate>
        <div className={campsStyles.panelHeader}><div><h2>{editor.mode === "create" ? t("manager.settings.volume.addFTEM") : format("volume.editCode", { code: editor.draft.ftem_code })}</h2><p>{t("manager.settings.volume.editorHelp")}</p></div><button type="button" className={campsStyles.iconButton} title={t("manager.settings.close")} aria-label={t("manager.settings.volume.closeForm")} disabled={saving} onClick={() => { setEditor(null); setEditorErrors({}); }}><X size={16} /></button></div>
        {errorMessages.length > 1 ? <div className={campsStyles.alertError} role="alert"><div><strong>{t("manager.settings.volume.fixFields")}</strong><ul className={styles.errorList}>{Array.from(new Set(errorMessages)).map((message) => <li key={message}>{message}</li>)}</ul></div></div> : null}
        <div className={styles.editorGrid}>
          <Field label={t("manager.settings.volume.ftemCode")} required error={displayedErrors.ftem_code}><input value={editor.draft.ftem_code} onChange={(event) => updateDraft({ ftem_code: event.target.value })} /></Field>
          <Field label={t("manager.settings.order")} required error={displayedErrors.sort_order}><input type="number" step="1" value={editor.draft.sort_order} onChange={(event) => updateDraft({ sort_order: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.levelName")} required full error={displayedErrors.level_label}><input value={editor.draft.level_label} onChange={(event) => updateDraft({ level_label: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.minHandicap")} error={displayedErrors.handicap_min}><input type="number" step="0.1" value={editor.draft.handicap_min} onChange={(event) => updateDraft({ handicap_min: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.maxHandicap")} error={displayedErrors.handicap_max}><input type="number" step="0.1" value={editor.draft.handicap_max} onChange={(event) => updateDraft({ handicap_max: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.offseasonMinutes")} required error={displayedErrors.minutes_offseason}><input type="number" min="0" step="1" value={editor.draft.minutes_offseason} onChange={(event) => updateDraft({ minutes_offseason: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.inSeasonMinutes")} required error={displayedErrors.minutes_inseason}><input type="number" min="0" step="1" value={editor.draft.minutes_inseason} onChange={(event) => updateDraft({ minutes_inseason: event.target.value })} /></Field>
          <Field label={t("manager.settings.volume.motivationText")} full><textarea rows={4} value={editor.draft.motivation_text} onChange={(event) => updateDraft({ motivation_text: event.target.value })} /></Field>
        </div>
        <div className={styles.editorFooter}><div className={campsStyles.actions}>{editor.mode === "edit" ? <><button type="button" className={campsStyles.secondary} disabled={saving || editor.index === 0} onClick={() => moveEditedRow(-1)}><ArrowUp size={15} />{t("manager.settings.volume.moveUp")}</button><button type="button" className={campsStyles.secondary} disabled={saving || editor.index === rows.length - 1} onClick={() => moveEditedRow(1)}><ArrowDown size={15} />{t("manager.settings.volume.moveDown")}</button></> : null}</div><div className={campsStyles.actions}><button type="button" className={campsStyles.secondary} disabled={saving} onClick={() => { setEditor(null); setEditorErrors({}); }}>{t("manager.settings.cancel")}</button><button type="submit" className={campsStyles.primary} disabled={saving}>{editor.mode === "create" ? t("manager.settings.volume.addLevel") : t("manager.settings.volume.saveLevel")}</button></div></div>
      </form> : null}

      <section className={campsStyles.panel}>
        <div className={campsStyles.panelHeader}><div><h2>{t("manager.settings.volume.levels")}</h2><p>{count("volume.levelCount", rows.length)}</p></div><button type="button" className={campsStyles.primary} disabled={saving || Boolean(editor)} onClick={openCreate}><Plus size={16} />{t("manager.settings.volume.add")}</button></div>
        {rows.length === 0 ? <div className={styles.emptyState}><div className={campsStyles.empty}>{t("manager.settings.volume.empty")}</div><button type="button" className={campsStyles.primary} disabled={saving || Boolean(editor)} onClick={openCreate}><Plus size={16} />{t("manager.settings.volume.add")}</button></div> : <div className={campsStyles.tableWrap}>
          <table className={`${campsStyles.table} ${styles.table}`}><thead><tr><th>{t("manager.settings.volume.ftem")}</th><th>{t("manager.settings.volume.level")}</th><th>{t("manager.settings.volume.handicap")}</th><th>{t("manager.settings.volume.offseason")}</th><th>{t("manager.settings.volume.inSeason")}</th><th>{t("manager.settings.volume.motivation")}</th><th>{t("manager.settings.order")}</th><th>{t("manager.settings.actions")}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? `${row.ftem_code}-${index}`}>
            <td data-label={t("manager.settings.volume.ftem")}><span className={styles.ftemCode}>{row.ftem_code || "—"}</span></td>
            <td data-label={t("manager.settings.volume.level")}><div className={campsStyles.titleCell}><b>{row.level_label || t("manager.settings.volume.unnamed")}</b></div></td>
            <td data-label={t("manager.settings.volume.handicap")}><span className={styles.compactValue}>{handicapDisplay(row)}</span></td>
            <td data-label={t("manager.settings.volume.offseason")}><span className={styles.compactValue}>{format("volume.monthlyMinutes", { count: Number(row.minutes_offseason).toLocaleString(managerLocaleTag(locale)) })}</span></td>
            <td data-label={t("manager.settings.volume.inSeason")}><span className={styles.compactValue}>{format("volume.monthlyMinutes", { count: Number(row.minutes_inseason).toLocaleString(managerLocaleTag(locale)) })}</span></td>
            <td data-label={t("manager.settings.volume.motivation")}><span className={styles.motivation} title={row.motivation_text || undefined}>{row.motivation_text || "—"}</span></td>
            <td data-label={t("manager.settings.order")}><span className={styles.order}>{row.sort_order}</span></td>
            <td data-label={t("manager.settings.actions")}><div className={campsStyles.actions}><button type="button" className={campsStyles.iconButton} title={t("manager.settings.edit")} aria-label={format("volume.editNamed", { name: `${row.ftem_code} — ${row.level_label}` })} disabled={saving || Boolean(editor)} onClick={() => openEdit(row, index)}><Pencil size={15} /></button><button type="button" className={campsStyles.iconButton} title={t("manager.settings.duplicate")} aria-label={format("volume.duplicateNamed", { name: `${row.ftem_code} — ${row.level_label}` })} disabled={saving || Boolean(editor)} onClick={() => openDuplicate(row)}><Copy size={15} /></button><button type="button" className={`${campsStyles.iconButton} ${campsStyles.dangerIcon}`} title={t("manager.settings.delete")} aria-label={format("volume.deleteNamed", { name: `${row.ftem_code} — ${row.level_label}` })} disabled={saving || Boolean(editor)} onClick={() => removeRow(row, index)}><Trash2 size={15} /></button></div></td>
          </tr>)}</tbody></table>
        </div>}
      </section>
    </> : null}
  </main>;
}

function Field({ label, required, full, error, children }: { label: string; required?: boolean; full?: boolean; error?: string; children: React.ReactNode }) {
  return <label className={`${campsStyles.field} ${full ? styles.fieldFull : ""}`}><span>{label}{required ? <span className={campsStyles.required}> *</span> : null}</span>{children}{error ? <small className={campsStyles.errorText} role="alert">{error}</small> : null}</label>;
}
