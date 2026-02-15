"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Round = {
  id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
  course_name: string | null;
  location: string | null;
  total_score: number | null;
  total_putts: number | null;
  gir: number | null;
  fairways_hit: number | null;
  fairways_total: number | null;
};

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

export default function RoundsListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    const res = await supabase
      .from("golf_rounds")
      .select("id,start_at,round_type,competition_name,course_name,location,total_score,total_putts,gir,fairways_hit,fairways_total")
      .order("start_at", { ascending: false });

    if (res.error) {
      setError(res.error.message);
      setRounds([]);
      setLoading(false);
      return;
    }

    setRounds((res.data ?? []) as Round[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Mes parcours</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            Entraînements & compétitions
          </div>
        </div>

        <Link className="btn" href="/player/golf/rounds/new">
          Ajouter un parcours
        </Link>
      </div>

      {error && <div style={{ color: "#a00" }}>{error}</div>}

      <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Chargement…</div>
        ) : rounds.length === 0 ? (
          <div style={{ color: "var(--muted)", fontWeight: 700 }}>Aucun parcours enregistré.</div>
        ) : (
          rounds.map((r) => (
            <Link
              key={r.id}
              href={`/player/golf/rounds/${r.id}`}
              className="latest-item"
              style={{ textDecoration: "none" }}
            >
              <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900, minWidth: 0 }} className="truncate">
                    {r.round_type === "competition"
                      ? `Compétition${r.competition_name ? ` — ${r.competition_name}` : ""}`
                      : "Entraînement"}
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {r.total_score == null ? "—" : `${r.total_score}`}
                  </div>
                </div>

                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }} className="truncate">
                  {fmtDateTime(r.start_at)}
                  {r.course_name ? ` • ${r.course_name}` : ""}
                  {r.location ? ` • ${r.location}` : ""}
                </div>

                <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>
                  Putts: {r.total_putts ?? "—"} • GIR: {r.gir ?? "—"}
                  {typeof r.fairways_hit === "number" && typeof r.fairways_total === "number"
                    ? ` • FW: ${r.fairways_hit}/${r.fairways_total}`
                    : ""}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
