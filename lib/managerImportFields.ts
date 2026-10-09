/** Same role/scope policy for template generation and server-side member creation. */
export type JuniorImportField = {
  id: string; label: string; field_type: string; options_json?: string[] | null;
  is_active?: boolean; scope?: string; is_sensitive?: boolean; is_required?: boolean;
  applies_to_roles?: string[] | null; editable_by?: string; legacy_binding?: string | null;
  description?: string | null; sort_order?: number;
};
export function importFieldApplies(field: JuniorImportField, role: string) {
  return field.is_active !== false && field.scope !== "season" && !field.is_sensitive && field.editable_by !== "none"
    && (field.legacy_binding ? role === "player" : (field.applies_to_roles ?? ["player"]).includes(role));
}
export function juniorImportFields(fields: JuniorImportField[], role: string) {
  return fields.filter(field => importFieldApplies(field, role)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
}
