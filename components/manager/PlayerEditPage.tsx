"use client";

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
import { familyAccessStatusLabel, renderFamilyTemplate, type AccessStatus, type FamilyMailConfig } from "@/lib/familyAccess";
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
type AccessPreview = { title: string; recipient: string; subject: string; body: string; kind: "parent_access" | "junior_access"; parent_user_id?: string; junior_user_id?: string; recipient_user_id?: string };
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
  const query = useSearchParams(); const clubId = query.get("club") ?? ""; const initialSeasonId = query.get("season") ?? "";
  const requestedTab = query.get("tab");
  const [tab, setTab] = useState<Tab>(requestedTab === "parent-access" || requestedTab === "statistics" || requestedTab === "periodic-report" ? requestedTab : "profile"); const [seasonId, setSeasonId] = useState(initialSeasonId); const [seasons, setSeasons] = useState<Season[]>([]); const [fields, setFields] = useState<Field[]>([]); const [member, setMember] = useState<Member | null>(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ first_name: "", last_name: "", username: "", auth_email: "", phone: "", birth_date: "", sex: "", handedness: "", handicap: "", address: "", postal_code: "", city: "", avs_no: "", is_active: true, is_performance: false, player_consent_status: "pending" });
  const [playerPassword, setPlayerPassword] = useState("");
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

  function selectTab(nextTab: Tab) { setTab(nextTab); setMessage(""); }
  const permanentFields = useMemo(() => fields.filter((field) => field.scope === "permanent"), [fields]); const seasonFields = useMemo(() => fields.filter((field) => field.scope === "season"), [fields]);

  async function load() {
    if (!clubId) { setError("Club manquant."); setLoading(false); return; }
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
      if (!next) throw new Error("Junior introuvable.");
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
      setConsentForm({ status: consent.status, decided_at: consent.decided_at ? String(consent.decided_at).slice(0, 10) : "", signer_guardian_user_id: consent.signer_guardian_user_id ?? "", signer_name: consent.signer_name ?? "", source: consent.source ?? "manager", consent_version: consent.consent_version ?? "", internal_notes: consent.internal_notes ?? "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }
  async function loadHandicapHistory(playerUserId = member?.user_id ?? "") {
    if (!playerUserId || !clubId) return;
    setHandicapHistoryLoading(true); setHandicapHistoryError("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/players/${playerUserId}/handicap-history`, { headers: await headers(), cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Chargement de l’historique impossible.");
      setHandicapHistory((json.entries ?? []) as HandicapHistoryEntry[]);
      if (json.current_handicap != null) setForm((current) => ({ ...current, handicap: String(json.current_handicap) }));
    } catch (cause) { setHandicapHistoryError(cause instanceof Error ? cause.message : "Chargement de l’historique impossible."); }
    finally { setHandicapHistoryLoading(false); }
  }
  async function loadSeason(id: string) { if (!id) { setSeasonValues({}); setSeasonStatus("active"); return; } try { const response = await fetch(`/api/manager/clubs/${clubId}/seasons/${id}/records`, { headers: await headers(), cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error); const record = (json.records ?? []).find((item: SeasonRecord) => item.club_member_id === memberId) as SeasonRecord | undefined; setSeasonValues(record?.custom_field_values ?? {}); setSeasonStatus(record?.registration_status === "cancelled" ? "inactive" : "active"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement de la saison impossible."); } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (clubId && seasonId) void loadSeason(seasonId); }, [clubId, seasonId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (permanentValues.__profile_sex === undefined) {
      if (member) setPermanentValues((current) => ({ ...current, __profile_sex: normalizeProfileSex(member.profiles?.sex) }));
      return;
    }
    setForm((current) => ({ ...current, sex: String(permanentValues.__profile_sex ?? "") }));
  }, [member, permanentValues.__profile_sex]);

  function validate(target: "profile" | "season") { const next: Record<string, string> = {}; if (target === "profile") { if (!form.first_name.trim()) next.first_name = "Le prénom est obligatoire."; if (!form.last_name.trim()) next.last_name = "Le nom est obligatoire."; if (form.auth_email.trim() && !/^\S+@\S+\.\S+$/.test(form.auth_email.trim())) next.auth_email = "Saisissez une adresse e-mail valide."; if (playerPassword && playerPassword.length < 8) next.auth_password = "Le mot de passe doit contenir au moins 8 caractères."; for (const field of permanentFields) if (field.is_required && !field.is_sensitive && empty(permanentValues[field.id])) next[`permanent:${field.id}`] = "Ce champ est obligatoire."; } else for (const field of seasonFields) if (field.is_required && !field.is_sensitive && empty(seasonValues[field.id])) next[`season:${field.id}`] = "Ce champ est obligatoire."; setErrors(next); return Object.keys(next).length === 0; }
  async function saveProfile(event: React.FormEvent) { event.preventDefault(); if (!validate("profile")) return; setSaving(true); setError(""); setMessage(""); try { const safeValues = Object.fromEntries(permanentFields.filter((field) => !field.is_sensitive).map((field) => [field.id, permanentValues[field.id] ?? null])); const response = await fetch(`/api/manager/clubs/${clubId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ memberId, role: "player", first_name: form.first_name, last_name: form.last_name, username: form.username, auth_email: form.auth_email, ...(playerPassword ? { auth_password: playerPassword } : {}), phone: form.phone, birth_date: form.birth_date, sex: String(permanentValues.__profile_sex ?? form.sex ?? ""), handedness: form.handedness, address: form.address, postal_code: form.postal_code, city: form.city, avs_no: form.avs_no, is_active: form.is_active, is_performance: form.is_performance, player_consent_status: form.player_consent_status, custom_field_values: safeValues }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setPlayerPassword(""); setMessage(playerPassword ? "Profil et mot de passe enregistrés." : "Profil enregistré."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); } finally { setSaving(false); } }
  async function saveSeason(event: React.FormEvent) { event.preventDefault(); if (!seasonId || !validate("season")) return; setSaving(true); setError(""); setMessage(""); try { const safeValues = Object.fromEntries(seasonFields.filter((field) => !field.is_sensitive).map((field) => [field.id, seasonValues[field.id] ?? null])); const response = await fetch(`/api/manager/clubs/${clubId}/seasons/${seasonId}/records`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ member_ids: [memberId], registration_status: seasonStatus === "active" ? "active" : "cancelled", custom_field_values: safeValues }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setMessage("Paramètres de saison enregistrés."); await loadSeason(seasonId); } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); } finally { setSaving(false); } }
  async function saveConsent() {
    if (!member) return; setSaving(true); setError(""); setMessage("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/players/${member.user_id}/consent`, { method: "PUT", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify(consentForm) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setConsentData({ consent: json.consent, history: json.history, guardians: json.guardians }); setForm((current) => ({ ...current, player_consent_status: consentForm.status })); setMessage("Consentement enregistré."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  async function sendConsentReminder() {
    if (!member || !window.confirm("Envoyer un rappel de consentement au parent disponible ?")) return; setSaving(true); setError(""); setMessage("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/players/${member.user_id}/consent`, { method: "POST", headers: await headers() }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setMessage(`Rappel envoyé à ${json.recipient}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Envoi impossible."); }
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
    if (!response.ok || !membersResponse.ok || !familyResponse.ok || !consentResponse.ok) throw new Error(json.error ?? membersJson.error ?? familyJson.error ?? consentJson.error ?? "Chargement des accès impossible.");
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
    if (!response.ok) throw new Error(json.error ?? "Ajout de l’accès impossible.");
  }

  async function createParentAccess(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!parentForm.first_name.trim()) nextErrors.parent_first_name = "Le prénom est obligatoire.";
    if (!parentForm.last_name.trim()) nextErrors.parent_last_name = "Le nom est obligatoire.";
    if (!/^\S+@\S+\.\S+$/.test(parentForm.email.trim())) nextErrors.parent_email = "Saisissez une adresse e-mail valide.";
    setParentErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true); setError(""); setMessage(""); setCreatedAccess(null);
    try {
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await headers()) },
        body: JSON.stringify({ ...parentForm, first_name: parentForm.first_name.trim(), last_name: parentForm.last_name.trim(), email: parentForm.email.trim().toLowerCase(), phone: parentForm.phone.trim(), role: "parent" }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Création de l’accès impossible.");
      const parentUserId = String(json.user?.id ?? "");
      if (!parentUserId) throw new Error("Le compte parent a été créé, mais son accès n’a pas pu être rattaché.");
      await linkParent(parentUserId, parentForm.relation, parentForm.is_primary);
      setParentForm({ first_name: "", last_name: "", email: "", phone: "", relation: "other", is_primary: false });
      setCreatedAccess({ username: String(json.username ?? ""), tempPassword: json.tempPassword ?? null });
      setMessage("L’accès parent a été créé et rattaché au junior.");
      await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création de l’accès impossible."); } finally { setSaving(false); }
  }

  async function attachExistingParent() {
    if (!selectedParentId) return;
    setSaving(true); setError(""); setMessage(""); setCreatedAccess(null);
    try { await linkParent(selectedParentId, existingParentRelation, existingParentPrimary); setSelectedParentId(""); setExistingParentRelation("other"); setExistingParentPrimary(false); setMessage("L’accès parent a été rattaché au junior."); await refreshGuardianAccess(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ajout de l’accès impossible."); }
    finally { setSaving(false); }
  }

  async function removeParentAccess(link: GuardianLink) {
    if (!window.confirm("Retirer cet accès parent ?")) return;
    setSaving(true); setError(""); setMessage(""); setCreatedAccess(null);
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/guardians`, { method: "DELETE", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ player_id: link.player_id, guardian_user_id: link.guardian_user_id }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Suppression de l’accès impossible.");
      setMessage("L’accès parent a été retiré.");
      await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Suppression de l’accès impossible."); } finally { setSaving(false); }
  }

  function startParentEdit(parentUserId: string) {
    const parentMember = parentMembers.find((item) => item.user_id === parentUserId);
    if (!parentMember) { setError("Ce parent ne possède pas encore de fiche membre modifiable dans ce club."); return; }
    const profile = parentMember.profiles;
    setEditingParentId(parentUserId);
    setParentEditErrors({}); setError(""); setMessage(""); setCreatedAccess(null);
    const link = guardianLinks.find((item) => item.player_id === member?.user_id && item.guardian_user_id === parentUserId);
    setParentEditForm({ first_name: profile?.first_name ?? "", last_name: profile?.last_name ?? "", username: profile?.username ?? "", email: parentMember.auth_email?.endsWith("@noemail.local") ? "" : parentMember.auth_email ?? "", password: "", phone: profile?.phone ?? "", address: profile?.address ?? "", postal_code: profile?.postal_code ?? "", city: profile?.city ?? "", relation: link?.relation ?? "other", is_primary: Boolean(link?.is_primary) });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => parentEditCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  async function saveParentEdit(event: React.FormEvent) {
    event.preventDefault();
    const parentMember = parentMembers.find((item) => item.user_id === editingParentId);
    if (!parentMember) return;
    const nextErrors: Record<string, string> = {};
    if (!parentEditForm.first_name.trim()) nextErrors.edit_first_name = "Le prénom est obligatoire.";
    if (!parentEditForm.last_name.trim()) nextErrors.edit_last_name = "Le nom est obligatoire.";
    if (!parentEditForm.username.trim()) nextErrors.edit_username = "Le nom d’utilisateur est obligatoire.";
    if (!/^\S+@\S+\.\S+$/.test(parentEditForm.email.trim())) nextErrors.edit_email = "Saisissez une adresse e-mail valide.";
    if (parentEditForm.password && parentEditForm.password.length < 8) nextErrors.edit_password = "Le mot de passe doit contenir au moins 8 caractères.";
    setParentEditErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify({ memberId: parentMember.id, role: "parent", first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim(), username: parentEditForm.username.trim().toLowerCase(), auth_email: parentEditForm.email.trim().toLowerCase(), auth_password: parentEditForm.password, phone: parentEditForm.phone.trim(), address: parentEditForm.address.trim(), postal_code: parentEditForm.postal_code.trim(), city: parentEditForm.city.trim() }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Modification du parent impossible.");
      await linkParent(editingParentId, parentEditForm.relation, parentEditForm.is_primary);
      setParentMembers((current) => current.map((item) => item.user_id === editingParentId ? { ...item, auth_email: parentEditForm.email.trim().toLowerCase(), profiles: item.profiles ? { ...item.profiles, first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim(), username: parentEditForm.username.trim().toLowerCase(), phone: parentEditForm.phone.trim(), address: parentEditForm.address.trim(), postal_code: parentEditForm.postal_code.trim(), city: parentEditForm.city.trim() } : item.profiles } : item));
      setParents((current) => current.map((item) => item.user_id === editingParentId ? { ...item, profiles: item.profiles ? { ...item.profiles, first_name: parentEditForm.first_name.trim(), last_name: parentEditForm.last_name.trim() } : item.profiles } : item));
      setEditingParentId(""); setMessage("Les informations et le lien du parent ont été enregistrés."); await refreshGuardianAccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Modification du parent impossible."); } finally { setSaving(false); }
  }

  async function sendFamilyAccess(kind: "parent_access" | "junior_access", parentUserId?: string) {
    if (!member || !familyData) return;
    if (!window.confirm(kind === "parent_access" ? "Envoyer cette invitation parent ?" : "Envoyer les accès du junior ?")) return;
    setSaving(true); setError(""); setMessage("");
    try { const response = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, { method: "POST", headers: { "Content-Type": "application/json", ...(await headers()) }, body: JSON.stringify(kind === "parent_access" ? { kind, parent_user_id: parentUserId } : { kind, junior_user_id: member.user_id, recipient_user_id: familyData.juniors.find((row) => row.junior_user_id === member.user_id)?.recipient_user_id }) }); const json = await response.json(); const sendFailed = !response.ok || Number(json.summary?.sent ?? 0) === 0 || (json.summary?.errors?.length ?? 0) > 0; if (sendFailed) throw new Error(json.error ?? json.summary?.errors?.[0]?.error ?? json.summary?.skipped?.[0]?.reason ?? "Envoi impossible."); setMessage("E-mail envoyé."); await refreshGuardianAccess(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Envoi impossible."); }
    finally { setSaving(false); setAccessPreview(null); }
  }

  function previewParentAccess(parent: FamilyParent) {
    if (!familyData) return; const variables = { club_name: familyData.club.name, parent_name: parent.parent_name, parent_username: parent.parent_username ?? "", parent_username_or_existing: parent.parent_username ?? "votre compte existant", reset_url: "https://www.activitee.golf/reset-password?invite_token=exemple", app_url: "https://www.activitee.golf/", player_guide_url: "https://www.activitee.golf/guide-junior.pdf" };
    setAccessPreview({ title: `Invitation de ${parent.parent_name}`, recipient: parent.parent_email ?? "Adresse manquante", subject: renderFamilyTemplate(familyData.mail_config.parent_subject, variables), body: renderFamilyTemplate(familyData.mail_config.parent_body, variables), kind: "parent_access", parent_user_id: parent.parent_user_id });
  }

  function previewJuniorAccess(junior: FamilyJunior) {
    if (!familyData) return; const parent = junior.parents.find((item) => item.parent_user_id === junior.recipient_user_id); const direct = Boolean(junior.junior_email); const variables = { club_name: familyData.club.name, parent_name: parent?.parent_name ?? "", junior_name: junior.junior_name, junior_username: junior.junior_username ?? "non renseigné", temp_password: "Golf-2026!", app_url: "https://www.activitee.golf/", player_guide_url: "https://www.activitee.golf/guide-junior.pdf" };
    setAccessPreview({ title: `Accès de ${junior.junior_name}`, recipient: junior.recipient_email ?? "Adresse manquante", subject: renderFamilyTemplate(direct ? familyData.mail_config.junior_direct_subject : familyData.mail_config.junior_parent_subject, variables), body: renderFamilyTemplate(direct ? familyData.mail_config.junior_direct_body : familyData.mail_config.junior_parent_body, variables), kind: "junior_access", junior_user_id: junior.junior_user_id, recipient_user_id: junior.recipient_user_id ?? undefined });
  }

  const linkedParents = useMemo(() => member ? guardianLinks.filter((link) => link.player_id === member.user_id) : [], [guardianLinks, member]);
  const parentById = useMemo(() => new Map(parents.map((parent) => [parent.user_id, parent])), [parents]);
  const linkedParentIds = useMemo(() => new Set(linkedParents.map((link) => link.guardian_user_id)), [linkedParents]);
  const availableParents = useMemo(() => parents.filter((parent) => !linkedParentIds.has(parent.user_id)).sort((left, right) => parentName(left).localeCompare(parentName(right), "fr-CH")), [parents, linkedParentIds]);
  const familyParentById = useMemo(() => new Map((familyData?.parents ?? []).map((parent) => [parent.parent_user_id, parent])), [familyData]);
  const juniorAccess = useMemo(() => familyData?.juniors.find((junior) => junior.junior_user_id === member?.user_id) ?? null, [familyData, member]);
  const selectedSeason = useMemo(() => seasons.find((season) => season.id === seasonId) ?? null, [seasonId, seasons]);
  const backUrl = `/manager/user-management/players?club=${clubId}${seasonId ? `&season=${seasonId}` : ""}`; const name = [member?.profiles?.first_name, member?.profiles?.last_name].filter(Boolean).join(" ") || "Junior";
  if (loading) return <div className={styles.page}><section className={styles.overview}><ListLoadingBlock label="Chargement de la fiche junior…" /></section></div>;
  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>Juniors</Link> / Fiche junior</nav>
    <div className={styles.topline}><div><h1>{name}</h1><p className={styles.lead}>Profil permanent et paramètres saisonniers.</p></div><div className={actionStyles.topActions}><label className="groups-season-nav-select"><select aria-label="Saison" value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={seasons.length === 0}>{seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · En cours" : ""}</option>)}</select></label><Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16} />Retour à la liste</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    <section className={styles.overview}><div className={navigationStyles.tabs} role="tablist" aria-label="Sections de la fiche junior"><button type="button" role="tab" aria-selected={tab === "profile"} onClick={() => selectTab("profile")}>Profil</button><button type="button" role="tab" aria-selected={tab === "documents"} onClick={() => selectTab("documents")}>Consentement</button><button type="button" role="tab" aria-selected={tab === "parent-access"} onClick={() => selectTab("parent-access")}>Accès famille</button><button type="button" role="tab" aria-selected={tab === "handicap-history"} onClick={() => selectTab("handicap-history")}>Historique du handicap</button><button type="button" role="tab" aria-selected={tab === "statistics"} onClick={() => selectTab("statistics")}>Statistiques</button><button type="button" role="tab" aria-selected={tab === "periodic-report"} onClick={() => selectTab("periodic-report")}>Rapport périodique</button></div></section>{message ? <div className={actionStyles.successAlert} role="status">{message}</div> : null}
    {tab === "profile" ? <div style={{ display: "grid", gap: 18 }}><form onSubmit={saveProfile} noValidate><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>Profil</h2><p>Informations administratives conservées d’une saison à l’autre.</p></div></div><div className="user-mgmt-form-grid"><Input label="Prénom" required value={form.first_name} onChange={(value) => setForm({ ...form, first_name: value })} error={errors.first_name} /><Input label="Nom" required value={form.last_name} onChange={(value) => setForm({ ...form, last_name: value })} error={errors.last_name} /><Input label="Date de naissance" type="date" value={form.birth_date} onChange={(value) => setForm({ ...form, birth_date: value })} /><Input label="Adresse e-mail" type="email" value={form.auth_email} onChange={(value) => setForm({ ...form, auth_email: value })} error={errors.auth_email} /><Input label="Téléphone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><Input label="Nouveau mot de passe" type="password" value={playerPassword} onChange={setPlayerPassword} error={errors.auth_password} /><Input label="Adresse" full value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><Input label="Code postal" value={form.postal_code} onChange={(value) => setForm({ ...form, postal_code: value })} /><Input label="Ville" value={form.city} onChange={(value) => setForm({ ...form, city: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">Latéralité</span><select value={form.handedness} onChange={(event) => setForm({ ...form, handedness: event.target.value })}><option value="">Non définie</option><option value="right">Droitier</option><option value="left">Gaucher</option></select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Genre</span><select value={String(permanentValues.__profile_sex ?? "")} onChange={(event) => setPermanentValues((current) => ({ ...current, __profile_sex: event.target.value }))}><option value="">Non renseigné</option><option value="female">Femme</option><option value="male">Homme</option><option value="other">Autre</option></select></label><Input label="Numéro AVS" value={form.avs_no} onChange={(value) => setForm({ ...form, avs_no: value })} /><Collection fields={permanentFields} values={permanentValues} setValues={setPermanentValues} errors={errors} prefix="permanent" /></div><SaveBar saving={saving} label="Enregistrer le profil" /></section></form><form onSubmit={saveSeason} style={{ display: "grid", gap: 18 }}><section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>Paramètres de saison</h2><p>Valeurs propres à la saison sélectionnée.</p></div></div>{seasonId ? <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">Statut</span><select value={seasonStatus} onChange={(event) => setSeasonStatus(event.target.value as "active" | "inactive")}><option value="active">Actif</option><option value="inactive">Inactif</option></select></label></div> : null}{seasonId ? <Collection fields={seasonFields} values={seasonValues} setValues={setSeasonValues} errors={errors} prefix="season" /> : <div className="marketplace-empty">Sélectionnez une saison.</div>}{seasonId ? <SaveBar saving={saving} label="Enregistrer la saison" /> : null}</section></form></div> : null}
    {tab === "documents" ? <div style={{ display: "grid", gap: 18 }}><section className={styles.quickPanel}><div className={styles.sectionHeading}><div><h2>Consentement</h2><p>Décision, signataire et traçabilité du consentement.</p></div></div><div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">Statut</span><select value={consentForm.status} onChange={(event) => setConsentForm({ ...consentForm, status: event.target.value as ConsentData["consent"]["status"] })}><option value="pending">À obtenir</option><option value="granted">Accordé</option><option value="refused">Refusé</option><option value="adult">Non requis / Majeur</option></select></label><Input label="Date de la décision" type="date" value={consentForm.decided_at} onChange={(value) => setConsentForm({ ...consentForm, decided_at: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">Parent ou représentant signataire</span><select value={consentForm.signer_guardian_user_id} onChange={(event) => { const guardian = consentData?.guardians.find((item) => item.guardian_user_id === event.target.value); setConsentForm({ ...consentForm, signer_guardian_user_id: event.target.value, signer_name: guardian?.guardian_name ?? consentForm.signer_name }); }}><option value="">Non renseigné</option>{(consentData?.guardians ?? []).map((guardian) => <option key={guardian.guardian_user_id} value={guardian.guardian_user_id}>{guardian.guardian_name}</option>)}</select></label><Input label="Nom du signataire" value={consentForm.signer_name} onChange={(value) => setConsentForm({ ...consentForm, signer_name: value })} /><label className="user-mgmt-field"><span className="user-mgmt-field-label">Origine</span><select value={consentForm.source} onChange={(event) => setConsentForm({ ...consentForm, source: event.target.value as ConsentData["consent"]["source"] })}><option value="parent_portal">Espace parent</option><option value="manager">Saisie manager</option><option value="import">Import</option></select></label><Input label="Version du consentement" value={consentForm.consent_version} onChange={(value) => setConsentForm({ ...consentForm, consent_version: value })} /><label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">Notes internes</span><textarea rows={4} value={consentForm.internal_notes} onChange={(event) => setConsentForm({ ...consentForm, internal_notes: event.target.value })} /></label></div><CardActions>{consentForm.status === "pending" && consentData?.guardians.some((guardian) => guardian.email) ? <button className={actionStyles.secondaryButton} type="button" disabled={saving} onClick={() => void sendConsentReminder()}><Mail size={16} />Envoyer un rappel</button> : null}<button className={actionStyles.primaryButton} type="button" disabled={saving} onClick={() => void saveConsent()}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? "Enregistrement…" : "Enregistrer le consentement"}</button></CardActions></section><section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Historique</h2><p>Modifications enregistrées pour ce club.</p></div></div>{consentData?.history.length ? <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>Date</th><th>Statut</th><th>Signataire</th><th>Origine</th><th>Version</th></tr></thead><tbody>{consentData.history.map((entry) => <tr key={entry.id}><td data-label="Date">{formatDate(entry.changed_at)}</td><td data-label="Statut"><span className={campStyles.badge}>{consentStatusLabel(entry.status)}</span></td><td data-label="Signataire">{entry.signer_name ?? "—"}</td><td data-label="Origine">{consentSourceLabel(entry.source)}</td><td data-label="Version">{entry.consent_version ?? "—"}</td></tr>)}</tbody></table></div> : <div className={campStyles.empty}>Aucune modification enregistrée.</div>}</section></div> : null}
    {tab === "handicap-history" ? <HandicapHistoryView entries={handicapHistory} currentHandicap={form.handicap ? Number(form.handicap) : null} loading={handicapHistoryLoading} error={handicapHistoryError} onRefresh={() => void loadHandicapHistory()} /> : null}
    {tab === "statistics" && member ? <ManagerPlayerStatistics clubId={clubId} playerId={member.user_id} seasonRange={selectedSeason ? { from: selectedSeason.starts_on, to: selectedSeason.ends_on } : undefined} /> : null}
    {tab === "periodic-report" && member ? <ManagerPeriodicReport clubId={clubId} playerId={member.user_id} familyUrl={`/manager/user-management/players/${memberId}?club=${clubId}${seasonId ? `&season=${seasonId}` : ""}&tab=parent-access`} /> : null}
    {tab === "parent-access" ? <div style={{ display: "grid", gap: 18 }}>
      <section className={campStyles.panel}>
        <div className={campStyles.panelHeader}><div><h2>Accès parent(s)</h2><p>Parents et représentants légaux autorisés à accéder au suivi de ce junior.</p></div></div>
        {linkedParents.length === 0 ? <div className={campStyles.empty}>Aucun accès parent rattaché.</div> : <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>Parent</th><th>Relation</th><th>Coordonnées</th><th>Invitation</th><th>Activité</th><th>Actions</th></tr></thead><tbody>{linkedParents.map((link) => { const parent = parentById.get(link.guardian_user_id); const access = familyParentById.get(link.guardian_user_id); const name = parentName(parent); return <tr key={link.guardian_user_id}><td data-label="Parent"><div className={campStyles.titleCell}><b>{name}</b><span className={campStyles.muted}>{link.is_primary ? "Contact principal" : "Contact lié"}</span></div></td><td data-label="Relation">{relationLabel(link.relation)}</td><td data-label="Coordonnées">{access?.parent_email ?? "Adresse e-mail manquante"}<span className={campStyles.muted} style={{ display: "block" }}>{access?.parent_username ?? "Identifiant manquant"}</span></td><td data-label="Invitation"><span className={`${campStyles.badge} ${access ? accessStatusClass(access.parent_status) : tableStyles.statusDanger}`}>{access ? familyAccessStatusLabel(access.parent_status) : "Informations à compléter"}</span><span className={campStyles.muted} style={{ display: "block" }}>Dernier envoi : {formatDate(access?.parent_last_sent_at ?? null)}</span></td><td data-label="Activité">{formatDate(access?.parent_last_activity_at ?? null)}</td><td data-label="Actions" className={tableStyles.actionCell}><div className={campStyles.actions}><button type="button" className={campStyles.iconButton} aria-label={`Aperçu de l’invitation de ${name}`} title="Aperçu" disabled={!access} onClick={() => access && previewParentAccess(access)}><Eye size={15} /></button><button type="button" className={campStyles.iconButton} aria-label={`${access?.parent_send_count ? "Renvoyer" : "Envoyer"} l’invitation de ${name}`} title={access?.parent_send_count ? "Renvoyer" : "Envoyer"} disabled={!access?.parent_email || access?.parent_status === "not_ready" || saving} onClick={() => void sendFamilyAccess("parent_access", link.guardian_user_id)}>{access?.parent_send_count ? <RefreshCw size={15} /> : <Send size={15} />}</button><button type="button" className={campStyles.iconButton} aria-label={`Modifier ${name}`} title="Modifier" disabled={saving} onClick={() => startParentEdit(link.guardian_user_id)}><Pencil size={15} /></button><button type="button" className={`${campStyles.iconButton} ${campStyles.dangerIcon}`} aria-label={`Retirer ${name}`} title="Retirer" disabled={saving} onClick={() => void removeParentAccess(link)}><Trash2 size={15} /></button></div></td></tr>; })}</tbody></table></div>}
        {accessPreview?.kind === "parent_access" ? <AccessMailPreview preview={accessPreview} saving={saving} onClose={() => setAccessPreview(null)} onConfirm={() => void sendFamilyAccess(accessPreview.kind, accessPreview.parent_user_id)} /> : null}
      </section>
      <section className={campStyles.panel}><div className={campStyles.panelHeader}><div><h2>Accès du junior</h2><p>{juniorAccess?.junior_email ? "Les accès seront envoyés directement au junior." : juniorAccess?.recipient_name ? `Les accès seront transmis à ${juniorAccess.recipient_name}, car le junior n’a pas d’adresse e-mail.` : "Aucun destinataire exploitable n’est disponible."}</p></div></div>{juniorAccess ? <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table}`}><thead><tr><th>Identifiant</th><th>E-mail junior</th><th>Destinataire</th><th>État</th><th>Dernier envoi</th><th>Actions</th></tr></thead><tbody><tr><td data-label="Identifiant"><div className={campStyles.titleCell}><b>{juniorAccess.junior_username ?? "À compléter"}</b></div></td><td data-label="E-mail junior">{juniorAccess.junior_email ?? "—"}</td><td data-label="Destinataire">{juniorAccess.recipient_email ?? "Informations à compléter"}{juniorAccess.recipient_name ? <span className={campStyles.muted} style={{ display: "block" }}>{juniorAccess.recipient_name}</span> : null}</td><td data-label="État"><span className={`${campStyles.badge} ${accessStatusClass(juniorAccess.junior_status)}`}>{familyAccessStatusLabel(juniorAccess.junior_status)}</span></td><td data-label="Dernier envoi">{formatDate(juniorAccess.junior_last_sent_at)}<span className={campStyles.muted} style={{ display: "block" }}>{juniorAccess.junior_send_count} envoi(s)</span></td><td data-label="Actions" className={tableStyles.actionCell}><div className={campStyles.actions}><button type="button" className={campStyles.iconButton} aria-label={`Aperçu des accès de ${juniorAccess.junior_name}`} title="Aperçu" onClick={() => previewJuniorAccess(juniorAccess)}><Eye size={15} /></button><button type="button" className={campStyles.iconButton} aria-label={`${juniorAccess.junior_send_count ? "Renvoyer" : "Envoyer"} les accès de ${juniorAccess.junior_name}`} title={juniorAccess.junior_send_count ? "Renvoyer" : "Envoyer"} disabled={!juniorAccess.recipient_email || juniorAccess.junior_status === "not_ready" || saving} onClick={() => void sendFamilyAccess("junior_access")}>{juniorAccess.junior_send_count ? <RefreshCw size={15} /> : <Send size={15} />}</button></div></td></tr></tbody></table></div> : <div className={campStyles.empty}>Chargement de l’état d’accès impossible.</div>}{accessPreview?.kind === "junior_access" ? <AccessMailPreview preview={accessPreview} saving={saving} onClose={() => setAccessPreview(null)} onConfirm={() => void sendFamilyAccess(accessPreview.kind, accessPreview.parent_user_id)} /> : null}</section>
      {editingParentId ? <form ref={parentEditCardRef} className={styles.quickPanel} onSubmit={saveParentEdit} noValidate>
        <div className={styles.sectionHeading}><div><h2>Modifier le parent</h2><p>Mettez à jour ses coordonnées et son adresse de connexion.</p></div><button type="button" className={actionStyles.secondaryButton} onClick={() => { setEditingParentId(""); setParentEditErrors({}); }}><X size={15} />Annuler</button></div>
        <div className="user-mgmt-form-grid">
          <Input label="Prénom" required value={parentEditForm.first_name} onChange={(value) => setParentEditForm({ ...parentEditForm, first_name: value })} error={parentEditErrors.edit_first_name} />
          <Input label="Nom" required value={parentEditForm.last_name} onChange={(value) => setParentEditForm({ ...parentEditForm, last_name: value })} error={parentEditErrors.edit_last_name} />
          <Input label="Nom d’utilisateur" required value={parentEditForm.username} onChange={(value) => setParentEditForm({ ...parentEditForm, username: value })} error={parentEditErrors.edit_username} />
          <Input label="Adresse e-mail" required type="email" value={parentEditForm.email} onChange={(value) => setParentEditForm({ ...parentEditForm, email: value })} error={parentEditErrors.edit_email} />
          <Input label="Nouveau mot de passe" type="password" value={parentEditForm.password} onChange={(value) => setParentEditForm({ ...parentEditForm, password: value })} error={parentEditErrors.edit_password} />
          <Input label="Téléphone" value={parentEditForm.phone} onChange={(value) => setParentEditForm({ ...parentEditForm, phone: value })} />
          <Input label="Adresse" full value={parentEditForm.address} onChange={(value) => setParentEditForm({ ...parentEditForm, address: value })} />
          <Input label="Code postal" value={parentEditForm.postal_code} onChange={(value) => setParentEditForm({ ...parentEditForm, postal_code: value })} />
          <Input label="Ville" value={parentEditForm.city} onChange={(value) => setParentEditForm({ ...parentEditForm, city: value })} />
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">Relation avec le junior</span><select value={parentEditForm.relation} onChange={(event) => setParentEditForm({ ...parentEditForm, relation: event.target.value })}><option value="mother">Mère</option><option value="father">Père</option><option value="legal_guardian">Représentant légal</option><option value="other">Autre</option></select></label>
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">Contact principal</span><select value={parentEditForm.is_primary ? "yes" : "no"} onChange={(event) => setParentEditForm({ ...parentEditForm, is_primary: event.target.value === "yes" })}><option value="no">Non</option><option value="yes">Oui</option></select></label>
        </div>
        <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? "Enregistrement…" : "Enregistrer le parent"}</button></CardActions>
      </form> : null}
      <form className={styles.quickPanel} onSubmit={createParentAccess} noValidate>
        <div className={styles.sectionHeading}><div><h2>Ajouter un accès parent</h2><p>Créez le compte puis rattachez-le automatiquement à ce junior.</p></div></div>
        <div className="user-mgmt-form-grid">
          <Input label="Prénom" required value={parentForm.first_name} onChange={(value) => setParentForm({ ...parentForm, first_name: value })} error={parentErrors.parent_first_name} />
          <Input label="Nom" required value={parentForm.last_name} onChange={(value) => setParentForm({ ...parentForm, last_name: value })} error={parentErrors.parent_last_name} />
          <Input label="Adresse e-mail" required type="email" value={parentForm.email} onChange={(value) => setParentForm({ ...parentForm, email: value })} error={parentErrors.parent_email} />
          <Input label="Téléphone" value={parentForm.phone} onChange={(value) => setParentForm({ ...parentForm, phone: value })} />
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">Relation avec le junior</span><select value={parentForm.relation} onChange={(event) => setParentForm({ ...parentForm, relation: event.target.value })}><option value="mother">Mère</option><option value="father">Père</option><option value="legal_guardian">Représentant légal</option><option value="other">Autre</option></select></label>
          <label className="user-mgmt-field"><span className="user-mgmt-field-label">Contact principal</span><select value={parentForm.is_primary ? "yes" : "no"} onChange={(event) => setParentForm({ ...parentForm, is_primary: event.target.value === "yes" })}><option value="no">Non</option><option value="yes">Oui</option></select></label>
        </div>
        {createdAccess ? <div className={actionStyles.successAlert} role="status"><b>Accès créé</b><br />Identifiant : {createdAccess.username || "—"}{createdAccess.tempPassword ? <><br />Mot de passe temporaire : {createdAccess.tempPassword}</> : <><br />Le compte existant a été rattaché.</>}</div> : null}
        <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <UserPlus size={16} />}{saving ? "Création…" : "Créer et ajouter l’accès"}</button></CardActions>
      </form>
      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}><div><h2>Parent déjà présent dans le club</h2><p>Rattachez un compte existant sans en créer un nouveau.</p></div></div>
        <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">Parent</span><select value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}><option value="">Sélectionner un parent</option>{availableParents.map((parent) => <option key={parent.user_id} value={parent.user_id}>{parentName(parent)}</option>)}</select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Relation avec le junior</span><select value={existingParentRelation} onChange={(event) => setExistingParentRelation(event.target.value)}><option value="mother">Mère</option><option value="father">Père</option><option value="legal_guardian">Représentant légal</option><option value="other">Autre</option></select></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Contact principal</span><select value={existingParentPrimary ? "yes" : "no"} onChange={(event) => setExistingParentPrimary(event.target.value === "yes")}><option value="no">Non</option><option value="yes">Oui</option></select></label></div>
        <CardActions><button type="button" className={actionStyles.primaryButton} disabled={saving || !selectedParentId} onClick={() => void attachExistingParent()}><Link2 size={16} />Rattacher ce parent</button></CardActions>
      </section>
    </div> : null}
  </div>;
}

function parentName(parent?: Guardian | null) { return [parent?.profiles?.first_name, parent?.profiles?.last_name].filter(Boolean).join(" ") || "Parent"; }
function formatDate(value: string | null | undefined) { if (!value) return "Jamais"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Jamais" : new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "short" }).format(date); }
function consentStatusLabel(value: string) { if (value === "granted") return "Accordé"; if (value === "refused") return "Refusé"; if (value === "adult") return "Non requis / Majeur"; return "À obtenir"; }
function consentSourceLabel(value: string) { if (value === "parent_portal") return "Espace parent"; if (value === "import") return "Import"; return "Saisie manager"; }
function relationLabel(value: string | null | undefined) { if (value === "mother") return "Mère"; if (value === "father") return "Père"; if (value === "legal_guardian") return "Représentant légal"; return "Autre"; }
function accessStatusClass(status: AccessStatus) { if (status === "error" || status === "not_ready") return tableStyles.statusDanger; if (status === "activated") return campStyles.badgeDone; if (status === "sent") return campStyles.badgeProgress; if (status === "expired") return campStyles.badgeArchived; return ""; }
function formatHandicapDate(value: string) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function handicapSourceLabel(value: string) { if (value === "manual") return "Saisie junior"; if (value === "import") return "Import"; return value || "—"; }

function HandicapHistoryView({ entries, currentHandicap, loading, error, onRefresh }: { entries: HandicapHistoryEntry[]; currentHandicap: number | null; loading: boolean; error: string; onRefresh: () => void }) {
  const chartData = useMemo(() => [...entries].reverse().map((entry) => ({ date: entry.effective_date, handicap: entry.value })), [entries]);
  return <div className={tableStyles.historyStack}>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>Évolution du handicap</h2><p>Un handicap plus bas indique une progression.</p></div><div className={campStyles.actions}><div className={tableStyles.currentHandicap}><span>Handicap actuel</span><b>{currentHandicap == null || !Number.isFinite(currentHandicap) ? "—" : currentHandicap.toFixed(1)}</b></div><button type="button" className={campStyles.iconButton} title="Actualiser" aria-label="Actualiser l’historique du handicap" disabled={loading} onClick={onRefresh}><RefreshCw size={15} className={loading ? styles.spin : undefined} /></button></div></div>
      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : loading ? <ListLoadingBlock label="Chargement de l’historique…" /> : chartData.length === 0 ? <div className={campStyles.empty}>Aucune donnée de handicap à afficher.</div> : <div className={tableStyles.chart} role="img" aria-label="Courbe d’évolution du handicap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 14, left: -12, bottom: 2 }}><CartesianGrid stroke="#e7ece6" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={formatHandicapDate} tick={{ fill: "#718076", fontSize: 10 }} axisLine={{ stroke: "#dfe6dd" }} tickLine={false} minTickGap={28} /><YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#718076", fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(label) => formatHandicapDate(String(label))} formatter={(value) => [Number(value).toFixed(1), "Handicap"]} contentStyle={{ border: "1px solid #dfe6dd", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 20px rgba(27,45,33,.08)" }} /><Line type="monotone" dataKey="handicap" stroke="#607b5b" strokeWidth={2.5} dot={{ r: 4, fill: "#607b5b", strokeWidth: 0 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div>}
    </section>
    <section className={campStyles.panel}>
      <div className={campStyles.panelHeader}><div><h2>Historique du handicap</h2><p>{entries.length} évolution{entries.length > 1 ? "s" : ""} enregistrée{entries.length > 1 ? "s" : ""} par le junior.</p></div></div>
      {loading ? <ListLoadingBlock label="Chargement de l’historique…" /> : entries.length === 0 ? <div className={campStyles.empty}>Le junior n’a encore enregistré aucune évolution.</div> : <div className={campStyles.tableWrap}><table className={`${campStyles.table} ${tableStyles.table} ${tableStyles.handicapTable}`}><thead><tr><th>Date d’effet</th><th>Handicap</th><th>Évolution</th><th>Note</th><th>Origine</th></tr></thead><tbody>{entries.map((entry, index) => { const previous = entries[index + 1]; const delta = previous ? entry.value - previous.value : null; const trend = delta == null ? "Valeur initiale" : delta < 0 ? `Amélioration de ${Math.abs(delta).toFixed(1)}` : delta > 0 ? `Hausse de ${delta.toFixed(1)}` : "Stable"; return <tr key={entry.id}><td data-label="Date d’effet">{formatHandicapDate(entry.effective_date)}</td><td data-label="Handicap"><b>{entry.value.toFixed(1)}</b></td><td data-label="Évolution"><span className={`${campStyles.badge} ${delta != null && delta < 0 ? tableStyles.trendImproving : delta != null && delta > 0 ? tableStyles.trendWorsening : campStyles.badgeDraft}`}>{trend}</span></td><td data-label="Note">{entry.note || "—"}</td><td data-label="Origine">{handicapSourceLabel(entry.source)}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}

function AccessMailPreview({ preview, saving, onClose, onConfirm }: { preview: AccessPreview; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className={tableStyles.preview}><div className={tableStyles.previewHeader}><div><b>{preview.title}</b><span>À : {preview.recipient}</span></div><button className={campStyles.secondary} type="button" onClick={onClose}><X size={14} />Fermer</button></div><div className={tableStyles.previewSubject}>{preview.subject}</div><div className={tableStyles.previewBody}>{preview.body}</div><div className={tableStyles.previewActions}><button className={campStyles.primary} type="button" disabled={preview.recipient.includes("manquante") || saving} onClick={onConfirm}><Mail size={14} />Confirmer l’envoi</button></div></div>;
}

function CardActions({ children }: { children: React.ReactNode }) { return <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: "auto" }}>{children}</div>; }
function SaveBar({ saving, label }: { saving: boolean; label: string }) { return <CardActions><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? "Enregistrement…" : label === "Enregistrer la saison" ? "Enregistrer les paramètres" : label}</button></CardActions>; }
function Input({ label, value, onChange, error, type = "text", required, full }: { label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean }) { if (label === "Numéro AVS") return null; return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}{required ? " *" : ""}</span><input required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} type={type} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="form-error" role="alert">{error}</small> : null}</label>; }
function Collection({ fields, values, setValues, errors, prefix }: { fields: Field[]; values: Record<string, FieldValue>; setValues: React.Dispatch<React.SetStateAction<Record<string, FieldValue>>>; errors: Record<string, string>; prefix: string }) { return <div style={{ display: "grid", gap: 12, gridColumn: "1 / -1" }}><div className="user-mgmt-form-grid">{fields.map((field) => <CustomField key={field.id} field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} error={errors[`${prefix}:${field.id}`]} />)}</div><Link href="/manager/user-management/custom-fields" className={actionStyles.secondaryButton} style={{ justifySelf: "start" }}>Ajouter des champs</Link></div>; }
function CustomField({ field, value, onChange, error }: { field: Field; value?: FieldValue; onChange: (value: FieldValue) => void; error?: string }) { if (field.is_sensitive) return <div className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}</span><div className="notice-card">Champ restreint.</div></div>; const options = field.options_json ?? []; let control: React.ReactNode; if (field.field_type === "long_text") control = <textarea rows={4} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />; else if (field.field_type === "boolean") control = <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "yes")}><option value="">Non défini</option><option value="yes">Oui</option><option value="no">Non</option></select>; else if (field.field_type === "select") control = <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Choisir</option>{options.map((option) => <option key={option}>{option}</option>)}</select>; else if (field.field_type === "radio") control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="radio" name={field.id} checked={value === option} onChange={() => onChange(option)} />{option}</label>)}</div>; else if (field.field_type === "checkbox") { const selected = Array.isArray(value) ? value : []; control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>; } else control = <input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />; return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}{field.is_required ? " *" : ""}</span>{control}{field.description ? <small>{field.description}</small> : null}{error ? <small className="form-error">{error}</small> : null}</label>; }
