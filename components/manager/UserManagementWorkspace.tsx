"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Download,
  Link2,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type Section = "players" | "parents" | "coaches" | "managers" | "custom-fields" | "email-configuration";
type MemberRole = "manager" | "coach" | "player" | "parent";

type ClubRow = {
  id: string;
  name: string;
};

type PlayerFieldDef = {
  id: string;
  club_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "boolean" | "select";
  options_json?: string[] | null;
  is_active: boolean;
  sort_order: number;
  applies_to_roles?: MemberRole[];
  visible_in_profile?: boolean;
  editable_in_profile?: boolean;
  legacy_binding?: "player_course_track" | "player_membership_paid" | "player_playing_right_paid" | null;
};

type MemberRow = {
  id: string;
  club_id: string;
  user_id: string;
  role: MemberRole;
  is_active: boolean | null;
  is_performance: boolean | null;
  player_consent_status?: "granted" | "pending" | "adult" | null;
  custom_field_values?: Record<string, string | boolean | null>;
  player_field_values?: Record<string, string | boolean | null>;
  auth_email?: string | null;
  auth_last_sign_in_at?: string | null;
  profiles?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    phone: string | null;
    birth_date: string | null;
    sex: string | null;
    handedness: string | null;
    handicap: number | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    avs_no: string | null;
    staff_function: string | null;
  } | null;
};

type EditPlayerForm = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  auth_email: string;
  auth_password: string;
  phone: string;
  birth_date: string;
  sex: string;
  handedness: string;
  handicap: string;
  address: string;
  postal_code: string;
  city: string;
  avs_no: string;
  is_active: boolean;
  is_performance: boolean;
  player_consent_status: "granted" | "pending" | "adult";
  custom_field_values: Record<string, string | boolean | null>;
};

type EditMemberForm = {
  id: string;
  role: Exclude<MemberRole, "player">;
  first_name: string;
  last_name: string;
  username: string;
  auth_email: string;
  auth_password: string;
  phone: string;
  birth_date: string;
  address: string;
  postal_code: string;
  city: string;
  avs_no: string;
  staff_function: string;
  is_active: boolean;
  custom_field_values: Record<string, string | boolean | null>;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  birth_date?: string | null;
};

type GuardianLinkRow = {
  player_id: string;
  guardian_user_id: string;
  relation: string | null;
  is_primary: boolean | null;
};

type GuardianMembershipProfileRow = {
  user_id: string;
  player_consent_status?: "granted" | "pending" | "adult" | null;
  profiles?: ProfileLite | null;
};

type GuardianData = {
  players: GuardianMembershipProfileRow[];
  parents: GuardianMembershipProfileRow[];
  links: GuardianLinkRow[];
  all_players?: GuardianMembershipProfileRow[];
  all_links?: GuardianLinkRow[];
};

type AccessJuniorRow = {
  junior_user_id: string;
  junior_name: string;
  junior_username: string | null;
  player_consent_status: "granted" | "pending" | "adult" | null;
  junior_status: "not_ready" | "ready" | "sent" | "activated" | "error";
  junior_last_sent_at: string | null;
  junior_last_activity_at?: string | null;
  junior_send_count: number;
};

type AccessParentRow = {
  parent_user_id: string;
  parent_name: string;
  parent_username: string | null;
  parent_email: string | null;
  parent_status: "not_ready" | "ready" | "sent" | "activated" | "error";
  parent_last_sent_at: string | null;
  parent_last_activity_at?: string | null;
  parent_send_count: number;
  linked_juniors: AccessJuniorRow[];
};

type AccessData = {
  club: { id: string; name: string };
  parents: AccessParentRow[];
  juniors_without_parent: Array<{
    user_id: string;
    name: string;
    username: string | null;
    player_consent_status: "granted" | "pending" | "adult" | null;
    activated_at: string | null;
  }>;
  mail_config: {
    parent_subject: string;
    parent_body: string;
    junior_subject: string;
    junior_body: string;
  };
};

type SortDirection = "asc" | "desc";

const SECTION_LINKS: Array<{ key: Section; label: string; href: string; icon: typeof Users }> = [
  { key: "players", label: "Joueurs", href: "/manager/user-management/players", icon: Users },
  { key: "parents", label: "Parents", href: "/manager/user-management/parents", icon: Link2 },
  { key: "coaches", label: "Coach", href: "/manager/user-management/coaches", icon: User },
  { key: "managers", label: "Manager", href: "/manager/user-management/managers", icon: Settings2 },
  { key: "custom-fields", label: "Champs personnalisés", href: "/manager/user-management/custom-fields", icon: Settings2 },
  { key: "email-configuration", label: "Configuration E-mail", href: "/manager/user-management/email-configuration", icon: Mail },
];

const FIELD_INPUT_STYLE: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(0,0,0,0.10)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#fff",
  minHeight: 42,
};

const MEMBER_ROLE_OPTIONS: MemberRole[] = ["player", "parent", "coach", "manager"];

function normalizeFieldRoles(raw: unknown) {
  const fallback: MemberRole[] = ["player"];
  if (!Array.isArray(raw)) return fallback;
  const roles = Array.from(
    new Set(
      raw
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter((item): item is MemberRole => MEMBER_ROLE_OPTIONS.includes(item as MemberRole))
    )
  );
  return roles.length > 0 ? roles : fallback;
}

function fieldAppliesToRole(field: Pick<PlayerFieldDef, "legacy_binding" | "applies_to_roles">, role: MemberRole) {
  if (field.legacy_binding) return role === "player";
  return normalizeFieldRoles(field.applies_to_roles).includes(role);
}

function normalizeProfileFlags(field: Pick<PlayerFieldDef, "visible_in_profile" | "editable_in_profile">) {
  const visibleInProfile = Boolean(field.visible_in_profile);
  return {
    visible_in_profile: visibleInProfile,
    editable_in_profile: visibleInProfile && Boolean(field.editable_in_profile),
  };
}

function memberRoleLabel(role: MemberRole) {
  if (role === "player") return "Joueurs";
  if (role === "parent") return "Parents";
  if (role === "coach") return "Coach";
  return "Manager";
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeAuthEmailInput(raw?: string | null) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}

function fullName(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = (profile?.first_name ?? "").trim();
  const last = (profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDelta = now.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function consentLabel(status: "granted" | "pending" | "adult" | null | undefined) {
  if (status === "granted") return "Accordé";
  if (status === "adult") return "Majeur";
  return "En attente";
}

function defaultConsentStatus(member: MemberRow) {
  if (member.player_consent_status === "granted" || member.player_consent_status === "pending" || member.player_consent_status === "adult") {
    return member.player_consent_status;
  }
  const age = computeAge(member.profiles?.birth_date);
  return age != null && age >= 18 ? "adult" : "pending";
}

function statusLabel(status: AccessParentRow["parent_status"]) {
  if (status === "activated") return "Activé";
  if (status === "sent") return "Envoyé";
  if (status === "error") return "Erreur";
  if (status === "not_ready") return "Non prêt";
  return "Prêt";
}

function statusTone(status: AccessParentRow["parent_status"]) {
  if (status === "activated") return { bg: "#dcfce7", color: "#166534", border: "#86efac" };
  if (status === "sent") return { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" };
  if (status === "error") return { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" };
  if (status === "not_ready") return { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers, ...rows].map((row) => row.map((value) => csvCell(value)).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function dateStamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function playerFieldDisplayValue(field: PlayerFieldDef, rawValue: string | boolean | null | undefined) {
  if (rawValue == null || rawValue === "") return null;
  if (field.field_type === "boolean") return rawValue ? "Oui" : "Non";
  if (field.legacy_binding === "player_course_track") {
    if (rawValue === "junior") return "Junior";
    if (rawValue === "competition") return "Compétition";
    if (rawValue === "no_course") return "Pas de cours";
  }
  if (field.legacy_binding === "player_membership_paid") return rawValue ? "Cotisation payée" : "Cotisation non payée";
  if (field.legacy_binding === "player_playing_right_paid") return rawValue ? "Droit de jeu payé" : "Droit de jeu non payé";
  return String(rawValue);
}

function renderMailTemplate(
  template: string,
  variables: Record<string, string>,
  linkMode: "text" | "token" = "text"
) {
  return template.replace(/\{\{([a-z0-9_]+)(?::([^}]+))?\}\}/gi, (_, key: string, label?: string) => {
    const value = variables[key] ?? "";
    if (!value) return "";
    if (!label) return value;
    const isUrl = /^https?:\/\//i.test(value.trim());
    if (!isUrl) return `${label}: ${value}`;
    return linkMode === "token"
      ? `[[ACTIVITEE_LINK:${encodeURIComponent(label)}:${encodeURIComponent(value)}]]`
      : `${label}: ${value}`;
  });
}

function renderTemplateText(text: string) {
  return text.replace(/\[\[ACTIVITEE_LINK:([^:\]]+):([^\]]+)\]\]/g, (_, encodedLabel: string, encodedUrl: string) => {
    return `${decodeURIComponent(encodedLabel)}: ${decodeURIComponent(encodedUrl)}`;
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function renderInlineHtml(value: string) {
  let html = "";
  let lastIndex = 0;
  for (const match of value.matchAll(/\[\[ACTIVITEE_LINK:([^:\]]+):([^\]]+)\]\]/g)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const label = decodeURIComponent(match[1] ?? "");
    const url = decodeURIComponent(match[2] ?? "");
    html += escapeHtml(value.slice(lastIndex, index)).replace(/\n/g, "<br/>");
    html += `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#166534;text-decoration:underline">${escapeHtml(label)}</a>`;
    lastIndex = index + raw.length;
  }
  html += escapeHtml(value.slice(lastIndex)).replace(/\n/g, "<br/>");
  return html;
}

function textToHtml(text: string) {
  return `<div style="font-family:Arial,sans-serif;color:#132018;line-height:1.55">${text
    .split("\n\n")
    .map((block) => `<p>${renderInlineHtml(block)}</p>`)
    .join("")}</div>`;
}

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), "fr", { numeric: true, sensitivity: "base" });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export default function UserManagementWorkspace({ section }: { section: Section }) {
  const pathname = usePathname();

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubId, setClubId] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [playerFields, setPlayerFields] = useState<PlayerFieldDef[]>([]);
  const [guardianData, setGuardianData] = useState<GuardianData | null>(null);
  const [accessData, setAccessData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [savingMailConfig, setSavingMailConfig] = useState(false);
  const [newField, setNewField] = useState<{
    label: string;
    field_type: "text" | "boolean" | "select";
    options: string;
    applies_to_roles: MemberRole[];
    visible_in_profile: boolean;
    editable_in_profile: boolean;
  }>({
    label: "",
    field_type: "text",
    options: "",
    applies_to_roles: ["player"],
    visible_in_profile: false,
    editable_in_profile: false,
  });
  const [mailConfig, setMailConfig] = useState<AccessData["mail_config"] | null>(null);
  const [playerCreateOpen, setPlayerCreateOpen] = useState(false);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [playerEditOpen, setPlayerEditOpen] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerEditForm, setPlayerEditForm] = useState<EditPlayerForm | null>(null);
  const [memberEditOpen, setMemberEditOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberEditForm, setMemberEditForm] = useState<EditMemberForm | null>(null);
  const [createdPlayerCreds, setCreatedPlayerCreds] = useState<{ username: string; tempPassword: string | null } | null>(null);
  const [playerCreateForm, setPlayerCreateForm] = useState({
    first_name: "",
    last_name: "",
  });

  const [playerSearch, setPlayerSearch] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [coachSearch, setCoachSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<{ key: string; dir: SortDirection }>({ key: "last_name", dir: "asc" });
  const [parentSort, setParentSort] = useState<{ key: string; dir: SortDirection }>({ key: "last_name", dir: "asc" });
  const [coachSort, setCoachSort] = useState<{ key: string; dir: SortDirection }>({ key: "last_name", dir: "asc" });
  const [managerSort, setManagerSort] = useState<{ key: string; dir: SortDirection }>({ key: "last_name", dir: "asc" });
  const canCreatePlayer = useMemo(
    () => Boolean(clubId && playerCreateForm.first_name.trim() && playerCreateForm.last_name.trim()),
    [clubId, playerCreateForm.first_name, playerCreateForm.last_name]
  );

  async function loadClubs() {
    const headers = await authHeader();
    const response = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error ?? "Impossible de charger les clubs.");
    return (Array.isArray(json?.clubs) ? json.clubs : [])
      .map((club) => ({ id: String((club as { id?: unknown; name?: unknown } | null)?.id ?? ""), name: String((club as { id?: unknown; name?: unknown } | null)?.name ?? "Club") }))
      .filter((club: ClubRow) => Boolean(club.id));
  }

  async function loadClubData(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const [membersResponse, guardiansResponse, accessResponse] = await Promise.all([
        fetch(`/api/manager/clubs/${selectedClubId}/members`, { headers, cache: "no-store" }),
        fetch(`/api/manager/clubs/${selectedClubId}/guardians`, { headers, cache: "no-store" }),
        fetch(`/api/manager/clubs/${selectedClubId}/access-invitations`, { headers, cache: "no-store" }),
      ]);

      const membersJson = await membersResponse.json().catch(() => ({}));
      const guardiansJson = await guardiansResponse.json().catch(() => ({}));
      const accessJson = await accessResponse.json().catch(() => ({}));

      if (!membersResponse.ok) throw new Error(membersJson?.error ?? "Impossible de charger les membres.");
      if (!guardiansResponse.ok) throw new Error(guardiansJson?.error ?? "Impossible de charger les liens parents.");
      if (!accessResponse.ok) throw new Error(accessJson?.error ?? "Impossible de charger les invitations.");

      setMembers((membersJson?.members ?? []) as MemberRow[]);
      setPlayerFields((membersJson?.playerFields ?? []) as PlayerFieldDef[]);
      setGuardianData((guardiansJson ?? null) as GuardianData | null);
      setAccessData((accessJson ?? null) as AccessData | null);
      setMailConfig((accessJson?.mail_config ?? null) as AccessData["mail_config"] | null);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Erreur de chargement."));
      setMembers([]);
      setPlayerFields([]);
      setGuardianData(null);
      setAccessData(null);
      setMailConfig(null);
    } finally {
      setLoading(false);
    }
  }

  async function reloadClubData() {
    if (!clubId) return;
    await loadClubData(clubId);
  }

  async function createPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clubId || creatingPlayer || !canCreatePlayer) return;

    setCreatingPlayer(true);
    setError(null);
    setCreatedPlayerCreds(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          first_name: playerCreateForm.first_name.trim(),
          last_name: playerCreateForm.last_name.trim(),
          staff_function: "",
          role: "player",
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error ?? "Erreur création joueur"));

      setCreatedPlayerCreds({
        username: String(json?.username ?? ""),
        tempPassword: json?.tempPassword ?? null,
      });
      setPlayerCreateForm({
        first_name: "",
        last_name: "",
      });
      await reloadClubData();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Erreur création joueur"));
    } finally {
      setCreatingPlayer(false);
    }
  }

  function openPlayerEdit(member: MemberRow) {
    const initialFieldValues: Record<string, string | boolean | null> = {};
    for (const field of activePlayerFields) {
      initialFieldValues[field.id] = member.custom_field_values?.[field.id] ?? member.player_field_values?.[field.id] ?? null;
    }

    setEditingPlayerId(member.id);
    setPlayerEditForm({
      id: member.id,
      first_name: member.profiles?.first_name ?? "",
      last_name: member.profiles?.last_name ?? "",
      username: member.profiles?.username ?? "",
      auth_email: normalizeAuthEmailInput(member.auth_email),
      auth_password: "",
      phone: member.profiles?.phone ?? "",
      birth_date: member.profiles?.birth_date ?? "",
      sex: member.profiles?.sex ?? "",
      handedness: member.profiles?.handedness ?? "",
      handicap: member.profiles?.handicap == null ? "" : String(member.profiles.handicap),
      address: member.profiles?.address ?? "",
      postal_code: member.profiles?.postal_code ?? "",
      city: member.profiles?.city ?? "",
      avs_no: member.profiles?.avs_no ?? "",
      is_active: member.is_active !== false,
      is_performance: Boolean(member.is_performance),
      player_consent_status: defaultConsentStatus(member),
      custom_field_values: initialFieldValues,
    });
    setPlayerEditOpen(true);
    closeMemberEdit();
    setPlayerCreateOpen(false);
    setCreatedPlayerCreds(null);
  }

  function closePlayerEdit() {
    setPlayerEditOpen(false);
    setEditingPlayerId(null);
    setPlayerEditForm(null);
  }

  function getActiveFieldsForRole(role: Exclude<MemberRole, "player">) {
    if (role === "parent") return activeParentFields;
    if (role === "coach") return activeCoachFields;
    return activeManagerFields;
  }

  function openMemberEdit(member: MemberRow) {
    if (member.role === "player") return;

    const role = member.role;
    const initialFieldValues: Record<string, string | boolean | null> = {};
    for (const field of getActiveFieldsForRole(role)) {
      initialFieldValues[field.id] = member.custom_field_values?.[field.id] ?? member.player_field_values?.[field.id] ?? null;
    }

    setEditingMemberId(member.id);
    setMemberEditForm({
      id: member.id,
      role,
      first_name: member.profiles?.first_name ?? "",
      last_name: member.profiles?.last_name ?? "",
      username: member.profiles?.username ?? "",
      auth_email: normalizeAuthEmailInput(member.auth_email),
      auth_password: "",
      phone: member.profiles?.phone ?? "",
      birth_date: member.profiles?.birth_date ?? "",
      address: member.profiles?.address ?? "",
      postal_code: member.profiles?.postal_code ?? "",
      city: member.profiles?.city ?? "",
      avs_no: member.profiles?.avs_no ?? "",
      staff_function: member.profiles?.staff_function ?? "",
      is_active: member.is_active !== false,
      custom_field_values: initialFieldValues,
    });
    setMemberEditOpen(true);
    closePlayerEdit();
    setPlayerCreateOpen(false);
    setCreatedPlayerCreds(null);
  }

  function closeMemberEdit() {
    setMemberEditOpen(false);
    setEditingMemberId(null);
    setMemberEditForm(null);
  }

  async function saveMemberEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clubId || !editingMemberId || !memberEditForm || busyMemberId) return;

    setBusyMemberId(editingMemberId);
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          memberId: editingMemberId,
          role: memberEditForm.role,
          is_active: memberEditForm.is_active,
          first_name: memberEditForm.first_name.trim(),
          last_name: memberEditForm.last_name.trim(),
          username: memberEditForm.username.trim().toLowerCase(),
          auth_email: memberEditForm.auth_email.trim().toLowerCase(),
          auth_password: memberEditForm.auth_password,
          phone: memberEditForm.phone.trim(),
          birth_date: memberEditForm.birth_date.trim(),
          address: memberEditForm.address.trim(),
          postal_code: memberEditForm.postal_code.trim(),
          city: memberEditForm.city.trim(),
          avs_no: memberEditForm.avs_no.trim(),
          staff_function: (memberEditForm.role === "coach" || memberEditForm.role === "manager") ? memberEditForm.staff_function.trim() : "",
          custom_field_values: memberEditForm.custom_field_values,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible d’enregistrer l’utilisateur.");
      await reloadClubData();
      closeMemberEdit();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible d’enregistrer l’utilisateur."));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function savePlayerEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clubId || !editingPlayerId || !playerEditForm || busyMemberId) return;

    setBusyMemberId(editingPlayerId);
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          memberId: editingPlayerId,
          role: "player",
          is_active: playerEditForm.is_active,
          is_performance: playerEditForm.is_performance,
          first_name: playerEditForm.first_name.trim(),
          last_name: playerEditForm.last_name.trim(),
          username: playerEditForm.username.trim().toLowerCase(),
          auth_email: playerEditForm.auth_email.trim().toLowerCase(),
          auth_password: playerEditForm.auth_password,
          phone: playerEditForm.phone.trim(),
          birth_date: playerEditForm.birth_date.trim(),
          sex: playerEditForm.sex.trim(),
          handedness: playerEditForm.handedness.trim(),
          handicap: playerEditForm.handicap.trim(),
          address: playerEditForm.address.trim(),
          postal_code: playerEditForm.postal_code.trim(),
          city: playerEditForm.city.trim(),
          avs_no: playerEditForm.avs_no.trim(),
          player_consent_status: playerEditForm.player_consent_status,
          custom_field_values: playerEditForm.custom_field_values,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible d’enregistrer le joueur.");
      await reloadClubData();
      closePlayerEdit();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible d’enregistrer le joueur."));
    } finally {
      setBusyMemberId(null);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await loadClubs();
        setClubs(list);
        const firstClubId = list[0]?.id ?? "";
        setClubId(firstClubId);
        if (firstClubId) {
          await loadClubData(firstClubId);
        } else {
          setLoading(false);
        }
      } catch (nextError: unknown) {
        setError(errorMessage(nextError, "Impossible de charger la rubrique."));
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!clubId) return;
    void loadClubData(clubId);
  }, [clubId]);

  const activePlayerFields = useMemo(
    () => playerFields.filter((field) => field.is_active && fieldAppliesToRole(field, "player")).sort((a, b) => a.sort_order - b.sort_order),
    [playerFields]
  );
  const activeParentFields = useMemo(
    () => playerFields.filter((field) => field.is_active && fieldAppliesToRole(field, "parent")).sort((a, b) => a.sort_order - b.sort_order),
    [playerFields]
  );
  const activeCoachFields = useMemo(
    () => playerFields.filter((field) => field.is_active && fieldAppliesToRole(field, "coach")).sort((a, b) => a.sort_order - b.sort_order),
    [playerFields]
  );
  const activeManagerFields = useMemo(
    () => playerFields.filter((field) => field.is_active && fieldAppliesToRole(field, "manager")).sort((a, b) => a.sort_order - b.sort_order),
    [playerFields]
  );

  const activeMembers = useMemo(() => members.filter((member) => member.is_active !== false), [members]);
  const players = useMemo(() => activeMembers.filter((member) => member.role === "player"), [activeMembers]);
  const parents = useMemo(() => activeMembers.filter((member) => member.role === "parent"), [activeMembers]);
  const coaches = useMemo(() => activeMembers.filter((member) => member.role === "coach"), [activeMembers]);
  const managers = useMemo(() => activeMembers.filter((member) => member.role === "manager"), [activeMembers]);

  const allGuardianLinks = useMemo(
    () => guardianData?.all_links ?? guardianData?.links ?? [],
    [guardianData]
  );
  const allPlayersFromGuardianApi = useMemo(
    () => guardianData?.all_players ?? guardianData?.players ?? [],
    [guardianData]
  );

  const parentAccessById = useMemo(() => {
    const map = new Map<string, AccessParentRow>();
    (accessData?.parents ?? []).forEach((row) => {
      map.set(row.parent_user_id, row);
    });
    return map;
  }, [accessData]);

  const juniorAccessByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      {
        parentUserId: string;
        parentName: string;
        junior: AccessJuniorRow;
      }
    >();
    (accessData?.parents ?? []).forEach((parent) => {
      parent.linked_juniors.forEach((junior) => {
        if (!map.has(junior.junior_user_id)) {
          map.set(junior.junior_user_id, {
            parentUserId: parent.parent_user_id,
            parentName: parent.parent_name,
            junior,
          });
        }
      });
    });
    return map;
  }, [accessData]);

  const unlinkedJuniorByPlayerId = useMemo(() => {
    const map = new Map<string, (AccessData["juniors_without_parent"])[number]>();
    (accessData?.juniors_without_parent ?? []).forEach((junior) => {
      map.set(junior.user_id, junior);
    });
    return map;
  }, [accessData]);

  const playerChildrenByParentId = useMemo(() => {
    const playerProfileById = new Map<string, ProfileLite | null>();
    allPlayersFromGuardianApi.forEach((player) => {
      playerProfileById.set(player.user_id, player.profiles ?? null);
    });

    const map = new Map<string, string[]>();
    allGuardianLinks.forEach((link) => {
      const current = map.get(link.guardian_user_id) ?? [];
      const profile = playerProfileById.get(link.player_id);
      current.push(fullName(profile));
      map.set(link.guardian_user_id, current);
    });

    for (const [parentId, names] of map.entries()) {
      map.set(
        parentId,
        Array.from(new Set(names.filter((name) => name !== "—"))).sort((a, b) => a.localeCompare(b, "fr"))
      );
    }
    return map;
  }, [allGuardianLinks, allPlayersFromGuardianApi]);

  function toggleSort(
    current: { key: string; dir: SortDirection },
    nextKey: string,
    setter: Dispatch<SetStateAction<{ key: string; dir: SortDirection }>>
  ) {
    setter((previous) => {
      if (previous.key === nextKey) {
        return { key: nextKey, dir: previous.dir === "asc" ? "desc" : "asc" };
      }
      return { key: nextKey, dir: "asc" };
    });
  }

  async function createPlayerField() {
    if (!clubId || savingFieldId) return;
    const label = newField.label.trim();
    if (!label) {
      setError("Le label du champ est requis.");
      return;
    }
    if (newField.field_type === "select" && !newField.options.trim()) {
      setError("Les options sont requises pour une liste.");
      return;
    }
    if (newField.applies_to_roles.length === 0) {
      setError("Sélectionne au moins un type d’utilisateur.");
      return;
    }
    setSavingFieldId("new");
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/player-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          label,
          field_type: newField.field_type,
          options: newField.options
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          applies_to_roles: newField.applies_to_roles,
          visible_in_profile: newField.visible_in_profile,
          editable_in_profile: newField.visible_in_profile && newField.editable_in_profile,
          sort_order: playerFields.length * 10 + 100,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible de créer le champ.");
      setNewField({
        label: "",
        field_type: "text",
        options: "",
        applies_to_roles: ["player"],
        visible_in_profile: false,
        editable_in_profile: false,
      });
      await reloadClubData();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible de créer le champ."));
    } finally {
      setSavingFieldId(null);
    }
  }

  async function savePlayerField(field: PlayerFieldDef) {
    if (!clubId || savingFieldId) return;
    setSavingFieldId(field.id);
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/player-fields/${field.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          label: field.label,
          field_type: field.field_type,
          options: field.options_json ?? [],
          is_active: field.is_active,
          sort_order: field.sort_order,
          applies_to_roles: normalizeFieldRoles(field.applies_to_roles),
          ...normalizeProfileFlags(field),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible de sauvegarder le champ.");
      await reloadClubData();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible de sauvegarder le champ."));
    } finally {
      setSavingFieldId(null);
    }
  }

  async function removePlayerField(field: PlayerFieldDef) {
    if (!clubId || savingFieldId || field.legacy_binding) return;
    const confirmed = window.confirm(`Supprimer le champ "${field.label}" ?`);
    if (!confirmed) return;
    setSavingFieldId(field.id);
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/player-fields/${field.id}`, {
        method: "DELETE",
        headers,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible de supprimer le champ.");
      await reloadClubData();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible de supprimer le champ."));
    } finally {
      setSavingFieldId(null);
    }
  }

  async function saveEmailConfiguration() {
    if (!clubId || !mailConfig) return;
    setSavingMailConfig(true);
    setError(null);
    try {
      const headers = await authHeader();
      const response = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(mailConfig),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error ?? "Impossible d’enregistrer la configuration e-mail.");
      setMailConfig((json?.mail_config ?? null) as AccessData["mail_config"] | null);
      await reloadClubData();
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Impossible d’enregistrer la configuration e-mail."));
    } finally {
      setSavingMailConfig(false);
    }
  }

  function updateFieldDraft(fieldId: string, patch: Partial<PlayerFieldDef>) {
    setPlayerFields((previous) => previous.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)));
  }

  const buildPlayerParameters = useCallback(
    (member: MemberRow) => {
      const chips: string[] = [];
      if (member.profiles?.avs_no) chips.push(`AVS: ${member.profiles.avs_no}`);
      activePlayerFields.forEach((field) => {
        const value = playerFieldDisplayValue(field, member.custom_field_values?.[field.id] ?? member.player_field_values?.[field.id]);
        if (!value) return;
        chips.push(`${field.label}: ${value}`);
      });
      return chips;
    },
    [activePlayerFields]
  );

  const getPlayerFieldValue = useCallback(
    (member: MemberRow, field: PlayerFieldDef) =>
      playerFieldDisplayValue(field, member.custom_field_values?.[field.id] ?? member.player_field_values?.[field.id]) ?? "—",
    []
  );

  const playerAccountSummary = useCallback(
    (member: MemberRow) => {
      const age = computeAge(member.profiles?.birth_date);
      const linkedAccess = juniorAccessByPlayerId.get(member.user_id);
      const unlinkedAccess = unlinkedJuniorByPlayerId.get(member.user_id);
      if (age != null && age >= 18) {
        return {
          label: "Majeur",
          tone: statusTone("ready"),
          lastActivity: member.auth_last_sign_in_at ?? null,
        };
      }
      if (linkedAccess) {
        return {
          label: statusLabel(linkedAccess.junior.junior_status),
          tone: statusTone(linkedAccess.junior.junior_status),
          lastActivity: linkedAccess.junior.junior_last_activity_at ?? linkedAccess.junior.junior_last_sent_at ?? null,
        };
      }
      if (unlinkedAccess) {
        return {
          label: unlinkedAccess.activated_at ? "Activé" : "Parent manquant",
          tone: unlinkedAccess.activated_at ? statusTone("activated") : statusTone("not_ready"),
          lastActivity: unlinkedAccess.activated_at ?? null,
        };
      }
      return {
        label: "Non configuré",
        tone: statusTone("not_ready"),
        lastActivity: null as string | null,
      };
    },
    [juniorAccessByPlayerId, unlinkedJuniorByPlayerId]
  );

  const filteredPlayers = useMemo(() => {
    const query = normalizeSearch(playerSearch);
    const items = players.filter((member) => {
      if (!query) return true;
      const values = [
        member.user_id,
        member.id,
        member.profiles?.first_name ?? "",
        member.profiles?.last_name ?? "",
        member.profiles?.avs_no ?? "",
        member.profiles?.username ?? "",
      ];
      return normalizeSearch(values.join(" ")).includes(query);
    });

    return items
      .slice()
      .sort((left, right) => {
        const leftAccount = playerAccountSummary(left);
        const rightAccount = playerAccountSummary(right);
        const leftAccess = juniorAccessByPlayerId.get(left.user_id);
        const rightAccess = juniorAccessByPlayerId.get(right.user_id);
        const leftParentLinked = computeAge(left.profiles?.birth_date) != null && computeAge(left.profiles?.birth_date)! >= 18
          ? "Majeur"
          : leftAccess || unlinkedJuniorByPlayerId.has(left.user_id)
          ? leftAccess
            ? "Oui"
            : "Non"
          : "Non";
        const rightParentLinked = computeAge(right.profiles?.birth_date) != null && computeAge(right.profiles?.birth_date)! >= 18
          ? "Majeur"
          : rightAccess || unlinkedJuniorByPlayerId.has(right.user_id)
          ? rightAccess
            ? "Oui"
            : "Non"
          : "Non";

        const leftValueByKey: Record<string, string | number | null | undefined> = {
          unique_id: left.user_id,
          last_name: left.profiles?.last_name ?? "",
          first_name: left.profiles?.first_name ?? "",
          birth_date: left.profiles?.birth_date ?? "",
          performance: left.is_performance ? 1 : 0,
          consent: consentLabel(left.player_consent_status),
          parent_linked: leftParentLinked,
          account_status: leftAccount.lastActivity ?? "",
        };
        const rightValueByKey: Record<string, string | number | null | undefined> = {
          unique_id: right.user_id,
          last_name: right.profiles?.last_name ?? "",
          first_name: right.profiles?.first_name ?? "",
          birth_date: right.profiles?.birth_date ?? "",
          performance: right.is_performance ? 1 : 0,
          consent: consentLabel(right.player_consent_status),
          parent_linked: rightParentLinked,
          account_status: rightAccount.lastActivity ?? "",
        };
        activePlayerFields.forEach((field) => {
          leftValueByKey[`org_param:${field.id}`] = getPlayerFieldValue(left, field);
          rightValueByKey[`org_param:${field.id}`] = getPlayerFieldValue(right, field);
        });
        const result = compareValues(leftValueByKey[playerSort.key], rightValueByKey[playerSort.key]);
        return playerSort.dir === "asc" ? result : -result;
      });
  }, [players, playerSearch, playerSort, juniorAccessByPlayerId, unlinkedJuniorByPlayerId, activePlayerFields, getPlayerFieldValue, playerAccountSummary]);

  const filteredParents = useMemo(() => {
    const query = normalizeSearch(parentSearch);
    const items = parents.filter((member) => {
      const children = playerChildrenByParentId.get(member.user_id) ?? [];
      const access = parentAccessById.get(member.user_id);
      const haystack = [
        member.profiles?.first_name ?? "",
        member.profiles?.last_name ?? "",
        member.profiles?.username ?? "",
        member.auth_email ?? "",
        access?.parent_email ?? "",
        ...children,
      ].join(" ");
      return !query || normalizeSearch(haystack).includes(query);
    });

    return items
      .slice()
      .sort((left, right) => {
        const leftChildren = (playerChildrenByParentId.get(left.user_id) ?? []).join(", ");
        const rightChildren = (playerChildrenByParentId.get(right.user_id) ?? []).join(", ");
        const leftAccess = parentAccessById.get(left.user_id);
        const rightAccess = parentAccessById.get(right.user_id);
        const leftValueByKey: Record<string, string | number | null | undefined> = {
          last_name: left.profiles?.last_name ?? "",
          first_name: left.profiles?.first_name ?? "",
          children: leftChildren,
          account_status: leftAccess?.parent_status ?? "",
          last_activity: leftAccess?.parent_last_activity_at ?? leftAccess?.parent_last_sent_at ?? "",
        };
        const rightValueByKey: Record<string, string | number | null | undefined> = {
          last_name: right.profiles?.last_name ?? "",
          first_name: right.profiles?.first_name ?? "",
          children: rightChildren,
          account_status: rightAccess?.parent_status ?? "",
          last_activity: rightAccess?.parent_last_activity_at ?? rightAccess?.parent_last_sent_at ?? "",
        };
        const result = compareValues(leftValueByKey[parentSort.key], rightValueByKey[parentSort.key]);
        return parentSort.dir === "asc" ? result : -result;
      });
  }, [parents, parentSearch, parentSort, playerChildrenByParentId, parentAccessById]);

  const filteredCoaches = useMemo(() => {
    const query = normalizeSearch(coachSearch);
    return coaches
      .filter((member) => {
        const haystack = [
          member.profiles?.first_name ?? "",
          member.profiles?.last_name ?? "",
          member.profiles?.staff_function ?? "",
          member.profiles?.username ?? "",
          member.auth_email ?? "",
        ].join(" ");
        return !query || normalizeSearch(haystack).includes(query);
      })
      .slice()
      .sort((left, right) => {
        const leftValueByKey: Record<string, string | number | null | undefined> = {
          last_name: left.profiles?.last_name ?? "",
          first_name: left.profiles?.first_name ?? "",
          function: left.profiles?.staff_function ?? "",
          email: left.auth_email ?? "",
        };
        const rightValueByKey: Record<string, string | number | null | undefined> = {
          last_name: right.profiles?.last_name ?? "",
          first_name: right.profiles?.first_name ?? "",
          function: right.profiles?.staff_function ?? "",
          email: right.auth_email ?? "",
        };
        const result = compareValues(leftValueByKey[coachSort.key], rightValueByKey[coachSort.key]);
        return coachSort.dir === "asc" ? result : -result;
      });
  }, [coaches, coachSearch, coachSort]);

  const filteredManagers = useMemo(() => {
    const query = normalizeSearch(managerSearch);
    return managers
      .filter((member) => {
        const haystack = [
          member.profiles?.first_name ?? "",
          member.profiles?.last_name ?? "",
          member.profiles?.staff_function ?? "",
          member.profiles?.username ?? "",
          member.auth_email ?? "",
        ].join(" ");
        return !query || normalizeSearch(haystack).includes(query);
      })
      .slice()
      .sort((left, right) => {
        const leftValueByKey: Record<string, string | number | null | undefined> = {
          last_name: left.profiles?.last_name ?? "",
          first_name: left.profiles?.first_name ?? "",
          function: left.profiles?.staff_function ?? "",
          email: left.auth_email ?? "",
        };
        const rightValueByKey: Record<string, string | number | null | undefined> = {
          last_name: right.profiles?.last_name ?? "",
          first_name: right.profiles?.first_name ?? "",
          function: right.profiles?.staff_function ?? "",
          email: right.auth_email ?? "",
        };
        const result = compareValues(leftValueByKey[managerSort.key], rightValueByKey[managerSort.key]);
        return managerSort.dir === "asc" ? result : -result;
      });
  }, [managers, managerSearch, managerSort]);

  const currentClubName = clubs.find((club) => club.id === clubId)?.name ?? accessData?.club.name ?? "Club";

  function SortHeader({
    label,
    sortKey,
    sort,
    onToggle,
  }: {
    label: string;
    sortKey: string;
    sort: { key: string; dir: SortDirection };
    onToggle: () => void;
  }) {
    return (
      <button type="button" className="user-mgmt-sort-btn" onClick={onToggle}>
        <span>{label}</span>
        <ArrowUpDown size={14} />
        {sort.key === sortKey ? <span className="user-mgmt-sort-dir">{sort.dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    );
  }

  function exportPlayers() {
    downloadCsv(
      `joueurs-${dateStamp()}.csv`,
      [
        "ID unique",
        "Nom",
        "Prénom",
        "Date de naissance",
        "Mode performance",
        "Consentement",
        "Parent lié",
        "Paramètres",
        "Statut du compte",
        "Dernière activité",
      ],
      filteredPlayers.map((member) => {
        const age = computeAge(member.profiles?.birth_date);
        const parentLinked =
          age != null && age >= 18 ? "Majeur" : juniorAccessByPlayerId.has(member.user_id) ? "Oui" : "Non";
        const account = playerAccountSummary(member);
        return [
          member.user_id,
          member.profiles?.last_name ?? "",
          member.profiles?.first_name ?? "",
          member.profiles?.birth_date ?? "",
          member.is_performance ? "Oui" : "Non",
          consentLabel(member.player_consent_status),
          parentLinked,
          buildPlayerParameters(member).join(" | "),
          account.label,
          account.lastActivity ? formatDateTime(account.lastActivity) : "",
        ];
      })
    );
  }

  function exportParents() {
    downloadCsv(
      `parents-${dateStamp()}.csv`,
      ["Nom", "Prénom", "Enfants liés", "Statut du compte", "Dernière activité"],
      filteredParents.map((member) => {
        const access = parentAccessById.get(member.user_id);
        return [
          member.profiles?.last_name ?? "",
          member.profiles?.first_name ?? "",
          (playerChildrenByParentId.get(member.user_id) ?? []).join(" | "),
          access ? statusLabel(access.parent_status) : "Non configuré",
          access?.parent_last_activity_at ? formatDateTime(access.parent_last_activity_at) : "",
        ];
      })
    );
  }

  function exportRoleMembers(filenamePrefix: string, list: MemberRow[]) {
    downloadCsv(
      `${filenamePrefix}-${dateStamp()}.csv`,
      ["Nom", "Prénom", "Fonction", "Username", "Adresse e-mail"],
      list.map((member) => [
        member.profiles?.last_name ?? "",
        member.profiles?.first_name ?? "",
        member.profiles?.staff_function ?? "",
        member.profiles?.username ?? "",
        member.auth_email ?? "",
      ])
    );
  }

  function downloadPlayersTemplate() {
    downloadCsv(
      "modele-import-joueurs.csv",
      [
        "Prénom",
        "Nom",
        "Email",
        "Role",
        "Téléphone",
        "Date de naissance",
        "Adresse",
        "Code postal",
        "Ville",
        "AVS",
        ...activePlayerFields.filter((field) => !field.legacy_binding).map((field) => field.label),
      ],
      []
    );
  }

  function downloadParentsTemplate() {
    downloadCsv(
      "modele-import-parents.csv",
      ["Prénom", "Nom", "Email", "Role", "Téléphone", "Adresse", "Code postal", "Ville"],
      []
    );
  }

  const sectionMeta: Record<Section, { title: string; description: string }> = {
    players: {
      title: "Gestion des utilisateurs • Joueurs",
      description:
        "Liste des joueurs actifs, recherche, tri, export et édition inline du profil joueur avec ses paramètres organisationnels.",
    },
    parents: {
      title: "Gestion des utilisateurs • Parents",
      description:
        "Vue consolidée des parents, de leurs enfants liés et de l’état du compte, avec accès direct aux écrans existants.",
    },
    coaches: {
      title: "Gestion des utilisateurs • Coach",
      description: "Première base de travail pour gérer les coachs actifs depuis cette nouvelle rubrique.",
    },
    managers: {
      title: "Gestion des utilisateurs • Manager",
      description: "Première base de travail pour gérer les managers actifs depuis cette nouvelle rubrique.",
    },
    "custom-fields": {
      title: "Gestion des utilisateurs • Champs personnalisés",
      description:
        "Gestion séparée des paramètres propres à l’organisation, avec choix des types d’utilisateurs concernés par chaque champ.",
    },
    "email-configuration": {
      title: "Gestion des utilisateurs • Configuration E-mail",
      description:
        "Configuration distincte des e-mails d’accès avec aperçu direct des templates parent et junior.",
    },
  };

  const previewVariables = useMemo(
    () => ({
      club_name: currentClubName,
      parent_name: "Marie Dupont",
      parent_username: "mdupont",
      parent_username_or_existing: "mdupont",
      reset_url: "https://www.activitee.golf/reset-password?invite_token=demo",
      app_url: "https://www.activitee.golf/",
      player_guide_url:
        "https://qgyshibomgcuaxhyhrgo.supabase.co/storage/v1/object/public/Docs/ActiviTee_V1_player.pdf",
      junior_name: "Lucas Dupont",
      junior_username: "lucas.dupont",
      temp_password: "TempPass123!",
    }),
    [currentClubName]
  );

  const parentPreviewSubject = renderMailTemplate(mailConfig?.parent_subject ?? "", previewVariables, "text");
  const parentPreviewBody = renderMailTemplate(mailConfig?.parent_body ?? "", previewVariables, "token");
  const juniorPreviewSubject = renderMailTemplate(mailConfig?.junior_subject ?? "", previewVariables, "text");
  const juniorPreviewBody = renderMailTemplate(mailConfig?.junior_body ?? "", previewVariables, "token");

  function renderMemberEditCard(role: Exclude<MemberRole, "player">) {
    if (!memberEditOpen || !memberEditForm || memberEditForm.role !== role) return null;

    const roleLabel = role === "parent" ? "parent" : role;
    const activeFields = getActiveFieldsForRole(role);
    const showStaffFunction = role === "coach" || role === "manager";

    return (
      <div className="glass-section">
        <div className="glass-card" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="card-title" style={{ marginBottom: 0 }}>{`Éditer le ${roleLabel}`}</div>
              <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 700 }}>
                Mise à jour du profil et des paramètres organisationnels.
              </div>
            </div>
            <button type="button" className="btn" onClick={closeMemberEdit}>
              Fermer
            </button>
          </div>

          <form onSubmit={saveMemberEdit} style={{ display: "grid", gap: 14 }}>
            <div className="user-mgmt-form-grid">
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Prénom</span>
                <input
                  value={memberEditForm.first_name}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, first_name: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Nom</span>
                <input
                  value={memberEditForm.last_name}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, last_name: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Username</span>
                <input
                  value={memberEditForm.username}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, username: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Adresse e-mail</span>
                <input
                  type="email"
                  value={memberEditForm.auth_email}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, auth_email: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Téléphone</span>
                <input
                  value={memberEditForm.phone}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, phone: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Date de naissance</span>
                <input
                  type="date"
                  value={memberEditForm.birth_date}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, birth_date: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                <span className="user-mgmt-field-label">Adresse</span>
                <input
                  value={memberEditForm.address}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, address: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Code postal</span>
                <input
                  value={memberEditForm.postal_code}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, postal_code: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Ville</span>
                <input
                  value={memberEditForm.city}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, city: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">AVS</span>
                <input
                  value={memberEditForm.avs_no}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, avs_no: event.target.value } : previous))}
                  style={FIELD_INPUT_STYLE}
                />
              </label>
              {showStaffFunction ? (
                <label className="user-mgmt-field">
                  <span className="user-mgmt-field-label">Fonction</span>
                  <input
                    value={memberEditForm.staff_function}
                    onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, staff_function: event.target.value } : previous))}
                    style={FIELD_INPUT_STYLE}
                  />
                </label>
              ) : null}
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Nouveau mot de passe</span>
                <input
                  value={memberEditForm.auth_password}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, auth_password: event.target.value } : previous))}
                  placeholder="Laisser vide pour ne pas changer"
                  style={FIELD_INPUT_STYLE}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={memberEditForm.is_active}
                  onChange={(event) => setMemberEditForm((previous) => (previous ? { ...previous, is_active: event.target.checked } : previous))}
                />
                Compte actif
              </label>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>Paramètres organisationnels</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>{`Champs personnalisés applicables aux ${memberRoleLabel(role).toLowerCase()}.`}</div>
              </div>
              {activeFields.length === 0 ? (
                <div className="marketplace-empty">{`Aucun champ personnalisé actif pour les ${memberRoleLabel(role).toLowerCase()}.`}</div>
              ) : (
                <div className="user-mgmt-form-grid">
                  {activeFields.map((field) => (
                    <label key={field.id} className="user-mgmt-field">
                      <span className="user-mgmt-field-label">{field.label}</span>
                      {field.field_type === "boolean" ? (
                        <select
                          value={
                            memberEditForm.custom_field_values[field.id] == null
                              ? ""
                              : memberEditForm.custom_field_values[field.id]
                              ? "yes"
                              : "no"
                          }
                          onChange={(event) =>
                            setMemberEditForm((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    custom_field_values: {
                                      ...previous.custom_field_values,
                                      [field.id]: event.target.value === "" ? null : event.target.value === "yes",
                                    },
                                  }
                                : previous
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          <option value="">Non défini</option>
                          <option value="yes">Oui</option>
                          <option value="no">Non</option>
                        </select>
                      ) : field.field_type === "select" ? (
                        <select
                          value={String(memberEditForm.custom_field_values[field.id] ?? "")}
                          onChange={(event) =>
                            setMemberEditForm((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    custom_field_values: {
                                      ...previous.custom_field_values,
                                      [field.id]: event.target.value || null,
                                    },
                                  }
                                : previous
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          <option value="">Non défini</option>
                          {(field.options_json ?? []).map((option) => (
                            <option key={option} value={option}>
                              {playerFieldDisplayValue(field, option)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={String(memberEditForm.custom_field_values[field.id] ?? "")}
                          onChange={(event) =>
                            setMemberEditForm((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    custom_field_values: {
                                      ...previous.custom_field_values,
                                      [field.id]: event.target.value || null,
                                    },
                                  }
                                : previous
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="user-mgmt-actions">
              <button type="submit" className="btn" disabled={busyMemberId === editingMemberId}>
                {busyMemberId === editingMemberId ? <RefreshCw size={14} className="spin" /> : <Pencil size={14} />}
                Enregistrer les modifications
              </button>
              <button type="button" className="btn" onClick={closeMemberEdit}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header" style={{ alignItems: "start" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {sectionMeta[section].title}
              </div>
              <div style={{ color: "rgba(0,0,0,0.62)", fontSize: 13, fontWeight: 800, maxWidth: 860 }}>
                {sectionMeta[section].description}
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <div className="user-mgmt-toolbar">
              <label className="user-mgmt-field">
                <span className="user-mgmt-field-label">Club</span>
                <select
                  value={clubId}
                  onChange={(event) => setClubId(event.target.value)}
                  style={FIELD_INPUT_STYLE}
                >
                  {clubs.map((club) => (
                    <option key={club.id} value={club.id}>
                      {club.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pill-soft" style={{ justifySelf: "start" }}>
                <RefreshCw size={14} />
                {currentClubName}
              </div>
            </div>

            <div className="user-mgmt-subnav">
              {SECTION_LINKS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link key={item.key} href={item.href} className={`user-mgmt-subnav-link ${active ? "active" : ""}`}>
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {error ? (
          <div className="glass-section" style={{ marginTop: 0 }}>
            <div className="notice-card" style={{ borderColor: "#fecaca", background: "#fff1f2", color: "#9f1239" }}>
              {error}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="glass-section">
            <div className="glass-card">
              <ListLoadingBlock label="Chargement de la rubrique..." />
            </div>
          </div>
        ) : null}

        {!loading && section === "players" ? (
          <>
            <div className="glass-section">
              <div className="user-mgmt-stats">
                <div className="glass-card">
                  <div className="muted-uc">Joueurs actifs</div>
                  <div className="big-number">{players.length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Mode performance</div>
                  <div className="big-number">{players.filter((member) => member.is_performance).length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Consentements en attente</div>
                  <div className="big-number">{players.filter((member) => member.player_consent_status !== "granted" && member.player_consent_status !== "adult").length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Parents liés</div>
                  <div className="big-number">
                    {
                      players.filter((member) => {
                        const age = computeAge(member.profiles?.birth_date);
                        return age != null && age >= 18 ? false : juniorAccessByPlayerId.has(member.user_id);
                      }).length
                    }
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                <div className="user-mgmt-toolbar">
                  <label className="user-mgmt-field" style={{ minWidth: "min(420px, 100%)" }}>
                    <span className="user-mgmt-field-label">Recherche</span>
                    <div style={{ position: "relative" }}>
                      <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "#64748b" }} />
                      <input
                        value={playerSearch}
                        onChange={(event) => setPlayerSearch(event.target.value)}
                        placeholder="ID, nom, prénom, username, AVS…"
                        style={{ ...FIELD_INPUT_STYLE, paddingLeft: 38 }}
                      />
                    </div>
                  </label>
                  <div className="user-mgmt-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setPlayerCreateOpen((previous) => !previous);
                        closePlayerEdit();
                        setCreatedPlayerCreds(null);
                      }}
                    >
                      <UserPlus size={14} />
                      Ajouter un joueur
                    </button>
                    <Link href="/manager/users?role=player#users-import" className="btn">
                      <Upload size={14} />
                      Importer des joueurs
                    </Link>
                    <button type="button" className="btn" onClick={downloadPlayersTemplate}>
                      <Download size={14} />
                      Télécharger la structure
                    </button>
                    <button type="button" className="btn" onClick={exportPlayers}>
                      <Download size={14} />
                      Exporter
                    </button>
                    <Link href="/manager/user-management/custom-fields" className="btn">
                      <Settings2 size={14} />
                      Champs personnalisés
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {playerCreateOpen ? (
              <div className="glass-section">
                <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div className="card-title" style={{ marginBottom: 0 }}>Nouveau joueur</div>
                      <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 700 }}>
                        Création rapide d’un joueur dans l’organisation en cours.
                      </div>
                    </div>
                    <button type="button" className="btn" onClick={() => setPlayerCreateOpen(false)}>
                      Fermer
                    </button>
                  </div>

                  <form onSubmit={createPlayer} style={{ display: "grid", gap: 12 }}>
                    <div className="user-mgmt-form-grid">
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Prénom</span>
                        <input
                          value={playerCreateForm.first_name}
                          onChange={(event) => setPlayerCreateForm((previous) => ({ ...previous, first_name: event.target.value }))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Nom</span>
                        <input
                          value={playerCreateForm.last_name}
                          onChange={(event) => setPlayerCreateForm((previous) => ({ ...previous, last_name: event.target.value }))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                    </div>

                    <div className="user-mgmt-actions">
                      <button type="submit" className="btn" disabled={!canCreatePlayer || creatingPlayer}>
                        <UserPlus size={14} />
                        {creatingPlayer ? "Création..." : "Créer le joueur"}
                      </button>
                    </div>
                  </form>

                  {createdPlayerCreds ? (
                    <div className="notice-card" style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 900 }}>Identifiants générés</div>
                      <div style={{ fontSize: 13 }}>
                        Username: <b>{createdPlayerCreds.username || "—"}</b>
                      </div>
                      <div style={{ fontSize: 13 }}>
                        Mot de passe: <span style={{ fontFamily: "ui-monospace, monospace" }}>{createdPlayerCreds.tempPassword ?? "inchangé (utilisateur existant)"}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {playerEditOpen && playerEditForm ? (
              <div className="glass-section">
                <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div className="card-title" style={{ marginBottom: 0 }}>Éditer le joueur</div>
                      <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 700 }}>
                        Mise à jour du profil joueur et des paramètres organisationnels.
                      </div>
                    </div>
                    <button type="button" className="btn" onClick={closePlayerEdit}>
                      Fermer
                    </button>
                  </div>

                  <form onSubmit={savePlayerEdit} style={{ display: "grid", gap: 14 }}>
                    <div className="user-mgmt-form-grid">
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Prénom</span>
                        <input
                          value={playerEditForm.first_name}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, first_name: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Nom</span>
                        <input
                          value={playerEditForm.last_name}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, last_name: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Username</span>
                        <input
                          value={playerEditForm.username}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, username: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Adresse e-mail</span>
                        <input
                          type="email"
                          value={playerEditForm.auth_email}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, auth_email: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Téléphone</span>
                        <input
                          value={playerEditForm.phone}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, phone: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Date de naissance</span>
                        <input
                          type="date"
                          value={playerEditForm.birth_date}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, birth_date: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Sexe</span>
                        <input
                          value={playerEditForm.sex}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, sex: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Latéralité</span>
                        <select
                          value={playerEditForm.handedness}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, handedness: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        >
                          <option value="">Non défini</option>
                          <option value="right">Droitier</option>
                          <option value="left">Gaucher</option>
                        </select>
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Handicap</span>
                        <input
                          value={playerEditForm.handicap}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, handicap: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">AVS</span>
                        <input
                          value={playerEditForm.avs_no}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, avs_no: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                        <span className="user-mgmt-field-label">Adresse</span>
                        <input
                          value={playerEditForm.address}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, address: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Code postal</span>
                        <input
                          value={playerEditForm.postal_code}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, postal_code: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Ville</span>
                        <input
                          value={playerEditForm.city}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, city: event.target.value } : previous))}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Consentement</span>
                        <select
                          value={playerEditForm.player_consent_status}
                          onChange={(event) =>
                            setPlayerEditForm((previous) =>
                              previous ? { ...previous, player_consent_status: event.target.value as EditPlayerForm["player_consent_status"] } : previous
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          <option value="granted">Accordé</option>
                          <option value="pending">En attente</option>
                          <option value="adult">Majeur</option>
                        </select>
                      </label>
                      <label className="user-mgmt-field">
                        <span className="user-mgmt-field-label">Nouveau mot de passe</span>
                        <input
                          value={playerEditForm.auth_password}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, auth_password: event.target.value } : previous))}
                          placeholder="Laisser vide pour ne pas changer"
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={playerEditForm.is_active}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, is_active: event.target.checked } : previous))}
                        />
                        Compte actif
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={playerEditForm.is_performance}
                          onChange={(event) => setPlayerEditForm((previous) => (previous ? { ...previous, is_performance: event.target.checked } : previous))}
                        />
                        Mode performance
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <div className="card-title" style={{ marginBottom: 4 }}>Paramètres organisationnels</div>
                        <div style={{ color: "#6b7280", fontSize: 13 }}>Champs personnalisés applicables aux joueurs.</div>
                      </div>
                      {activePlayerFields.length === 0 ? (
                        <div className="marketplace-empty">Aucun champ personnalisé actif pour les joueurs.</div>
                      ) : (
                        <div className="user-mgmt-form-grid">
                          {activePlayerFields.map((field) => (
                            <label key={field.id} className="user-mgmt-field">
                              <span className="user-mgmt-field-label">{field.label}</span>
                              {field.field_type === "boolean" ? (
                                <select
                                  value={
                                    playerEditForm.custom_field_values[field.id] == null
                                      ? ""
                                      : playerEditForm.custom_field_values[field.id]
                                      ? "yes"
                                      : "no"
                                  }
                                  onChange={(event) =>
                                    setPlayerEditForm((previous) =>
                                      previous
                                        ? {
                                            ...previous,
                                            custom_field_values: {
                                              ...previous.custom_field_values,
                                              [field.id]: event.target.value === "" ? null : event.target.value === "yes",
                                            },
                                          }
                                        : previous
                                    )
                                  }
                                  style={FIELD_INPUT_STYLE}
                                >
                                  <option value="">Non défini</option>
                                  <option value="yes">Oui</option>
                                  <option value="no">Non</option>
                                </select>
                              ) : field.field_type === "select" ? (
                                <select
                                  value={String(playerEditForm.custom_field_values[field.id] ?? "")}
                                  onChange={(event) =>
                                    setPlayerEditForm((previous) =>
                                      previous
                                        ? {
                                            ...previous,
                                            custom_field_values: {
                                              ...previous.custom_field_values,
                                              [field.id]: event.target.value || null,
                                            },
                                          }
                                        : previous
                                    )
                                  }
                                  style={FIELD_INPUT_STYLE}
                                >
                                  <option value="">Non défini</option>
                                  {(field.options_json ?? []).map((option) => (
                                    <option key={option} value={option}>
                                      {playerFieldDisplayValue(field, option)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={String(playerEditForm.custom_field_values[field.id] ?? "")}
                                  onChange={(event) =>
                                    setPlayerEditForm((previous) =>
                                      previous
                                        ? {
                                            ...previous,
                                            custom_field_values: {
                                              ...previous.custom_field_values,
                                              [field.id]: event.target.value || null,
                                            },
                                          }
                                        : previous
                                    )
                                  }
                                  style={FIELD_INPUT_STYLE}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="user-mgmt-actions">
                      <button type="submit" className="btn" disabled={busyMemberId === editingPlayerId}>
                        {busyMemberId === editingPlayerId ? <RefreshCw size={14} className="spin" /> : <Pencil size={14} />}
                        Enregistrer les modifications
                      </button>
                      <button type="button" className="btn" onClick={closePlayerEdit}>
                        Annuler
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            <div className="glass-section">
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div className="user-mgmt-table-wrap">
                  <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--players">
                    <thead>
                      <tr>
                        <th><SortHeader label="Nom" sortKey="last_name" sort={playerSort} onToggle={() => toggleSort(playerSort, "last_name", setPlayerSort)} /></th>
                        <th><SortHeader label="Prénom" sortKey="first_name" sort={playerSort} onToggle={() => toggleSort(playerSort, "first_name", setPlayerSort)} /></th>
                        <th><SortHeader label="Consentement" sortKey="consent" sort={playerSort} onToggle={() => toggleSort(playerSort, "consent", setPlayerSort)} /></th>
                        <th><SortHeader label="Parent lié" sortKey="parent_linked" sort={playerSort} onToggle={() => toggleSort(playerSort, "parent_linked", setPlayerSort)} /></th>
                        {activePlayerFields.map((field) => (
                          <th key={field.id}>
                            <SortHeader
                              label={field.label}
                              sortKey={`org_param:${field.id}`}
                              sort={playerSort}
                              onToggle={() => toggleSort(playerSort, `org_param:${field.id}`, setPlayerSort)}
                            />
                          </th>
                        ))}
                        <th><SortHeader label="Activité" sortKey="account_status" sort={playerSort} onToggle={() => toggleSort(playerSort, "account_status", setPlayerSort)} /></th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlayers.length === 0 ? (
                        <tr>
                          <td colSpan={7 + activePlayerFields.length}>
                            <div className="marketplace-empty">Aucun joueur actif trouvé.</div>
                          </td>
                        </tr>
                      ) : (
                        filteredPlayers.map((member) => {
                          const age = computeAge(member.profiles?.birth_date);
                          const account = playerAccountSummary(member);
                          const parentLinkText =
                            age != null && age >= 18 ? "Majeur" : juniorAccessByPlayerId.has(member.user_id) ? "Oui" : "Non";

                          return (
                            <tr key={member.id}>
                              <td>{member.profiles?.last_name ?? "—"}</td>
                              <td>{member.profiles?.first_name ?? "—"}</td>
                              <td>{consentLabel(member.player_consent_status)}</td>
                              <td>{parentLinkText}</td>
                              {activePlayerFields.map((field) => (
                                <td key={field.id}>{getPlayerFieldValue(member, field)}</td>
                              ))}
                              <td>
                                <div style={{ display: "grid", gap: 4 }}>
                                  {age != null && age >= 18 ? (
                                    <div style={{ display: "grid", gap: 2 }}>
                                      <span style={{ fontSize: 11, color: "#6b7280" }}>
                                        {account.lastActivity ? formatDateTime(account.lastActivity).replace(", ", "\n") : "Pas d’activité"}
                                      </span>
                                    </div>
                                  ) : account.lastActivity ? (
                                    <div style={{ display: "grid", gap: 2 }}>
                                      <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "pre-line" }}>
                                        {formatDateTime(account.lastActivity).replace(", ", "\n")}
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <span style={{ fontSize: 11, fontWeight: 900, color: "#b91c1c" }}>
                                        {account.label}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </td>
                              <td>
                                <div className="user-mgmt-actions">
                                  <button
                                    type="button"
                                    className="btn user-mgmt-icon-btn"
                                    title="Éditer"
                                    aria-label="Éditer"
                                    onClick={() => openPlayerEdit(member)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {!loading && section === "parents" ? (
          <>
            <div className="glass-section">
              <div className="user-mgmt-stats">
                <div className="glass-card">
                  <div className="muted-uc">Parents actifs</div>
                  <div className="big-number">{parents.length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Parents liés</div>
                  <div className="big-number">{filteredParents.filter((member) => (playerChildrenByParentId.get(member.user_id) ?? []).length > 0).length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Accès activés</div>
                  <div className="big-number">{filteredParents.filter((member) => parentAccessById.get(member.user_id)?.parent_status === "activated").length}</div>
                </div>
                <div className="glass-card">
                  <div className="muted-uc">Champs personnalisés</div>
                  <div className="big-number">À définir</div>
                </div>
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                <div className="user-mgmt-toolbar">
                  <label className="user-mgmt-field" style={{ minWidth: "min(420px, 100%)" }}>
                    <span className="user-mgmt-field-label">Recherche</span>
                    <div style={{ position: "relative" }}>
                      <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "#64748b" }} />
                      <input
                        value={parentSearch}
                        onChange={(event) => setParentSearch(event.target.value)}
                        placeholder="Nom, prénom, e-mail, enfant lié…"
                        style={{ ...FIELD_INPUT_STYLE, paddingLeft: 38 }}
                      />
                    </div>
                  </label>
                  <div className="user-mgmt-actions">
                    <Link href="/manager/users?role=parent#users-create" className="btn">
                      <UserPlus size={14} />
                      Ajouter un parent
                    </Link>
                    <Link href="/manager/users?role=parent#users-import" className="btn">
                      <Upload size={14} />
                      Importer des parents
                    </Link>
                    <button type="button" className="btn" onClick={downloadParentsTemplate}>
                      <Download size={14} />
                      Télécharger la structure
                    </button>
                    <button type="button" className="btn" onClick={exportParents}>
                      <Download size={14} />
                      Exporter
                    </button>
                    <Link href="/manager/parents" className="btn">
                      <Link2 size={14} />
                      Gérer les liaisons
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {renderMemberEditCard("parent")}

            <div className="glass-section">
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div className="user-mgmt-table-wrap">
                  <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--parents">
                    <thead>
                      <tr>
                        <th><SortHeader label="Nom" sortKey="last_name" sort={parentSort} onToggle={() => toggleSort(parentSort, "last_name", setParentSort)} /></th>
                        <th><SortHeader label="Prénom" sortKey="first_name" sort={parentSort} onToggle={() => toggleSort(parentSort, "first_name", setParentSort)} /></th>
                        <th><SortHeader label="Enfant(s) lié(s)" sortKey="children" sort={parentSort} onToggle={() => toggleSort(parentSort, "children", setParentSort)} /></th>
                        <th><SortHeader label="Dernière activité" sortKey="last_activity" sort={parentSort} onToggle={() => toggleSort(parentSort, "last_activity", setParentSort)} /></th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredParents.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            <div className="marketplace-empty">Aucun parent actif trouvé.</div>
                          </td>
                        </tr>
                      ) : (
                        filteredParents.map((member) => {
                          const children = playerChildrenByParentId.get(member.user_id) ?? [];
                          const access = parentAccessById.get(member.user_id);
                          const tone = statusTone(access?.parent_status ?? "not_ready");
                          const linkChildrenHref = `/manager/parents?clubId=${encodeURIComponent(clubId)}&parentUserId=${encodeURIComponent(member.user_id)}`;
                          return (
                            <tr key={member.id}>
                              <td>{member.profiles?.last_name ?? "—"}</td>
                              <td>{member.profiles?.first_name ?? "—"}</td>
                              <td>
                                {children.length === 0 ? (
                                  <span style={{ color: "#6b7280" }}>—</span>
                                ) : (
                                  <div style={{ display: "grid", gap: 2 }}>
                                    {children.map((child) => (
                                      <span key={child} style={{ fontSize: 11, color: "#475569" }}>
                                        {child}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td>
                                {access?.parent_last_activity_at ? (
                                  <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "pre-line" }}>
                                    {formatDateTime(access.parent_last_activity_at).replace(", ", "\n")}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, fontWeight: 900, color: tone.color }}>
                                    {access ? statusLabel(access.parent_status) : "Non configuré"}
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className="user-mgmt-actions">
                                  <button
                                    type="button"
                                    className="btn user-mgmt-icon-btn"
                                    title="Éditer"
                                    aria-label="Éditer"
                                    onClick={() => openMemberEdit(member)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  {children.length === 0 ? (
                                    <Link
                                      href={linkChildrenHref}
                                      className="btn user-mgmt-icon-btn"
                                      title="Lier un junior"
                                      aria-label="Lier un junior"
                                    >
                                      <Link2 size={14} />
                                    </Link>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {!loading && section === "coaches" ? (
          <>
            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                <div className="user-mgmt-toolbar">
                  <label className="user-mgmt-field" style={{ minWidth: "min(420px, 100%)" }}>
                    <span className="user-mgmt-field-label">Recherche</span>
                    <div style={{ position: "relative" }}>
                      <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "#64748b" }} />
                      <input
                        value={coachSearch}
                        onChange={(event) => setCoachSearch(event.target.value)}
                        placeholder="Nom, prénom, fonction, e-mail…"
                        style={{ ...FIELD_INPUT_STYLE, paddingLeft: 38 }}
                      />
                    </div>
                  </label>
                  <div className="user-mgmt-actions">
                    <Link href="/manager/users?role=coach#users-create" className="btn">
                      <UserPlus size={14} />
                      Ajouter un coach
                    </Link>
                    <button type="button" className="btn" onClick={() => exportRoleMembers("coachs", filteredCoaches)}>
                      <Download size={14} />
                      Exporter
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {renderMemberEditCard("coach")}

            <div className="glass-section">
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div className="user-mgmt-table-wrap">
                  <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff">
                    <thead>
                      <tr>
                        <th><SortHeader label="Nom" sortKey="last_name" sort={coachSort} onToggle={() => toggleSort(coachSort, "last_name", setCoachSort)} /></th>
                        <th><SortHeader label="Prénom" sortKey="first_name" sort={coachSort} onToggle={() => toggleSort(coachSort, "first_name", setCoachSort)} /></th>
                        <th><SortHeader label="Fonction" sortKey="function" sort={coachSort} onToggle={() => toggleSort(coachSort, "function", setCoachSort)} /></th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCoaches.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="marketplace-empty">Aucun coach actif trouvé.</div>
                          </td>
                        </tr>
                      ) : (
                        filteredCoaches.map((member) => (
                          <tr key={member.id}>
                            <td>{member.profiles?.last_name ?? "—"}</td>
                            <td>{member.profiles?.first_name ?? "—"}</td>
                            <td>{member.profiles?.staff_function ?? "—"}</td>
                            <td>
                              <div className="user-mgmt-actions">
                                <button
                                  type="button"
                                  className="btn user-mgmt-icon-btn"
                                  title="Éditer"
                                  aria-label="Éditer"
                                  onClick={() => openMemberEdit(member)}
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {!loading && section === "managers" ? (
          <>
            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                <div className="user-mgmt-toolbar">
                  <label className="user-mgmt-field" style={{ minWidth: "min(420px, 100%)" }}>
                    <span className="user-mgmt-field-label">Recherche</span>
                    <div style={{ position: "relative" }}>
                      <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "#64748b" }} />
                      <input
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        placeholder="Nom, prénom, fonction, e-mail…"
                        style={{ ...FIELD_INPUT_STYLE, paddingLeft: 38 }}
                      />
                    </div>
                  </label>
                  <div className="user-mgmt-actions">
                    <Link href="/manager/users?role=manager#users-create" className="btn">
                      <UserPlus size={14} />
                      Ajouter un manager
                    </Link>
                    <button type="button" className="btn" onClick={() => exportRoleMembers("managers", filteredManagers)}>
                      <Download size={14} />
                      Exporter
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {renderMemberEditCard("manager")}

            <div className="glass-section">
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div className="user-mgmt-table-wrap">
                  <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff">
                    <thead>
                      <tr>
                        <th><SortHeader label="Nom" sortKey="last_name" sort={managerSort} onToggle={() => toggleSort(managerSort, "last_name", setManagerSort)} /></th>
                        <th><SortHeader label="Prénom" sortKey="first_name" sort={managerSort} onToggle={() => toggleSort(managerSort, "first_name", setManagerSort)} /></th>
                        <th><SortHeader label="Fonction" sortKey="function" sort={managerSort} onToggle={() => toggleSort(managerSort, "function", setManagerSort)} /></th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredManagers.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            <div className="marketplace-empty">Aucun manager actif trouvé.</div>
                          </td>
                        </tr>
                      ) : (
                        filteredManagers.map((member) => (
                          <tr key={member.id}>
                            <td>{member.profiles?.last_name ?? "—"}</td>
                            <td>{member.profiles?.first_name ?? "—"}</td>
                            <td>{member.profiles?.staff_function ?? "—"}</td>
                            <td>
                              <div className="user-mgmt-actions">
                                <button
                                  type="button"
                                  className="btn user-mgmt-icon-btn"
                                  title="Éditer"
                                  aria-label="Éditer"
                                  onClick={() => openMemberEdit(member)}
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {!loading && section === "custom-fields" ? (
          <>
            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Ajouter un champ</h2>
                  <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                    Exemples: type de cours, cotisation, AVS, abonnement, option de transport, etc.
                  </p>
                </div>
                <div className="user-mgmt-form-grid">
                  <label className="user-mgmt-field">
                    <span className="user-mgmt-field-label">Label</span>
                    <input
                      value={newField.label}
                      onChange={(event) => setNewField((previous) => ({ ...previous, label: event.target.value }))}
                      placeholder="Ex: Type de cours"
                      style={FIELD_INPUT_STYLE}
                    />
                  </label>
                  <label className="user-mgmt-field">
                    <span className="user-mgmt-field-label">Type</span>
                    <select
                      value={newField.field_type}
                      onChange={(event) =>
                        setNewField((previous) => ({ ...previous, field_type: event.target.value as typeof previous.field_type }))
                      }
                      style={FIELD_INPUT_STYLE}
                    >
                      <option value="text">Texte</option>
                      <option value="boolean">Oui / Non</option>
                      <option value="select">Liste</option>
                    </select>
                  </label>
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Types d’utilisateurs concernés</span>
                    <div className="user-mgmt-chip-list">
                      {MEMBER_ROLE_OPTIONS.map((role) => {
                        const checked = newField.applies_to_roles.includes(role);
                        return (
                          <label key={role} className="pill-soft" style={{ gap: 8, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setNewField((previous) => ({
                                  ...previous,
                                  applies_to_roles: event.target.checked
                                    ? Array.from(new Set([...previous.applies_to_roles, role]))
                                    : previous.applies_to_roles.filter((item) => item !== role),
                                }))
                              }
                            />
                            {memberRoleLabel(role)}
                          </label>
                        );
                      })}
                    </div>
                  </label>
                  <label className="user-mgmt-field">
                    <span className="user-mgmt-field-label">Visible dans le profil</span>
                    <select
                      value={newField.visible_in_profile ? "yes" : "no"}
                      onChange={(event) =>
                        setNewField((previous) => ({
                          ...previous,
                          visible_in_profile: event.target.value === "yes",
                          editable_in_profile: event.target.value === "yes" ? previous.editable_in_profile : false,
                        }))
                      }
                      style={FIELD_INPUT_STYLE}
                    >
                      <option value="no">Non</option>
                      <option value="yes">Oui</option>
                    </select>
                  </label>
                  {newField.visible_in_profile ? (
                    <label className="user-mgmt-field">
                      <span className="user-mgmt-field-label">Editable dans le profil</span>
                      <select
                        value={newField.editable_in_profile ? "yes" : "no"}
                        onChange={(event) =>
                          setNewField((previous) => ({
                            ...previous,
                            editable_in_profile: event.target.value === "yes",
                          }))
                        }
                        style={FIELD_INPUT_STYLE}
                      >
                        <option value="no">Non</option>
                        <option value="yes">Oui</option>
                      </select>
                    </label>
                  ) : null}
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Options</span>
                    <input
                      value={newField.options}
                      onChange={(event) => setNewField((previous) => ({ ...previous, options: event.target.value }))}
                      placeholder="Séparer les options par une virgule"
                      disabled={newField.field_type !== "select"}
                      style={FIELD_INPUT_STYLE}
                    />
                  </label>
                </div>
                <div>
                  <button type="button" className="btn" onClick={() => void createPlayerField()} disabled={savingFieldId === "new"}>
                    {savingFieldId === "new" ? <RefreshCw size={14} className="spin" /> : <UserPlus size={14} />}
                    Ajouter le champ
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Champs actuels</h2>
                  <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                    Les champs système restent modifiables dans leurs libellés et leur ordre, mais pas supprimables.
                  </p>
                </div>

                {playerFields.length === 0 ? (
                  <div className="marketplace-empty">Aucun champ défini pour ce club.</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {playerFields
                      .slice()
                      .sort((left, right) => left.sort_order - right.sort_order)
                      .map((field) => (
                        <div key={field.id} className="glass-card" style={{ display: "grid", gap: 12, border: "1px solid rgba(0,0,0,0.08)" }}>
                          <div className="user-mgmt-form-grid">
                            <label className="user-mgmt-field">
                              <span className="user-mgmt-field-label">Label</span>
                              <input
                                value={field.label}
                                onChange={(event) => updateFieldDraft(field.id, { label: event.target.value })}
                                style={FIELD_INPUT_STYLE}
                              />
                            </label>
                            <label className="user-mgmt-field">
                              <span className="user-mgmt-field-label">Type</span>
                              <select
                                value={field.field_type}
                                onChange={(event) =>
                                  updateFieldDraft(field.id, { field_type: event.target.value as PlayerFieldDef["field_type"] })
                                }
                                disabled={Boolean(field.legacy_binding)}
                                style={FIELD_INPUT_STYLE}
                              >
                                <option value="text">Texte</option>
                                <option value="boolean">Oui / Non</option>
                                <option value="select">Liste</option>
                              </select>
                            </label>
                            <label className="user-mgmt-field">
                              <span className="user-mgmt-field-label">Ordre</span>
                              <input
                                type="number"
                                value={field.sort_order}
                                onChange={(event) => updateFieldDraft(field.id, { sort_order: Number(event.target.value) || 0 })}
                                style={FIELD_INPUT_STYLE}
                              />
                            </label>
                            <label className="user-mgmt-field">
                              <span className="user-mgmt-field-label">Actif</span>
                              <select
                                value={field.is_active ? "yes" : "no"}
                                onChange={(event) => updateFieldDraft(field.id, { is_active: event.target.value === "yes" })}
                                style={FIELD_INPUT_STYLE}
                              >
                                <option value="yes">Oui</option>
                                <option value="no">Non</option>
                              </select>
                            </label>
                            <label className="user-mgmt-field">
                              <span className="user-mgmt-field-label">Visible dans le profil</span>
                              <select
                                value={normalizeProfileFlags(field).visible_in_profile ? "yes" : "no"}
                                onChange={(event) =>
                                  updateFieldDraft(field.id, {
                                    visible_in_profile: event.target.value === "yes",
                                    editable_in_profile: event.target.value === "yes" ? Boolean(field.editable_in_profile) : false,
                                  })
                                }
                                style={FIELD_INPUT_STYLE}
                              >
                                <option value="no">Non</option>
                                <option value="yes">Oui</option>
                              </select>
                            </label>
                            {normalizeProfileFlags(field).visible_in_profile ? (
                              <label className="user-mgmt-field">
                                <span className="user-mgmt-field-label">Editable dans le profil</span>
                                <select
                                  value={normalizeProfileFlags(field).editable_in_profile ? "yes" : "no"}
                                  onChange={(event) =>
                                    updateFieldDraft(field.id, {
                                      editable_in_profile: event.target.value === "yes",
                                    })
                                  }
                                  style={FIELD_INPUT_STYLE}
                                >
                                  <option value="no">Non</option>
                                  <option value="yes">Oui</option>
                                </select>
                              </label>
                            ) : null}
                            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                              <span className="user-mgmt-field-label">Types d’utilisateurs concernés</span>
                              <div className="user-mgmt-chip-list">
                                {MEMBER_ROLE_OPTIONS.map((role) => {
                                  const checked = normalizeFieldRoles(field.applies_to_roles).includes(role);
                                  return (
                                    <label key={role} className="pill-soft" style={{ gap: 8, cursor: field.legacy_binding ? "default" : "pointer", opacity: field.legacy_binding ? 0.65 : 1 }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={Boolean(field.legacy_binding)}
                                        onChange={(event) =>
                                          updateFieldDraft(field.id, {
                                            applies_to_roles: event.target.checked
                                              ? Array.from(new Set([...normalizeFieldRoles(field.applies_to_roles), role]))
                                              : normalizeFieldRoles(field.applies_to_roles).filter((item) => item !== role),
                                          })
                                        }
                                      />
                                      {memberRoleLabel(role)}
                                    </label>
                                  );
                                })}
                              </div>
                            </label>
                            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                              <span className="user-mgmt-field-label">Options</span>
                              <input
                                value={(field.options_json ?? []).join(", ")}
                                onChange={(event) =>
                                  updateFieldDraft(field.id, {
                                    options_json: event.target.value
                                      .split(",")
                                      .map((item) => item.trim())
                                      .filter(Boolean),
                                  })
                                }
                                disabled={field.field_type !== "select"}
                                style={FIELD_INPUT_STYLE}
                              />
                            </label>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div className="user-mgmt-chip-list">
                              {field.legacy_binding ? <span className="pill-soft">Champ système</span> : <span className="pill-soft">Champ personnalisé</span>}
                              <span className="pill-soft">{field.field_key}</span>
                              {normalizeFieldRoles(field.applies_to_roles).map((role) => (
                                <span key={`${field.id}-${role}`} className="pill-soft">
                                  {memberRoleLabel(role)}
                                </span>
                              ))}
                            </div>
                            <div className="user-mgmt-actions">
                              <button type="button" className="btn" onClick={() => void savePlayerField(field)} disabled={savingFieldId === field.id}>
                                {savingFieldId === field.id ? <RefreshCw size={14} className="spin" /> : <Pencil size={14} />}
                                Enregistrer
                              </button>
                              {!field.legacy_binding ? (
                                <button type="button" className="btn btn-danger soft" onClick={() => void removePlayerField(field)} disabled={savingFieldId === field.id}>
                                  <Trash2 size={14} />
                                  Supprimer
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}

        {!loading && section === "email-configuration" ? (
          <>
            <div className="glass-section">
              <div className="glass-card" style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Templates d’envoi</h2>
                    <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                      Variables disponibles: {"{{club_name}}"}, {"{{parent_name}}"}, {"{{parent_username}}"}, {"{{parent_username_or_existing}}"}, {"{{reset_url}}"}, {"{{app_url}}"}, {"{{player_guide_url}}"}, {"{{junior_name}}"}, {"{{junior_username}}"}, {"{{temp_password}}"}.
                    </p>
                  </div>
                  <Link href="/manager/access" className="btn">
                    <Mail size={14} />
                    Ouvrir Invitations & accès
                  </Link>
                </div>

                <div className="user-mgmt-form-grid">
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Sujet parent</span>
                    <input
                      value={mailConfig?.parent_subject ?? ""}
                      onChange={(event) => setMailConfig((previous) => (previous ? { ...previous, parent_subject: event.target.value } : previous))}
                      style={FIELD_INPUT_STYLE}
                    />
                  </label>
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Corps parent</span>
                    <textarea
                      value={mailConfig?.parent_body ?? ""}
                      onChange={(event) => setMailConfig((previous) => (previous ? { ...previous, parent_body: event.target.value } : previous))}
                      rows={10}
                      style={{ ...FIELD_INPUT_STYLE, minHeight: 220, resize: "vertical" }}
                    />
                  </label>
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Sujet junior</span>
                    <input
                      value={mailConfig?.junior_subject ?? ""}
                      onChange={(event) => setMailConfig((previous) => (previous ? { ...previous, junior_subject: event.target.value } : previous))}
                      style={FIELD_INPUT_STYLE}
                    />
                  </label>
                  <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="user-mgmt-field-label">Corps junior</span>
                    <textarea
                      value={mailConfig?.junior_body ?? ""}
                      onChange={(event) => setMailConfig((previous) => (previous ? { ...previous, junior_body: event.target.value } : previous))}
                      rows={10}
                      style={{ ...FIELD_INPUT_STYLE, minHeight: 220, resize: "vertical" }}
                    />
                  </label>
                </div>

                <div>
                  <button type="button" className="btn" onClick={() => void saveEmailConfiguration()} disabled={savingMailConfig || !mailConfig}>
                    {savingMailConfig ? <RefreshCw size={14} className="spin" /> : <Mail size={14} />}
                    Enregistrer la configuration
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-section">
              <div className="user-mgmt-stats" style={{ gridTemplateColumns: "1fr" }}>
                <div className="glass-card" style={{ display: "grid", gap: 10 }}>
                  <div className="muted-uc">Aperçu parent</div>
                  <div style={{ fontSize: 15, fontWeight: 900 }}>{parentPreviewSubject}</div>
                  <div
                    style={{ fontSize: 14, lineHeight: 1.55, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 14, background: "#fff" }}
                    dangerouslySetInnerHTML={{ __html: textToHtml(parentPreviewBody) }}
                  />
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontSize: 12,
                      lineHeight: 1.5,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fff",
                    }}
                  >
                    {renderTemplateText(parentPreviewBody)}
                  </pre>
                </div>

                <div className="glass-card" style={{ display: "grid", gap: 10 }}>
                  <div className="muted-uc">Aperçu junior</div>
                  <div style={{ fontSize: 15, fontWeight: 900 }}>{juniorPreviewSubject}</div>
                  <div
                    style={{ fontSize: 14, lineHeight: 1.55, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 14, background: "#fff" }}
                    dangerouslySetInnerHTML={{ __html: textToHtml(juniorPreviewBody) }}
                  />
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontSize: 12,
                      lineHeight: 1.5,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "#fff",
                    }}
                  >
                    {renderTemplateText(juniorPreviewBody)}
                  </pre>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
