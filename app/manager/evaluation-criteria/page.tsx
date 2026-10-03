"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useManagerClubChangeGuard } from "@/components/manager/useManagerClubChangeGuard";
import { managerAdministrationFormat, managerCriterionDomain, managerNewCriterionChoices, managerAdministrationFeedback } from "@/lib/managerAdministrationPresentation";
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


function freshDraft(order = 10): Draft {
  return { name: "", description: null, respondent: "coach", response_format: "scale_1_6", choices_json: defaultEvaluationChoices("scale_1_6"), activity_types: ["training"], domain_key: "technique", domain_label: "Technique", is_required: false, is_active: true, sort_order: order };
}

export default function EvaluationCriteriaPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requestedClubId = params.get("club") ?? "";
  const formatText = (key: string, values: Record<string, string | number>) => managerAdministrationFormat(t, key, values);
  const RESPONDENTS: Array<{ value: EvaluationRespondent; label: string }> = [
    { value: "coach", label: t("manager.administration.criteria.coach") }, { value: "player", label: t("manager.administration.criteria.player") }, { value: "both", label: t("manager.administration.criteria.both") },
  ];
  const FORMATS: Array<{ value: EvaluationResponseFormat; label: string }> = [
    { value: "scale_1_6", label: t("manager.administration.criteria.scale") }, { value: "delta", label: t("manager.administration.criteria.delta") },
    { value: "sentiment", label: t("manager.administration.criteria.sentiment") }, { value: "feeling", label: t("manager.administration.criteria.feeling") },
    { value: "yes_no", label: t("manager.fields.boolean") }, { value: "short_text", label: t("manager.fields.short_text") },
  ];
  const TYPE_LABELS: Record<string, string> = { training: t("manager.activity.training"), interclub: t("manager.activity.interclub"), camp: t("manager.activity.camp"), session: t("manager.activity.session"), event: t("manager.activity.event"), competition: t("manager.activity.competition") };

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubsError, setClubsError] = useState(false);
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [loadedClubId, setLoadedClubId] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const loadSequence = useRef(0);
  const activeClubRef = useRef(clubId);
  activeClubRef.current = clubId;
  const selectionKey = clubId || (requestedClubId ? `invalid:${requestedClubId}` : "none");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(freshDraft());
  useManagerClubChangeGuard(Boolean(editingId), t("manager.administration.criteria.discardDraft"), busy);
  const scopeReady = Boolean(clubId && loadedClubId === clubId && !loading && !loadFailed);

  async function token() { return (await supabase.auth.getSession()).data.session?.access_token ?? ""; }
  async function loadClubs() {
    const response = await fetch("/api/manager/my-clubs", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error ?? t("manager.loadError"));
    const next = (json.clubs ?? []) as Club[]; setClubs(next); setClubsLoaded(true);
  }
  async function loadCriteria(id: string) {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setCriteria([]); setLoadedClubId(""); setLoadFailed(false);
    try {
      const response = await fetch(`/api/manager/clubs/${id}/evaluation-criteria`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? t("manager.loadError"));
      if (sequence !== loadSequence.current || activeClubRef.current !== id) return;
      setCriteria(json.criteria ?? []);
    } catch (e) { if (sequence === loadSequence.current && activeClubRef.current === id) { setLoadFailed(true); setError(e instanceof Error ? e.message : t("manager.loadError")); } }
    finally { if (sequence === loadSequence.current && activeClubRef.current === id) { setLoadedClubId(id); setLoading(false); } }
  }
  // Initial manager context is loaded once; the selected club drives the list query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadClubs().catch((e) => { setClubsError(true); setClubsLoaded(true); setError(e.message); setLoading(false); }); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!clubsLoaded || clubsError) return; setEditingId(null); setDraft(freshDraft()); if (clubId) void loadCriteria(clubId); else { ++loadSequence.current; setCriteria([]); setLoadedClubId(""); setLoadFailed(true); setError(t(requestedClubId ? "manager.clubUnavailable" : "manager.noClub")); setLoading(false); } }, [clubsLoaded, clubsError, selectionKey]);

  function selectClub(id: string) {
    if (id === clubId || !clubs.some((club) => club.id === id) || busy) return;
    if (editingId && !window.confirm(t("manager.administration.criteria.discardDraft"))) return;
    const next = new URLSearchParams(params.toString()); next.set("club", id);
    router.replace(`/manager/evaluation-criteria?${next}`, { scroll: false });
  }

  function openNew(source?: EvaluationCriterion) {
    setEditingId(source ? "duplicate" : "new");
    setDraft(source ? { name: formatText("criteria.copyName", { name: source.name }), description: source.description, respondent: source.respondent, response_format: source.response_format, choices_json: source.choices_json.map((choice) => ({ ...choice })), activity_types: [...source.activity_types], domain_key: source.domain_key, domain_label: source.domain_label, is_required: source.is_required, is_active: true, sort_order: source.sort_order + 1 } : freshDraft((criteria.at(-1)?.sort_order ?? 0) + 10));
    setError(""); setSuccess("");
  }
  function openEdit(row: EvaluationCriterion) {
    setEditingId(row.id); setDraft({ name: row.name, description: row.description, respondent: row.respondent, response_format: row.response_format, choices_json: row.choices_json.map((choice) => ({ ...choice })), activity_types: [...row.activity_types], domain_key: row.domain_key, domain_label: row.domain_label, is_required: row.is_required, is_active: row.is_active, sort_order: row.sort_order });
  }
  function setFormat(format: EvaluationResponseFormat) { setDraft((current) => ({ ...current, response_format: format, choices_json: managerNewCriterionChoices(t, format) })); }
  async function save() {
    if (!scopeReady || busy || !editingId) return;
    if (!draft.name.trim() || !draft.activity_types.length) { setError(t("manager.administration.criteria.requiredInput")); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const isUpdate = editingId && !["new", "duplicate"].includes(editingId);
      const response = await fetch(`/api/manager/clubs/${clubId}/evaluation-criteria${isUpdate ? `/${editingId}` : ""}`, { method: isUpdate ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(draft) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? t("manager.saveError"));
      if (activeClubRef.current === clubId) { setEditingId(null); setSuccess(isUpdate ? t("manager.administration.criteria.updated") : t("manager.administration.criteria.created")); await loadCriteria(clubId); }
    } catch (e) { if (activeClubRef.current === clubId) setError(e instanceof Error ? e.message : t("manager.saveError")); } finally { setBusy(false); }
  }
  async function mutate(row: EvaluationCriterion, action: "toggle" | "archive" | "delete") {
    if (!scopeReady || busy) return;
    if (action !== "toggle" && !window.confirm(formatText(action === "delete" ? "criteria.confirmDelete" : "criteria.confirmArchive", { name: row.name }))) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const deleting = action === "delete";
      const response = await fetch(`/api/manager/clubs/${clubId}/evaluation-criteria/${row.id}`, { method: deleting ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: deleting ? undefined : JSON.stringify(action === "archive" ? { action: "archive" } : { ...row, is_active: !row.is_active }) });
      const json = await response.json(); if (!response.ok) throw new Error(json?.error ?? t("manager.administration.actionError"));
      if (activeClubRef.current === clubId) { setSuccess(deleting ? t("manager.administration.criteria.deleted") : action === "archive" ? t("manager.administration.criteria.archived") : t("manager.administration.statusUpdated")); await loadCriteria(clubId); }
    } catch (e) { if (activeClubRef.current === clubId) setError(e instanceof Error ? e.message : t("manager.administration.actionError")); } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <div className={styles.breadcrumb}><span>{t("manager.settings.settings")}</span><span>›</span><span>{t("manager.nav.criteria")}</span></div>
    <div className={styles.topline}><div><h1>{t("manager.nav.criteria")}</h1><p className={styles.lead}>{t("manager.administration.criteria.lead")}</p></div><div className={styles.actions}><button className={styles.primary} disabled={!scopeReady || busy} onClick={() => openNew()}><Plus size={16}/>{t("manager.administration.criteria.create")}</button></div></div>
    {error ? <div className={styles.alertError} role="alert">{managerAdministrationFeedback(t, error)}</div> : null}{success ? <div className={styles.alertSuccess} role="status">{managerAdministrationFeedback(t, success)}</div> : null}
    <label className={styles.field}><span>{t("manager.settings.club")}</span><select value={clubId} disabled={!clubsLoaded || busy || !clubs.length} onChange={(e) => selectClub(e.target.value)}>{!clubId ? <option value="">{t(clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}{clubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? t("manager.settings.club")}</option>)}</select></label>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>{t("manager.administration.criteria.custom")}</h2><p>{t("manager.administration.criteria.historyHelp")}</p></div></div>
      {loading || (clubId && !loadFailed && !scopeReady) ? <div className={styles.empty}>{t("manager.administration.loading")}</div> : !scopeReady ? null : criteria.length === 0 ? <div className={styles.empty}>{t("manager.administration.criteria.empty")}</div> : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.criteriaTable}`}>
            <thead><tr><th>{t("manager.content.name")}</th><th>{t("manager.administration.criteria.respondent")}</th><th>{t("manager.administration.criteria.format")}</th><th>{t("manager.administration.criteria.activityTypes")}</th><th>{t("manager.administration.criteria.domain")}</th><th>{t("manager.performance.status")}</th><th>{t("manager.content.actions")}</th></tr></thead>
            <tbody>{criteria.map((row) => (
              <tr key={row.id}>
                <td data-label={t("manager.content.name")}><div className={styles.titleCell}><b>{row.name}</b><span className={styles.muted}>{row.description || t("manager.administration.criteria.noInstructions")}</span></div></td>
                <td data-label={t("manager.administration.criteria.respondent")}>{RESPONDENTS.find((item) => item.value === row.respondent)?.label}</td>
                <td data-label={t("manager.administration.criteria.format")}>{FORMATS.find((item) => item.value === row.response_format)?.label}</td>
                <td data-label={t("manager.administration.criteria.types")}>{row.activity_types.map((type) => TYPE_LABELS[type] ?? type).join(", ")}</td>
                <td data-label={t("manager.administration.criteria.domain")}>{managerCriterionDomain(t, row.domain_key, row.domain_label)}</td>
                <td data-label={t("manager.performance.status")}><span className={`${styles.badge} ${row.archived_at ? styles.badgeArchived : !row.is_active ? styles.badgeDraft : ""}`}>{row.archived_at ? t("manager.content.archived") : row.is_active ? t("manager.administration.active") : t("manager.administration.inactive")}</span></td>
                <td data-label={t("manager.content.actions")}><div className={styles.actions}><button className={styles.iconButton} title={t("manager.content.edit")} aria-label={formatText("criteria.editNamed", { name: row.name })} disabled={busy} onClick={() => openEdit(row)}><Pencil size={15}/></button><button className={styles.iconButton} title={t("manager.content.duplicate")} aria-label={formatText("criteria.duplicateNamed", { name: row.name })} disabled={busy} onClick={() => openNew(row)}><Copy size={15}/></button>{!row.archived_at ? <><button className={styles.iconButton} title={row.is_active ? t("manager.administration.deactivate") : t("manager.administration.activate")} aria-label={formatText(row.is_active ? "criteria.deactivateNamed" : "criteria.activateNamed", { name: row.name })} disabled={busy} onClick={() => void mutate(row, "toggle")}>{row.is_active ? t("manager.administration.criteria.on") : t("manager.administration.criteria.off")}</button>{row.used_count ? <button className={`${styles.iconButton} ${styles.dangerIcon}`} title={t("manager.content.archive")} aria-label={formatText("criteria.archiveNamed", { name: row.name })} disabled={busy} onClick={() => void mutate(row, "archive")}><Archive size={15}/></button> : <button className={`${styles.iconButton} ${styles.dangerIcon}`} title={t("manager.content.delete")} aria-label={formatText("criteria.deleteNamed", { name: row.name })} disabled={busy} onClick={() => void mutate(row, "delete")}><Trash2 size={15}/></button>}</> : null}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
    {scopeReady && editingId ? <section className={styles.panel} aria-label={t("manager.administration.criteria.form")}><div className={styles.panelHeader}><div><h2>{editingId === "new" || editingId === "duplicate" ? t("manager.administration.criteria.new") : t("manager.administration.criteria.edit")}</h2><p>{t("manager.administration.criteria.optionalHelp")}</p></div><button className={styles.iconButton} aria-label={t("manager.settings.volume.closeForm")} onClick={() => setEditingId(null)}><X size={16}/></button></div>
      <div className={styles.grid2}><label className={styles.field}><span>{t("manager.content.name")} <b className={styles.required}>*</b></span><input value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label><label className={styles.field}><span>{t("manager.administration.criteria.respondent")}</span><select value={draft.respondent} onChange={(e) => setDraft({ ...draft, respondent: e.target.value as EvaluationRespondent })}>{RESPONDENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      <label className={styles.field}><span>{t("manager.administration.criteria.description")}</span><textarea maxLength={500} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}/></label>
      <div className={styles.grid3}><label className={styles.field}><span>{t("manager.administration.criteria.format")}</span><select value={draft.response_format} onChange={(e) => setFormat(e.target.value as EvaluationResponseFormat)}>{FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className={styles.field}><span>{t("manager.administration.criteria.domain")}</span><select value={draft.domain_key} onChange={(e) => { const domain = EVALUATION_DOMAINS.find((item) => item.value === e.target.value); setDraft({ ...draft, domain_key: e.target.value, domain_label: domain?.label ?? e.target.value }); }}>{EVALUATION_DOMAINS.map((item) => <option key={item.value} value={item.value}>{t(`manager.administration.domain.${item.value}`)}</option>)}</select></label><label className={styles.field}><span>{t("manager.settings.order")}</span><input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}/></label></div>
      <div className={styles.selectionBlock}><span className={styles.muted}>{t("manager.administration.criteria.activityTypes")}</span><div className={styles.pillRow}>{EVALUATION_ACTIVITY_TYPES.map((type) => <label className={styles.check} key={type}><input type="checkbox" checked={draft.activity_types.includes(type)} onChange={(e) => setDraft({ ...draft, activity_types: e.target.checked ? [...draft.activity_types, type] : draft.activity_types.filter((value) => value !== type) })}/>{TYPE_LABELS[type]}</label>)}</div></div>
      {draft.response_format !== "short_text" ? <div className={styles.grid3}>{draft.choices_json.map((choice, index) => <label className={styles.field} key={`${choice.value}-${index}`}><span>{formatText("criteria.choiceLabel", { value: managerNewCriterionChoices(t, draft.response_format).find((standard) => standard.value === choice.value)?.label ?? String(choice.value) })}</span><input value={choice.label} onChange={(e) => setDraft({ ...draft, choices_json: draft.choices_json.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) })}/></label>)}</div> : null}
      <div className={styles.dayCard}><div className={styles.sectionTitle}><h3>{t("manager.administration.criteria.preview")}</h3><p>{draft.name || t("manager.administration.criteria.name")}{draft.is_required ? t("manager.administration.criteria.requiredSuffix") : t("manager.administration.criteria.optionalSuffix")}</p></div><EvaluationResponseField name={draft.name || t("manager.administration.criteria.previewName")} format={draft.response_format} choices={draft.choices_json as EvaluationChoice[]} value={null} onChange={() => {}}/></div>
      <div className={styles.pillRow}><label className={styles.check}><input type="checkbox" checked={draft.is_required} onChange={(e) => setDraft({ ...draft, is_required: e.target.checked })}/>{t("manager.administration.required")}</label><label className={styles.check}><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}/>{t("manager.administration.active")}</label></div>
      <div className={styles.actions}><button className={styles.secondary} onClick={() => setEditingId(null)}>{t("manager.cancel")}</button><button className={styles.primary} disabled={busy} onClick={() => void save()}>{busy ? t("manager.saving") : t("manager.save")}</button></div>
    </section> : null}
  </div>;
}
