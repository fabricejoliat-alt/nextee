"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type SessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  created_at: string;
};

type ClubRow = { id: string; name: string | null };

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

function typeLabel(t: SessionRow["session_type"]) {
  if (t === "club") return "Club";
  if (t === "private") return "Privé";
  return "Individuel";
}

function uuidOrNull(v: any) {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

export default function TrainingsListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});

  const totalThisPage = useMemo(() => {
    return sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
  }, [sessions]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Session invalide.");

      // 1) sessions
      const sRes = await supabase
        .from("training_sessions")
        .select(
          "id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at"
        )
        .order("start_at", { ascending: false });

      if (sRes.error) throw new Error(sRes.error.message);

      const list = (sRes.data ?? []) as SessionRow[];
      setSessions(list);

      // 2) clubs names (si besoin)
      const clubIds = Array.from(
        new Set(
          list
            .map((s) => uuidOrNull(s.club_id))
            .filter((x): x is string => typeof x === "string" && x.length > 0)
        )
      );

      if (clubIds.length === 0) {
        setClubNameById({});
        setLoading(false);
        return;
      }

      const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
      if (cRes.error) {
        setClubNameById({});
        setLoading(false);
        return;
      }

      const map: Record<string, string> = {};
      (cRes.data ?? []).forEach((c: ClubRow) => {
        map[c.id] = (c.name ?? "Club") as string;
      });
      setClubNameById(map);

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setSessions([]);
      setClubNameById({});
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Mes entraînements</div>
            <div style={{ color: "var(--muted)", fontWeight: 800, fontSize: 13 }}>
              {loading ? "…" : `${sessions.length} séance(s) • ${totalThisPage} min`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/player/trainings/new">
              Ajouter
            </Link>
            <Link className="btn" href="/player/golf">
              Mon Golf
            </Link>
          </div>
        </div>

        {error && <div style={{ color: "#a00" }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Chargement…</div>
        ) : sessions.length === 0 ? (
          <div style={{ color: "var(--muted)", fontWeight: 700 }}>
            Aucun entraînement pour le moment.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sessions.map((s) => {
              const clubName =
                s.session_type === "club" && s.club_id
                  ? clubNameById[s.club_id] ?? "Club"
                  : null;

              return (
                <Link
                  key={s.id}
                  href={`/player/trainings/${s.id}`}
                  className="latest-item"
                  style={{ textDecoration: "none" }}
                >
                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900, minWidth: 0 }} className="truncate">
                        {fmtDateTime(s.start_at)}
                      </div>
                      <div style={{ fontWeight: 900 }}>
                        {(s.total_minutes ?? 0) > 0 ? `${s.total_minutes} min` : "—"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="pill">{typeLabel(s.session_type)}</span>
                      {clubName && <span className="pill">{clubName}</span>}
                      {s.location_text && (
                        <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }} className="truncate">
                          📍 {s.location_text}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      <Link className="btn" href={`/player/trainings/${s.id}`}>
                        Voir
                      </Link>
                      <Link className="btn" href={`/player/trainings/${s.id}/edit`}>
                        Modifier
                      </Link>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
