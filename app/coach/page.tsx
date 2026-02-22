"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle } from "lucide-react";

type Group = { id: string; name: string };
type TrainingLite = {
  id: string;
  start_at: string;
  location_text: string | null;
  status: "planned" | "done" | "cancelled";
  group_id: string;
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function CoachHomePage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [trainings, setTrainings] = useState<TrainingLite[]>([]);

  const range = useMemo(() => {
    const now = new Date();
    const d7 = new Date(now);
    d7.setDate(d7.getDate() + 7);
    return { from: now.toISOString(), to: d7.toISOString() };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }

      // Groupes du coach
      const { data: gRows } = await supabase
        .from("coach_group_coaches")
        .select("coach_groups(id,name)")
        .eq("coach_user_id", uid);

      const gList: Group[] =
        (gRows ?? [])
          .map((r: any) => r.coach_groups)
          .filter(Boolean)
          .map((g: any) => ({ id: g.id, name: g.name })) ?? [];

      setGroups(gList);

      // Trainings 7 jours (uniquement les groupes du coach)
      const groupIds = gList.map((g) => g.id);
      if (groupIds.length > 0) {
        const { data: tRows } = await supabase
          .from("club_trainings")
          .select("id,start_at,location_text,status,group_id")
          .in("group_id", groupIds)
          .gte("start_at", range.from)
          .lte("start_at", range.to)
          .order("start_at", { ascending: true });

        setTrainings((tRows ?? []) as TrainingLite[]);
      } else {
        setTrainings([]);
      }

      setLoading(false);
    })();
  }, [range.from, range.to]);

  const groupNameById = useMemo(() => {
    const m: Record<string, string> = {};
    groups.forEach((g) => (m[g.id] = g.name));
    return m;
  }, [groups]);

  return (
    <div className="player-dashboard-bg">
      {/* ✅ EXACTEMENT comme ta page Player : un container centré interne */}
      <div className="app-shell">
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">Coach</div>

          <div className="grid-2" style={{ marginTop: 12 }}>
            {/* Mes groupes */}
            <div className="glass-card">
              <div className="card-title">Mes groupes</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>Chargement…</div>
              ) : groups.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>Aucun groupe assigné.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {groups.slice(0, 6).map((g) => (
                    <Link
                      key={g.id}
                      href={`/coach/groups/${g.id}`}
                      className="glass-card"
                      style={{ padding: 14 }}
                    >
                      <div style={{ fontWeight: 950 }}>{g.name}</div>
                      <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                        Voir le groupe
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              <Link href="/coach/groups" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                Voir tous les groupes
              </Link>
            </div>

            {/* 7 prochains jours */}
            <div className="glass-card">
              <div className="card-title">7 prochains jours</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>Chargement…</div>
              ) : trainings.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>Aucun entraînement planifié.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {trainings.slice(0, 8).map((t) => (
                    <Link
                      key={t.id}
                      href={`/coach/trainings/${t.id}`}
                      className="glass-card"
                      style={{ padding: 14 }}
                    >
                      <div style={{ fontWeight: 950 }}>
                        {groupNameById[t.group_id] ?? "Groupe"}
                      </div>
                      <div style={{ opacity: 0.8, fontWeight: 800, marginTop: 4 }}>
                        {fmtDateTime(t.start_at)}
                      </div>
                      {t.location_text ? (
                        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                          {t.location_text}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              )}

              <Link href="/coach/calendar" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                Ouvrir le calendrier
              </Link>
            </div>
          </div>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}