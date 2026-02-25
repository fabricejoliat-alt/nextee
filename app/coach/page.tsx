"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type Group = { id: string; name: string };
type TrainingLite = {
  id: string;
  start_at: string;
  location_text: string | null;
  status: "planned" | "done" | "cancelled";
  group_id: string;
};

function fmtDateTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function CoachHomePage() {
  const { t, locale } = useI18n();
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";
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
          <div className="section-title">{t("coachHome.title")}</div>

          <div className="grid-2" style={{ marginTop: 12 }}>
            {/* Mes groupes */}
            <div className="glass-card">
              <div className="card-title">{t("coach.myGroups")}</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
              ) : groups.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("coachHome.noAssignedGroup")}</div>
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
                        {t("coachHome.viewGroup")}
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              <Link href="/coach/groups" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                {t("coachHome.viewAllGroups")}
              </Link>
            </div>

            {/* 7 prochains jours */}
            <div className="glass-card">
              <div className="card-title">{t("coachHome.next7Days")}</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
              ) : trainings.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("trainings.nonePlanned")}</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {trainings.slice(0, 8).map((training) => (
                    <Link
                      key={training.id}
                      href={`/coach/trainings/${training.id}`}
                      className="glass-card"
                      style={{ padding: 14 }}
                    >
                      <div style={{ fontWeight: 950 }}>
                        {groupNameById[training.group_id] ?? t("coachHome.groupFallback")}
                      </div>
                      <div style={{ opacity: 0.8, fontWeight: 800, marginTop: 4 }}>
                        {fmtDateTime(training.start_at, dateLocale)}
                      </div>
                      {training.location_text ? (
                        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                          {training.location_text}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              )}

              <Link href="/coach/calendar" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                {t("coachHome.openCalendar")}
              </Link>
            </div>
          </div>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
