"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerJuniorFeedback, managerJuniorFormat, managerJuniorDate } from "@/lib/managerJuniorPresentation";
import { managerCount, managerLocaleTag, type ManagerTranslate } from "@/lib/managerLocale";
import type { AppLocale } from "@/lib/i18n/messages";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, Link2, Mail, Pencil, RefreshCw, Save, Send, Trash2, UserPlus, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import navigationStyles from "@/app/design-system/design-system.module.css";
import campStyles from "@/app/manager/camps/Camps.module.css";
import tableStyles from "@/components/manager/PlayerEditPage.module.css";
import { renderFamilyTemplate, renderAccessInvitationBody, type AccessStatus, type FamilyMailConfig } from "@/lib/familyAccess";
import ManagerPlayerStatistics from "@/components/manager/ManagerPlayerStatistics";
import ManagerPeriodicReport from "@/components/manager/ManagerPeriodicReport";

type Tab = "profile" | "documents" | "parent-access" | "handicap-history" | "statistics" | "periodic-report";
type FieldValue = string | boolean | string[];
type Field = { id: string; label: string; field_type: "text" | "short_text" | "long_text" | "number" | "date" | "select" | "radio" | "checkbox" | "boolean"; options_json?: string[] | null; is_active: boolean; legacy_binding?: string | null; scope: "permanent" | "season"; description?: string | null; is_required?: boolean; is_sensitive?: boolean };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };
type Member = { id: string; user_id: string; role: string; auth_email?: string | null; auth_last_sign_in_at?: string | null; is_active: boolean | null; is_performance: boolean | null; player_consent_status: "granted" | "pending" | "refused" | "adult" | null; custom_field_values?: Record<string, FieldValue>; profiles: { first_name: string | null; last_name: string | null; username: string | null; phone: string | null; birth_date: string | null; sex: string | null; handedness: string | null; handicap: number | null; address: string | null; postal_code: string | null; city: string | null; avs_no: string | null } | null };
type SeasonRecord = { club_member_id: string; registration_status?: "draft" | "active" | "waitlist" | "cancelled" | "completed"; custom_field_values?: Record<string, FieldValue> };
type GuardianProfile = { id: string; first_name: string | null; last_name: string | null };
type Guardian = { user_id: string; profiles: GuardianProfile | null };
type GuardianLink = { player_id: string; guardian_user_id: string; relation: string | null; is_primary: boolean | null };
type ConsentData = { consent: { status: "pending" | "granted" | "refused" | "adult"; decided_at: string | null; signer_guardian_user_id: string | null; signer_name: string | null; source: "parent_portal" | "manager" | "import"; consent_version: string | null; internal_notes: string | null }; history: Array<{ id: string; status: string; decided_at: string | null; signer_name: string | null; source: string; consent_version: string | null; changed_at: string }>; guardians: Array<{ guardian_user_id: string; guardian_name: string; email: string | null; is_primary: boolean; relation: string | null }> };
type FamilyParent = { parent_user_id: string; parent_name: string; parent_username: string | null; parent_email: string | null; parent_status: AccessStatus; parent_last_sent_at: string | null; parent_last_activity_at: string | null; parent_send_count: number };
type FamilyJunior = { junior_user_id: string; junior_name: string; junior_username: string | null; junior_email: string | null; parents: Array<{ parent_user_id: string; parent_name: string; parent_email: string | null; is_primary: boolean }>; recipient_user_id: string | null; recipient_name: string | null; recipient_email: string | null; junior_status: AccessStatus; junior_last_sent_at: string | null; junior_last_activity_at: string | null; junior_send_count: number };
type FamilyData = { parents: FamilyParent[]; juniors: FamilyJunior[]; mail_config: FamilyMailConfig; club: { name: string } };
type AccessPreview = { name: string; recipient: string | null; canSend: boolean; subject: string; body: string; kind: "parent_access" | "junior_access"; parent_user_id?: string; junior_user_id?: string; recipient_user_id?: string };
type HandicapHistoryEntry = { id: string; effective_date: string; value: number; note: string | null; source: string; created_at: string; updated_at: string };

async function headers() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}; }
const empty = (value: FieldValue | undefined) => value == null || value === "" || (Array.isArray(value) && value.length === 0);
function normalizeProfileSex(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("fr");
  if (["f", "femme", "female"].includes(normalized)) return "female";
  if (["m", "homme", "male"].includes(normalized)) return "male";
  if (["autre", "other"].includes(normalized)) return "other";
  return "";
}

export default function PlayerEditPage({ memberId }: { memberId: string }) {
  const { t, locale } = useI18n();
  const { parentName, formatDate, consentStatusLabel, consentSourceLabel, relationLabel, accessStatusClass } = useMemo(() => juniorLabels(t, locale), [t, locale]);
  const query = useSearchParams(); const clubId = query.get("club") ?? ""; const initialSeasonId = query.get("season") ?? "";
  const requestedTab = query.get("tab");
  const [tab, setTab] = useState<Tab>(requestedTab === "parent-access" || requestedTab === "statistics" || requestedTab === "periodic-report" ? requestedTab : "profile"); const [seasonId, setSeasonId] = useState(initialSeasonId); const [seasons, setSeasons] = useState<Season[]>([]); const [fields, setFields] = useState<Field[]>([]); const [member, setMember] = useState<Member | null>(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [reminderRecipient, setReminderRecipient] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ first_name: "", last_name: "", username: "", auth_email: "", phone: "", birth_date: "", sex: "", handedness: "", handicap: "", address: "", postal_code: "", city: "", avs_no: "", is_active: true, is_performance: false, player_consent_status: "pending" });
  const [permanentValues, setPermanentValues] = useState<Record<string, FieldValue>>({}); const [seasonValues, setSeasonValues] = useState<Record<string, FieldValue>>({}); const [seasonStatus, setSeasonStatus] = useState<"active" | "inactive">("active");
  const [parents, setParents] = useState<Guardian[]>([]); const [guardianLinks, setGuardianLinks] = useState<GuardianLink[]>([]); const [selectedParentId, setSelectedParentId] = useState("");
  const [parentMembers, setParentMembers] = useState<Member[]>([]); const [editingParentId, setEditingParentId] = useState("");
  const [parentForm, setParentForm] = useState({ first_name: "", last_name: "", email: "", phone: "", relation: "other", is_primary: false }); const [parentErrors, setParentErrors] = useState<Record<string, string>>({}); const [createdAccess, setCreatedAccess] = useState<{ username: string; tempPassword: string | null } | null>(null);
  const [existingParentRelation, setExistingParentRelation] = useState("other"); const [existingParentPrimary, setExistingParentPrimary] = useState(false);
  const [parentEditForm, setParentEditForm] = useState({ first_name: "", last_name: "", username: "", email: "", password: "", phone: "", address: "", postal_code: "", city: "", relation: "other", is_primary: false }); const [parentEditErrors, setParentEditErrors] = useState<Record<string, string>>({});
  const [consentData, setConsentData] = useState<ConsentData | null>(null);
  const [consentForm, setConsentForm] = useState({ status: "pending" as ConsentData["consent"]["status"], decided_at: "", signer_guardian_user_id: "", signer_name: "", source: "manager" as ConsentData["consent"]["source"], consent_version: "", internal_notes: "" });
  const [familyData, setFamilyData] = useState<FamilyData | null>(null);
  const [accessPreview, setAccessPreview] = useState<AccessPreview | null>(null);
  const [handicapHistory, setHandicapHistory] = useState<HandicapHistoryEntry[]>([]); const [handicapHistoryLoading, setHandicapHistoryLoading] = useState(false); const [handicapHistoryError, setHandicapHistoryError] = useState("");
  const parentEditCardRef = useRef<HTMLFormElement | null>(null);

  function selectTab(nextTab: Tab) { setTab(nextTab); setMessage(""); setReminderRecipient(""); }
  const permanentFields = useMemo(() => fields.filter((field) => field.scope === "permanent"), [fields]); const seasonFields = useMemo(() => fields.filter((field) => field.scope === "season"), [fields]);

  async function load() {
    if (!clubId) { setError(t("manager.administration.missingClub")); setLoading(false); return; }
    setLoading(true);
    try {
      const auth = await headers();
      const [membersResponse, seasonsResponse, guardiansResponse] = await Promise.all([
        fetch(`/api/manager/clubs/${clubId}/members`, { headers: auth, cache: "no-store" }),
        fetch(`/api/manager/clubs/${clubId}/seasons`, { headers: auth, cache: "no-store" }),
        fetch(`/api/manager/clubs/${clubId}/guardians`, { headers: auth, cache: "no-store" }),
      ]);
      const [membersJson, seasonsJson, guardiansJson] = await Promise.all([membersResponse.json(), seasonsResponse.json(), guardiansResponse.json()]);
      if (!membersResponse.ok) throw new Error(membersJson.error); if (!seasonsResponse.ok) throw new Error(seasonsJson.error); if (!guardiansResponse.ok) throw new Error(guardiansJson.error);
      const allMembers = (membersJson.members ?? []) as Member[];
      const next = allMembers.find((item) => item.id === memberId && item.role === "player");
      if (!next) throw new Error(t("manager.junior.edit.notFound"));
      const nextSeasons = seasonsJson.seasons ?? [];
      const selectedSeason = nextSeasons.some((season: Season) => season.id === seasonId) ? seasonId : nextSeasons.find((season: Season) => season.is_current)?.id ?? nextSeasons[0]?.id ?? "";
      setMember(next); setParentMembers(allMembers.filter((item) => item.role === "parent")); setParents(guardiansJson.parents ?? []); setGuardianLinks((guardiansJson.all_links ?? guardiansJson.links) ?? []); setFields(((membersJson.playerFields ?? []) as Field[]).filter((field) => field.is_active && !field.legacy_binding)); setSeasons(nextSeasons); setSeasonId(selectedSeason); setPermanentValues(next.custom_field_values ?? {});
      const profile = next.profiles;
      setForm({ first_name: profile?.first_name ?? "", last_name: profile?.last_name ?? "", username: profile?.username ?? "", auth_email: next.auth_email?.endsWith("@noemail.local") ? "" : next.auth_email ?? "", phone: profile?.phone ?? "", birth_date: profile?.birth_date ?? "", sex: profile?.sex ?? "", handedness: profile?.handedness ?? "", handicap: profile?.handicap == null ? "" : String(profile.handicap), address: profile?.address ?? "", postal_code: profile?.postal_code ?? "", city: profile?.city ?? "", avs_no: profile?.avs_no ?? "", is_active: next.is_active !== false, is_performance: Boolean(next.is_performance), player_consent_status: next.player_consent_status ?? "pending" });
      const [consentResponse, familyResponse] = await Promise.all([
        fetch(`/api/manager/clubs/${clubId}/players/${next.user_id}/consent`, { headers: auth, cache: "no-store" }),
        fetch(`/api/manager/clubs/${clubId}/access-invitations`, { headers: auth, cache: "no-store" }),
      ]);
      const [consentJson, familyJson] = await Promise.all([consentResponse.json(), familyResponse.json()]);
      if (!consentResponse.ok) throw new Error(consentJson.error); if (!familyResponse.ok) throw new Error(familyJson.error);
      setConsentData(consentJson); setFamilyData(familyJson);
      await loadHandicapHistory(next.user_id);
      const consent = consentJson.consent;
      setConsentForm({ status: consent.status, decided_at: consent.decided_at ? String(consent.decided_at).slice(0, 10) : "", signer_guardian_user_id: consent.signer_guardian_user_id ?? "", signer_name: consent.signer_name ?? "", source: consent.source === "import" ? "import" : "manager", consent_version: consent.consent_version ?? "", internal_notes: consent.internal_notes ?? "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.loadError")); }
    finally { setLoading(false); }
  }
  async function loadHandicapHistory(playerUserId = member?.user_id ?? "") {
    if (!playerUserId || !clubId) return;
    setHandicapHistoryLoading(true); setHandicapHistoryError("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/players/${playerUserId}/handicap-history`, { headers: await headers(), cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.junior.edit.historyError"));
      setHandicapHistory((json.entries ?? []) as HandicapHistoryEntry[]);
      if (json.current_handicap != null) setForm((current) => ({ ...current, handicap: String(json.current_handicap) }));
    } catch (cause) { setHandicapHistoryError(cause instanceof Error ? cause.message : t("manager.junior.edit.historyError")); }
    finally { setHandicapHistoryLoading(false); }
  }
  async function loadSeason(id: string) { if (!id) { setSeasonValues({}); setSeasonStatus("active"); return; } try { const response = await fetch(`/api/manager/clubs/${clubId}/seasons/${id}/records`, { headers: await headers(), cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error); const record = (json.records ?? []).find((item: SeasonRecord) => item.club_member_id === memberId) as SeasonRecord | undefined; setSeasonValues(record?.custom_field_values ?? {}); setSeasonStatus(record?.registration_status === "cancelled" ? "inactive" : "active"); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.administration.seasonLoadError")); } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (clubId && seasonId) void loadSeason(seasonId); }, [clubId, seasonId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (permanentValues.__profile_sex === undefined) {
      if (member) setPermanentValues((current) => ({ ...current, __profile_sex: normalizeProfileSex(member.profiles?.sex) }));
      return;
    }
    setForm((current) => ({ ...current, sex: String(permanentValues.__profile_sex ?? "") }));
  }, [member, permanentValues.__profile_sex]);

  function validate(target: "profile" | "season") { const next: Record<string, string> = {}; if (target === "profile") { if (!form.first_name.trim()) next.first_name = t("manager.administration.firstNameRequired"); if (!form.last_name.trim()) next.last_name = t("manager.administration.lastNameRequired"); if (form.auth_email.trim() && !/^\S+@\S+\.\S+$/.test(form.auth_email.trim())) next.auth_email = t("manager.administration.validEmail"); for (const field of permanentFields) if (field.is_required && !field.is_sensitive && empty(permanentValues[field.id])) next[`permanent:${field.id}`] = t("manager.junior.fieldRequired"); } else for (const field of seasonFields) if (field.is_required && !field.is_sensitive && empty(seasonValues[field.id])) next[`season:${field.id}`] = t("manager.junior.fieldRequired"); setErrors(next); return Object.keys(next).length === 0; }
  async function saveProfile(event: React.FormEvent) { event.preventDefault(); if (!validate("profile")) return; setSaving(true); setError(""); setMessage(""); setReminderRecipient(""); try { const safeValues = Object.fromEntries(permanentFields.filter((field) => !field.is_sensitive).map((field) => [field.id, permanentValues[field.id] ?? null])); const response = await fetch(`/api/manager/clubs/${clubId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ memberId, role: "player", first_name: form.first_name, last_name: form.last_name, username: form.username, phone: form.phone, birth_date: form.birth_date, sex: String(permanentValues.__profile_sex ?? form.sex ?? ""), handedness: form.handedness, address: form.address, postal_code: form.postal_code, city: form.city, avs_no: form.avs_no, is_active: form.is_active, is_performance: form.is_performance, player_consent_status: form.player_consent_status, custom_field_values: safeValues }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setMessage(t("manager.junior.edit.saved")); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); } finally { setSaving(false); } }
  async function saveSeason(event: React.FormEvent) { event.preventDefault(); if (!seasonId || !validate("season")) return; setSaving(true); setError(""); setMessage(""); setReminderRecipient(""); try { const safeValues = Object.fromEntries(seasonFields.filter((field) => !field.is_sensitive).map((field) => [field.id, seasonValues[field.id] ?? null])); const response = await fetch(`/api/manager/clubs/${clubId}/seasons/${seasonId}/records`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ member_ids: [memberId], registration_status: seasonStatus === "active" ? "active" : "cancelled", custom_field_values: safeValues }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setMessage(t("manager.junior.edit.seasonSaved")); await loadSeason(seasonId); } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); } finally { setSaving(false); } }
  async function saveConsent() {
    if (!member) return; setSaving(true); setError(""); setMessage(""); setReminderRecipient("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/players/${member.user_id}/consent`, { method: "PUT", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify(consentForm) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setConsentData({ consent: json.consent, history: json.history, guardians: json.guardians }); setForm((current) => ({ ...current, player_consent_status: consentForm.status })); setMessage(t("manager.junior.edit.consentSaved")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.saveError")); }
    finally { setSaving(false); }
  }

  async function sendConsentReminder() {
    if (!member || !window.confirm(t("manager.junior.edit.confirmReminder"))) return; setSaving(true); setError(""); setMessage(""); setReminderRecipient("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/players/${member.user_id}/consent`, { method: "POST", headers: await headers() }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setReminderRecipient(String(json.recipient ?? "")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.sendError")); }
    finally { setSaving(false); }
  }

  async function refreshGuardianAccess() {
    if (!member) return;
    const auth = await headers();
    const [response, membersResponse, familyResponse, consentResponse] = await Promise.all([
      fetch(`/api/manager/clubs/${clubId}/guardians`, { headers: auth, cache: "no-store" }),
      fetch(`/api/manager/clubs/${clubId}/members`, { headers: auth, cache: "no-store" }),
      fetch(`/api/manager/clubs/${clubId}/access-invitations`, { headers: auth, cache: "no-store" }),
      fetch(`/api/manager/clubs/${clubId}/players/${member.user_id}/consent`, { headers: auth, cache: "no-store" }),
    ]);
    const [json, membersJson, familyJson, consentJson] = await Promise.all([response.json(), membersResponse.json(), familyResponse.json(), consentResponse.json()]);
    if (!response.ok || !membersResponse.ok || !familyResponse.ok || !consentResponse.ok) throw new Error(json.error ?? membersJson.error ?? familyJson.error ?? consentJson.error ?? t("manager.junior.edit.accessError"));
    setParents(json.parents ?? []); setGuardianLinks((json.all_links ?? json.links) ?? []); setParentMembers((membersJson.members ?? []).filter((item: Member) => item.role === "parent")); setFamilyData(familyJson); setConsentData(consentJson);
  }

  async function linkParent(parentUserId: string, relation = "other", isPrimary = false) {
    if (!member?.user_id || !parentUserId) return;
    const response = await fetch(`/api/manager/clubs/${clubId}/guardians`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await headers()) },
      body: JSON.stringify({ player_id: member.user_id, guardian_user_id: parentUserId, relation, is_primary: isPrimary }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? t("manager.junior.edit.linkError"));
  }

  async function createParentAccess(event: React.FormEvent) {
    event.preventDefault();
    if (!member?.user_id || saving) return;
    const nextErrors: Record<string, string> = {};
    if (!parentForm.first_name.trim()) nextErrors.parent_first_name = t("manager.administration.firstNameRequired");
    if (!parentForm.last_name.trim()) nextErrors.parent_last_name = t("manager.administration.lastNameRequired");
    if (!/^\S+@\S+\.\S+$/.test(parentForm.email.trim())) nextErrors.parent_email = t("manager.administration.validEmail");
    setParentErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true); setError(""); setMessage(""); setReminderRecipient(""); setCreatedAccess(null);
    try {
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ ...parentForm, first_name: parentForm.first_name.trim(), last_name: parentForm.last_name.trim(), email: parentForm.email.trim().toLowerCase(), phone: parentForm.phone.trim(), role: "parent", player_id: member.user_id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.junior.edit.createAccessError"));
      const parentUserId = String(json.user?.id ?? "");
      if (!parentUserId) throw new Error(t("manager.junior.edit.parentLinkFailed"));
      await linkParent(parentUserId, parentForm.relation, parentForm.is_primary);
      setParentForm({ first_name: "", last_name: "", email: "", phone: "", relation: "other", is_primary: false });
      setCreatedAccess({ username: String(json.username ?? ""), tempPassword: json.tempPassword ?? null });
      setMessage(t(json.tempPassword ? "manager.junior.edit.parentCreated" : "manager.junior.edit.parentLinked"));
      await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.createAccessError")); } finally { setSaving(false); }
  }

  async function attachExistingParent() {
    if (!selectedParentId) return;
    setSaving(true); setError(""); setMessage(""); setReminderRecipient(""); setCreatedAccess(null);
    try { await linkParent(selectedParentId, existingParentRelation, existingParentPrimary); setSelectedParentId(""); setExistingParentRelation("other"); setExistingParentPrimary(false); setMessage(t("manager.junior.edit.parentLinked")); await refreshGuardianAccess(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.linkError")); }
    finally { setSaving(false); }
  }

  async function removeParentAccess(link: GuardianLink) {
    if (!window.confirm(t("manager.junior.edit.confirmRemove"))) return;
    setSaving(true); setError(""); setMessage(""); setReminderRecipient(""); setCreatedAccess(null);
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/guardians`, { method: "DELETE", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ player_id: link.player_id, guardian_user_id: link.guardian_user_id }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.junior.edit.removeError"));
      setMessage(t("manager.junior.edit.parentRemoved"));
      await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.removeError")); } finally { setSaving(false); }
  }

  function startParentEdit(parentUserId: string) {
    const parentMember = parentMembers.find((item) => item.user_id === parentUserId);
    if (!parentMember) { setError(t("manager.junior.edit.parentNotEditable")); return; }
    const profile = parentMember.profiles;
    setEditingParentId(parentUserId);
    setParentEditErrors({}); setError(""); setMessage(""); setReminderRecipient(""); setCreatedAccess(null);
    const link = guardianLinks.find((item) => item.player_id === member?.user_id && item.guardian_user_id === parentUserId);
    setParentEditForm({ first_name: profile?.first_name ?? "", last_name: profile?.last_name ?? "", username: profile?.username ?? "", email: parentMember.auth_email?.endsWith("@noemail.local") ? "" : parentMember.auth_email ?? "", password: "", phone: profile?.phone ?? "", address: profile?.address ?? "", postal_code: profile?.postal_code ?? "", city: profile?.city ?? "", relation: link?.relation ?? "other", is_primary: Boolean(link?.is_primary) });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => parentEditCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  async function saveParentEdit(event: React.FormEvent) {
    event.preventDefault();
    const parentMember = parentMembers.find((item) => item.user_id === editingParentId);
    if (!parentMember) return;
    const nextErrors: Record<string, string> = {};
    if (!parentEditForm.first_name.trim()) nextErrors.edit_first_name = t("manager.administration.firstNameRequired");
    if (!parentEditForm.last_name.trim()) nextErrors.edit_last_name = t("manager.administration.lastNameRequired");
    if (!parentEditForm.username.trim()) nextErrors.edit_username = t("manager.administration.usernameRequired");
    setParentEditErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true); setError(""); setMessage(""); setReminderRecipient("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ memberId: parentMember.id, role: "parent", first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim(), username: parentEditForm.username.trim().toLowerCase(), phone: parentEditForm.phone.trim(), address: parentEditForm.address.trim(), postal_code: parentEditForm.postal_code.trim(), city: parentEditForm.city.trim() }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.junior.edit.parentSaveError"));
      await linkParent(editingParentId, parentEditForm.relation, parentEditForm.is_primary);
      setParentMembers((current) => current.map((item) => item.user_id === editingParentId ? { ...item, auth_email: parentEditForm.email.trim().toLowerCase(), profiles: item.profiles ? { ...item.profiles, first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim(), username: parentEditForm.username.trim().toLowerCase(), phone: parentEditForm.phone.trim(), address: parentEditForm.address.trim(), postal_code: parentEditForm.postal_code.trim(), city: parentEditForm.city.trim() } : item.profiles } : item));
      setParents((current) => current.map((item) => item.user_id === editingParentId ? { ...item, profiles: item.profiles ? { ...item.profiles, first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim() } : item.profiles } : item));
      setEditingParentId(""); setMessage(t("manager.junior.edit.parentSaved")); await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.parentSaveError")); } finally { setSaving(false); }
  }

  async function sendFamilyAccess(kind: "parent_access" | "junior_access", parentUserId?: string) {
    if (!member || !familyData) return;
    if (!window.confirm(kind === "parent_access" ? t("manager.junior.edit.confirmParentInvite") : t("manager.junior.edit.confirmJuniorInvite"))) return;
    setSaving(true); setError(""); setMessage(""); setReminderRecipient("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, { method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify(kind === "parent_access" ? { kind, parent_user_id: parentUserId } : { kind, junior_user_id: member.user_id, recipient_user_id: familyData.juniors.find((row) => row.junior_user_id === member.user_id)?.recipient_user_id }) }); const json = await response.json(); const sendFailed = !response.ok || Number(json.summary?.sent ?? 0) === 0 || (json.summary?.errors?.length ?? 0) > 0; if (sendFailed) throw new Error(json.error ?? json.summary?.errors?.[0]?.error ?? json.summary?.skipped?.[0]?.reason ?? t("manager.junior.edit.sendError")); setMessage(t("manager.junior.edit.emailSent")); await refreshGuardianAccess(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("manager.junior.edit.sendError")); }
    finally { setSaving(false); setAccessPreview(null); }
  }

  function previewParentAccess(parent: FamilyParent) {
    if (!familyData) return; const variables = { club_name: familyData.club.name, parent_name: parent.parent_name, parent_username: parent.parent_username ?? "", parent_username_or_existing: parent.parent_username ?? "votre compte existant", reset_url: "https://www.activitee.golf/reset-password?invite_token=exemple", app_url: "https://www.activitee.golf/", player_guide_url: "https://www.activitee.golf/guide-junior.pdf" };
    setAccessPreview({ name: parent.parent_name, recipient: parent.parent_email, canSend: Boolean(parent.parent_email) && parent.parent_status !== "not_ready", subject: renderFamilyTemplate(familyData.mail_config.parent_subject, variables), body: renderAccessInvitationBody(familyData.mail_config.parent_body, variables), kind: "parent_access", parent_user_id: parent.parent_user_id });
  }

  function previewJuniorAccess(junior: FamilyJunior) {
    if (!familyData) return; const parent = junior.parents.find((item) => item.parent_user_id === junior.recipient_user_id); const direct = Boolean(junior.junior_email); const variables = { club_name: familyData.club.name, parent_name: parent?.parent_name ?? "", junior_name: junior.junior_name, junior_username: junior.junior_username ?? "non renseigné", reset_url: "https://www.activitee.golf/reset-password?invite_token=exemple", app_url: "https://www.activitee.golf/", player_guide_url: "https://www.activitee.golf/guide-junior.pdf" };
    setAccessPreview({ name: junior.junior_name, recipient: junior.recipient_email, canSend: Boolean(junior.recipient_email) && junior.junior_status !== "not_ready", subject: renderFamilyTemplate(direct ? familyData.mail_config.junior_direct_subject : familyData.mail_config.junior_parent_subject, variables), body: renderAccessInvitationBody(direct ? familyData.mail_config.junior_direct_body : familyData.mail_config.junior_parent_body, variables), kind: "junior_access", junior_user_id: junior.junior_user_id, recipient_user_id: junior.recipient_user_id ?? undefined });
  }

  const linkedParents = useMemo(() => member ? guardianLinks.filter((link) => link.player_id === member.user_id) : [], [guardianLinks, member]);
  const parentById = useMemo(() => new Map(parents.map((parent) => [parent.user_id, parent])), [parents]);
  const linkedParentIds = useMemo(() => new Set(linkedParents.map((link) => link.guardian_user_id)), [linkedParents]);
  const availableParents = useMemo(() => parents.filter((parent) => !linkedParentIds.has(parent.user_id)).sort((left, right) => parentName(left).localeCompare(parentName(right), managerLocaleTag(locale))), [parents, linkedParentIds, locale, parentName]);
  const familyParentById = useMemo(() => new Map((familyData?.parents ?? []).map((parent) => [parent.parent_user_id, parent])), [familyData]);
  const juniorAccess = useMemo(() => familyData?.juniors.find((junior) => junior.junior_user_id === member?.user_id) ?? null, [familyData, member]);
  const selectedSeason = useMemo(() => seasons.find((season) => season.id === seasonId) ?? null, [seasonId, seasons]);
  const backUrl = `/manager/user-management/players?club=${clubId}${seasonId ? `&season=${seasonId}` : ""}`; const name = [member?.profiles?.first_name, member?.profiles?.last_name].filter(Boolean).join(" ") || t("manager.performance.junior");
  if (loading) return <div className={`${styles.page} ${tableStyles.page}`}><section className={styles.overview}><ListLoadingBlock label={t("manager.junior.edit.loading")} /></section></div>;
  return <div className={`${styles.page} ${tableStyles.page}`}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>{t("manager.fields.player")}</Link> / {t("manager.junior.edit.profile")}</nav>
    <div className={styles.topline}><div><h1>{name}</h1><p className={styles.lead}>{t("manager.junior.edit.lead")}</p></div><div className={`${actionStyles.topActions} ${tableStyles.topActions}`}><label className="groups-season-nav-select"><select aria-label={t("manager.season")} value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={seasons.length === 0}>{seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? t("manager.settings.seasons.currentSuffix") : ""}</option>)}</select></label><Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16} />{t("manager.administration.backToList")}</Link></div></div>
    {reminderRecipient ? <div className={actionStyles.successAlert} role="status">{managerJuniorFormat(t, "edit.reminderSent", { recipient: reminderRecipient })}</div> : null}
    {error ? <div className={actionStyles.errorAlert} role="alert">{managerJuniorFeedback(t, error)}</div> : null}
    <section className={styles.overview}><div className={`${navigationStyles.tabs} ${tableStyles.tabs}`} role="tablist" aria-label={t("manager.junior.edit.tabs")}><button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => selectTab("profile")}>{t("manager.administration.profile")}</button><button type="button" role="tab" aria-selected={tab === "documents"} onClick={() => selectTab("documents")}>{t("manager.administration.consent")}</button><button type="button" role="tab" aria-selected={tab === "parent-access"} onClick={() => selectTab("parent-access")}>{t("manager.junior.edit.family")}</button><button type="button" role="tab" aria-selected={tab === "handicap-history"} onClick={() => selectTab("handicap-history")}>{t("manager.junior.edit.handicapHistory")}</button><button type="button" role="tab" aria-selected={tab === "statistics"} onClick={() => selectTab("statistics")}>{t("manager.administration.statistics")}</button><button type="button" role="tab" aria-selected={tab === "periodic-report"} onClick={() => selectTab("periodic-report")}>{t("manager.junior.emails.periodic_report.title")}</button></div></section>{message ? <div className={actionStyles.successAlert} role="status">{managerJuniorFeedback(t, message)}</div> : null}
    {tab === "profile" ? <div style={{ display: "grid", gap: 18 }}><form onSubmit={saveProfile} noValidate><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>{t("manager.administration.profile")}</h2><p>{t("manager.junior.edit.profileHelp")}</p></div></div><div className="user-mgmt-form-grid"><Input label={t("manager.profile.firstName")} required value={form.first_name} onChange={(value) => setForm({ ...form, first_name: value })} error={errors.first_name} /><Input label={t("manager.content.name")} required value={form.last_name} onChange={(value) => setForm({ ...form, last_name: value })} error={errors.last_name} /><Input label={t("manager.profile.birthDate")} type="date" value={form.birth_date} onChange={(value) => setForm({ ...form, birth_date: value })} /><Input label={t("manager.administration.loginEmail")} type="email" value={form.auth_email} readOnly /><Input label={t("manager.profile.phone")} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><Input label={t("manager.profile.address")} full value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><Input label={t("manager.profile.postalCode")} value={form.postal_code} onChange={(value) => setForm({ ...form, postal_code: value })} /><Input label={t("manager.profile.city")} value={form.city} onChange={(value) => setForm({ ...form, city: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.profile.handedness")}</span><select value={form.handedness} onChange={(event) => setForm({ ...form, handedness: event.target.value })}><option value="">{t("manager.content.undefinedCapacity")}</option><option value="right">{t("manager.junior.right")}</option><option value="left">{t("manager.junior.left")}</option></select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("coach.directory.gender")}</span><select value={String(permanentValues.__profile_sex ?? "")} onChange={(event) => setPermanentValues((current) => ({ ...current, __profile_sex: event.target.value }))}><option value="">{t("manager.junior.edit.notProvided")}</option><option value="female">{t("manager.profile.female")}</option><option value="male">{t("manager.profile.male")}</option><option value="other">{t("manager.junior.relation.other")}</option></select></label><Collection fields={permanentFields} values={permanentValues} setValues={setPermanentValues} errors={errors} prefix="permanent" /></div><SaveBar saving={saving} label={t("manager.administration.saveProfile")} /></section></form><form onSubmit={saveSeason} style={{ display: "grid", gap: 18 }}><section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{t("manager.administration.seasonSettings")}</h2><p>{t("manager.junior.edit.seasonHelp")}</p></div></div>{seasonId ? <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.performance.status")}</span><select value={seasonStatus} onChange={(event) => setSeasonStatus(event.target.value as "active" | "inactive")}><option value="active">{t("manager.administration.active")}</option><option value="inactive">{t("manager.administration.inactive")}</option></select></label></div> : null}{seasonId ? <Collection fields={seasonFields} values={seasonValues} setValues={setSeasonValues} errors={errors} prefix="season" /> : <div className="marketplace-empty">{t("manager.junior.edit.selectSeason")}</div>}{seasonId ? <SaveBar saving={saving} label={t("manager.administration.saveSettings")} /> : null}</section></form></div> : null}
    {tab === "documents" ? <div style={{ display: "grid", gap: 18 }}><section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>{t("manager.administration.consent")}</h2><p>{t("manager.junior.edit.consentHelp")}</p></div></div><div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.performance.status")}</span><select value={consentForm.status} onChange={(event) => setConsentForm({ ...consentForm, status: event.target.value as ConsentData["consent"]["status"] })}><option value="pending">{t("manager.administration.consent.pending")}</option><option value="granted">{t("manager.administration.consent.granted")}</option><option value="refused">{t("manager.content.declined")}</option><option value="adult">{t("manager.administration.consent.adult")}</option></select></label><Input label={t("manager.junior.edit.decisionDate")} type="date" value={consentForm.decided_at} onChange={(value) => setConsentForm({ ...consentForm, decided_at: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.signingGuardian")}</span><select value={consentForm.signer_guardian_user_id} onChange={(event) => { const guardian = consentData?.guardians.find((item) => item.guardian_user_id === event.target.value); setConsentForm({ ...consentForm, signer_guardian_user_id: event.target.value, signer_name: guardian?.guardian_name ?? consentForm.signer_name }); }}><option value="">{t("manager.junior.edit.notProvided")}</option>{(consentData?.guardians ?? []).map((guardian) => <option key={guardian.guardian_user_id} value={guardian.guardian_user_id}>{guardian.guardian_name}</option>)}</select></label><Input label={t("manager.junior.edit.signerName")} value={consentForm.signer_name} onChange={(value) => setConsentForm({ ...consentForm, signer_name: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.origin")}</span><select value={consentForm.source} onChange={(event) => setConsentForm({ ...consentForm, source: event.target.value as ConsentData["consent"]["source"] })}><option value="manager">{t("manager.junior.edit.managerEntry")}</option><option value="import">{t("manager.junior.edit.import")}</option></select></label><Input label={t("manager.junior.edit.consentVersion")} value={consentForm.consent_version} onChange={(value) => setConsentForm({ ...consentForm, consent_version: value })} /><label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">{t("manager.junior.edit.internalNotes")}</span><textarea rows={4} value={consentForm.internal_notes} onChange={(event) => setConsentForm({ ...consentForm, internal_notes: event.target.value })} /></label></div><CardActions>{consentForm.status === "pending" && consentData?.guardians.some((guardian) => guardian.email) ? <button className={actionStyles.secondaryButton} type="button" disabled={saving} onClick={() => void sendConsentReminder()}><Mail size={16} />{t("manager.junior.edit.remind")}</button> : null}<button className={actionStyles.primaryButton} type="button" disabled={saving} onClick={() => void saveConsent()}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.saving") : t("manager.junior.edit.saveConsent")}</button></CardActions></section><section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.junior.report.history")}</h2><p>{t("manager.junior.edit.historyHelp")}</p></div></div>{consentData?.history.length ? <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>{t("manager.fields.date")}</th><th>{t("manager.performance.status")}</th><th>{t("manager.junior.edit.signer")}</th><th>{t("manager.junior.edit.origin")}</th><th>{t("manager.junior.edit.version")}</th></tr></thead><tbody>{consentData.history.map((entry) => <tr key={entry.id}><td data-label={t("manager.fields.date")}>{formatDate(entry.changed_at)}</td><td data-label={t("manager.performance.status")}><span className={campStyles.badge}>{consentStatusLabel(entry.status)}</span></td><td data-label={t("manager.junior.edit.signer")}>{entry.signer_name ?? "—"}</td><td data-label={t("manager.junior.edit.origin")}>{consentSourceLabel(entry.source)}</td><td data-label={t("manager.junior.edit.version")}>{entry.consent_version ?? "—"}</td></tr>)}</tbody></table></div> : <div className={campStyles.empty}>{t("manager.junior.edit.emptyHistory")}</div>}</section></div> : null}
    {tab === "handicap-history" ? <HandicapHistoryView entries={handicapHistory} currentHandicap={form.handicap ? Number(form.handicap) : null} loading={handicapHistoryLoading} error={handicapHistoryError} onRefresh={() => void loadHandicapHistory()} /> : null}
    {tab === "statistics" && member ? <ManagerPlayerStatistics clubId={clubId} playerId={member.user_id} seasonRange={selectedSeason ? { from: selectedSeason.starts_on, to: selectedSeason.ends_on } : undefined} /> : null}
    {tab === "periodic-report" && member ? <ManagerPeriodicReport clubId={clubId} playerId={member.user_id} familyUrl={`/manager/user-management/players/${memberId}?club=${clubId}${seasonId ? `&season=${seasonId}` : ""}&tab=parent-access`} /> : null}
    {tab === "parent-access" ? <div style={{ display: "grid", gap: 18 }}>
      <section className={campStyles.panel}>
        <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.edit.parentsAccess")}</h2><p>{t("manager.junior.edit.parentsHelp")}</p></div></div>
        {linkedParents.length === 0 ? <div className={campStyles.empty}>{t("manager.junior.edit.noParentAccess")}</div> : <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>{t("manager.content.parent")}</th><th>{t("manager.junior.edit.relation")}</th><th>{t("manager.junior.edit.contact")}</th><th>{t("manager.junior.edit.invitation")}</th><th>{t("coach.activity.other")}</th><th>{t("manager.content.actions")}</th></tr></thead><tbody>{linkedParents.map((link) => { const parent = parentById.get(link.guardian_user_id); const access = familyParentById.get(link.guardian_user_id); const name = parentName(parent); return <tr key={link.guardian_user_id}><td data-label={t("manager.content.parent")}><div className={campStyles.titleCell}><b>{name}</b><span className={campStyles.muted}>{link.is_primary ? t("manager.junior.edit.primary") : t("manager.junior.edit.linkedContact")}</span></div></td><td data-label={t("manager.junior.edit.relation")}>{relationLabel(link.relation)}</td><td data-label={t("manager.junior.edit.contact")}>{access?.parent_email ?? t("manager.junior.edit.emailMissing")}<span className={campStyles.muted} style={{ display: "block" }}>{access?.parent_username ?? t("manager.junior.edit.usernameMissing")}</span></td><td data-label={t("manager.junior.edit.invitation")}><span className={`${campStyles.badge} ${access ? accessStatusClass(access.parent_status) : tableStyles.statusDanger}`}>{access ? t(`manager.junior.edit.status.${access.parent_status}`) : t("manager.junior.edit.incomplete")}</span><span className={campStyles.muted} style={{ display: "block" }}>{t("manager.junior.edit.lastSent")} : {formatDate(access?.parent_last_sent_at ?? null)}</span></td><td data-label={t("coach.activity.other")}>{formatDate(access?.parent_last_activity_at ?? null)}</td><td data-label={t("manager.content.actions")} className={tableStyles.actionCell}><div className={campStyles.actions}><button type="button" className={campStyles.iconButton} aria-label={managerJuniorFormat(t, "edit.previewParent", { name })} title={t("manager.administration.criteria.previewName")} disabled={!access} onClick={() => access && previewParentAccess(access)}><Eye size={15} /></button><button type="button" className={campStyles.iconButton} aria-label={managerJuniorFormat(t, access?.parent_send_count ? "edit.resendParent" : "edit.sendParent", { name })} title={access?.parent_send_count ? t("manager.junior.edit.resend") : t("manager.junior.edit.send")} disabled={!access?.parent_email || access?.parent_status === "not_ready" || saving} onClick={() => void sendFamilyAccess("parent_access", link.guardian_user_id)}>{access?.parent_send_count ? <RefreshCw size={15} /> : <Send size={15} />}</button><button type="button" className={campStyles.iconButton} aria-label={managerJuniorFormat(t, "edit.editNamed", { name })} title={t("manager.content.edit")} disabled={saving} onClick={() => startParentEdit(link.guardian_user_id)}><Pencil size={15} /></button><button type="button" className={`${campStyles.iconButton} ${campStyles.dangerIcon}`} aria-label={managerJuniorFormat(t, "edit.removeNamed", { name })} title={t("manager.content.remove")} disabled={saving} onClick={() => void removeParentAccess(link)}><Trash2 size={15} /></button></div></td></tr>; })}</tbody></table></div>}
        {accessPreview?.kind === "parent_access" ? <AccessMailPreview preview={accessPreview} saving={saving} onClose={() => setAccessPreview(null)} onConfirm={() => void sendFamilyAccess(accessPreview.kind, accessPreview.parent_user_id)} /> : null}
      </section>
      <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>{t("manager.junior.edit.juniorAccess")}</h2><p>{juniorAccess?.junior_email ? t("manager.junior.edit.directAccess") : juniorAccess?.recipient_name ? managerJuniorFormat(t, "edit.parentRecipient", { name: juniorAccess.recipient_name }) : t("manager.junior.edit.noRecipient")}</p></div></div>{juniorAccess ? <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>{t("manager.junior.edit.username")}</th><th>{t("manager.junior.edit.juniorEmail")}</th><th>{t("manager.junior.edit.recipient")}</th><th>{t("manager.content.state")}</th><th>{t("manager.junior.edit.lastSent")}</th><th>{t("manager.content.actions")}</th></tr></thead><tbody><tr><td data-label={t("manager.junior.edit.username")}><div className={campStyles.titleCell}><b>{juniorAccess.junior_username ?? t("manager.junior.edit.status.not_ready")}</b></div></td><td data-label={t("manager.junior.edit.juniorEmail")}>{juniorAccess.junior_email ?? "—"}</td><td data-label={t("manager.junior.edit.recipient")}>{juniorAccess.recipient_email ?? t("manager.junior.edit.incomplete")}{juniorAccess.recipient_name ? <span className={campStyles.muted} style={{ display: "block" }}>{juniorAccess.recipient_name}</span> : null}</td><td data-label={t("manager.content.state")}><span className={`${campStyles.badge} ${accessStatusClass(juniorAccess.junior_status)}`}>{t(`manager.junior.edit.status.${juniorAccess.junior_status}`)}</span></td><td data-label={t("manager.junior.edit.lastSent")}>{formatDate(juniorAccess.junior_last_sent_at)}<span className={campStyles.muted} style={{ display: "block" }}>{managerCount(t, locale, "manager.junior.edit.sentCount", juniorAccess.junior_send_count)}</span></td><td data-label={t("manager.content.actions")} className={tableStyles.actionCell}><div className={campStyles.actions}><button type="button" className={campStyles.iconButton} aria-label={managerJuniorFormat(t, "edit.previewJunior", { name: juniorAccess.junior_name })} title={t("manager.administration.criteria.previewName")} onClick={() => previewJuniorAccess(juniorAccess)}><Eye size={15} /></button><button type="button" className={campStyles.iconButton} aria-label={managerJuniorFormat(t, juniorAccess.junior_send_count ? "edit.resendJunior" : "edit.sendJunior", { name: juniorAccess.junior_name })} title={juniorAccess.junior_send_count ? t("manager.junior.edit.resend") : t("manager.junior.edit.send")} disabled={!juniorAccess.recipient_email || juniorAccess.junior_status === "not_ready" || saving} onClick={() => void sendFamilyAccess("junior_access")}>{juniorAccess.junior_send_count ? <RefreshCw size={15} /> : <Send size={15} />}</button></div></td></tr></tbody></table></div> : <div className={campStyles.empty}>{t("manager.junior.edit.accessStateError")}</div>}{accessPreview?.kind === "junior_access" ? <AccessMailPreview preview={accessPreview} saving={saving} onClose={() => setAccessPreview(null)} onConfirm={() => void sendFamilyAccess(accessPreview.kind, accessPreview.parent_user_id)} /> : null}</section>
      {editingParentId ? <form ref={parentEditCardRef} className={styles.quickPanel} onSubmit={saveParentEdit} noValidate>
        <div className={styles.sectionHeading}><div><h2>{t("manager.junior.edit.editParent")}</h2><p>{t("manager.junior.edit.editParentHelp")}</p></div><button type="button" className={actionStyles.secondaryButton} onClick={() => { setEditingParentId(""); setParentEditErrors({}); }}><X size={15} />{t("manager.cancel")}</button></div>
        <div className="user-mgmt-form-grid">
          <Input label={t("manager.profile.firstName")} required value={parentEditForm.first_name} onChange={(value) => setParentEditForm({ ...parentEditForm, first_name: value })} error={parentEditErrors.edit_first_name} />
          <Input label={t("manager.content.name")} required value={parentEditForm.last_name} onChange={(value) => setParentEditForm({ ...parentEditForm, last_name: value })} error={parentEditErrors.edit_last_name} />
          <Input label={t("manager.administration.username")} required value={parentEditForm.username} onChange={(value) => setParentEditForm({ ...parentEditForm, username: value })} error={parentEditErrors.edit_username} />
          <Input label={t("manager.administration.loginEmail")} type="email" value={parentEditForm.email} readOnly />

          <Input label={t("manager.profile.phone")} value={parentEditForm.phone} onChange={(value) => setParentEditForm({ ...parentEditForm, phone: value })} />
          <Input label={t("manager.profile.address")} full value={parentEditForm.address} onChange={(value) => setParentEditForm({ ...parentEditForm, address: value })} />
          <Input label={t("manager.profile.postalCode")} value={parentEditForm.postal_code} onChange={(value) => setParentEditForm({ ...parentEditForm, postal_code: value })} />
          <Input label={t("manager.profile.city")} value={parentEditForm.city} onChange={(value) => setParentEditForm({ ...parentEditForm, city: value })} />
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.juniorRelation")}</span><select value={parentEditForm.relation} onChange={(event) => setParentEditForm({ ...parentEditForm, relation: event.target.value })}><option value="mother">{t("manager.junior.relation.mother")}</option><option value="father">{t("manager.junior.relation.father")}</option><option value="legal_guardian">{t("manager.junior.relation.legal_guardian")}</option><option value="other">{t("manager.junior.relation.other")}</option></select></label>
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.primary")}</span><select value={parentEditForm.is_primary ? "yes" : "no"} onChange={(event) => setParentEditForm({ ...parentEditForm, is_primary: event.target.value === "yes" })}><option value="no">{t("manager.content.no")}</option><option value="yes">{t("manager.content.yes")}</option></select></label>
        </div>
        <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.saving") : t("manager.junior.edit.saveParent")}</button></CardActions>
      </form> : null}
      <form className={styles.quickPanel} onSubmit={createParentAccess} noValidate>
        <div className={styles.sectionHeading}><div><h2>{t("manager.junior.edit.addParent")}</h2><p>{t("manager.junior.edit.addParentHelp")}</p></div></div>
        <div className="user-mgmt-form-grid">
          <Input label={t("manager.profile.firstName")} required value={parentForm.first_name} onChange={(value) => setParentForm({ ...parentForm, first_name: value })} error={parentErrors.parent_first_name} />
          <Input label={t("manager.content.name")} required value={parentForm.last_name} onChange={(value) => setParentForm({ ...parentForm, last_name: value })} error={parentErrors.parent_last_name} />
          <Input label={t("manager.administration.email")} required type="email" value={parentForm.email} onChange={(value) => setParentForm({ ...parentForm, email: value })} error={parentErrors.parent_email} />
          <Input label={t("manager.profile.phone")} value={parentForm.phone} onChange={(value) => setParentForm({ ...parentForm, phone: value })} />
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.juniorRelation")}</span><select value={parentForm.relation} onChange={(event) => setParentForm({ ...parentForm, relation: event.target.value })}><option value="mother">{t("manager.junior.relation.mother")}</option><option value="father">{t("manager.junior.relation.father")}</option><option value="legal_guardian">{t("manager.junior.relation.legal_guardian")}</option><option value="other">{t("manager.junior.relation.other")}</option></select></label>
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.primary")}</span><select value={parentForm.is_primary ? "yes" : "no"} onChange={(event) => setParentForm({ ...parentForm, is_primary: event.target.value === "yes" })}><option value="no">{t("manager.content.no")}</option><option value="yes">{t("manager.content.yes")}</option></select></label>
        </div>
        {createdAccess ? <div className={actionStyles.successAlert} role="status"><b>{t(createdAccess.tempPassword ? "manager.junior.edit.accessCreated" : "manager.junior.edit.existingLinked")}</b><br />{t("manager.junior.edit.usernamePrefix")} {createdAccess.username || "—"}{createdAccess.tempPassword ? <><br />{t("manager.junior.edit.passwordPrefix")} {createdAccess.tempPassword}</> : null}</div> : null}
        <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <UserPlus size={16} />}{saving ? t("manager.settings.seasons.creating") : t("manager.junior.edit.createAccess")}</button></CardActions>
      </form>
      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>{t("manager.junior.edit.existingParent")}</h2><p>{t("manager.junior.edit.existingHelp")}</p></div></div>
        <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.content.parent")}</span><select value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}><option value="">{t("manager.junior.edit.selectParent")}</option>{availableParents.map((parent) => <option key={parent.user_id} value={parent.user_id}>{parentName(parent)}</option>)}</select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.juniorRelation")}</span><select value={existingParentRelation} onChange={(event) => setExistingParentRelation(event.target.value)}><option value="mother">{t("manager.junior.relation.mother")}</option><option value="father">{t("manager.junior.relation.father")}</option><option value="legal_guardian">{t("manager.junior.relation.legal_guardian")}</option><option value="other">{t("manager.junior.relation.other")}</option></select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.junior.edit.primary")}</span><select value={existingParentPrimary ? "yes" : "no"} onChange={(event) => setExistingParentPrimary(event.target.value === "yes")}><option value="no">{t("manager.content.no")}</option><option value="yes">{t("manager.content.yes")}</option></select></label></div>
        <CardActions><button type="button" className={actionStyles.primaryButton} disabled={saving || !selectedParentId} onClick={() => void attachExistingParent()}><Link2 size={16} />{t("manager.junior.edit.linkParent")}</button></CardActions>
      </section>
    </div> : null}
  </div>;
}

function juniorLabels(t: ManagerTranslate, locale: AppLocale) {
function parentName(parent?: Guardian | null) { return [parent?.profiles?.first_name, parent?.profiles?.last_name].filter(Boolean).join(" ") || t("manager.content.parent"); }
const formatDate = (value: string | null | undefined) => managerJuniorDate(t, locale, value);
function consentStatusLabel(value: string) { if (value === "granted") return t("manager.administration.consent.granted"); if (value === "refused") return t("manager.content.declined"); if (value === "adult") return t("manager.administration.consent.adult"); return t("manager.administration.consent.pending"); }
function consentSourceLabel(value: string) { if (value === "parent_portal") return t("manager.junior.edit.parentPortal"); if (value === "import") return t("manager.junior.edit.import"); return t("manager.junior.edit.managerEntry"); }
function relationLabel(value: string | null | undefined) { if (value === "mother") return t("manager.junior.relation.mother"); if (value === "father") return t("manager.junior.relation.father"); if (value === "legal_guardian") return t("manager.junior.relation.legal_guardian"); return t("manager.junior.relation.other"); }
function accessStatusClass(status: AccessStatus) { if (status === "error" || status === "not_ready") return tableStyles.statusDanger; if (status === "activated") return campStyles.badgeDone; if (status === "sent") return campStyles.badgeProgress; if (status === "expired") return campStyles.badgeArchived; return ""; }
const formatHandicapDate = (value: string) => managerJuniorDate(t, locale, value, false);
function handicapSourceLabel(value: string) { if (value === "manual") return t("manager.junior.edit.juniorEntry"); if (value === "import") return t("manager.junior.edit.import"); return value || "—"; }

const handicapNumber = (value: number) => value.toLocaleString(managerLocaleTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
return { parentName, formatDate, consentStatusLabel, consentSourceLabel, relationLabel, accessStatusClass, formatHandicapDate, handicapSourceLabel, handicapNumber };
}

function HandicapHistoryView({ entries, currentHandicap, loading, error, onRefresh }: { entries: HandicapHistoryEntry[]; currentHandicap: number | null; loading: boolean; error: string; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const { formatHandicapDate, handicapSourceLabel, handicapNumber } = useMemo(() => juniorLabels(t, locale), [t, locale]);
  const chartData = useMemo(() => [...entries].reverse().map((entry) => ({ date: entry.effective_date, handicap: entry.value })), [entries]);
  return <div className={tableStyles.historyStack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.edit.handicapTrend")}</h2><p>{t("manager.junior.edit.handicapHelp")}</p></div><div className={campStyles.actions}><div className={tableStyles.currentHandicap}><span>{t("manager.junior.edit.currentHandicap")}</span><b>{currentHandicap == null || !Number.isFinite(currentHandicap) ? "—" : handicapNumber(currentHandicap)}</b></div><button type="button" className={campStyles.iconButton} title={t("manager.refresh")} aria-label={t("manager.junior.edit.refreshHandicap")} disabled={loading} onClick={onRefresh}><RefreshCw size={15} className={loading ? styles.spin : undefined} /></button></div></div>
      {error ? <div className={actionStyles.errorAlert} role="alert">{managerJuniorFeedback(t, error)}</div> : loading ? <ListLoadingBlock label={t("manager.junior.edit.loadingHistory")} /> : chartData.length === 0 ? <div className={campStyles.empty}>{t("manager.junior.edit.noHandicap")}</div> : <div className={tableStyles.chart} role="img" aria-label={t("manager.junior.edit.handicapChart")}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 14, left: -12, bottom: 2 }}><CartesianGrid stroke="#e7ece6" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={formatHandicapDate} tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} minTickGap={28} /><YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(label) => formatHandicapDate(String(label))} formatter={(value) => [handicapNumber(Number(value)), t("manager.settings.volume.handicap")]} contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} /><Line type="monotone" dataKey="handicap" stroke="#607b5b" strokeWidth={2.5} dot={{ r: 4, fill: "#607b5b", strokeWidth: 0 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div>}
    </section>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>{t("manager.junior.edit.handicapHistory")}</h2><p>{managerCount(t, locale, "manager.junior.edit.changes", entries.length)}</p></div></div>
      {loading ? <ListLoadingBlock label={t("manager.junior.edit.loadingHistory")} /> : entries.length === 0 ? <div className={campStyles.empty}>{t("manager.junior.edit.noHandicapEntry")}</div> : <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table} ${tableStyles.handicapTable}`}><thead><tr><th>{t("manager.junior.edit.effectiveDate")}</th><th>{t("manager.settings.volume.handicap")}</th><th>{t("manager.junior.edit.change")}</th><th>{t("manager.content.note")}</th><th>{t("manager.junior.edit.origin")}</th></tr></thead><tbody>{entries.map((entry, index) => { const previous = entries[index + 1]; const delta = previous ? entry.value - previous.value : null; const trend = delta == null ? t("manager.junior.edit.initialValue") : delta < 0 ? managerJuniorFormat(t, "edit.improvement", { value: handicapNumber(Math.abs(delta)) }) : delta > 0 ? managerJuniorFormat(t, "edit.increase", { value: handicapNumber(delta) }) : t("manager.junior.edit.stable"); return <tr key={entry.id}><td data-label={t("manager.junior.edit.effectiveDate")}>{formatHandicapDate(entry.effective_date)}</td><td data-label={t("manager.settings.volume.handicap")}><b>{handicapNumber(entry.value)}</b></td><td data-label={t("manager.junior.edit.change")}><span className={`${campStyles.badge} ${delta != null && delta < 0 ? tableStyles.trendImproving : delta != null && delta > 0 ? tableStyles.trendWorsening : campStyles.badgeDraft}`}>{trend}</span></td><td data-label={t("manager.content.note")}>{entry.note || "—"}</td><td data-label={t("manager.junior.edit.origin")}>{handicapSourceLabel(entry.source)}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}

function AccessMailPreview({ preview, saving, onClose, onConfirm }: { preview: AccessPreview; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return <div className={tableStyles.preview}><div className={tableStyles.previewHeader}><div><b>{managerJuniorFormat(t, preview.kind === "parent_access" ? "edit.parentInvitation" : "edit.juniorInvitation", { name: preview.name })}</b><span>{t("manager.junior.edit.toPrefix")} {preview.recipient || t("manager.junior.edit.addressMissing")}</span></div><button className={campStyles.secondary} type="button" onClick={onClose}><X size={14} />{t("manager.settings.close")}</button></div><div className={tableStyles.previewSubject}>{preview.subject}</div><div className={tableStyles.previewBody}>{preview.body}</div><div className={tableStyles.previewActions}><button className={campStyles.primary} type="button" disabled={!preview.canSend || saving} onClick={onConfirm}><Mail size={14} />{t("manager.junior.edit.confirmSend")}</button></div></div>;
}

function CardActions({ children }: { children: React.ReactNode }) { return <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: "auto" }}>{children}</div>; }
function SaveBar({ saving, label }: { saving: boolean; label: string }) {
  const { t } = useI18n(); return <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.saving") : label}</button></CardActions>; }
function Input({ label, value, onChange, error, type = "text", required, full, readOnly }: { label: string; value: string; onChange?: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean; readOnly?: boolean }) {
  const { t } = useI18n(); return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}{required ? " *" : ""}</span><input required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} type={type} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />{error ? <small className="form-error" role="alert">{managerJuniorFeedback(t, error)}</small> : null}</label>; }
function Collection({ fields, values, setValues, errors, prefix }: { fields: Field[]; values: Record<string, FieldValue>; setValues: React.Dispatch<React.SetStateAction<Record<string, FieldValue>>>; errors: Record<string, string>; prefix: string }) {
  const { t } = useI18n(); return <div style={{ display: "grid", gap: 12, gridColumn: "1 / -1" }}><div className="user-mgmt-form-grid">{fields.map((field) => <CustomField key={field.id} field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} error={errors[`${prefix}:${field.id}`]} />)}</div><Link href="/manager/user-management/custom-fields" className={actionStyles.secondaryButton} style={{ justifySelf: "start" }}>{t("manager.administration.addFields")}</Link></div>; }
function CustomField({ field, value, onChange, error }: { field: Field; value?: FieldValue; onChange: (value: FieldValue) => void; error?: string }) {
  const { t } = useI18n(); if (field.is_sensitive) return <div className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}</span><div className="notice-card">{t("manager.junior.edit.restricted")}</div></div>; const options = field.options_json ?? []; let control: React.ReactNode; if (field.field_type === "long_text") control = <textarea rows={4} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />; else if (field.field_type === "boolean") control = <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "yes")}><option value="">{t("manager.content.undefined")}</option><option value="yes">{t("manager.content.yes")}</option><option value="no">{t("manager.content.no")}</option></select>; else if (field.field_type === "select") control = <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">{t("manager.administration.choose")}</option>{options.map((option) => <option key={option}>{option}</option>)}</select>; else if (field.field_type === "radio") control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="radio" name={field.id} checked={value === option} onChange={() => onChange(option)} />{option}</label>)}</div>; else if (field.field_type === "checkbox") { const selected = Array.isArray(value) ? value : []; control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>; } else control = <input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />; return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}{field.is_required ? " *" : ""}</span>{control}{field.description ? <small>{field.description}</small> : null}{error ? <small className="form-error">{managerJuniorFeedback(t, error)}</small> : null}</label>; }
