"use client";

import type { MemberFieldValue } from "@/lib/memberFieldValues";

export default function ProfileCustomFieldControl({ field, name, disabled = false, yes, no, onChange }: {
  field: { field_type: string; label: string; options_json: string[]; value: MemberFieldValue };
  name: string; disabled?: boolean; yes: string; no: string; onChange: (value: MemberFieldValue) => void;
}) {
  const { value, field_type: type } = field;
  if (type === "checkbox" || type === "radio") {
    const selected = Array.isArray(value) ? value : [];
    return <div role="group" aria-label={field.label}>{field.options_json.map((option) => <label key={option} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type={type} name={name} disabled={disabled} checked={type === "checkbox" ? selected.includes(option) : value === option}
        onChange={(event) => onChange(type === "checkbox" ? event.target.checked ? [...selected, option] : selected.filter((v) => v !== option) : option)} />{option}
    </label>)}</div>;
  }
  if (type === "boolean") return <select aria-label={field.label} disabled={disabled} value={value == null ? "" : value ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "yes")}><option value="">—</option><option value="yes">{yes}</option><option value="no">{no}</option></select>;
  if (type === "select") return <select aria-label={field.label} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)}><option value="">—</option>{field.options_json.map((option) => <option key={option}>{option}</option>)}</select>;
  if (type === "long_text") return <textarea aria-label={field.label} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} />;
  return <input aria-label={field.label} type={type === "number" || type === "date" ? type : "text"} step={type === "number" ? "any" : undefined} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)} />;
}
