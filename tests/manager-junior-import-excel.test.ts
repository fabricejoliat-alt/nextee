import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { createJuniorImportExcel } from "../lib/managerJuniorImportExcel.ts";
import { juniorImportColumns, readJuniorImportWorkbook } from "../lib/managerJuniorImportWorkbook.ts";
import { parseJuniorImportRows } from "../lib/managerJuniorImport.ts";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";

const fields = [
  { id: "flag", label: "Autorisé", field_type: "boolean" },
  { id: "select", label: "Niveau", field_type: "select", options_json: ["A, B", "C".repeat(260)] },
  { id: "multi", label: "Jours", field_type: "checkbox", options_json: ["Lundi", "Mercredi"] },
];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;

test("native dropdowns survive XLSX export on all 2000 rows and localized selections import correctly", async () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    const t = tr(locale), bytes = await createJuniorImportExcel("A", fields, t);
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = excel.getWorksheet("Juniors")!;
    const columns = juniorImportColumns(fields, t);
    const index = (key: string) => columns.findIndex(c => c.key === key) + 1;
    for (const key of ["parent1_is_primary", "parent2_is_primary", "parent1_relation", "parent2_relation", "junior.field.flag", "junior.field.select"]) {
      for (const row of [2, 2001]) {
        const validation = sheet.getCell(row, index(key)).dataValidation;
        assert.equal(validation.type, "list");
        assert.equal(validation.showErrorMessage, true);
        assert.equal(validation.allowBlank, true);
        assert.ok(excel.definedNames.getRanges(String(validation.formulae[0])).ranges.length);
      }
    }
    assert.equal(sheet.getCell(2, index("junior.field.multi")).dataValidation?.type, undefined);
    assert.equal(sheet.getColumn(index("parent1_phone")).numFmt, "@");
    assert.equal(sheet.views[0].state, "frozen");
    assert.equal(excel.getWorksheet("_choices")!.state, "veryHidden");
    const chosen = {
      junior_first_name: "Léa", junior_last_name: "Test", junior_birth_date: "2014-02-28",
      parent1_first_name: "Alex", parent1_last_name: "Test", parent1_email: "alex@example.test",
      parent1_is_primary: t("manager.junior.import.yes"), parent1_relation: t("manager.junior.relation.mother"),
      parent2_first_name: "Chris", parent2_last_name: "Test", parent2_email: "chris@example.test",
      parent2_is_primary: t("manager.junior.import.no"), parent2_relation: t("manager.junior.relation.other"),
      "junior.field.flag": t("manager.junior.import.no"), "junior.field.select": "A, B", "junior.field.multi": "Lundi | Mercredi",
    };
    for (const [key, value] of Object.entries(chosen)) sheet.getCell(2, index(key)).value = value;
    const saved = await excel.xlsx.writeBuffer();
    const workbook = XLSX.read(saved, { type: "buffer", cellDates: true });
    const rows = parseJuniorImportRows(readJuniorImportWorkbook(workbook, "A", fields), [], fields);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].errors, []);
    assert.equal(rows[0].parents[0].is_primary, true);
    assert.equal(rows[0].parents[1].is_primary, false);
    assert.equal(rows[0].parents[1].relation, "other");
    assert.equal(rows[0].field_values.flag, false);
    assert.deepEqual(rows[0].field_values.multi, ["Lundi", "Mercredi"]);
  }
});

test("a junior without parents imports from the actual Excel template even when parent custom fields are required", async () => {
  const definitions = [{ id: "parent-required", label: "Champ parent requis", field_type: "text", applies_to_roles: ["parent"], is_required: true }];
  const t = tr("fr"), columns = juniorImportColumns(definitions, t);
  assert.ok(columns.filter(c => c.key.startsWith("parent")).every(c => !c.header.includes("*")));
  assert.ok(columns.filter(c => c.key.startsWith("parent")).every(c => c.header.includes("facultatif")));
  const bytes = await createJuniorImportExcel("A", definitions, t);
  const excel = new ExcelJS.Workbook();
  await excel.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = excel.getWorksheet("Juniors")!;
  for (const [key, value] of Object.entries({ junior_first_name: "Léa", junior_last_name: "Test", junior_birth_date: "2014-02-28" })) {
    sheet.getCell(2, columns.findIndex(c => c.key === key) + 1).value = value;
  }
  const workbook = XLSX.read(await excel.xlsx.writeBuffer(), { type: "buffer", cellDates: true });
  const rows = parseJuniorImportRows(readJuniorImportWorkbook(workbook, "A", definitions), [], definitions);
  assert.deepEqual(rows[0].errors, []);
  assert.deepEqual(rows[0].parents, []);
  const { runJuniorImport, createJuniorImportProgress } = await import("../lib/managerJuniorImport.ts");
  const writes: Record<string, unknown>[] = [];
  const summary = await runJuniorImport(rows, "A", createJuniorImportProgress(), async (_path, body) => { writes.push(body); return { user: { id: "junior" } }; });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].role, "player");
  assert.equal(summary.parents_created_or_updated, 0);
  assert.equal(summary.associations, 0);
});
