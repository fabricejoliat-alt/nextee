import { juniorImportFields, type JuniorImportField } from "./managerImportFields.ts";
import { encodeMemberFieldValue } from "./memberFieldValues.ts";
export type ExistingJuniorImportMember = { role: string; user_id: string; auth_email?: string | null; profiles?: { first_name?: string | null; last_name?: string | null; birth_date?: string | null } | null };
export type JuniorImportParent = { first_name: string; last_name: string; email: string; relation: "mother" | "father" | "legal_guardian" | "other"; is_primary: boolean; exists: boolean; profile: Record<string, string>; field_values: Record<string, unknown> };
export type JuniorImportRow = { parents: JuniorImportParent[]; profile: Record<string, string>; field_values: Record<string, unknown>; field_errors: Array<{ label: string; key: string }>; row: number; junior_first_name: string; junior_last_name: string; junior_birth_date: string; junior_email: string; parent_first_name: string; parent_last_name: string; parent_email: string; relation: "mother" | "father" | "legal_guardian" | "other"; is_primary: boolean; errors: string[]; possible_duplicate: boolean; parent_exists: boolean };

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const email = (value: string) => value.trim().toLowerCase();
const identity = (first: string, last: string, birth: string) => `${normalized(first)}|${normalized(last)}|${birth}`;
function text(row: Record<string, unknown>, names: string[]) {
  for (const name of names) { const value = row[name]; if (value != null && String(value).trim()) return String(value).trim(); }
  return "";
}

export function juniorImportDate(value: string) {
  const local = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const iso = local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

function relation(value: string): JuniorImportRow["relation"] {
  const key = normalized(value);
  if (["mere", "mother", "maman", "mutter", "madre"].includes(key)) return "mother";
  if (["pere", "father", "papa", "vater", "padre"].includes(key)) return "father";
  if (["representant legal", "legal guardian", "legal_guardian", "tuteur", "gesetzliche vertretung", "erziehungsberechtigte", "rappresentante legale", "tutore"].includes(key)) return "legal_guardian";
  return "other";
}

/** Column aliases are file formats, independent of the interface language. */
export function parseJuniorImportRows(raw: Record<string, unknown>[], existing: ExistingJuniorImportMember[], fields: JuniorImportField[] = []): JuniorImportRow[] {
  const existingPlayers = new Set(existing.filter(member => member.role === "player").map(member => identity(member.profiles?.first_name ?? "", member.profiles?.last_name ?? "", member.profiles?.birth_date ?? "")));
  const parentEmails = new Set(existing.filter(member => member.role === "parent").map(member => email(member.auth_email ?? "")).filter(Boolean));
  const seen = new Set<string>();
  const rows = raw.map((source, index) => {
    const first = text(source, ["Prénom junior", "Prenom junior", "junior_prenom", "junior_first_name", "Prénom", "Junior first name", "Vorname Junior", "Nome junior"]);
    const last = text(source, ["Nom junior", "junior_nom", "junior_last_name", "Nom", "Junior last name", "Nachname Junior", "Cognome junior"]);
    const birth = juniorImportDate(text(source, ["Date de naissance", "junior_date_naissance", "junior_birth_date", "Naissance", "Date of birth", "Geburtsdatum", "Data di nascita"]));
    const juniorEmail = email(text(source, ["E-mail junior", "Email junior", "junior_email", "Junior email", "E-Mail Junior"]));
    const parentEmail = email(text(source, ["E-mail parent", "Email parent", "parent_email", "Parent email", "E-Mail Elternteil", "E-mail genitore"]));
    const parentFirst = text(source, ["Prénom parent", "Prenom parent", "parent_prenom", "parent_first_name", "Parent first name", "Vorname Elternteil", "Nome genitore"]);
    const parentLast = text(source, ["Nom parent", "parent_nom", "parent_last_name", "Parent last name", "Nachname Elternteil", "Cognome genitore"]);
    const rowIdentity = identity(first, last, birth);
    const errors: string[] = [];
    const invalidEmail = (value: string) => value && !/^\S+@\S+\.\S+$/.test(value);
    if (!first) errors.push("manager.junior.import.firstMissing");
    if (!last) errors.push("manager.junior.import.lastMissing");
    if (!birth) errors.push("manager.junior.import.birthInvalid");
    if (invalidEmail(juniorEmail)) errors.push("manager.junior.import.juniorEmailInvalid");
    if (invalidEmail(parentEmail)) errors.push("manager.junior.import.parentEmailInvalid");
    if (parentEmail && (!parentFirst || !parentLast)) errors.push("manager.junior.import.parentNameMissing");
    const duplicate = seen.has(rowIdentity) || existingPlayers.has(rowIdentity);
    if (duplicate) errors.push("manager.junior.import.duplicateJunior");
    const fieldErrors: JuniorImportRow["field_errors"] = [];
    const fieldValues = (prefix: string, role: string, present = true) => {
      const values: Record<string, unknown> = {};
      if (!present) return values;
      for (const field of juniorImportFields(fields, role)) {
        const raw = text(source, [`${prefix}.field.${field.id}`]);
        if (!raw) { if (field.is_required) fieldErrors.push({ label: `${prefix} · ${field.label}`, key: "manager.junior.import.fieldRequired" }); continue; }
        let value: unknown = raw;
        if (field.field_type === "boolean") value = importBoolean(raw);
        if (field.field_type === "number") value = raw.replace(",", ".");
        if (field.field_type === "date") value = juniorImportDate(raw) || raw;
        if (field.field_type === "checkbox") {
          try { value = field.options_json?.includes(raw) ? [raw] : raw.startsWith("[") ? JSON.parse(raw) : raw.split("|").map(item => item.trim()); }
          catch { value = null; }
        }
        try {
          if (value == null) throw new Error("invalid");
          encodeMemberFieldValue(field, value); values[field.id] = value;
        } catch { fieldErrors.push({ label: `${prefix} · ${field.label}`, key: "manager.junior.import.fieldInvalid" }); }
      }
      return values;
    };
    const profile = (prefix: string) => Object.fromEntries(["phone", "address", "postal_code", "city"].flatMap(key => {
      const value = text(source, [`${prefix}_${key}`]); return value ? [[key, value]] : [];
    }));
    const parents: JuniorImportParent[] = [];
    for (const prefix of ["parent1", "parent2"]) {
      const first_name = text(source, [`${prefix}_first_name`]) || (prefix === "parent1" ? parentFirst : "");
      const last_name = text(source, [`${prefix}_last_name`]) || (prefix === "parent1" ? parentLast : "");
      const address = email(text(source, [`${prefix}_email`])) || (prefix === "parent1" ? parentEmail : "");
      const relationText = text(source, [`${prefix}_relation`]) || (prefix === "parent1" ? text(source, ["Relation", "parent_relation", "Beziehung", "Relazione"]) : "");
      const primaryText = text(source, [`${prefix}_is_primary`]) || (prefix === "parent1" ? text(source, ["Parent principal", "parent_principal", "is_primary", "Primary parent", "Hauptkontakt", "Genitore principale"]) : "");
      const present = Boolean(first_name || last_name || address || Object.entries(source).some(([key, value]) => key.startsWith(prefix + "_") || key.startsWith(prefix + ".field.") ? String(value).trim() : false));
      if (!present) continue;
      if (!address || invalidEmail(address)) errors.push("manager.junior.import.parentEmailInvalid");
      if (!first_name || !last_name) errors.push("manager.junior.import.parentNameMissing");
      if (primaryText && importBoolean(primaryText) == null) errors.push("manager.junior.import.primaryInvalid");
      if (relationText && !["mother", "father", "legal_guardian", "other"].includes(normalized(relationText)) && relation(relationText) === "other" && !["autre", "andere", "altro"].includes(normalized(relationText))) errors.push("manager.junior.import.relationInvalid");
      parents.push({ first_name, last_name, email: address, relation: relation(relationText), is_primary: importBoolean(primaryText) === true, exists: parentEmails.has(address), profile: profile(prefix), field_values: fieldValues(prefix, "parent") });
    }
    if (juniorEmail && parents.some(parent => parent.email === juniorEmail)) errors.push("manager.junior.import.sharedJuniorEmail");
    if (parents.length === 2 && parents[0].email === parents[1].email) errors.push("manager.junior.import.sameParent");
    if (parents.filter(parent => parent.is_primary).length > 1) errors.push("manager.junior.import.twoPrimary");
    const values = fieldValues("junior", "player");
    if (fieldErrors.length) errors.push("manager.junior.import.customInvalid");
    seen.add(rowIdentity);
    return { parents, profile: profile("junior"), field_values: values, field_errors: fieldErrors, row: Number(source.__excelRow) || index + 2, junior_first_name: first, junior_last_name: last, junior_birth_date: birth, junior_email: juniorEmail, parent_first_name: parents[0]?.first_name ?? "", parent_last_name: parents[0]?.last_name ?? "", parent_email: parents[0]?.email ?? "", relation: parents[0]?.relation ?? "other", is_primary: parents[0]?.is_primary ?? false, errors: [...new Set(errors)], possible_duplicate: duplicate, parent_exists: parents.some(parent => parent.exists) };
  });
  // A shared parent must have one consistent set of values across sibling rows.
  const parentRows = new Map<string, { fingerprint: string; rows: JuniorImportRow[] }>();
  for (const row of rows) for (const parent of row.parents) {
    const fingerprint = JSON.stringify([normalized(parent.first_name), normalized(parent.last_name), parent.profile, parent.field_values]);
    const seen = parentRows.get(parent.email);
    if (seen && seen.fingerprint !== fingerprint) {
      for (const item of [...seen.rows, row]) if (!item.errors.includes("manager.junior.import.parentConflict")) item.errors.push("manager.junior.import.parentConflict");
    }
    if (seen) seen.rows.push(row); else parentRows.set(parent.email, { fingerprint, rows: [row] });
  }
  return rows;
}

function importBoolean(value: string): boolean | null {
  const key = normalized(value);
  if (["oui", "yes", "true", "1", "principal", "ja", "si", "vero", "wahr"].includes(key)) return true;
  if (["non", "no", "false", "0", "nein", "falso", "falsch"].includes(key)) return false;
  return null;
}

export function createJuniorImportProgress() {
  return { juniors: new Map<string, string>(), parents: new Map<string, string>(), completed: new Set<number>(), links: new Set<string>(), associations: 0 };
}
export type JuniorImportProgress = ReturnType<typeof createJuniorImportProgress>;
export function newJuniorImportConflicts(rows: JuniorImportRow[], existing: ExistingJuniorImportMember[], progress: JuniorImportProgress) {
  const createdIds = new Set(progress.juniors.values());
  const existingIdentities = new Set(existing.filter(member => member.role === "player" && !createdIds.has(member.user_id)).map(member => identity(member.profiles?.first_name ?? "", member.profiles?.last_name ?? "", member.profiles?.birth_date ?? "")));
  return new Set(rows.filter(row => !row.errors.length && !progress.completed.has(row.row) && existingIdentities.has(identity(row.junior_first_name, row.junior_last_name, row.junior_birth_date))).map(row => row.row));
}
export type JuniorImportSummary = { juniors_created_or_updated: number; parents_created_or_updated: number; associations: number; errors: Array<{ row: number; error: string }> };
type ImportRequest = (path: string, body: Record<string, unknown>, fallback: string) => Promise<{ user?: { id?: string } }>;

/** Retain successful steps during a retry on this page; never send invitations. */
export async function runJuniorImport(rows: JuniorImportRow[], clubId: string, progress: JuniorImportProgress, request: ImportRequest): Promise<JuniorImportSummary> {
  const errors: JuniorImportSummary["errors"] = [];
  for (const row of rows.filter(item => !item.errors.length && !progress.completed.has(item.row))) {
    try {
      const rowIdentity = identity(row.junior_first_name, row.junior_last_name, row.junior_birth_date);
      let juniorId = progress.juniors.get(rowIdentity);
      if (!juniorId) {
        const result = await request(`/api/admin/clubs/${clubId}/create-member`, { role: "player", first_name: row.junior_first_name, last_name: row.junior_last_name, birth_date: row.junior_birth_date, email: row.junior_email, ...row.profile, player_field_values: row.field_values, player_consent_status: "pending" }, "manager.junior.import.juniorError");
        juniorId = result.user?.id;
        if (!juniorId) throw new Error("manager.junior.import.juniorIdMissing");
        progress.juniors.set(rowIdentity, juniorId);
      }
      for (const parent of row.parents) {
        let parentId = progress.parents.get(parent.email);
        if (!parentId) {
          const result = await request(`/api/admin/clubs/${clubId}/create-member`, { role: "parent", player_id: juniorId, first_name: parent.first_name, last_name: parent.last_name, email: parent.email, ...parent.profile, player_field_values: parent.field_values }, "manager.junior.import.parentError");
          parentId = result.user?.id;
          if (!parentId) throw new Error("manager.junior.import.parentIdMissing");
          progress.parents.set(parent.email, parentId);
        }
        const linkKey = `${juniorId}|${parentId}`;
        if (!progress.links.has(linkKey)) {
          await request(`/api/manager/clubs/${clubId}/guardians`, { player_id: juniorId, guardian_user_id: parentId, relation: parent.relation, is_primary: parent.is_primary }, "manager.junior.import.linkError");
          progress.links.add(linkKey);
          progress.associations++;
        }
      }
      progress.completed.add(row.row);
    } catch (cause) { errors.push({ row: row.row, error: cause instanceof Error ? cause.message : "manager.junior.import.error" }); }
  }
  return { juniors_created_or_updated: progress.juniors.size, parents_created_or_updated: progress.parents.size, associations: progress.associations, errors };
}
