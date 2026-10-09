import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { createJuniorImportWorkbook, readJuniorImportWorkbook, juniorImportColumns } from "../lib/managerJuniorImportWorkbook.ts";
import { parseJuniorImportRows, runJuniorImport, createJuniorImportProgress, newJuniorImportConflicts } from "../lib/managerJuniorImport.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
import type { JuniorImportField } from "../lib/managerImportFields.ts";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerDatabase, managerFixture, loadManagerModule, managerRequest } from "./helpers/managerRouteHarness.ts";

const fields: JuniorImportField[] = [
  { id: "n", label: "Même libellé", field_type: "number", is_required: true },
  { id: "b", label: "Même libellé", field_type: "boolean", is_required: true },
  { id: "s", label: "Groupe souhaité", field_type: "select", options_json: ["A", "B"] },
  { id: "d", label: "Date", field_type: "date" },
  { id: "c", label: "Choix", field_type: "checkbox", options_json: ["A, B", "C", "A|C"] },
  { id: "p", label: "Disponibilité", field_type: "long_text", applies_to_roles: ["parent"] },
  { id: "sensitive", label: "Secret", field_type: "text", is_sensitive: true },
  { id: "season", label: "Saison", field_type: "text", scope: "season" },
  { id: "inactive", label: "Inactif", field_type: "text", is_active: false },
  { id: "readonly", label: "Lecture", field_type: "text", editable_by: "none" },
];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;
const junior = { junior_first_name: "Léa", junior_last_name: "Test", junior_birth_date: "2014-02-28" };
const family = { ...junior, parent1_first_name: "Alex", parent1_last_name: "Test", parent1_email: "Alex@example.test", parent1_relation: "mother", parent1_is_primary: "true", parent2_first_name: "Chris", parent2_last_name: "Test", parent2_email: "Chris@example.test", parent2_relation: "father", parent2_is_primary: "false", "junior.field.n": "0", "junior.field.b": "false", "junior.field.d": "29.02.2024", "junior.field.s": "A", "junior.field.c": '["A, B","A|C"]', "parent1.field.p": "Mercredi", "parent2.field.p": "Samedi", parent1_phone: "0790123456" };

function filledWorkbook(locale: AppLocale, data: Record<string, unknown>[], definitions = fields) {
  const wb = createJuniorImportWorkbook("A", definitions, tr(locale));
  const columns = juniorImportColumns(definitions, tr(locale));
  XLSX.utils.sheet_add_aoa(wb.Sheets.Juniors, data.map(row => columns.map(c => row[c.key] ?? "")), { origin: "A2" });
  return XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true });
}

test("blank localized templates round-trip with two parent groups, stable field IDs and no source personal data", () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    const wb = createJuniorImportWorkbook("A", fields, tr(locale));
    assert.equal(wb.Sheets.Juniors["!ref"]?.split(":")[1]?.match(/\d+$/)?.[0], "1");
    assert.equal(wb.Workbook?.Sheets?.[2].Hidden, 1);
    const cols = juniorImportColumns(fields, tr(locale));
    assert.equal(cols.filter(c => c.field).length, 7);
    assert.ok(cols.every(c => !/sensitive|season|inactive|readonly/.test(c.key)));
    assert.ok(cols.some(c => c.key === "parent2_email"));
    const rows = parseJuniorImportRows(readJuniorImportWorkbook(filledWorkbook(locale, [family]), "A", fields), [], fields);
    assert.deepEqual(rows[0].errors, []);
    assert.equal(rows[0].parents.length, 2);
    assert.deepEqual(rows[0].field_values, { b: false, c: ["A, B", "A|C"], d: "2024-02-29", n: "0", s: "A" });
    assert.deepEqual(rows[0].parents[0].field_values, { p: "Mercredi" });
    assert.equal(rows[0].parents[0].profile.phone, "0790123456");
  }
});

test("templates reject another organization, stale options, duplicate headers and missing metadata", () => {
  const wb = filledWorkbook("fr", [family]);
  assert.throws(() => readJuniorImportWorkbook(wb, "B", fields), /templateClub/);
  assert.throws(() => readJuniorImportWorkbook(wb, "A", fields.map(f => f.id === "s" ? { ...f, options_json: ["C"] } : f)), /templateStale/);
  delete wb.Sheets._activitee;
  assert.throws(() => readJuniorImportWorkbook(wb, "A", fields), /templateStale/);
  const duplicate = { SheetNames: ["Data"], Sheets: { Data: XLSX.utils.aoa_to_sheet([["junior_first_name", "junior_first_name"], ["Lea", "Leo"]]) } };
  assert.throws(() => readJuniorImportWorkbook(duplicate, "A", []), /duplicateColumns/);
});

test("blank rows retain original Excel row numbers; typed Excel dates and legacy CSV remain compatible", () => {
  const wb = filledWorkbook("fr", [{}, { ...family, junior_birth_date: new Date("2014-02-28T00:00:00Z") }]);
  const raw = readJuniorImportWorkbook(wb, "A", fields);
  assert.equal(raw[0].__excelRow, 3);
  assert.equal(parseJuniorImportRows(raw, [], fields)[0].junior_birth_date, "2014-02-28");
  const csv = XLSX.read('Prénom junior,Nom junior,Date de naissance,E-mail parent,Prénom parent,Nom parent\nLea,Test,28.02.2014,p@example.test,Alex,Test', { type: "string" });
  assert.equal(parseJuniorImportRows(readJuniorImportWorkbook(csv, "A", []), [])[0].parents.length, 1);
});

test("preview rejects invalid or missing custom fields, malformed parents and ambiguous family data", () => {
  const rows = parseJuniorImportRows([{ ...family, "junior.field.n": "", "junior.field.b": "maybe", "junior.field.s": "X", parent2_is_primary: "true" }], [], fields);
  assert.equal(rows[0].field_errors.length, 3);
  assert.ok(rows[0].errors.includes("manager.junior.import.twoPrimary"));
  assert.ok(parseJuniorImportRows([{ ...family, parent2_email: "Alex@example.test" }], [], fields)[0].errors.includes("manager.junior.import.sameParent"));
  assert.ok(parseJuniorImportRows([{ ...junior, parent2_first_name: "Alex" }], [])[0].errors.includes("manager.junior.import.parentEmailInvalid"));
  assert.ok(parseJuniorImportRows([{ ...family, junior_email: "alex@example.test" }], [], fields)[0].errors.includes("manager.junior.import.sharedJuniorEmail"));
  const siblings = parseJuniorImportRows([family, { ...family, junior_first_name: "Tom", "parent1.field.p": "Autre" }], [], fields);
  assert.ok(siblings.every(row => row.errors.includes("manager.junior.import.parentConflict")));
  const existing = [{ role: "player", user_id: "existing", profiles: { first_name: "Léa", last_name: "Test", birth_date: "2014-02-28" } }];
  assert.ok(parseJuniorImportRows([junior], existing)[0].errors.includes("manager.junior.import.duplicateJunior"));
});

test("two-parent retries and siblings create each parent once, preserve completed links and leave consent pending", async () => {
  const rows = parseJuniorImportRows([family, { ...family, junior_first_name: "Tom" }], [], fields);
  const progress = createJuniorImportProgress();
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []; let fail = true;
  const request = async (path: string, body: Record<string, unknown>) => {
    writes.push({ path, body });
    if (body.role === "player") return { user: { id: String(body.first_name) } };
    if (body.role === "parent") return { user: { id: String(body.email) } };
    if (body.player_id === "Léa" && body.guardian_user_id === "chris@example.test" && fail) throw new Error("link failed");
    return {};
  };
  const first = await runJuniorImport(rows, "A", progress, request);
  assert.equal(first.associations, 3); assert.equal(first.errors.length, 1);
  fail = false; const count = writes.length;
  const second = await runJuniorImport(rows, "A", progress, request);
  assert.equal(writes.length, count + 1); assert.equal(second.associations, 4);
  assert.equal(writes.filter(w => w.body.role === "parent").length, 2);
  assert.deepEqual(writes.find(w => w.body.role === "parent")?.body.player_field_values, { p: "Mercredi" });
  assert.ok(writes.filter(w => w.body.role === "player").every(w => w.body.player_consent_status === "pending"));
  assert.ok(writes.every(w => !w.path.includes("invitation")));
});

const createPath = "app/api/admin/clubs/[clubId]/create-member/route.ts";
test("server stores parent custom values and rejects foreign, sensitive, seasonal and wrong-role fields before account writes", async () => {
  for (const mode of ["valid", "foreign", "sensitive", "season", "role", "invalid", "inactive", "readonly"] as const) {
    const tables = managerFixture();
    tables.club_player_fields = [{ id: "p", club_id: mode === "foreign" ? "B" : "A", label: "Option", field_type: "boolean", applies_to_roles: mode === "role" ? ["player"] : ["parent"], is_sensitive: mode === "sensitive", scope: mode === "season" ? "season" : "permanent", is_active: mode !== "inactive", editable_by: mode === "readonly" ? "none" : "manager" }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", { role: "parent", first_name: "Parent", last_name: "QA", email: "new@example.test", player_field_values: { p: mode === "invalid" ? "false" : false } }), { params: Promise.resolve({ clubId: "A" }) });
    assert.equal(response.status, mode === "valid" ? 200 : 400, mode);
    if (mode === "valid") assert.equal(h.writes.find(w => w.table === "club_member_player_field_values")?.values.value_bool, false);
    else { assert.deepEqual(h.authWrites, []); assert.deepEqual(h.writes, []); }
  }
});

test("Manager downloads a scoped workbook and sees two parents; changed fields block import before any writes", async () => {
  let locale: AppLocale = "fr", currentFields = fields;
  const writes: unknown[] = []; let download: XLSX.WorkBook | undefined;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
  const h = coachComponentHarness("components/manager/PlayersExcelImportPage.tsx", {
    modules: {
      "next/navigation": { useSearchParams: () => new URLSearchParams({ club: "A" }) },
      "@/components/i18n/AppI18nProvider": { useI18n: () => ({ locale, t: tr(locale) }) },
      "@/lib/managerJuniorImportExcel": { downloadJuniorImportExcel: async (clubId: string, definitions: JuniorImportField[], t: (key: string) => string) => { download = createJuniorImportWorkbook(clubId, definitions, t); } },
    },
    fetch: async (url, init) => {
      if (init?.method) { writes.push(init.body); throw new Error("No write expected"); }
      return Response.json(String(url).endsWith("my-clubs") ? { clubs: [{ id: "A", name: "Club QA" }] } : { members: [], playerFields: currentFields });
    },
  });
  async function settle() { let tree = h.render(); for (let i = 0; i < 5; i++) { await flush(); tree = h.render(); } return tree; }
  try {
    let tree = await settle();
    const button = (name: string) => elements(tree).find(n => n.type === "button" && textContent(n).trim() === name)!;
    button(tr(locale)("manager.junior.import.template")).props.onClick();
    tree = await settle();
    assert.ok(download); assert.equal(JSON.parse(String(download.Sheets._activitee.A1.v)).clubId, "A");
    assert.ok(juniorImportColumns(fields, tr(locale)).every(c => !c.header.includes(c.key)));
    const bytes = XLSX.write(filledWorkbook("fr", [family]), { type: "array", bookType: "xlsx" });
    elements(tree).find(n => n.type === "input" && n.props.type === "file")!.props.onChange({ target: { files: [{ name: "qa.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes }], value: "qa.xlsx" } });
    tree = await settle(); assert.ok(textContent(tree).includes("Alex")); assert.ok(textContent(tree).includes("Chris"));
    locale = "de"; tree = await settle(); assert.ok(textContent(tree).includes("Disponibilité")); // Authored field labels are kept.
    currentFields = fields.map(f => f.id === "p" ? { ...f, is_required: true } : f);
    button("1 Zeile importieren").props.onClick(); tree = await settle();
    assert.ok(textContent(tree).includes(tr(locale)("manager.junior.import.templateStale")));
    assert.deepEqual(writes, []);
  } finally { h.cleanup(); if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); }
});

test("a junior added after preview is blocked, while a partially imported junior can resume", () => {
  const rows = parseJuniorImportRows([junior], []);
  const existing = [{ role: "player", user_id: "created", profiles: { first_name: "Léa", last_name: "Test", birth_date: "2014-02-28" } }];
  const progress = createJuniorImportProgress();
  assert.deepEqual([...newJuniorImportConflicts(rows, existing, progress)], [2]);
  progress.juniors.set("lea|test|2014-02-28", "created");
  assert.equal(newJuniorImportConflicts(rows, existing, progress).size, 0);
});
