"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Round = {
  id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
  course_name: string | null;
  tee_name: string | null;
  slope_rating: number | null;
  course_rating: number | null;

  total_score: number | null;
  total_putts: number | null;
  gir: number | null;
  fairways_hit: number | null;
  fairways_total: number | null;

  eagles: number | null;
  birdies: number | null;
  pars: number | null;
  bogeys: number | null;
  doubles_plus: number | null;
};

type Hole = {
  id?: string;
  hole_no: number;
  par: number | null;
  stroke_index: number | null;
  score: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
  note: string | null;
};

function getParamString(p: any): string | null {
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function EditRoundPage() {
  const params = useParams();
  const router = useRouter();

  const roundId = useMemo(() => getParamString((params as any)?.roundId), [params]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [round, setRound] = useState<Round | null>(null);
  const [holes, setHoles] = useState<Hole[]>(
    Array.from({ length: 18 }, (_, i) => ({
      hole_no: i + 1,
      par: null,
      stroke_index: null,
      score: null,
      putts: null,
      fairway_hit: null,
      note: null,
    }))
  );

  async function load() {
    if (!roundId) {
      setError("Identifiant de parcours invalide.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const rRes = await supabase
      .from("golf_rounds")
      .select(
        "id,start_at,round_type,competition_name,course_name,tee_name,slope_rating,course_rating,total_score,total_putts,gir,fairways_hit,fairways_total,eagles,birdies,pars,bogeys,doubles_plus"
      )
      .eq("id", roundId)
      .maybeSingle();

    if (rRes.error) {
      setError(rRes.error.message);
      setRound(null);
      setLoading(false);
      return;
    }

    if (!rRes.data) {
      setError("Parcours introuvable.");
      setRound(null);
      setLoading(false);
      return;
    }

    setRound(rRes.data as Round);

    const hRes = await supabase
      .from("golf_round_holes")
      .select("id,hole_no,par,stroke_index,score,putts,fairway_hit,note")
      .eq("round_id", roundId)
      .order("hole_no", { ascending: true });

    if (hRes.error) {
      setError(hRes.error.message);
      setLoading(false);
      return;
    }

    const map = new Map<number, Hole>();
    (hRes.data ?? []).forEach((x: any) => map.set(x.hole_no, x));

    setHoles(
      Array.from({ length: 18 }, (_, i) => {
        const holeNo = i + 1;
        const existing = map.get(holeNo);
        return {
          hole_no: holeNo,
          id: existing?.id,
          par: existing?.par ?? null,
          stroke_index: existing?.stroke_index ?? null,
          score: existing?.score ?? null,
          putts: existing?.putts ?? null,
          fairway_hit: existing?.fairway_hit ?? null,
          note: existing?.note ?? null,
        };
      })
    );

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  function setHole(idx: number, patch: Partial<Hole>) {
    setHoles((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }

  async function saveAll() {
    if (!roundId) return;
    setSaving(true);
    setError(null);

    try {
      // upsert holes
      const payload = holes.map((h) => ({
        id: h.id,
        round_id: roundId,
        hole_no: h.hole_no,
        par: h.par,
        stroke_index: h.stroke_index,
        score: h.score,
        putts: h.putts,
        fairway_hit: h.fairway_hit,
        note: h.note?.trim() || null,
      }));

      const res = await supabase
        .from("golf_round_holes")
        .upsert(payload, { onConflict: "round_id,hole_no" });

      if (res.error) throw new Error(res.error.message);

      // reload to refresh computed stats (trigger)
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRound() {
    if (!roundId) return;
    if (!confirm("Supprimer ce parcours ?")) return;

    const del = await supabase.from("golf_rounds").delete().eq("id", roundId);
    if (del.error) {
      setError(del.error.message);
      return;
    }
    router.push("/player/golf/rounds");
  }

  if (loading) return <div style={{ color: "var(--muted)" }}>Chargement…</div>;

  if (!round) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Parcours</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? "Impossible d’afficher le parcours."}
          </div>
        </div>
        <Link className="btn" href="/player/golf/rounds">Retour</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }} className="truncate">
              {round.round_type === "competition"
                ? `Compétition${round.competition_name ? ` — ${round.competition_name}` : ""}`
                : "Entraînement"}
            </div>
            <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }} className="truncate">
              {fmtDateTime(round.start_at)}
              {round.course_name ? ` • ${round.course_name}` : ""}
              {round.tee_name ? ` • ${round.tee_name}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={saveAll} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button className="btn btn-danger" type="button" onClick={deleteRound}>
              Supprimer
            </button>
            <Link className="btn" href="/player/golf/rounds">Retour</Link>
          </div>
        </div>

        {error && <div style={{ color: "#a00" }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
          <span>Score: {round.total_score ?? "—"}</span>
          <span>Putts: {round.total_putts ?? "—"}</span>
          <span>GIR: {round.gir ?? "—"}</span>
          {typeof round.fairways_hit === "number" && typeof round.fairways_total === "number" && (
            <span>FW: {round.fairways_hit}/{round.fairways_total}</span>
          )}
          <span>🦅 {round.eagles ?? 0} • 🐦 {round.birdies ?? 0} • Par {round.pars ?? 0} • Bogey {round.bogeys ?? 0} • 2+ {round.doubles_plus ?? 0}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Scorecard</div>

        <div style={{ display: "grid", gap: 8 }}>
          {holes.map((h, idx) => (
            <div
              key={h.hole_no}
              style={{
                display: "grid",
                gridTemplateColumns: "52px 70px 70px 70px 90px 1fr",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 900 }}>#{h.hole_no}</div>

              <input
                className="input"
                inputMode="numeric"
                placeholder="Par"
                value={h.par ?? ""}
                onChange={(e) => setHole(idx, { par: e.target.value === "" ? null : Number(e.target.value) })}
              />

              <input
                className="input"
                inputMode="numeric"
                placeholder="Score"
                value={h.score ?? ""}
                onChange={(e) => setHole(idx, { score: e.target.value === "" ? null : Number(e.target.value) })}
              />

              <input
                className="input"
                inputMode="numeric"
                placeholder="Putts"
                value={h.putts ?? ""}
                onChange={(e) => setHole(idx, { putts: e.target.value === "" ? null : Number(e.target.value) })}
              />

              <select
                className="input"
                value={h.fairway_hit === null ? "" : h.fairway_hit ? "yes" : "no"}
                onChange={(e) =>
                  setHole(idx, { fairway_hit: e.target.value === "" ? null : e.target.value === "yes" })
                }
              >
                <option value="">FW —</option>
                <option value="yes">FW Oui</option>
                <option value="no">FW Non</option>
              </select>

              <input
                className="input"
                placeholder="Note (optionnel)"
                value={h.note ?? ""}
                onChange={(e) => setHole(idx, { note: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>
          GIR est calculé automatiquement avec : (score - putts) ≤ (par - 2) quand les champs sont saisis.
        </div>
      </div>
    </div>
  );
}
