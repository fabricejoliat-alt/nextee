/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { EvaluationCriterion } from "@/lib/evaluationCriteria";

type Props = { clubId: string; eventType: string; selectedIds: string[]; onChange: (ids: string[]) => void; disabled?: boolean };

export default function EventCriteriaSelector({ clubId, eventType, selectedIds, onChange, disabled }: Props) {
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    if (!clubId) return;
    void supabase.from("club_evaluation_criteria").select("*").eq("club_id", clubId).eq("is_active", true).is("archived_at", null).contains("activity_types", [eventType]).order("sort_order").then(({ data, error: queryError }) => {
      if (!alive) return;
      setError(queryError?.message ?? ""); setCriteria((data ?? []) as EvaluationCriterion[]);
    });
    return () => { alive = false; };
  }, [clubId, eventType]);
  const coach = useMemo(() => criteria.filter((item) => item.respondent === "coach" || item.respondent === "both"), [criteria]);
  const player = useMemo(() => criteria.filter((item) => item.respondent === "player" || item.respondent === "both"), [criteria]);
  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((value) => value !== id));
    else if (selectedIds.length < 3) onChange([...selectedIds, id]);
  }
  const list = (rows: EvaluationCriterion[]) => rows.length ? <div style={{ display: "grid", gap: 7 }}>{rows.map((item) => <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 9, border: "1px solid rgba(0,0,0,.1)", borderRadius: 10, opacity: !selectedIds.includes(item.id) && selectedIds.length >= 3 ? .55 : 1 }}><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={disabled || (!selectedIds.includes(item.id) && selectedIds.length >= 3)} onChange={() => toggle(item.id)}/><span style={{ display: "grid", gap: 2 }}><b style={{ fontSize: 12 }}>{item.name}{item.is_required ? " *" : ""}</b><small style={{ opacity: .65 }}>{item.domain_label}{item.description ? ` · ${item.description}` : ""}</small></span></label>)}</div> : <small style={{ opacity: .65 }}>Aucun critère personnalisé correspondant.</small>;
  return <div style={{ display: "grid", gap: 12, padding: 14, border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, background: "rgba(255,255,255,.7)" }}>
    <div><b style={{ fontSize: 13 }}>Focus de l’activité ({selectedIds.length}/3)</b><p style={{ margin: "4px 0 0", fontSize: 11, opacity: .65 }}>Choisissez jusqu’à trois priorités personnalisées, en plus des six critères standards.</p></div>
    {error ? <small style={{ color: "#ad3d35" }}>{error}</small> : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}><div><b style={{ fontSize: 11 }}>COACH</b><p style={{ fontSize: 10, opacity: .65 }}>Standards : Engagement · Attitude · Application</p>{list(coach)}</div><div><b style={{ fontSize: 11 }}>AUTO-ÉVALUATION JOUEUR</b><p style={{ fontSize: 10, opacity: .65 }}>Standards : Motivation · Difficulté · Satisfaction</p>{list(player)}</div></div>
  </div>;
}

export async function replaceEventCriteria(eventIds: string[], criterionIds: string[]) {
  if (!eventIds.length) return;
  for (const eventId of eventIds) {
    const current = await supabase.from("club_event_evaluation_criteria").select("id,criterion_id").eq("event_id", eventId);
    if (current.error) throw new Error(current.error.message);
    const allIds = (current.data ?? []).map((row: any) => row.id);
    if (allIds.length) {
      const disabled = await supabase.from("club_event_evaluation_criteria").update({ is_enabled: false }).in("id", allIds);
      if (disabled.error) throw new Error(disabled.error.message);
    }
    for (const [index, criterionId] of criterionIds.entries()) {
      const existing = (current.data ?? []).find((row: any) => String(row.criterion_id) === criterionId);
      if (existing) {
        const updated = await supabase.from("club_event_evaluation_criteria").update({ is_enabled: true, position: index + 1 }).eq("id", existing.id);
        if (updated.error) throw new Error(updated.error.message);
      } else {
        const inserted = await supabase.from("club_event_evaluation_criteria").insert({ event_id: eventId, criterion_id: criterionId, position: index + 1 });
        if (inserted.error) throw new Error(inserted.error.message);
      }
    }
  }
}
