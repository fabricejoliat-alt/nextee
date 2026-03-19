"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type PlayerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type PlayerStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};

type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
  "short_game_all",
  "putting",
  "wedging",
  "pitching",
  "chipping",
  "bunker",
  "course",
  "mental",
  "fitness",
  "other",
] as const;

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => (i + 1) * 5);

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

export default function CoachPlayerStructurePage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const { t } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [items, setItems] = useState<TrainingItemDraft[]>([]);

  const categories = useMemo(
    () =>
      TRAINING_CATEGORY_VALUES.map((value) => ({
        value,
        label: t(`cat.${value}`),
      })),
    [t]
  );

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);

  const canSave = useMemo(() => {
    if (busy || loading) return false;
    for (const it of items) {
      if (!it.category) return false;
      const v = Number(it.minutes);
      if (!Number.isFinite(v) || v <= 0 || v > 300 || v % 5 !== 0) return false;
    }
    return true;
  }, [busy, loading, items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!eventId || !playerId || !groupId) throw new Error("Paramètres manquants.");

        const eRes = await supabase
          .from("club_events")
          .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,status")
          .eq("id", eventId)
          .eq("group_id", groupId)
          .maybeSingle();
        if (eRes.error) throw new Error(eRes.error.message);
        if (!eRes.data) throw new Error("Événement introuvable.");
        const ev = eRes.data as EventRow;
        if (ev.event_type !== "training" && ev.event_type !== "camp") {
          throw new Error("La structure individuelle n'est disponible que pour les entraînements et stages/camps.");
        }
        setEvent(ev);

        const pRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name")
          .eq("id", playerId)
          .maybeSingle();
        if (pRes.error) throw new Error(pRes.error.message);
        if (!pRes.data) throw new Error("Joueur introuvable.");
        setPlayer(pRes.data as PlayerRow);

        const personalizedRes = await supabase
          .from("club_event_player_structure_items")
          .select("category,minutes,note,position")
          .eq("event_id", eventId)
          .eq("player_id", playerId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });
        if (personalizedRes.error) throw new Error(personalizedRes.error.message);
        const personalized = (personalizedRes.data ?? []) as PlayerStructureItemRow[];
        if (personalized.length > 0) {
          setItems(
            personalized.map((r) => ({
              category: r.category ?? "",
              minutes: String(r.minutes ?? ""),
              note: r.note ?? "",
            }))
          );
          setLoading(false);
          return;
        }

        const structRes = await supabase
          .from("club_event_structure_items")
          .select("category,minutes,note,position")
          .eq("event_id", eventId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });
        if (structRes.error) throw new Error(structRes.error.message);
        const base = (structRes.data ?? []) as Array<{ category: string; minutes: number; note: string | null }>;
        setItems(
          base.map((r) => ({
            category: r.category ?? "",
            minutes: String(r.minutes ?? ""),
            note: r.note ?? "",
          }))
        );

        setLoading(false);
      } catch (e: unknown) {
        setLoading(false);
        setEvent(null);
        setPlayer(null);
        setItems([]);
        setError(e instanceof Error ? e.message : "Erreur chargement.");
      }
    })();
  }, [eventId, playerId, groupId]);

  function addLine() {
    setItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<TrainingItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || !event) return;
    setBusy(true);
    setError(null);

    const delItems = await supabase
      .from("club_event_player_structure_items")
      .delete()
      .eq("event_id", event.id)
      .eq("player_id", playerId);
    if (delItems.error) {
      setError(delItems.error.message);
      setBusy(false);
      return;
    }

    if (items.length > 0) {
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData.user?.id ?? null;
      const payload = items.map((it, idx) => ({
        event_id: event.id,
        player_id: playerId,
        category: it.category,
        minutes: Number(it.minutes),
        note: it.note.trim() || null,
        position: idx,
        created_by: currentUserId,
      }));
      const insItems = await supabase.from("club_event_player_structure_items").insert(payload);
      if (insItems.error) {
        setError(insItems.error.message);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    router.push(`/coach/groups/${groupId}/planning/${eventId}`);
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Structure planifiée individuelle</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.65)" }}>
                {player ? nameOf(player.first_name, player.last_name) : "Joueur"} • {event ? fmtDateTime(event.starts_at) : ""}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                {t("common.back")}
              </Link>
            </div>
          </div>
          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        <div className="glass-section">
          {loading ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
          ) : (
            <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
              <div className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Structure planifiée pour ce joueur</div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      height: 42,
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.10)",
                      background: "rgba(255,255,255,0.65)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 12px",
                      fontWeight: 950,
                      color: "rgba(0,0,0,0.78)",
                    }}
                  >
                    <span>{totalMinutes}</span>
                    <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>min</span>
                  </div>
                </div>

                {items.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucune ligne.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {items.map((it, idx) => (
                      <div
                        key={`line-${idx}`}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.65)",
                          padding: 12,
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Poste</span>
                            <select value={it.category} onChange={(e) => updateLine(idx, { category: e.target.value })}>
                              <option value="">-</option>
                              {categories.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Durée</span>
                            <select value={it.minutes} onChange={(e) => updateLine(idx, { minutes: e.target.value })}>
                              <option value="">-</option>
                              {MINUTE_OPTIONS.map((m) => (
                                <option key={m} value={String(m)}>
                                  {m} min
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>Note</span>
                          <input
                            value={it.note}
                            onChange={(e) => updateLine(idx, { note: e.target.value })}
                            placeholder="Optionnel"
                          />
                        </label>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div className="pill-soft">Poste {idx + 1}</div>
                          <button type="button" className="btn btn-danger soft" onClick={() => removeLine(idx)}>
                            {t("common.delete")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn" onClick={addLine}>
                    + Ajouter un poste
                  </button>
                </div>
              </div>

              <div className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                    {t("common.cancel")}
                  </Link>
                  <button type="submit" className="cta-green cta-green-inline" disabled={!canSave}>
                    {busy ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
