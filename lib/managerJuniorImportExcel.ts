import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { createJuniorImportWorkbook, juniorImportColumns } from "./managerJuniorImportWorkbook.ts";
import type { JuniorImportField } from "./managerImportFields.ts";

type Translate = (key: string) => string;

/** Native Excel validations are exported with ExcelJS; SheetJS remains the import reader. */
export async function createJuniorImportExcel(clubId: string, fields: JuniorImportField[], t: Translate) {
  const source = createJuniorImportWorkbook(clubId, fields, t);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ActiviTee";
  for (const name of source.SheetNames) {
    const worksheet = workbook.addWorksheet(name, { state: name === "_activitee" ? "veryHidden" : "visible" });
    worksheet.addRows(XLSX.utils.sheet_to_json(source.Sheets[name], { header: 1, raw: true }));
    worksheet.columns.forEach((column, index) => {
      column.width = source.Sheets[name]["!cols"]?.[index]?.wch ?? 25;
    });
  }
  const sheet = workbook.getWorksheet("Juniors")!;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.getRow(1).height = 52;
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF35483B" } };
    cell.font = { name: "Calibri", size: 11, color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  const lists = workbook.addWorksheet("_choices", { state: "veryHidden" });
  let listColumn = 0;
  const columns = juniorImportColumns(fields, t);
  for (const [index, definition] of columns.entries()) {
    const column = sheet.getColumn(index + 1);
    const boolean = definition.key.endsWith("is_primary") || definition.field?.field_type === "boolean";
    const relation = definition.key.endsWith("_relation");
    const date = definition.key.endsWith("birth_date") || definition.field?.field_type === "date";
    column.numFmt = date ? "yyyy-mm-dd" : definition.field?.field_type === "number" ? "0.############" : "@";
    // Reapply header style after setting the column style.
    column.alignment = { vertical: "top", wrapText: true };
    const options = boolean ? [t("manager.junior.import.yes"), t("manager.junior.import.no")]
      : relation ? ["mother", "father", "legal_guardian", "other"].map(key => t(`manager.junior.relation.${key}`))
      : ["select", "radio"].includes(definition.field?.field_type ?? "") ? definition.field?.options_json ?? [] : [];
    if (!options.length) continue;
    listColumn++;
    options.forEach((option, row) => { lists.getCell(row + 1, listColumn).value = option; });
    const letter = lists.getColumn(listColumn).letter;
    const name = `ActiviTeeChoices${listColumn}`;
    workbook.definedNames.add(`'_choices'!$${letter}$1:$${letter}$${options.length}`, name);
    const prompt = definition.key.endsWith("is_primary") ? t("manager.junior.import.primaryHint") : boolean ? t("manager.junior.import.booleanHint") : t("manager.junior.import.choiceHint");
    for (let row = 2; row <= 2001; row++) {
      sheet.getCell(row, index + 1).dataValidation = {
        type: "list", allowBlank: true, formulae: [name], showInputMessage: true,
        promptTitle: t("manager.junior.import.expected"), prompt,
        showErrorMessage: true, errorStyle: "stop", errorTitle: t("manager.junior.import.check"),
        error: t("manager.junior.import.chooseValidOption"),
      };
    }
  }
  const instructions = workbook.getWorksheet("Instructions")!;
  instructions.eachRow(row => {
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Calibri", size: 11, color: { argb: "FF35483B" } };
    if (row.number <= 4) { instructions.mergeCells(row.number, 1, row.number, 3); row.height = Math.max(32, Math.ceil(String(row.getCell(1).value ?? "").length / 160) * 16 + 12); }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export async function downloadJuniorImportExcel(clubId: string, fields: JuniorImportField[], t: Translate, fileName: string) {
  const bytes = await createJuniorImportExcel(clubId, fields, t);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
