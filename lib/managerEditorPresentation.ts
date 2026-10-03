import { managerFormat, type ManagerTranslate } from "./managerLocale.ts";
import { coachEventSaveErrorKey } from "./coachEventEditor.ts";
export const managerEditorFormat = (t: ManagerTranslate, key: string, values: Record<string, string | number>) => managerFormat(t, `manager.editor.${key}`, values);
export function managerEditorSaveError(cause: unknown) {
  const message = cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "";
  if (/^(manager|coach|common)\./.test(message)) return message;
  if (message === "series_limit") return "manager.editor.seriesLimit";
  if (message === "empty_series") return "coach.error.planningNoOccurrence";
  if (message === "invalid_criteria") return "manager.editor.invalidCriteria";
  return coachEventSaveErrorKey(cause);
}
