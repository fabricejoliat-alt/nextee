"use client";

import type { EvaluationChoice, EvaluationResponseFormat } from "@/lib/evaluationCriteria";

type Props = {
  name: string;
  format: EvaluationResponseFormat;
  choices: EvaluationChoice[];
  value: unknown;
  onChange: (value: string | number | boolean | null) => void;
  disabled?: boolean;
};

export default function EvaluationResponseField({ name, format, choices, value, onChange, disabled }: Props) {
  if (format === "short_text") {
    return (
      <input
        aria-label={name}
        value={typeof value === "string" ? value : ""}
        maxLength={240}
        disabled={disabled}
        placeholder="Votre réponse…"
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }} role="group" aria-label={name}>
      {choices.map((choice) => {
        const selected = String(value) === String(choice.value);
        return (
          <button
            key={String(choice.value)}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : choice.value)}
            style={{
              minHeight: 38,
              padding: "7px 11px",
              borderRadius: 10,
              border: selected ? "1px solid #35483b" : "1px solid rgba(0,0,0,.12)",
              background: selected ? "#35483b" : "#fff",
              color: selected ? "#fff" : "#35483b",
              fontWeight: 800,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {choice.icon ? `${choice.icon} ` : ""}{choice.label}
          </button>
        );
      })}
    </div>
  );
}
