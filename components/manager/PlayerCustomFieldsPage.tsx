"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import ManagerClubSelect from "./ManagerClubSelect";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { managerHeaders, useManagerResource } from "./useManagerResource";
import { useManagerClubChangeGuard } from "./useManagerClubChangeGuard";
import styles from "@/components/admin/AdminHomeStats.module.css";

type RolePermissions = { visible_to_player: boolean; editable_by_player: boolean; visible_to_coach: boolean; editable_by_coach: boolean };
type Field = RolePermissions & { id: string; label: string; field_type: string; scope: "permanent" | "season"; description?: string | null; options_json?: string[]; applies_to_roles?: string[] };
type Draft = RolePermissions & { label: string; field_type: string; scope: "permanent" | "season"; description: string; options: string; applies_to_roles: string[] };
const empty: Draft = { label: "", field_type: "short_text", scope: "permanent", description: "", options: "", applies_to_roles: ["player"], visible_to_player: true, editable_by_player: false, visible_to_coach: false, editable_by_coach: false };
type FieldEditorHandle = { hasUnsavedChanges: () => boolean; isBusy: () => boolean };

export default function PlayerCustomFieldsPage() {
  const { t } = useI18n();
  const scope = useManagerClubSelection();
  const editorRef = useRef<FieldEditorHandle>(null);
  const resource = useManagerResource<{ playerFields: Field[] }>(scope.clubId ? `/api/manager/clubs/${scope.clubId}/player-fields` : null, t("manager.loadError"));
  function selectClub(id: string) {
    if (id === scope.clubId || editorRef.current?.isBusy()) return;
    if (editorRef.current?.hasUnsavedChanges() && !window.confirm(t("manager.fields.discardDraft"))) return;
    scope.setClubId(id);
  }
  // Remount the editor for a new club: a draft and its field ID never cross club boundaries.
  return <div className={styles.page}>
    <nav aria-label={t("common.breadcrumb")}>{t("manager.fields.breadcrumb")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.fields.title")}</h1><p className={styles.lead}>{t("manager.fields.lead")}</p></div>
      <ManagerClubSelect clubs={scope.clubs} clubId={scope.clubId} onChange={selectClub} />
    </div>
    {scope.error || resource.error ? <div role="alert" className={styles.errorAlert}>{scope.error || resource.error}</div> : null}
    {scope.loading || resource.loading ? <ListLoadingBlock label={t("manager.fields.loading")} /> : null}
    {scope.clubId && resource.data ? <FieldEditor key={scope.clubId} clubId={scope.clubId} fields={resource.data.playerFields} reload={resource.reload} editorRef={editorRef} /> : null}
  </div>;
}

export function FieldEditor({ clubId, fields, reload, editorRef }: { clubId: string; fields: Field[]; reload: () => void; editorRef?: Ref<FieldEditorHandle> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(empty), [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  useManagerClubChangeGuard(editing !== null || JSON.stringify(draft) !== JSON.stringify(empty), t("manager.fields.discardDraft"), busy);
  useImperativeHandle(editorRef, () => ({
    hasUnsavedChanges: () => editing !== null || JSON.stringify(draft) !== JSON.stringify(empty),
    isBusy: () => pending.current,
  }), [draft, editing]);
  const optionType = ["select", "radio", "checkbox"].includes(draft.field_type);
  const named = (key: string, name: string) => t(key).replace("{name}", name);
  function reset() { setDraft(empty); setEditing(null); setError(""); }
  async function save() {
    if (pending.current) return;
    setError(""); setMessage("");
    if (!draft.label.trim()) return setError(t("manager.fields.requiredLabel"));
    if (!draft.applies_to_roles.length) return setError(t("manager.fields.requiredTargets"));
    const options = draft.options.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (optionType && !options.length) return setError(t("manager.fields.requiredOptions"));
    pending.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/player-fields${editing ? `/${editing}` : ""}`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...(await managerHeaders()) },
        body: JSON.stringify({ ...draft, options: optionType ? options : [] }),
      });
      const json = await response.json(); if (!response.ok) throw new Error(json.error ?? t("manager.saveError"));
      reset(); setMessage(t("manager.saved")); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove(field: Field) {
    if (pending.current || !window.confirm(named("manager.fields.confirmDelete", field.label))) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/player-fields/${field.id}`, { method: "DELETE", headers: await managerHeaders() });
      const json = await response.json(); if (!response.ok) throw new Error(json.error ?? t("manager.saveError"));
      if (editing === field.id) reset(); setMessage(t("manager.deleted")); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    {error ? <div role="alert" className={styles.errorAlert}>{error}</div> : null}
    {message ? <p role="status">{message}</p> : null}
    <form className={styles.quickPanel} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={styles.sectionHeading}><h2>{t(editing ? "manager.fields.edit" : "manager.fields.new")}</h2></div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 20 }}>
        <div className="user-mgmt-form-grid">
          <Label label={t("manager.fields.label")}><input required value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></Label>
          <fieldset className="user-mgmt-field" style={{ border: 0, padding: 0 }}><legend className="user-mgmt-field-label">{t("manager.fields.targets")}</legend>
            <div className="user-mgmt-chip-list">{["player", "coach", "parent", "manager"].map((role) => <Permission key={role} label={t(`manager.fields.${role}`)} checked={draft.applies_to_roles.includes(role)} onChange={(checked) => setDraft({ ...draft, applies_to_roles: checked ? [...draft.applies_to_roles, role] : draft.applies_to_roles.filter((value) => value !== role) })} />)}</div>
          </fieldset>
          <Label label={t("manager.fields.scope")}><select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as Draft["scope"] })}>{["permanent", "season"].map((value) => <option key={value} value={value}>{t(`manager.fields.${value}`)}</option>)}</select></Label>
          <Label label={t("manager.fields.type")}><select value={draft.field_type} onChange={(event) => setDraft({ ...draft, field_type: event.target.value })}>{["text", "short_text", "long_text", "number", "date", "select", "radio", "checkbox", "boolean"].map((value) => <option key={value} value={value}>{t(`manager.fields.${value}`)}</option>)}</select></Label>
          <Label label={t("manager.fields.help")}><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Label>
          {optionType ? <Label label={t("manager.fields.options")}><textarea value={draft.options} onChange={(event) => setDraft({ ...draft, options: event.target.value })} /></Label> : null}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><legend className="user-mgmt-field-label" style={{ marginBottom: 12 }}>{t("manager.fields.access")}</legend><div className="user-mgmt-chip-list" style={{ gap: 10 }}>
          <Permission label={t("manager.fields.visiblePlayer")} checked={draft.visible_to_player} onChange={(checked) => setDraft({ ...draft, visible_to_player: checked, editable_by_player: checked && draft.editable_by_player })} />
          <Permission label={t("manager.fields.editablePlayer")} checked={draft.editable_by_player} disabled={!draft.visible_to_player} onChange={(checked) => setDraft({ ...draft, editable_by_player: checked })} />
          <Permission label={t("manager.fields.visibleCoach")} checked={draft.visible_to_coach} onChange={(checked) => setDraft({ ...draft, visible_to_coach: checked, editable_by_coach: checked && draft.editable_by_coach })} />
          <Permission label={t("manager.fields.editableCoach")} checked={draft.editable_by_coach} disabled={!draft.visible_to_coach} onChange={(checked) => setDraft({ ...draft, editable_by_coach: checked })} />
        </div></fieldset>
        <div className="user-mgmt-actions"><button className="btn" type="submit" disabled={busy}>{busy ? <RefreshCw size={14} className={styles.spin} aria-hidden="true" /> : editing ? <Pencil size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{t(busy ? "manager.saving" : editing ? "manager.save" : "manager.fields.create")}</button>{editing ? <button className="btn" type="button" onClick={reset}>{t("manager.cancel")}</button> : null}</div>
      </fieldset>
    </form>
    {(["permanent", "season"] as const).map((scope) => <section className={styles.overview} key={scope}>
      <div className={styles.sectionHeading}><h2>{t(`manager.fields.${scope}`)}</h2></div>
      <div className={styles.quickGrid}>{fields.filter((field) => field.scope === scope).length === 0 ? <div className="marketplace-empty">{t("manager.fields.empty")}</div> : fields.filter((field) => field.scope === scope).map((field) => <article key={field.id} className={styles.quickLink}>
        <div><b>{field.label}</b><small>{(field.applies_to_roles ?? ["player"]).map((role) => t(`manager.fields.${role}`)).join(", ")}</small><small>{[[field.visible_to_player, "visiblePlayer"], [field.editable_by_player, "editablePlayer"], [field.visible_to_coach, "visibleCoach"], [field.editable_by_coach, "editableCoach"]].filter(([enabled]) => enabled).map(([, key]) => t(`manager.fields.${key}`)).join(" · ") || t("manager.fields.hidden")}</small></div>
        <button type="button" className="btn" style={{ width: 44, minWidth: 44, minHeight: 44, padding: 0, flexShrink: 0 }} disabled={busy} aria-label={named("manager.fields.editNamed", field.label)} title={named("manager.fields.editNamed", field.label)} onClick={() => { setError(""); setMessage(""); setEditing(field.id); setDraft({ label: field.label, field_type: field.field_type, scope: field.scope, description: field.description ?? "", options: (field.options_json ?? []).join("\n"), applies_to_roles: field.applies_to_roles ?? ["player"], visible_to_player: field.visible_to_player, editable_by_player: field.editable_by_player, visible_to_coach: field.visible_to_coach, editable_by_coach: field.editable_by_coach }); }}><Pencil size={16} aria-hidden="true" /></button>
        <button type="button" className="btn" style={{ width: 44, minWidth: 44, minHeight: 44, padding: 0, flexShrink: 0 }} disabled={busy} aria-label={named("manager.fields.deleteNamed", field.label)} title={named("manager.fields.deleteNamed", field.label)} onClick={() => void remove(field)}><Trash2 size={16} aria-hidden="true" /></button>
      </article>)}</div>
    </section>)}
  </>;
}
function Label({ label, children }: { label: string; children: React.ReactNode }) { return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{label}</span>{children}</label>; }
function Permission({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) { return <label className="pill-soft"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
