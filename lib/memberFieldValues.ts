export type MemberFieldValue = string | boolean | string[] | null;
type Definition = { field_type: string; options_json?: string[] | null; label?: string };
type StoredValue = { value_text: string | null; value_bool: boolean | null; value_option: string | null };

/** Validate before any member/profile write. False and zero are meaningful values. */
export function encodeMemberFieldValue(field: Definition, raw: unknown): StoredValue | null {
  if (raw == null || (typeof raw === "string" && !raw.trim()) || (Array.isArray(raw) && !raw.length)) return null;
  const stored: StoredValue = { value_text: null, value_bool: null, value_option: null };
  const invalid = () => { throw new Error(`Valeur invalide pour ${field.label ?? "ce champ"}`); };
  const options = field.options_json ?? [];
  const validOption = (value: string) => !options.length || options.includes(value);
  switch (field.field_type) {
    case "boolean":
      if (typeof raw !== "boolean") invalid();
      stored.value_bool = raw as boolean;
      break;
    case "checkbox":
      if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string" && validOption(v))) invalid();
      stored.value_text = JSON.stringify([...new Set(raw as string[])]);
      break;
    case "select":
    case "radio":
      if (typeof raw !== "string" || !validOption(raw.trim())) invalid();
      stored.value_option = (raw as string).trim();
      break;
    case "text":
    case "short_text":
    case "long_text":
    case "number":
    case "date": {
      if (typeof raw !== "string" && !(field.field_type === "number" && typeof raw === "number")) invalid();
      const value = String(raw).trim();
      if (field.field_type === "number" && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) invalid();
      if (field.field_type === "number" && !Number.isFinite(Number(value))) invalid();
      if (field.field_type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid();
      stored.value_text = value;
      break;
    }
    default: invalid();
  }
  return stored;
}

export function decodeMemberFieldValue(field: Definition | undefined, stored: { value_text?: unknown; value_bool?: unknown; value_option?: unknown }): MemberFieldValue {
  if (field?.field_type === "checkbox") {
    const raw = stored.value_text == null ? null : String(stored.value_text);
    if (!raw) return [];
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
    } catch { /* Older clients stored comma-separated selections. */ }
    const options = field.options_json ?? [];
    if (options.includes(raw)) return [raw];
    const legacy = raw.split(",");
    return legacy.every((v) => options.includes(v)) ? legacy : [raw];
  }
  return stored.value_option != null ? String(stored.value_option)
    : typeof stored.value_bool === "boolean" ? stored.value_bool
    : stored.value_text == null ? null : String(stored.value_text);
}
