import * as XLSX from "xlsx";
import { juniorImportFields, type JuniorImportField } from "./managerImportFields.ts";

type Translate = (key: string) => string;
const baseKeys = ["first_name", "last_name", "birth_date", "email", "phone", "address", "postal_code", "city"];
export function juniorImportColumns(fields: JuniorImportField[], t: Translate) {
  const columns: Array<{ key: string; header: string; field?: JuniorImportField }> = [];
  for (const prefix of ["junior", "parent1", "parent2"]) {
    const role = prefix === "junior" ? "player" : "parent";
    const owner = t(`manager.junior.import.${prefix}`);
    for (const key of [...baseKeys.filter(key => prefix === "junior" || key !== "birth_date"), ...(prefix === "junior" ? [] : ["relation", "is_primary"])]) {
      const id = `${prefix}_${key}`;
      const required = prefix === "junior" && ["first_name", "last_name", "birth_date"].includes(key);
      columns.push({ key: id, header: `${owner} · ${t(`manager.junior.import.column.${key}`)}${required ? " *" : ""}` });
    }
    for (const field of juniorImportFields(fields, role)) {
      const id = `${prefix}.field.${field.id}`;
      columns.push({ key: id, header: `${owner} · ${field.label}${role === "player" && field.is_required ? " *" : ""}`, field });
    }
  }
  const headers = new Set<string>();
  for (const column of columns) {
    const label = column.header; let suffix = 2;
    while (headers.has(column.header)) column.header = `${label} (${suffix++})`;
    headers.add(column.header);
  }
  return columns;
}
export function juniorImportFieldSignature(fields: JuniorImportField[]) {
  return JSON.stringify(fields.filter(f => importFieldAppliesToFamily(f)).sort((a, b) => a.id.localeCompare(b.id)).map(f => ({
    id: f.id, type: f.field_type, options: f.options_json ?? [], required: Boolean(f.is_required),
    roles: ["player", "parent"].filter(role => juniorImportFields([f], role).length), legacy: f.legacy_binding ?? null,
  })));
}
function importFieldAppliesToFamily(field: JuniorImportField) { return ["player", "parent"].some(role => juniorImportFields([field], role).length); }

export function createJuniorImportWorkbook(clubId: string, fields: JuniorImportField[], t: Translate) {
  const columns = juniorImportColumns(fields, t);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([columns.map(column => column.header)]);
  sheet["!cols"] = columns.map(column => ({ wch: column.field ? 30 : 25 }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  XLSX.utils.book_append_sheet(workbook, sheet, "Juniors");
  const instructions = [
    [t("manager.junior.import.template")], [t("manager.junior.import.templateHelp")],
    [t("manager.junior.import.templateRules")], [t("manager.junior.import.templateScope")],
    [t("manager.junior.import.columnLabel"), t("manager.junior.import.expected"), t("manager.junior.import.description")],
    ...columns.map(column => [column.header, column.field
      ? `${t(`manager.fields.${column.field.field_type}`)}${column.field.options_json?.length ? `: ${column.field.options_json.join(" | ")}` : ""}`
      : column.key.endsWith("birth_date") ? "YYYY-MM-DD" : column.key.endsWith("relation") ? ["mother", "father", "legal_guardian", "other"].map(key => t(`manager.junior.relation.${key}`)).join(" | ")
      : column.key.endsWith("is_primary") ? `${t("manager.junior.import.yes")} | ${t("manager.junior.import.no")}` : "", [column.key.startsWith("parent") && (column.field?.is_required || /_(first_name|last_name|email)$/.test(column.key)) ? t("manager.junior.import.parentFieldRequired") : "", column.field?.description ?? ""].filter(Boolean).join(" · ")]),
  ];
  const help = XLSX.utils.aoa_to_sheet(instructions); help["!cols"] = [{ wch: 65 }, { wch: 65 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(workbook, help, "Instructions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[JSON.stringify({ version: 1, clubId, signature: juniorImportFieldSignature(fields), columns: columns.map(({ key, header }) => ({ key, header })) })]]), "_activitee");
  workbook.Workbook = { Sheets: [{ name: "Juniors", Hidden: 0 }, { name: "Instructions", Hidden: 0 }, { name: "_activitee", Hidden: 1 }] };
  return workbook;
}

/** Workbook metadata is a compatibility check, never an authorization source. */
export function readJuniorImportWorkbook(workbook: XLSX.WorkBook, clubId: string, fields: JuniorImportField[]) {
  const metadata = workbook.Sheets._activitee;
  let mapping: Map<string, string> | undefined;
  if (metadata) {
    let manifest;
    try { manifest = JSON.parse(String(metadata.A1?.v ?? "")); } catch { throw new Error("manager.junior.import.templateStale"); }
    if (!manifest || typeof manifest !== "object") throw new Error("manager.junior.import.templateStale");
    if (manifest.clubId !== clubId) throw new Error("manager.junior.import.templateClub");
    if (manifest.version !== 1 || manifest.signature !== juniorImportFieldSignature(fields) || !Array.isArray(manifest.columns)) throw new Error("manager.junior.import.templateStale");
    mapping = new Map<string, string>();
    for (const column of manifest.columns) {
      if (!column || typeof column.header !== "string" || typeof column.key !== "string" || mapping.has(column.header)) throw new Error("manager.junior.import.templateStale");
      mapping.set(column.header, column.key);
    }
  }
  const sheet = workbook.Sheets[metadata ? "Juniors" : workbook.SheetNames[0]];
  if (!sheet) throw new Error("manager.junior.import.emptyWorkbook");
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  if (range.e.r > 2000 || (range.e.r + 1) * (range.e.c + 1) > 1_000_000) throw new Error("manager.junior.import.fileLimit");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true, dateNF: "yyyy-mm-dd", blankrows: true });
  if (matrix.length > 2001) throw new Error("manager.junior.import.fileLimit");
  const headers = (matrix[0] ?? []).map(value => String(value).trim());
  const keys = headers.map(header => mapping?.get(header) ?? header.match(/\[([^\]]+)\]$/)?.[1] ?? header);
  if (new Set(keys).size !== keys.length) throw new Error("manager.junior.import.duplicateColumns");
  if (!metadata && headers.some(header => header.includes(" · "))) throw new Error("manager.junior.import.templateStale");
  const allowed = new Set(juniorImportColumns(fields, key => key).map(column => column.key));
  if (metadata && (keys.length !== allowed.size || keys.some(key => !allowed.has(key)))) throw new Error("manager.junior.import.templateStale");
  for (const key of keys) {
    if (key.includes(".field.") && (!metadata || !allowed.has(key))) throw new Error("manager.junior.import.templateStale");
  }
  const raw = matrix.slice(1).map((values, index) => ({ ...Object.fromEntries(keys.map((key, col) => [key, values[col] instanceof Date ? (values[col] as Date).toISOString().slice(0, 10) : values[col] ?? ""])), __excelRow: index + 2 }))
    .filter(row => Object.entries(row).some(([key, value]) => key !== "__excelRow" && String(value).trim()));
  if (!raw.length) throw new Error("manager.junior.import.emptySheet");
  return raw;
}
