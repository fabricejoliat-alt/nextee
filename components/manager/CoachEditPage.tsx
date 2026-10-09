"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, KeyRound, RefreshCw, Save } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerAdministrationFeedback } from "@/lib/managerAdministrationPresentation";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import navigationStyles from "@/app/design-system/design-system.module.css";
import ManagerCoachStatistics from "@/components/manager/ManagerCoachStatistics";
import permissionStyles from "@/components/manager/CoachPermissions.module.css";
import passwordStyles from "@/components/manager/CoachPasswordDialog.module.css";

type Value = string | boolean | string[];
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Field = { id: string; label: string; field_type: string; options_json?: string[]; scope: "permanent" | "season"; applies_to_roles?: string[]; is_active: boolean; description?: string | null };
type Coach = { id: string; user_id: string; role: string; auth_email?: string | null; is_active: boolean | null; can_manage_assigned_groups?: boolean; can_manage_assigned_group_planning?: boolean; can_transfer_players_between_club_groups?: boolean; coach_training_assistance_enabled?: boolean; custom_field_values?: Record<string, Value>; profiles: { first_name: string | null; last_name: string | null; username: string | null; staff_function: string | null; phone: string | null; address: string | null; postal_code: string | null; city: string | null } | null };
type SeasonRecord = { club_member_id: string; registration_status: "active" | "inactive"; custom_field_values?: Record<string, Value> };
async function headers() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }

export default function CoachEditPage({ memberId }: { memberId: string }) {
  const { t } = useI18n();

  const query = useSearchParams(); const clubId = query.get("club") ?? ""; const backUrl = `/manager/user-management/coaches${clubId ? `?club=${clubId}` : ""}`;
  const [tab, setTab] = useState<"profile" | "statistics">(query.get("tab") === "statistics" ? "statistics" : "profile");
  const [coach, setCoach] = useState<Coach | null>(null); const [seasons, setSeasons] = useState<Season[]>([]); const [seasonId, setSeasonId] = useState(query.get("season") ?? ""); const [fields, setFields] = useState<Field[]>([]); const [seasonValues, setSeasonValues] = useState<Record<string, Value>>({}); const [seasonStatus, setSeasonStatus] = useState<"active" | "inactive">("active"); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const passwordBusyRef = useRef(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", username: "", email: "", password: "", staff_function: "", phone: "", address: "", postal_code: "", city: "", is_active: true, can_manage_assigned_groups: false, can_manage_assigned_group_planning: false, can_transfer_players_between_club_groups: false, coach_training_assistance_enabled: false, custom: {} as Record<string, Value> });
  const permanentFields = useMemo(() => fields.filter((field) => field.scope === "permanent" && field.is_active && (!field.applies_to_roles?.length || field.applies_to_roles.includes("coach"))), [fields]); const seasonalFields = useMemo(() => fields.filter((field) => field.scope === "season" && field.is_active && (!field.applies_to_roles?.length || field.applies_to_roles.includes("coach"))), [fields]);
  async function load() { if (!clubId) { setError(t("manager.administration.missingClub")); setLoading(false); return; } setLoading(true); try { const auth = await headers(); const [members, seasonsRes] = await Promise.all([fetch(`/api/manager/clubs/${clubId}/members`, { headers: auth }), fetch(`/api/manager/clubs/${clubId}/seasons`, { headers: auth })]); const mj = await members.json(); const sj = await seasonsRes.json(); if (!members.ok || !seasonsRes.ok) throw new Error(mj.error ?? sj.error); const next = (mj.members ?? []).find((item: Coach) => item.id === memberId && item.role === "coach"); if (!next) throw new Error(t("manager.administration.coaches.notFound")); const nextSeasons = sj.seasons ?? []; const selected = nextSeasons.some((item: Season) => item.id === seasonId) ? seasonId : nextSeasons.find((item: Season) => item.is_current)?.id ?? nextSeasons[0]?.id ?? ""; const p = next.profiles; setCoach(next); setFields(mj.playerFields ?? []); setSeasons(nextSeasons); setSeasonId(selected); setForm({ first_name: p?.first_name ?? "", last_name: p?.last_name ?? "", username: p?.username ?? "", email: next.auth_email?.endsWith("@noemail.local") ? "" : next.auth_email ?? "", password: "", staff_function: p?.staff_function ?? "", phone: p?.phone ?? "", address: p?.address ?? "", postal_code: p?.postal_code ?? "", city: p?.city ?? "", is_active: next.is_active !== false, can_manage_assigned_groups: Boolean(next.can_manage_assigned_groups), can_manage_assigned_group_planning: Boolean(next.can_manage_assigned_group_planning), can_transfer_players_between_club_groups: Boolean(next.can_transfer_players_between_club_groups), coach_training_assistance_enabled: Boolean(next.coach_training_assistance_enabled), custom: next.custom_field_values ?? {} }); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.loadError")); } finally { setLoading(false); } }
  async function loadSeason(id: string) { if (!id) return; try { const r = await fetch(`/api/manager/clubs/${clubId}/seasons/${id}/coach-records`, { headers: await headers() }); const j = await r.json(); if (!r.ok) throw new Error(j.error); const record = (j.records ?? []).find((item: SeasonRecord) => item.club_member_id === memberId); setSeasonStatus(record?.registration_status ?? "active"); setSeasonValues(record?.custom_field_values ?? {}); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.administration.seasonLoadError")); } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadSeason(seasonId); }, [seasonId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveProfile(e: React.FormEvent) { e.preventDefault(); if (!coach || !form.first_name.trim() || !form.last_name.trim()) return; setSaving(true); setError(""); try { const r = await fetch(`/api/manager/clubs/${clubId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ memberId, role: "coach", first_name: form.first_name, last_name: form.last_name, username: form.username, staff_function: form.staff_function, phone: form.phone, address: form.address, postal_code: form.postal_code, city: form.city, is_active: form.is_active, can_manage_assigned_groups: form.can_manage_assigned_groups, can_manage_assigned_group_planning: form.can_manage_assigned_group_planning, can_transfer_players_between_club_groups: form.can_transfer_players_between_club_groups, coach_training_assistance_enabled: form.coach_training_assistance_enabled, custom_field_values: form.custom }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMessage(t("manager.administration.coaches.saved")); setForm((current) => ({ ...current, password: "" })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); } finally { setSaving(false); } }
  async function saveSeason(e: React.FormEvent) { e.preventDefault(); if (!seasonId) return; setSaving(true); setError(""); try { const r = await fetch(`/api/manager/clubs/${clubId}/seasons/${seasonId}/coach-records`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ member_ids: [memberId], registration_status: seasonStatus, custom_field_values: seasonValues }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMessage(t("manager.administration.settingsSaved")); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); } finally { setSaving(false); } }
  function closePassword() {
    if (passwordBusyRef.current) return;
    setPasswordOpen(false); setPassword(""); setConfirmPassword(""); setPasswordError("");
  }
  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!coach || passwordBusyRef.current) return;
    if (password.length < 12 || password.length > 128) { setPasswordError("passwordLength"); return; }
    if (password !== confirmPassword) { setPasswordError("passwordMismatch"); return; }
    passwordBusyRef.current = true; setPasswordBusy(true); setPasswordError("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/coaches/password`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ member_id: coach.id, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        const key = result.error === "invalid_password" ? "passwordLength"
          : result.error === "weak_password" ? "passwordWeak"
          : result.error === "same_password" ? "passwordSame"
          : response.status === 403 ? "passwordProtected" : "passwordError";
        setPasswordError(key); return;
      }
      setPasswordOpen(false); setPassword(""); setConfirmPassword("");
      setMessage(t("manager.administration.coaches.passwordSaved"));
    } catch {
      setPasswordError("passwordError");
    } finally { passwordBusyRef.current = false; setPasswordBusy(false); }
  }
  if (loading) return <div className={styles.page}><ListLoadingBlock label={t("manager.administration.coaches.profileLoading")} /></div>;
  const name = [coach?.profiles?.first_name, coach?.profiles?.last_name].filter(Boolean).join(" ") || t("manager.performance.coach");
  const selectedSeason = seasons.find((season) => season.id === seasonId);
  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>{t("manager.fields.coach")}</Link><span aria-hidden="true" style={{ margin: "0 8px" }}>/</span><span>{t("manager.administration.coaches.profilePage")}</span></nav>
    <div className={styles.topline}><div><h1>{name}</h1><p className={styles.lead}>{t("manager.administration.coaches.profileLead")}</p></div><div className={actionStyles.topActions}><label className="groups-season-nav-select"><select aria-label={t("manager.season")} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</option>)}</select></label><Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16}/>{t("manager.administration.backToList")}</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{managerAdministrationFeedback(t, error)}</div> : null}{message ? <div className={actionStyles.successAlert} role="status">{managerAdministrationFeedback(t, message)}</div> : null}
    <section className={styles.overview}><div className={navigationStyles.tabs} role="tablist" aria-label={t("manager.administration.coaches.tabs")}><button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => setTab("profile")}>{t("manager.administration.profile")}</button><button type="button" role="tab" aria-selected={tab === "statistics"} onClick={() => setTab("statistics")}>{t("manager.administration.statistics")}</button></div></section>
    {tab === "profile" ? <>
      {coach?.is_active ? <div className={passwordStyles.accessAction}><button type="button" className={actionStyles.secondaryButton} onClick={() => { setPasswordError(""); setPasswordOpen(true); }}><KeyRound size={16} />{t("manager.administration.coaches.changePassword")}</button></div> : null}
      <form onSubmit={saveProfile}><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>{t("manager.administration.coaches.profile")}</h2></div></div><div className="user-mgmt-form-grid"><Text label={t("manager.profile.firstName")} value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })}/><Text label={t("manager.content.name")} value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })}/><Text label={t("manager.administration.username")} value={form.username} onChange={(v) => setForm({ ...form, username: v })}/><Text label={t("manager.profile.function")} value={form.staff_function} onChange={(v) => setForm({ ...form, staff_function: v })}/><Text label={t("manager.administration.loginEmail")} type="email" value={form.email} readOnly/><Text label={t("manager.profile.phone")} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })}/>{permanentFields.map((field) => <Custom key={field.id} field={field} value={form.custom[field.id]} onChange={(v) => setForm({ ...form, custom: { ...form.custom, [field.id]: v } })}/>)}</div><Link className={actionStyles.secondaryButton} href="/manager/user-management/custom-fields">{t("manager.administration.addFields")}</Link><Actions saving={saving} label={t("manager.administration.saveProfile")}/></section></form>
      <form onSubmit={saveProfile}>
        <section className={`${styles.overview} ${permissionStyles.card}`}>
          <div className={styles.sectionHeading}><div><h2>{t("manager.administration.permissions.title")}</h2><p>{t("manager.administration.permissions.help")}</p></div></div>
          <div className={permissionStyles.presets} aria-label={t("manager.administration.permissions.presets")}>
            <button type="button" onClick={() => setForm({ ...form, can_manage_assigned_groups: false, can_manage_assigned_group_planning: false, can_transfer_players_between_club_groups: false })}>{t("manager.administration.permissions.supervisor")}</button>
            <button type="button" onClick={() => setForm({ ...form, can_manage_assigned_groups: false, can_manage_assigned_group_planning: true, can_transfer_players_between_club_groups: false })}>{t("manager.administration.permissions.planner")}</button>
            <button type="button" onClick={() => setForm({ ...form, can_manage_assigned_groups: true, can_manage_assigned_group_planning: true, can_transfer_players_between_club_groups: false })}>{t("manager.administration.permissions.groupLead")}</button>
            <button type="button" onClick={() => setForm({ ...form, can_transfer_players_between_club_groups: true })}>{t("manager.administration.permissions.head")}</button>
          </div>
          <div className={permissionStyles.switches}>
            <PermissionSwitch label={t("manager.administration.permissions.groups")} description={t("manager.administration.permissions.groupsHelp")} checked={form.can_manage_assigned_groups} onChange={(checked) => setForm({ ...form, can_manage_assigned_groups: checked })} />
            <PermissionSwitch label={t("manager.administration.permissions.planning")} description={t("manager.administration.permissions.planningHelp")} checked={form.can_manage_assigned_group_planning} onChange={(checked) => setForm({ ...form, can_manage_assigned_group_planning: checked })} />
            <PermissionSwitch label={t("manager.administration.permissions.transfer")} description={t("manager.administration.permissions.transferHelp")} checked={form.can_transfer_players_between_club_groups} onChange={(checked) => setForm({ ...form, can_transfer_players_between_club_groups: checked })} />
            <PermissionSwitch label={t("manager.nav.ai")} description={t("manager.administration.permissions.aiHelp")} checked={form.coach_training_assistance_enabled} onChange={(checked) => setForm({ ...form, coach_training_assistance_enabled: checked })} />
          </div>
          <Actions saving={saving} label={t("manager.administration.permissions.save")}/>
        </section>
      </form>
      <form onSubmit={saveSeason}><section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{t("manager.administration.seasonSettings")}</h2></div></div><div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.performance.status")}</span><select value={seasonStatus} onChange={(e) => setSeasonStatus(e.target.value as "active" | "inactive")}><option value="active">{t("manager.administration.active")}</option><option value="inactive">{t("manager.administration.inactive")}</option></select></label>{seasonalFields.map((field) => <Custom key={field.id} field={field} value={seasonValues[field.id]} onChange={(v) => setSeasonValues({ ...seasonValues, [field.id]: v })}/>)}</div><Link className={actionStyles.secondaryButton} href="/manager/user-management/custom-fields">{t("manager.administration.addFields")}</Link><Actions saving={saving} label={t("manager.administration.saveSettings")}/></section></form>
    </> : coach ? <ManagerCoachStatistics clubId={clubId} coachId={coach.user_id} seasonId={seasonId} seasonFrom={selectedSeason?.starts_on} seasonTo={selectedSeason?.ends_on}/> : null}
    {passwordOpen && coach ? <AccessibleDialog onClose={closePassword} className={passwordStyles.dialog} label={t("manager.administration.coaches.changePassword")}>
      <form className={passwordStyles.form} onSubmit={changePassword}>
        <h2>{t("manager.administration.coaches.changePassword")}</h2>
        <p>{t("manager.administration.coaches.passwordHelp")}</p>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.loginIdentifier")}</span><input autoComplete="username" readOnly value={form.username || form.email || "—"} /></label>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.newPassword")}</span><input type="password" name="new-password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={passwordBusy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className={actionStyles.field}><span>{t("manager.administration.coaches.confirmPassword")}</span><input type="password" name="confirm-password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={passwordBusy} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {passwordError ? <div className={actionStyles.errorAlert} role="alert">{t(`manager.administration.coaches.${passwordError}`)}</div> : null}
        <div className={passwordStyles.actions}><button type="button" className={actionStyles.secondaryButton} disabled={passwordBusy} onClick={closePassword}>{t("common.cancel")}</button><button type="submit" className={actionStyles.primaryButton} disabled={passwordBusy}>{passwordBusy ? t("manager.administration.loading") : t("manager.administration.coaches.changePassword")}</button></div>
      </form>
    </AccessibleDialog> : null}
  </div>;
}
function Text({ label, value, onChange, type = "text", readOnly }: { label: string; value: string; onChange?: (v: string) => void; type?: string; readOnly?: boolean }) { return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{label}</span><input type={type} value={value} readOnly={readOnly} onChange={(e) => onChange?.(e.target.value)} /></label>; }
function PermissionSwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className={permissionStyles.switchRow}><span><b>{label}</b><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>; }
function Custom({ field, value, onChange }: { field: Field; value?: Value; onChange: (v: Value) => void }) {
  const { t } = useI18n();

  const options = field.options_json ?? [];
  if (field.field_type === "checkbox" || field.field_type === "radio") {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="user-mgmt-field"><legend className="user-mgmt-field-label">{field.label}</legend>{options.map((option) => <label key={option}><input type={field.field_type} name={field.id} checked={field.field_type === "checkbox" ? selected.includes(option) : value === option} onChange={(event) => onChange(field.field_type === "checkbox" ? event.target.checked ? [...selected, option] : selected.filter((item) => item !== option) : option)} />{option}</label>)}{field.description ? <small>{field.description}</small> : null}</fieldset>;
  }
  const control = field.field_type === "select" ? <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">{t("manager.administration.choose")}</option>{options.map((option) => <option key={option}>{option}</option>)}</select> : field.field_type === "boolean" ? <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value === "yes")}><option value="">{t("manager.content.undefined")}</option><option value="yes">{t("manager.content.yes")}</option><option value="no">{t("manager.content.no")}</option></select> : field.field_type === "long_text" ? <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /> : <input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}</span>{control}{field.description ? <small>{field.description}</small> : null}</label>;
}
function Actions({ saving, label }: { saving: boolean; label: string }) { const { t } = useI18n(); return <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: 16 }}><button className={actionStyles.primaryButton} type="submit" disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.saving") : label}</button></div>; }
