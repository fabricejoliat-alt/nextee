"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";

type PlayerFieldDef = {
  id: string;
  club_id: string;
  field_key: string;
  label: string;
  field_type: "text" | "boolean" | "select";
  options_json?: string[] | null;
  is_active: boolean;
  sort_order: number;
  legacy_binding?: "player_course_track" | "player_membership_paid" | "player_playing_right_paid" | null;
};

type MemberRow = {
  id: string;
  club_id: string;
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean | null;
  is_performance: boolean | null;
  player_course_track?: "junior" | "competition" | "no_course" | null;
  player_membership_paid?: boolean | null;
  player_playing_right_paid?: boolean | null;
  player_consent_status?: "granted" | "pending" | "adult" | null;
  player_field_values?: Record<string, string | boolean | null>;
  auth_email?: string | null;
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
    avatar_url: string | null;
    staff_function: string | null;
  } | null;
};

type EditForm = {
  id: string;
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean;
  is_performance: boolean;
  player_consent_status: "granted" | "pending" | "adult";
  player_field_values: Record<string, string | boolean | null>;
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
  staff_function: string;
};

type PlayerFieldForm = {
  label: string;
  field_type: "text" | "boolean" | "select";
  options: string;
};

type ImportField = string;

type ImportPreviewRow = {
  rowNumber: number;
  values: Record<string, string>;
  normalized: {
    first_name: string;
    last_name: string;
    email: string;
    role: "manager" | "coach" | "player" | "parent";
    phone: string;
    staff_function: string;
    birth_date: string;
    address: string;
    postal_code: string;
    city: string;
    avs_no: string;
    player_field_values: Record<string, string | boolean | null>;
  };
  errors: string[];
  warnings: string[];
};

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function defaultConsentStatus(m: MemberRow) {
  if (m.player_consent_status === "granted" || m.player_consent_status === "pending" || m.player_consent_status === "adult") {
    return m.player_consent_status;
  }
  const age = computeAge(m.profiles?.birth_date);
  return age != null && age >= 18 ? "adult" : "pending";
}

function labelName(m: MemberRow) {
  const n = `${m.profiles?.first_name ?? ""} ${m.profiles?.last_name ?? ""}`.trim();
  return n || "Utilisateur";
}

function generatePassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeAuthEmailInput(raw?: string | null) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}

function normalizeFieldLabelToken(raw: string) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function roleLabel(role: MemberRow["role"]) {
  if (role === "manager") return "Manager";
  if (role === "coach") return "Coach";
  if (role === "parent") return "Parent";
  return "Joueur";
}

function playerFieldDisplayValue(field: PlayerFieldDef, rawValue: string | boolean | null | undefined) {
  if (rawValue == null || rawValue === "") return "—";
  if (field.field_type === "boolean") return rawValue ? "Oui" : "Non";
  if (field.legacy_binding === "player_course_track") {
    if (rawValue === "junior") return "Junior";
    if (rawValue === "competition") return "Compétition";
    if (rawValue === "no_course") return "Pas de cours";
  }
  return String(rawValue);
}

function parseCsvRows(input: string) {
  const source = input.replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const sample = lines[0] ?? "";
  const separator = [";", ",", "\t"]
    .map((candidate) => ({ candidate, count: sample.split(candidate).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.candidate ?? ";";

  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === separator) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizeImportRole(raw: string): MemberRow["role"] {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "player";
  if (["manager", "gestionnaire"].includes(value)) return "manager";
  if (["coach", "entraineur", "entraîneur"].includes(value)) return "coach";
  if (["parent", "pere", "père", "mere", "mère"].includes(value)) return "parent";
  if (["player", "joueur", "junior"].includes(value)) return "player";
  return "player";
}

function normalizeImportBirthDate(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!match) return "";

  let first = Number(match[1]);
  let second = Number(match[2]);
  let year = Number(match[3]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(year)) return "";
  if (year < 100) year += year >= 30 ? 1900 : 2000;
  let day = first;
  let month = second;

  if (first <= 12 && second > 12) {
    month = first;
    day = second;
  } else if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else {
    day = first;
    month = second;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseImportedBoolean(raw: string) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "oui", "y", "x", "payee", "payé", "paye", "ok"].includes(value)) return true;
  if (["0", "false", "no", "non", "n"].includes(value)) return false;
  return null;
}

function buildImportPreview(
  headers: string[],
  rawRows: string[][],
  mapping: Record<string, ImportField>,
  playerFields: PlayerFieldDef[]
) {
  const fieldByMappingKey = new Map<string, PlayerFieldDef>(playerFields.map((field) => [`player_field:${field.id}`, field]));
  const baseRows = rawRows.map((cells, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, colIndex) => {
      values[header] = String(cells[colIndex] ?? "").trim();
    });

    const pick = (field: ImportField) => {
      const entry = Object.entries(mapping).find(([, mapped]) => mapped === field);
      if (!entry) return "";
      return values[entry[0]] ?? "";
    };

    const normalized = {
      first_name: pick("first_name"),
      last_name: pick("last_name"),
      email: normalizeAuthEmailInput(pick("email")),
      role: normalizeImportRole(pick("role")),
      phone: pick("phone"),
      staff_function: pick("staff_function"),
      birth_date: normalizeImportBirthDate(pick("birth_date")),
      address: pick("address"),
      postal_code: pick("postal_code"),
      city: pick("city"),
      avs_no: pick("avs_no"),
      player_field_values: {} as Record<string, string | boolean | null>,
    };

    for (const [header, mapped] of Object.entries(mapping)) {
      const field = fieldByMappingKey.get(mapped);
      if (!field) continue;
      const raw = values[header] ?? "";
      if (!raw.trim()) {
        normalized.player_field_values[field.id] = null;
        continue;
      }
      if (field.field_type === "boolean") {
        const boolValue = parseImportedBoolean(raw);
        normalized.player_field_values[field.id] = boolValue;
      } else {
        normalized.player_field_values[field.id] = raw.trim();
      }
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    if (!normalized.first_name) errors.push("Prénom manquant");
    if (!normalized.last_name) errors.push("Nom manquant");
    const rawEmail = pick("email").trim();
    if (rawEmail && !normalized.email) errors.push("Adresse e-mail invalide");
    const rawBirthDate = pick("birth_date").trim();
    if (rawBirthDate && !normalized.birth_date) errors.push("Date de naissance invalide");
    for (const field of playerFields) {
      if (!(field.id in normalized.player_field_values)) continue;
      const value = normalized.player_field_values[field.id];
      if (field.field_type === "boolean" && value == null && String(values[headers.find((header) => mapping[header] === `player_field:${field.id}`) ?? ""] ?? "").trim()) {
        warnings.push(`${field.label}: valeur booléenne non reconnue`);
      }
      if (field.field_type === "select" && typeof value === "string" && value && !(field.options_json ?? []).includes(value)) {
        errors.push(`${field.label}: option invalide`);
      }
    }

    return {
      rowNumber: index + 2,
      values,
      normalized,
      errors,
      warnings,
    } satisfies ImportPreviewRow;
  });

  const playerRowsByEmail = new Map<string, number[]>();
  for (const row of baseRows) {
    if (row.normalized.role !== "player" || !row.normalized.email) continue;
    const key = row.normalized.email;
    const list = playerRowsByEmail.get(key) ?? [];
    list.push(row.rowNumber);
    playerRowsByEmail.set(key, list);
  }
  for (const row of baseRows) {
    if (row.normalized.role !== "player" || !row.normalized.email) continue;
    const matches = playerRowsByEmail.get(row.normalized.email) ?? [];
    if (matches.length > 1) {
      row.warnings.push(`Adresse e-mail partagée avec les lignes ${matches.filter((n) => n !== row.rowNumber).join(", ")}`);
    }
  }

  return baseRows;
}

export default function ManagerUsersPage() {
  const [clubId, setClubId] = useState("");
  const [clubNamesById, setClubNamesById] = useState<Record<string, string>>({});

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [playerFields, setPlayerFields] = useState<PlayerFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cStaffFunction, setCStaffFunction] = useState("");
  const [cRole, setCRole] = useState<"manager" | "coach" | "player" | "parent">("player");
  const [createdCreds, setCreatedCreds] = useState<{ username: string; tempPassword: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "manager" | "coach" | "player" | "parent">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [importFileName, setImportFileName] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRawRows, setImportRawRows] = useState<string[][]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, ImportField>>({});
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ created: number; failed: number; messages: string[] } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<EditForm>>({});
  const [newField, setNewField] = useState<PlayerFieldForm>({ label: "", field_type: "text", options: "" });

  const canCreate = useMemo(() => cFirst.trim() && cLast.trim() && clubId, [cFirst, cLast, clubId]);
  const activePlayerFields = useMemo(
    () => playerFields.filter((field) => field.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [playerFields]
  );
  const importPreview = useMemo(
    () => buildImportPreview(importHeaders, importRawRows, importMapping, activePlayerFields),
    [importHeaders, importRawRows, importMapping, activePlayerFields]
  );
  const importReadyCount = useMemo(() => importPreview.filter((row) => row.errors.length === 0).length, [importPreview]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function resolveManagerClub() {
    const headers = await authHeader();
    const res = await fetch("/api/manager/my-clubs", { method: "GET", headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? "Impossible de récupérer les clubs manager");
    const list = Array.isArray(json?.clubs) ? json.clubs : [];
    if (list.length === 0) {
      throw new Error("Aucun club manager actif trouvé");
    }
    const names: Record<string, string> = {};
    for (const c of list) {
      if (c?.id) names[String(c.id)] = String(c?.name ?? "Club");
    }
    setClubNamesById(names);
    return String(list[0].id);
  }

  async function loadMembers(selectedClubId: string) {
    if (!selectedClubId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${selectedClubId}/members`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Load failed");
      setMembers((json.members ?? []) as MemberRow[]);
      setPlayerFields((json.playerFields ?? []) as PlayerFieldDef[]);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement users");
      setMembers([]);
      setPlayerFields([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const managerClubId = await resolveManagerClub();
        setClubId(managerClubId);
      } catch (e: any) {
        setError(e?.message ?? "Impossible de charger le club");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubId) {
      setMembers([]);
      return;
    }
    void loadMembers(clubId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedCreds(null);
    if (!clubId) return;

    const headers = await authHeader();
    const res = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        first_name: cFirst.trim(),
        last_name: cLast.trim(),
        email: cEmail.trim().toLowerCase(),
        phone: cPhone.trim(),
        staff_function: cRole === "manager" || cRole === "coach" ? cStaffFunction.trim() : "",
        role: cRole,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Erreur création utilisateur");
      return;
    }

    setCreatedCreds({
      username: (json?.username ?? "").toString(),
      tempPassword: json?.tempPassword ?? null,
    });

    setCFirst("");
    setCLast("");
    setCEmail("");
    setCPhone("");
    setCStaffFunction("");
    setCRole("player");
    await loadMembers(clubId);
  }

  function startEdit(m: MemberRow) {
    const initialFieldValues: Record<string, string | boolean | null> = {};
    for (const field of playerFields) {
      initialFieldValues[field.id] = m.player_field_values?.[field.id] ?? null;
    }
    setEditingId(m.id);
    setForm({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      is_active: m.is_active ?? true,
      is_performance: m.is_performance ?? false,
      player_consent_status: defaultConsentStatus(m),
      player_field_values: initialFieldValues,
      first_name: m.profiles?.first_name ?? "",
      last_name: m.profiles?.last_name ?? "",
      username: m.profiles?.username ?? "",
      auth_email: normalizeAuthEmailInput(m.auth_email),
      auth_password: "",
      phone: m.profiles?.phone ?? "",
      birth_date: m.profiles?.birth_date ?? "",
      sex: m.profiles?.sex ?? "",
      handedness: m.profiles?.handedness ?? "",
      handicap: m.profiles?.handicap == null ? "" : String(m.profiles.handicap),
      address: m.profiles?.address ?? "",
      postal_code: m.profiles?.postal_code ?? "",
      city: m.profiles?.city ?? "",
      avs_no: m.profiles?.avs_no ?? "",
      staff_function: m.profiles?.staff_function ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
  }

  async function saveEdit() {
    if (!editingId || !clubId) return;

    setSavingId(editingId);
    setError(null);

    const headers = await authHeader();
    const payload: Record<string, any> = {
      memberId: editingId,
      role: form.role,
      is_active: form.is_active,
      first_name: (form.first_name ?? "").toString().trim(),
      last_name: (form.last_name ?? "").toString().trim(),
      username: (form.username ?? "").toString().trim().toLowerCase(),
      auth_email: normalizeAuthEmailInput(form.auth_email as string),
      auth_password: (form.auth_password ?? "").toString(),
    };

    if ((form.role ?? "player") === "player") {
      payload.phone = (form.phone ?? "").toString().trim();
      payload.birth_date = (form.birth_date ?? "").toString().trim();
      payload.sex = (form.sex ?? "").toString().trim();
      payload.handedness = (form.handedness ?? "").toString().trim();
      payload.handicap = (form.handicap ?? "").toString().trim();
      payload.address = (form.address ?? "").toString().trim();
      payload.postal_code = (form.postal_code ?? "").toString().trim();
      payload.city = (form.city ?? "").toString().trim();
      payload.avs_no = (form.avs_no ?? "").toString().trim();
      payload.player_field_values = form.player_field_values ?? {};
      payload.player_consent_status = (form.player_consent_status ?? "pending").toString().trim();
    }
    if ((form.role ?? "player") === "parent") {
      payload.auth_email = normalizeAuthEmailInput(form.auth_email as string);
      payload.auth_password = (form.auth_password ?? "").toString();
      payload.phone = (form.phone ?? "").toString().trim();
      payload.address = (form.address ?? "").toString().trim();
      payload.postal_code = (form.postal_code ?? "").toString().trim();
      payload.city = (form.city ?? "").toString().trim();
    }
    if ((form.role ?? "player") === "manager" || (form.role ?? "player") === "coach") {
      payload.staff_function = (form.staff_function ?? "").toString().trim();
    } else {
      payload.staff_function = "";
    }

    const res = await fetch(`/api/manager/clubs/${clubId}/members`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Erreur sauvegarde");
      setSavingId(null);
      return;
    }

    const shouldSyncPerformance =
      (form.role ?? "player") === "player" &&
      Boolean(form.user_id) &&
      form.is_active !== false;

    if (shouldSyncPerformance && form.user_id) {
      const { error: perfError } = await supabase.rpc("set_player_performance_mode", {
        p_org_id: clubId,
        p_player_id: form.user_id,
        p_enabled: Boolean(form.is_performance),
      });
      if (perfError) {
        // If membership just became inactive, the RPC can report not found while the update itself is successful.
        const perfMsg = String(perfError.message ?? "");
        if (perfMsg.includes("player_membership_not_found") && form.is_active === false) {
          // ignore
        } else {
          setError(perfError.message || "Erreur sauvegarde mode performance");
          setSavingId(null);
          return;
        }
      }
    }

    setSavingId(null);
    cancelEdit();
    await loadMembers(clubId);
  }

  const sorted = useMemo(
    () =>
      members
        .slice()
        .sort((a, b) => labelName(a).localeCompare(labelName(b), "fr")),
    [members]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (!q) return true;
      const haystack = [
        labelName(m),
        m.profiles?.username ?? "",
        m.auth_email ?? "",
        m.role ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, sorted, roleFilter]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, totalItems);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, clubId, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function exportFilteredUsers() {
    const rows = filtered.map((m) => {
      const firstName = String(m.profiles?.first_name ?? "").trim();
      const lastName = String(m.profiles?.last_name ?? "").trim();
      const email = normalizeAuthEmailInput(m.auth_email);
      return [lastName, firstName, email, roleLabel(m.role)];
    });

    const csv = [
      ["Nom", "Prénom", "Adresse e-mail", "Rôle"],
      ...rows,
    ]
      .map((row) => row.map((value) => csvCell(String(value ?? ""))).join(";"))
      .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const date = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `utilisateurs-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function onPickImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setImportSummary(null);
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length < 2) {
        setError("Le CSV doit contenir une ligne d'en-tête et au moins une ligne de données.");
        setImportFileName("");
        setImportHeaders([]);
        setImportRawRows([]);
        setImportMapping({});
        return;
      }

      const headers = rows[0].map((value, index) => String(value || `Colonne ${index + 1}`).trim() || `Colonne ${index + 1}`);
      const suggestedMapping: Record<string, ImportField> = {};
      headers.forEach((header) => {
        const key = header.trim().toLowerCase();
        if (["prenom", "prénom", "first name", "firstname", "first_name"].includes(key)) suggestedMapping[header] = "first_name";
        else if (["nom", "last name", "lastname", "last_name", "surname"].includes(key)) suggestedMapping[header] = "last_name";
        else if (["email", "e-mail", "adresse e-mail", "mail"].includes(key)) suggestedMapping[header] = "email";
        else if (["role", "rôle", "type"].includes(key)) suggestedMapping[header] = "role";
        else if (["telephone", "téléphone", "phone", "mobile"].includes(key)) suggestedMapping[header] = "phone";
        else if (["fonction", "staff function", "staff_function"].includes(key)) suggestedMapping[header] = "staff_function";
        else if (["date de naissance", "naissance", "birth date", "birth_date", "dob"].includes(key)) suggestedMapping[header] = "birth_date";
        else if (["adresse", "address"].includes(key)) suggestedMapping[header] = "address";
        else if (["code postal", "npa", "postal code", "postal_code", "zip"].includes(key)) suggestedMapping[header] = "postal_code";
        else if (["localite", "localité", "ville", "city"].includes(key)) suggestedMapping[header] = "city";
        else if (["avs", "avs no", "avs_no", "numero avs", "numéro avs"].includes(key)) suggestedMapping[header] = "avs_no";
        else {
          const matchedField = activePlayerFields.find((field) => normalizeFieldLabelToken(field.label) === normalizeFieldLabelToken(key));
          suggestedMapping[header] = matchedField ? `player_field:${matchedField.id}` : "";
        }
      });

      setImportFileName(file.name);
      setImportHeaders(headers);
      setImportRawRows(rows.slice(1));
      setImportMapping(suggestedMapping);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Impossible de lire le fichier CSV.");
      setImportFileName("");
      setImportHeaders([]);
      setImportRawRows([]);
      setImportMapping({});
    }
  }

  async function runImport() {
    if (!clubId || importPreview.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);

    try {
      const headers = await authHeader();
      let created = 0;
      let failed = 0;
      const messages: string[] = [];

      for (const row of importPreview) {
        if (row.errors.length > 0) {
          failed += 1;
          messages.push(`Ligne ${row.rowNumber}: ${row.errors.join(", ")}`);
          continue;
        }

        const res = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(row.normalized),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed += 1;
          messages.push(`Ligne ${row.rowNumber}: ${String(json?.error ?? "Erreur import")}`);
          continue;
        }
        created += 1;
      }

      setImportSummary({ created, failed, messages });
      await loadMembers(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur import CSV");
    } finally {
      setImporting(false);
    }
  }

  async function createPlayerField() {
    if (!clubId || savingFieldId) return;
    const label = newField.label.trim();
    if (!label) {
      setError("Le label du paramètre est requis.");
      return;
    }
    if (newField.field_type === "select" && !newField.options.trim()) {
      setError("Les options sont requises pour une liste.");
      return;
    }

    setSavingFieldId("new");
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/player-fields`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          label,
          field_type: newField.field_type,
          options: newField.options
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          sort_order: playerFields.length * 10 + 100,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Impossible de créer le paramètre");
      setNewField({ label: "", field_type: "text", options: "" });
      await loadMembers(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur création paramètre");
    } finally {
      setSavingFieldId(null);
    }
  }

  async function updatePlayerField(fieldId: string, patch: Partial<PlayerFieldDef> & { options?: string[] }) {
    if (!clubId || savingFieldId) return;
    setSavingFieldId(fieldId);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/player-fields/${fieldId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Impossible de mettre à jour le paramètre");
      await loadMembers(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur mise à jour paramètre");
    } finally {
      setSavingFieldId(null);
    }
  }

  async function deletePlayerField(fieldId: string) {
    if (!clubId || savingFieldId) return;
    setSavingFieldId(fieldId);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/manager/clubs/${clubId}/player-fields/${fieldId}`, {
        method: "DELETE",
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Impossible de supprimer le paramètre");
      await loadMembers(clubId);
    } catch (e: any) {
      setError(e?.message ?? "Erreur suppression paramètre");
    } finally {
      setSavingFieldId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, width: "min(980px, 100%)", margin: "0 auto", boxSizing: "border-box" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Utilisateurs</h1>
        <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
          Liste des utilisateurs rattachés au golf dont tu es manager.
        </div>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid #ffcccc",
            background: "#fff5f5",
            padding: 12,
            borderRadius: 12,
            color: "#a00",
          }}
        >
          {error}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Créer un utilisateur</h2>

        <form onSubmit={createUser} style={{ display: "grid", gap: 10, maxWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input placeholder="Prénom" value={cFirst} onChange={(e) => setCFirst(e.target.value)} style={inputStyle} />
            <input placeholder="Nom" value={cLast} onChange={(e) => setCLast(e.target.value)} style={inputStyle} />
          </div>

          <input placeholder="Adresse e-mail (optionnel)" value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={inputStyle} />
          <input placeholder="Téléphone (optionnel)" value={cPhone} onChange={(e) => setCPhone(e.target.value)} style={inputStyle} />
          {(cRole === "manager" || cRole === "coach") ? (
            <input
              placeholder="Fonction (optionnel)"
              value={cStaffFunction}
              onChange={(e) => setCStaffFunction(e.target.value)}
              style={inputStyle}
            />
          ) : null}

          <select value={cRole} onChange={(e) => setCRole(e.target.value as any)} style={inputStyle}>
            <option value="player">Joueur</option>
            <option value="coach">Coach</option>
            <option value="manager">Manager</option>
            <option value="parent">Parent</option>
          </select>

          <button className="btn" disabled={!canCreate} type="submit">
            Créer
          </button>
        </form>

        {createdCreds && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ fontWeight: 900 }}>Identifiants générés</div>
            <div style={{ marginTop: 6 }}>
              Username: <b>{createdCreds.username || "—"}</b>
            </div>
            <div style={{ marginTop: 6 }}>
              Mot de passe:{" "}
              <span style={{ fontFamily: "monospace" }}>
                {createdCreds.tempPassword ?? "inchangé (utilisateur existant)"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Importer des utilisateurs</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Charge un fichier CSV, associe les colonnes aux champs ActiviTee, puis importe les comptes dans le club.
          </div>

          <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <input type="file" accept=".csv,text/csv" onChange={onPickImportFile} style={inputStyle} />
            {importFileName ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                Fichier: {importFileName} • {importRawRows.length} ligne(s)
              </div>
            ) : null}
          </div>

          {importHeaders.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800 }}>Correspondance des colonnes</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {importHeaders.map((header) => (
                    <div
                      key={header}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 260px)",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{header}</div>
                      <select
                        value={importMapping[header] ?? ""}
                        onChange={(e) =>
                          setImportMapping((prev) => ({ ...prev, [header]: e.target.value as ImportField }))
                        }
                        style={inputStyle}
                      >
                        <option value="">Ignorer</option>
                        <option value="first_name">Prénom</option>
                        <option value="last_name">Nom</option>
                        <option value="email">Adresse e-mail</option>
                        <option value="role">Rôle</option>
                        <option value="phone">Téléphone</option>
                        <option value="staff_function">Fonction</option>
                        <option value="birth_date">Date de naissance</option>
                        <option value="address">Adresse</option>
                        <option value="postal_code">Code postal</option>
                        <option value="city">Localité</option>
                        <option value="avs_no">Numéro AVS</option>
                        {activePlayerFields.length > 0 ? <option disabled>────────</option> : null}
                        {activePlayerFields.map((field) => (
                          <option key={field.id} value={`player_field:${field.id}`}>
                            Paramètre joueur: {field.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800 }}>
                  Aperçu importable: {importReadyCount} / {importPreview.length}
                </div>
                <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto", paddingRight: 4 }}>
                  {importPreview.map((row) => (
                    <div
                      key={row.rowNumber}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 10,
                        background: "rgba(255,255,255,0.75)",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>Ligne {row.rowNumber}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        {row.normalized.first_name || "—"} {row.normalized.last_name || "—"} • {row.normalized.email || "pas d’e-mail"} • {roleLabel(row.normalized.role)}
                      </div>
                      {row.normalized.birth_date ? (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>Naissance: {row.normalized.birth_date}</div>
                      ) : null}
                      {row.normalized.phone ? (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>Tél: {row.normalized.phone}</div>
                      ) : null}
                      {row.normalized.address || row.normalized.postal_code || row.normalized.city ? (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>
                          Adresse: {[row.normalized.address, row.normalized.postal_code, row.normalized.city].filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                      {row.normalized.avs_no ? (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>AVS: {row.normalized.avs_no}</div>
                      ) : null}
                      {Object.entries(row.normalized.player_field_values).map(([fieldId, value]) => {
                        const field = activePlayerFields.find((item) => item.id === fieldId);
                        if (!field || value == null || value === "") return null;
                        return (
                          <div key={fieldId} style={{ fontSize: 13, color: "var(--muted)" }}>
                            {field.label}: {playerFieldDisplayValue(field, value)}
                          </div>
                        );
                      })}
                      {row.normalized.staff_function ? (
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>Fonction: {row.normalized.staff_function}</div>
                      ) : null}
                      {row.errors.length > 0 ? (
                        <div style={{ color: "#a00", fontSize: 13 }}>{row.errors.join(" • ")}</div>
                      ) : row.warnings.length > 0 ? (
                        <div style={{ color: "#9a6700", fontSize: 13 }}>{row.warnings.join(" • ")}</div>
                      ) : (
                        <div style={{ color: "#0a6", fontSize: 13 }}>Prêt à importer</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void runImport()}
                  disabled={importing || importReadyCount === 0}
                >
                  {importing ? "Import en cours..." : "Importer les utilisateurs"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setImportFileName("");
                    setImportHeaders([]);
                    setImportRawRows([]);
                    setImportMapping({});
                    setImportSummary(null);
                  }}
                  disabled={importing}
                >
                  Réinitialiser
                </button>
              </div>

              {importSummary ? (
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 900 }}>
                    Import terminé • {importSummary.created} créé(s), {importSummary.failed} échec(s)
                  </div>
                  {importSummary.messages.length > 0 ? (
                    <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#a00", maxHeight: 220, overflow: "auto" }}>
                      {importSummary.messages.map((message, index) => (
                        <div key={`${message}-${index}`}>{message}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune erreur.</div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Paramètres joueurs de l’organisation</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Définis ici les paramètres spécifiques aux joueurs de ce club. Les trois champs existants restent disponibles, mais chaque organisation peut maintenant gérer sa propre liste.
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {playerFields.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Aucun paramètre joueur configuré.</div>
            ) : (
              playerFields.map((field) => (
                <div
                  key={field.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 10,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(180px,1.2fr) 120px minmax(180px,1fr) auto auto", alignItems: "center" }}>
                    <input
                      value={field.label}
                      onChange={(e) =>
                        setPlayerFields((prev) => prev.map((item) => (item.id === field.id ? { ...item, label: e.target.value } : item)))
                      }
                      style={inputStyle}
                    />
                    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{field.field_type}</div>
                    <input
                      value={(field.options_json ?? []).join(", ")}
                      onChange={(e) =>
                        setPlayerFields((prev) =>
                          prev.map((item) =>
                            item.id === field.id
                              ? { ...item, options_json: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }
                              : item
                          )
                        )
                      }
                      style={{ ...inputStyle, opacity: field.field_type === "select" ? 1 : 0.55 }}
                      placeholder={field.field_type === "select" ? "Options séparées par des virgules" : "Pas d’options"}
                      disabled={field.field_type !== "select"}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={field.is_active}
                        onChange={(e) =>
                          setPlayerFields((prev) => prev.map((item) => (item.id === field.id ? { ...item, is_active: e.target.checked } : item)))
                        }
                      />
                      Actif
                    </label>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          void updatePlayerField(field.id, {
                            label: field.label,
                            is_active: field.is_active,
                            options: field.options_json ?? [],
                            sort_order: field.sort_order,
                          })
                        }
                        disabled={savingFieldId === field.id}
                      >
                        {savingFieldId === field.id ? "Sauvegarde…" : "Enregistrer"}
                      </button>
                      {!field.legacy_binding ? (
                        <button className="btn" type="button" onClick={() => void deletePlayerField(field.id)} disabled={savingFieldId === field.id}>
                          Supprimer
                        </button>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>Champ système</div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 10, maxWidth: 760 }}>
            <div style={{ fontWeight: 800 }}>Ajouter un paramètre</div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(180px,1fr) 160px minmax(220px,1.4fr) auto" }}>
              <input
                placeholder="Label"
                value={newField.label}
                onChange={(e) => setNewField((prev) => ({ ...prev, label: e.target.value }))}
                style={inputStyle}
              />
              <select
                value={newField.field_type}
                onChange={(e) => setNewField((prev) => ({ ...prev, field_type: e.target.value as PlayerFieldForm["field_type"] }))}
                style={inputStyle}
              >
                <option value="text">Texte</option>
                <option value="boolean">Oui / Non</option>
                <option value="select">Liste</option>
              </select>
              <input
                placeholder={newField.field_type === "select" ? "Options séparées par des virgules" : "Aucune option requise"}
                value={newField.options}
                onChange={(e) => setNewField((prev) => ({ ...prev, options: e.target.value }))}
                style={{ ...inputStyle, opacity: newField.field_type === "select" ? 1 : 0.55 }}
                disabled={newField.field_type !== "select"}
              />
              <button className="btn" type="button" onClick={() => void createPlayerField()} disabled={savingFieldId === "new"}>
                {savingFieldId === "new" ? "Ajout…" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Liste</h2>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <div style={{ maxWidth: 420 }}>
            <input
              placeholder="Rechercher (nom, username, email, rôle)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ maxWidth: 260 }}>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)} style={inputStyle}>
              <option value="all">Tous les rôles</option>
              <option value="player">Joueurs</option>
              <option value="parent">Parents</option>
              <option value="coach">Coachs</option>
              <option value="manager">Managers</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {totalItems === 0 ? "0 résultat" : `${pageStart}-${pageEnd} sur ${totalItems}`}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={exportFilteredUsers} disabled={filtered.length === 0}>
                Exporter CSV
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 13 }}>
                Par page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{ ...inputStyle, padding: "6px 10px", borderRadius: 10 }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <button className="btn" type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Précédent
              </button>
              <div style={{ fontSize: 13, fontWeight: 700, minWidth: 70, textAlign: "center" }}>
                Page {currentPage}/{totalPages}
              </div>
              <button
                className="btn"
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Suivant
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <ListLoadingBlock label="Chargement..." />
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>Aucun utilisateur.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {paginated.map((m) => {
              const isEditing = editingId === m.id;
              const isPlayerProfileEdit = (form.role ?? m.role) === "player";
              const isParentProfileEdit = (form.role ?? m.role) === "parent";

              return (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {!isEditing ? (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{labelName(m)}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          username: {m.profiles?.username ?? "—"} • rôle: {m.role}
                        </div>
                        {(m.role === "manager" || m.role === "coach") && m.profiles?.staff_function ? (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            fonction: {m.profiles.staff_function}
                          </div>
                        ) : null}
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          club: {clubNamesById[m.club_id] ?? m.club_id}
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          statut: {m.is_active ? "actif" : "archivé"}
                        </div>
                        {m.role === "player" && (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>
                            mode performance: {m.is_performance ? "oui" : "non"}
                          </div>
                        )}
                        {m.role === "player" ? (
                          <>
                            {activePlayerFields.length === 0 ? (
                              <div style={{ color: "var(--muted)", fontSize: 13 }}>Aucun paramètre joueur actif</div>
                            ) : null}
                            {activePlayerFields.map((field) => (
                              <div key={field.id} style={{ color: "var(--muted)", fontSize: 13 }}>
                                {field.label.toLowerCase()}: {playerFieldDisplayValue(field, m.player_field_values?.[field.id])}
                              </div>
                            ))}
                            <div style={{ color: "var(--muted)", fontSize: 13 }}>
                              consentement: {defaultConsentStatus(m) === "granted" ? "Accordé" : defaultConsentStatus(m) === "adult" ? "Majeur" : "En attente"}
                            </div>
                          </>
                        ) : null}
                      </div>

                      <button className="btn" onClick={() => startEdit(m)}>
                        Éditer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Prénom</span>
                          <input
                            placeholder="Prénom"
                            value={(form.first_name ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Nom</span>
                          <input
                            placeholder="Nom"
                            value={(form.last_name ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                      </div>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Username</span>
                        <input
                          placeholder="Username"
                          value={(form.username ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Adresse e-mail</span>
                        <input
                          placeholder="Adresse e-mail"
                          type="email"
                          value={(form.auth_email ?? "") as string}
                          onChange={(e) => setForm((f) => ({ ...f, auth_email: e.target.value }))}
                          style={inputStyle}
                        />
                      </label>
                      {(form.role === "manager" || form.role === "coach") ? (
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Fonction</span>
                          <input
                            placeholder="Fonction"
                            value={(form.staff_function ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, staff_function: e.target.value }))}
                            style={inputStyle}
                          />
                        </label>
                      ) : null}
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 800 }}>Nouveau mot de passe</span>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(220px, 360px) auto",
                            gap: 8,
                            alignItems: "center",
                            maxWidth: 520,
                          }}
                        >
                          <input
                            placeholder="Nouveau mot de passe (min 8)"
                            type="text"
                            value={(form.auth_password ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, auth_password: e.target.value }))}
                            style={inputStyle}
                          />
                          <button
                            className="btn"
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, auth_password: generatePassword(12) }))}
                            style={{ padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}
                          >
                            Générer
                          </button>
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Rôle</span>
                        <select
                          value={(form.role ?? "player") as string}
                          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as any }))}
                          style={inputStyle}
                        >
                          <option value="player">Joueur</option>
                          <option value="coach">Coach</option>
                          <option value="manager">Manager</option>
                          <option value="parent">Parent</option>
                        </select>
                      </label>

                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form.is_active)}
                          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                        />
                        Actif
                      </label>

                      {isPlayerProfileEdit && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(form.is_performance)}
                            onChange={(e) => setForm((f) => ({ ...f, is_performance: e.target.checked }))}
                          />
                          Mode performance
                        </label>
                      )}

                      {isPlayerProfileEdit && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>Profil joueur</div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            {activePlayerFields.map((field) => (
                              <label key={field.id} style={{ display: "grid", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 800 }}>{field.label}</span>
                                {field.field_type === "boolean" ? (
                                  <select
                                    value={
                                      form.player_field_values?.[field.id] == null
                                        ? ""
                                        : form.player_field_values?.[field.id]
                                        ? "yes"
                                        : "no"
                                    }
                                    onChange={(e) =>
                                      setForm((f) => ({
                                        ...f,
                                        player_field_values: {
                                          ...(f.player_field_values ?? {}),
                                          [field.id]: e.target.value === "" ? null : e.target.value === "yes",
                                        },
                                      }))
                                    }
                                    style={inputStyle}
                                  >
                                    <option value="">Non défini</option>
                                    <option value="yes">Oui</option>
                                    <option value="no">Non</option>
                                  </select>
                                ) : field.field_type === "select" ? (
                                  <select
                                    value={String(form.player_field_values?.[field.id] ?? "")}
                                    onChange={(e) =>
                                      setForm((f) => ({
                                        ...f,
                                        player_field_values: {
                                          ...(f.player_field_values ?? {}),
                                          [field.id]: e.target.value || null,
                                        },
                                      }))
                                    }
                                    style={inputStyle}
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
                                    value={String(form.player_field_values?.[field.id] ?? "")}
                                    onChange={(e) =>
                                      setForm((f) => ({
                                        ...f,
                                        player_field_values: {
                                          ...(f.player_field_values ?? {}),
                                          [field.id]: e.target.value || null,
                                        },
                                      }))
                                    }
                                    style={inputStyle}
                                  />
                                )}
                              </label>
                            ))}
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800 }}>Consentement</span>
                              <select
                                value={(form.player_consent_status ?? "pending") as string}
                                onChange={(e) => setForm((f) => ({ ...f, player_consent_status: e.target.value as EditForm["player_consent_status"] }))}
                                style={inputStyle}
                              >
                                <option value="granted">Accordé</option>
                                <option value="pending">En attente</option>
                                <option value="adult">Majeur</option>
                              </select>
                            </label>
                          </div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                            <input
                              type="date"
                              value={(form.birth_date ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                              style={inputStyle}
                            />
                            <select
                              value={(form.sex ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}
                              style={inputStyle}
                            >
                              <option value="">Sexe</option>
                              <option value="male">Homme</option>
                              <option value="female">Femme</option>
                              <option value="other">Autre</option>
                            </select>
                          </div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
                            <select
                              value={(form.handedness ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, handedness: e.target.value }))}
                              style={inputStyle}
                            >
                              <option value="">Latéralité</option>
                              <option value="right">Droitier</option>
                              <option value="left">Gaucher</option>
                            </select>
                            <input
                              placeholder="Handicap (ex: 12.4 ou AP)"
                              value={(form.handicap ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, handicap: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Téléphone"
                              value={(form.phone ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>

                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
                            <input
                              placeholder="Adresse"
                              value={(form.address ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="NPA"
                              value={(form.postal_code ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Ville"
                              value={(form.city ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>

                          <input
                            placeholder="No AVS"
                            value={(form.avs_no ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, avs_no: e.target.value }))}
                            style={inputStyle}
                          />
                        </>
                      )}

                      {isParentProfileEdit && (
                        <>
                          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>Contact parent</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                            <input
                              placeholder="Email login"
                              value={(form.auth_email ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, auth_email: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>
                          <input
                            placeholder="Téléphone"
                            value={(form.phone ?? "") as string}
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            style={inputStyle}
                          />
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
                            <input
                              placeholder="Adresse"
                              value={(form.address ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="NPA"
                              value={(form.postal_code ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                              style={inputStyle}
                            />
                            <input
                              placeholder="Ville"
                              value={(form.city ?? "") as string}
                              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                              style={inputStyle}
                            />
                          </div>
                        </>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" onClick={saveEdit} disabled={savingId === m.id}>
                          {savingId === m.id ? "Sauvegarde…" : "Sauvegarder"}
                        </button>
                        <button className="btn" onClick={cancelEdit} disabled={savingId === m.id}>
                          Annuler
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};
