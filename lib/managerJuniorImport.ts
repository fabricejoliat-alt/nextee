export type ExistingJuniorImportMember = { role: string; user_id: string; auth_email?: string | null; profiles?: { first_name?: string | null; last_name?: string | null; birth_date?: string | null } | null };
export type JuniorImportRow = { row: number; junior_first_name: string; junior_last_name: string; junior_birth_date: string; junior_email: string; parent_first_name: string; parent_last_name: string; parent_email: string; relation: "mother" | "father" | "legal_guardian" | "other"; is_primary: boolean; errors: string[]; possible_duplicate: boolean; parent_exists: boolean };

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
export function parseJuniorImportRows(raw: Record<string, unknown>[], existing: ExistingJuniorImportMember[]): JuniorImportRow[] {
  const existingPlayers = new Set(existing.filter(member => member.role === "player").map(member => identity(member.profiles?.first_name ?? "", member.profiles?.last_name ?? "", member.profiles?.birth_date ?? "")));
  const parentEmails = new Set(existing.filter(member => member.role === "parent").map(member => email(member.auth_email ?? "")).filter(Boolean));
  const seen = new Set<string>();
  return raw.map((source, index) => {
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
    seen.add(rowIdentity);
    return { row: index + 2, junior_first_name: first, junior_last_name: last, junior_birth_date: birth, junior_email: juniorEmail, parent_first_name: parentFirst, parent_last_name: parentLast, parent_email: parentEmail, relation: relation(text(source, ["Relation", "parent_relation", "Beziehung", "Relazione"])), is_primary: ["oui", "yes", "true", "1", "principal", "ja", "si", "vero", "wahr"].includes(normalized(text(source, ["Parent principal", "parent_principal", "is_primary", "Primary parent", "Hauptkontakt", "Genitore principale"]))), errors, possible_duplicate: duplicate, parent_exists: Boolean(parentEmail && parentEmails.has(parentEmail)) };
  });
}

export function createJuniorImportProgress() {
  return { juniors: new Map<string, string>(), parents: new Map<string, string>(), completed: new Set<number>(), associations: 0 };
}
export type JuniorImportProgress = ReturnType<typeof createJuniorImportProgress>;
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
        const result = await request(`/api/admin/clubs/${clubId}/create-member`, { role: "player", first_name: row.junior_first_name, last_name: row.junior_last_name, birth_date: row.junior_birth_date, email: row.junior_email, player_consent_status: "pending" }, "manager.junior.import.juniorError");
        juniorId = result.user?.id;
        if (!juniorId) throw new Error("manager.junior.import.juniorIdMissing");
        progress.juniors.set(rowIdentity, juniorId);
      }
      if (row.parent_email) {
        let parentId = progress.parents.get(row.parent_email);
        if (!parentId) {
          const result = await request(`/api/admin/clubs/${clubId}/create-member`, { role: "parent", player_id: juniorId, first_name: row.parent_first_name, last_name: row.parent_last_name, email: row.parent_email }, "manager.junior.import.parentError");
          parentId = result.user?.id;
          if (!parentId) throw new Error("manager.junior.import.parentIdMissing");
          progress.parents.set(row.parent_email, parentId);
        }
        await request(`/api/manager/clubs/${clubId}/guardians`, { player_id: juniorId, guardian_user_id: parentId, relation: row.relation, is_primary: row.is_primary }, "manager.junior.import.linkError");
        progress.associations++;
      }
      progress.completed.add(row.row);
    } catch (cause) { errors.push({ row: row.row, error: cause instanceof Error ? cause.message : "manager.junior.import.error" }); }
  }
  return { juniors_created_or_updated: progress.juniors.size, parents_created_or_updated: progress.parents.size, associations: progress.associations, errors };
}
