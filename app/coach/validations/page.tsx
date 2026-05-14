"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Flag, ShieldCheck, X, Target } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { getValidationBadgeColors, getValidationBadgeLabel, type ValidationExerciseItem, type ValidationSectionItem } from "@/lib/validations";

type CatalogPayload = {
  sections: Array<
    Omit<ValidationSectionItem, "validated_count" | "total_count" | "badge" | "exercises"> & {
      exercises: Array<
        ValidationExerciseItem & {
          challengers: Array<{
            id: string;
            first_name: string | null;
            last_name: string | null;
            avatar_url: string | null;
          }>;
        }
      >;
    }
  >;
};

export default function CoachValidationsPage() {
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<CatalogPayload["sections"]>([]);
  const [selectedExercise, setSelectedExercise] = useState<
    | (ValidationExerciseItem & {
        challengers: Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>;
        sectionName: string;
      })
    | null
  >(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        if (!token) throw new Error("Pas de session.");
        const res = await fetch("/api/coach/validations", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Erreur de chargement.");
        setSections((json.sections ?? []) as CatalogPayload["sections"]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erreur de chargement.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sectionsWithExercises = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        exercises: [...section.exercises].sort((a, b) => a.sequence_no - b.sequence_no),
      })),
    [sections]
  );

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0, color: "white" }}>
              Validations
            </div>
          </div>

          {error ? <div style={{ marginTop: 12, ...messageBox("rgba(185,28,28,0.08)", "rgba(185,28,28,0.22)", "#991b1b") }}>{error}</div> : null}

          {loading ? (
            <div style={{ marginTop: 12 }} className="card">
              Chargement…
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gap: 14 }}>
                {sectionsWithExercises.map((section) => {
                  const badge = getValidationBadgeFromCounts(section.exercises);
                  const colors = getValidationBadgeColors(badge);
                  const badgeLabel = getValidationBadgeLabel(locale, badge);
                  return (
                    <section key={section.id} className="glass-section">
                      <div className="glass-card" style={{ display: "grid", gap: 14 }}>
                        <div className="card-title" style={{ marginBottom: 0, color: "#166534" }}>
                          Les défis {section.name}
                        </div>
                        <div className="bar-row" style={{ marginBottom: 0 }}>
                          {badge !== "none" ? (
                            <span style={softPill()}>
                              <ShieldCheck size={14} />
                              {badgeLabel}
                            </span>
                          ) : null}
                        </div>

                        <div style={{ display: "grid", gap: 12 }}>
                          {section.exercises.map((exercise) => (
                            <div
                              key={exercise.id}
                              style={{
                                border: "1px solid rgba(15,23,42,0.08)",
                                borderRadius: 18,
                                padding: 16,
                                background: "rgba(255,255,255,0.96)",
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      minWidth: 34,
                                      height: 34,
                                      borderRadius: 999,
                                      background: "rgba(15,23,42,0.08)",
                                      fontSize: 13,
                                      fontWeight: 900,
                                      color: "rgba(15,23,42,0.88)",
                                    }}
                                  >
                                    {exercise.sequence_no}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 16, fontWeight: 900, color: "rgba(15,23,42,0.96)" }}>
                                      {exercise.name}
                                    </div>
                                    <div style={{ fontSize: 12, color: "rgba(15,23,42,0.62)", fontWeight: 800 }}>
                                      {exercise.level != null ? `Niveau ${exercise.level}` : ""}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                                {exercise.objective ? <DetailCard icon={<Target size={14} />} label="Objectif" value={exercise.objective} /> : null}
                                {exercise.detailed_description || exercise.short_description ? (
                                  <DetailCard
                                    icon={<ClipboardList size={14} />}
                                    label="Consigne"
                                    value={exercise.detailed_description || exercise.short_description || ""}
                                  />
                                ) : null}
                                {exercise.equipment ? <DetailCard icon={<Flag size={14} />} label="Matériel" value={exercise.equipment} /> : null}
                                {exercise.validation_rule_text ? <DetailCard icon={<ShieldCheck size={14} />} label="Règle" value={exercise.validation_rule_text} /> : null}
                              </div>

                              <button
                                type="button"
                                className="btn"
                                onClick={() =>
                                  setSelectedExercise({
                                    ...exercise,
                                    sectionName: section.name,
                                  })
                                }
                                style={{
                                  width: "fit-content",
                                  background: "white",
                                  color: "rgba(15,23,42,0.78)",
                                  border: "1px solid rgba(15,23,42,0.12)",
                                }}
                              >
                                Challengers
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedExercise ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Challengers"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.58)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 80,
          }}
          onClick={() => setSelectedExercise(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(680px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              borderRadius: 22,
              background: "white",
              boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
              padding: 18,
              display: "grid",
              gap: 14,
            }}
          >
            <style>{`
              [role="dialog"] *::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>
                  Challengers
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(15,23,42,0.64)" }}>
                  {selectedExercise.sectionName} · {selectedExercise.name}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setSelectedExercise(null)}
                style={{
                  width: 40,
                  minHeight: 40,
                  padding: 0,
                  justifyContent: "center",
                  background: "white",
                  border: "1px solid rgba(15,23,42,0.12)",
                  color: "rgba(15,23,42,0.72)",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {selectedExercise.challengers.length === 0 ? (
                <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(15,23,42,0.62)" }}>Aucun joueur bloqué à ce niveau.</div>
              ) : (
                selectedExercise.challengers.map((player) => <PlayerCard key={player.id} player={player} />)
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getValidationBadgeFromCounts(exercises: ValidationExerciseItem[]) {
  const validated = exercises.filter((exercise) => exercise.is_validated).length;
  const total = exercises.length;
  if (total > 0 && validated >= total) return "elite";
  if (validated >= 13) return "gold";
  if (validated >= 10) return "silver";
  if (validated >= 5) return "bronze";
  return "none";
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

function statusPill(background: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.08)",
    fontSize: 12,
    fontWeight: 900,
    background,
  };
}

function DetailCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.94)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(15,23,42,0.56)", fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", color: "#166534" }}>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, fontWeight: 700, color: "rgba(15,23,42,0.88)", whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}

function softPill(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.08)",
    fontSize: 12,
    fontWeight: 800,
    color: "rgba(15,23,42,0.72)",
    background: "rgba(255,255,255,0.9)",
  };
}

function PlayerCard({
  player,
}: {
  player: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
}) {
  const fullName = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || "Joueur";
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: 16,
        padding: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "rgba(255,255,255,0.96)",
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          background: "rgba(15,23,42,0.08)",
        }}
      >
        {player.avatar_url ? (
          <img src={player.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : null}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(15,23,42,0.9)" }}>{fullName}</div>
    </div>
  );
}
