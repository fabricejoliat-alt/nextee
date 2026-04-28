"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SectionRow = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

type ExerciseRow = {
  id: string;
  section_id: string;
  external_code: string | null;
  sequence_no: number;
  level: number | null;
  name: string;
  objective: string | null;
  short_description: string | null;
  detailed_description: string | null;
  equipment: string | null;
  validation_rule_text: string | null;
  illustration_url: string | null;
  is_active: boolean;
};

type DraftMap = Record<string, ExerciseRow>;

function emptyText(value: string | null | undefined) {
  return value ?? "";
}

export default function ValidationsAdmin() {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session.");
      const res = await fetch("/api/admin/validations", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur de chargement.");

      const nextSections = (json.sections ?? []) as SectionRow[];
      const nextExercises = (json.exercises ?? []) as ExerciseRow[];
      const nextDrafts: DraftMap = {};
      nextExercises.forEach((exercise) => {
        nextDrafts[exercise.id] = { ...exercise };
      });

      setSections(nextSections);
      setExercises(nextExercises);
      setDrafts(nextDrafts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de chargement.");
      setSections([]);
      setExercises([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sectionsWithExercises = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        exercises: exercises
          .filter((exercise) => exercise.section_id === section.id)
          .sort((a, b) => a.sequence_no - b.sequence_no),
      })),
    [sections, exercises]
  );

  function updateDraft(exerciseId: string, patch: Partial<ExerciseRow>) {
    setDrafts((current) => ({
      ...current,
      [exerciseId]: {
        ...current[exerciseId],
        ...patch,
      },
    }));
  }

  async function saveExercise(exerciseId: string) {
    const draft = drafts[exerciseId];
    if (!draft) return;

    setSavingId(exerciseId);
    setError(null);
    setInfo(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Pas de session.");
      const res = await fetch(`/api/admin/validations/exercises/${exerciseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: draft.name,
          level: draft.level,
          objective: draft.objective,
          short_description: draft.short_description,
          detailed_description: draft.detailed_description,
          equipment: draft.equipment,
          validation_rule_text: draft.validation_rule_text,
          illustration_url: draft.illustration_url,
          is_active: draft.is_active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Erreur de sauvegarde.");
      setInfo(`Exercice sauvegardé: ${draft.name}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de sauvegarde.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Validations</h1>
        <p style={{ margin: "8px 0 0", color: "rgba(0,0,0,0.62)", fontWeight: 700 }}>
          Édition des exercices visibles côté Player et Parent.
        </p>
      </div>

      {error ? <div style={messageBox("rgba(185,28,28,0.08)", "rgba(185,28,28,0.22)", "#991b1b")}>{error}</div> : null}
      {info ? <div style={messageBox("rgba(22,163,74,0.08)", "rgba(22,163,74,0.22)", "#166534")}>{info}</div> : null}

      {loading ? (
        <div className="card">Chargement…</div>
      ) : (
        sectionsWithExercises.map((section) => (
          <div key={section.id} className="card" style={{ display: "grid", gap: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{section.name}</h2>
              <div style={{ marginTop: 4, color: "var(--muted)", fontWeight: 700 }}>{section.exercises.length} exercices</div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {section.exercises.map((exercise) => {
                const draft = drafts[exercise.id] ?? exercise;
                return (
                  <div
                    key={exercise.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 16,
                      padding: 14,
                      display: "grid",
                      gap: 12,
                      background: "rgba(255,255,255,0.72)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          style={{
                            minWidth: 34,
                            height: 34,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 999,
                            background: "rgba(0,0,0,0.06)",
                            fontWeight: 900,
                          }}
                        >
                          {exercise.sequence_no}
                        </span>
                        <div style={{ fontWeight: 900 }}>{exercise.external_code ? `ID ${exercise.external_code}` : "Sans ID"}</div>
                      </div>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(draft.is_active)}
                          onChange={(event) => updateDraft(exercise.id, { is_active: event.target.checked })}
                        />
                        Actif
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) 120px 180px" }}>
                      <label style={fieldWrapStyle}>
                        <span style={fieldLabelStyle}>Nom</span>
                        <input value={draft.name} onChange={(event) => updateDraft(exercise.id, { name: event.target.value })} style={inputStyle} />
                      </label>
                      <label style={fieldWrapStyle}>
                        <span style={fieldLabelStyle}>Niveau</span>
                        <input
                          value={draft.level ?? ""}
                          onChange={(event) =>
                            updateDraft(exercise.id, {
                              level: event.target.value.trim() ? Number(event.target.value) : null,
                            })
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label style={fieldWrapStyle}>
                        <span style={fieldLabelStyle}>Illustration URL</span>
                        <input
                          value={emptyText(draft.illustration_url)}
                          onChange={(event) => updateDraft(exercise.id, { illustration_url: event.target.value })}
                          style={inputStyle}
                          placeholder="https://..."
                        />
                      </label>
                    </div>

                    <label style={fieldWrapStyle}>
                      <span style={fieldLabelStyle}>Objectif</span>
                      <input
                        value={emptyText(draft.objective)}
                        onChange={(event) => updateDraft(exercise.id, { objective: event.target.value })}
                        style={inputStyle}
                      />
                    </label>

                    <label style={fieldWrapStyle}>
                      <span style={fieldLabelStyle}>Description courte</span>
                      <input
                        value={emptyText(draft.short_description)}
                        onChange={(event) => updateDraft(exercise.id, { short_description: event.target.value })}
                        style={inputStyle}
                      />
                    </label>

                    <label style={fieldWrapStyle}>
                      <span style={fieldLabelStyle}>Description détaillée</span>
                      <textarea
                        value={emptyText(draft.detailed_description)}
                        onChange={(event) => updateDraft(exercise.id, { detailed_description: event.target.value })}
                        rows={4}
                        style={textAreaStyle}
                      />
                    </label>

                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                      <label style={fieldWrapStyle}>
                        <span style={fieldLabelStyle}>Matériel</span>
                        <input
                          value={emptyText(draft.equipment)}
                          onChange={(event) => updateDraft(exercise.id, { equipment: event.target.value })}
                          style={inputStyle}
                        />
                      </label>
                      <label style={fieldWrapStyle}>
                        <span style={fieldLabelStyle}>Règle de validation</span>
                        <input
                          value={emptyText(draft.validation_rule_text)}
                          onChange={(event) => updateDraft(exercise.id, { validation_rule_text: event.target.value })}
                          style={inputStyle}
                        />
                      </label>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button className="btn" onClick={() => saveExercise(exercise.id)} disabled={savingId === exercise.id}>
                        {savingId === exercise.id ? "Sauvegarde…" : "Sauvegarder"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function messageBox(background: string, border: string, color: string): CSSProperties {
  return {
    border: `1px solid ${border}`,
    background,
    color,
    borderRadius: 14,
    padding: 12,
    fontWeight: 800,
  };
}

const fieldWrapStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.62)",
};

const inputStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "white",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: 92,
  font: "inherit",
};
