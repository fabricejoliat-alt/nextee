"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle, Search } from "lucide-react";

type ClubLite = { id: string; name: string | null };

type CoachGroup = {
  id: string;
  created_at: string;
  club_id: string;
  name: string;
  is_active: boolean;
  head_coach_user_id: string | null;
  clubs?: ClubLite | null; // join
};

type CoachGroupCoachRow = {
  group_id: string;
  is_head: boolean;
  coach_groups?: CoachGroup | null;
};

type GroupCategoryRow = { group_id: string; category: string };
type GroupPlayerRow = { group_id: string; player_user_id: string };

function toneForCategory(cat: string) {
  const c = (cat ?? "").toLowerCase();
  if (c.startsWith("u") || c.includes("jun")) return "blue";
  if (c.includes("elite")) return "green";
  if (c.includes("ama") || c.includes("adult")) return "orange";
  return "neutral";
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "green" | "blue" | "orange";
}) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: 12,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.55)",
    color: "rgba(0,0,0,0.72)",
    whiteSpace: "nowrap",
  };

  if (tone === "green") {
    style.background = "rgba(167, 243, 208, 0.45)";
    style.border = "1px solid rgba(16,185,129,0.25)";
    style.color = "rgba(6, 95, 70, 0.95)";
  } else if (tone === "blue") {
    style.background = "rgba(186, 230, 253, 0.45)";
    style.border = "1px solid rgba(14,165,233,0.25)";
    style.color = "rgba(3, 105, 161, 0.95)";
  } else if (tone === "orange") {
    style.background = "rgba(254, 215, 170, 0.45)";
    style.border = "1px solid rgba(249,115,22,0.25)";
    style.color = "rgba(154, 52, 18, 0.95)";
  }

  return <span style={style}>{label}</span>;
}

export default function CoachGroupsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoachGroupCoachRow[]>([]);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<string>("");

  async function load() {
    setLoading(true);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const uid = auth?.user?.id;

    if (authErr || !uid) {
      setRows([]);
      setCategories({});
      setPlayerCounts({});
      setLoading(false);
      return;
    }

    // 1) Groupes assignés au coach + join club name via coach_groups -> clubs
    const { data: coachGroups, error: cgErr } = await supabase
      .from("coach_group_coaches")
      .select(
        `
        group_id,
        is_head,
        coach_groups (
          id,
          created_at,
          club_id,
          name,
          is_active,
          head_coach_user_id,
          clubs:clubs ( id, name )
        )
      `
      )
      .eq("coach_user_id", uid)
      .order("created_at", { ascending: false });

    if (cgErr) {
      console.error(cgErr);
      setRows([]);
      setCategories({});
      setPlayerCounts({});
      setLoading(false);
      return;
    }

    // ✅ Fix typage TS (reconstruit proprement)
    const safeRows: CoachGroupCoachRow[] = (coachGroups ?? [])
      .filter((r: any) => r.coach_groups)
      .map((r: any) => ({
        group_id: r.group_id,
        is_head: !!r.is_head,
        coach_groups: {
          ...r.coach_groups,
          clubs: r.coach_groups?.clubs ?? null,
        },
      }));

    setRows(safeRows);

    const groupIds = safeRows.map((r) => r.group_id);
    if (groupIds.length === 0) {
      setCategories({});
      setPlayerCounts({});
      setLoading(false);
      return;
    }

    // 2) Catégories
    const { data: cats, error: catErr } = await supabase
      .from("coach_group_categories")
      .select("group_id,category")
      .in("group_id", groupIds);

    if (!catErr) {
      const byGroup: Record<string, string[]> = {};
      (cats as GroupCategoryRow[] | null)?.forEach((c) => {
        if (!byGroup[c.group_id]) byGroup[c.group_id] = [];
        byGroup[c.group_id].push(c.category);
      });
      Object.keys(byGroup).forEach((gid) => {
        byGroup[gid] = Array.from(new Set(byGroup[gid])).sort((a, b) =>
          a.localeCompare(b, "fr")
        );
      });
      setCategories(byGroup);
    } else {
      console.error(catErr);
      setCategories({});
    }

    // 3) Compter joueurs / groupe
    const { data: players, error: pErr } = await supabase
      .from("coach_group_players")
      .select("group_id,player_user_id")
      .in("group_id", groupIds);

    if (!pErr) {
      const counts: Record<string, number> = {};
      (players as GroupPlayerRow[] | null)?.forEach((p) => {
        counts[p.group_id] = (counts[p.group_id] ?? 0) + 1;
      });
      setPlayerCounts(counts);
    } else {
      console.error(pErr);
      setPlayerCounts({});
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    Object.values(categories).forEach((arr) => arr.forEach((c) => set.add(c)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [categories]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    const mapped = rows
      .filter((r) => r.coach_groups)
      .map((r) => {
        const g = r.coach_groups!;
        const clubName = g.clubs?.name ?? "Club";
        const cats = categories[r.group_id] ?? [];
        const players = playerCounts[r.group_id] ?? 0;

        return {
          group_id: r.group_id,
          is_head: r.is_head,
          group: g,
          clubName,
          cats,
          players,
        };
      });

    return mapped
      .filter((x) => {
        const matchesQ =
          !query ||
          x.group.name.toLowerCase().includes(query) ||
          (x.clubName ?? "").toLowerCase().includes(query) ||
          x.cats.some((c) => c.toLowerCase().includes(query));

        const matchesCat = !catFilter || x.cats.includes(catFilter);
        return matchesQ && matchesCat;
      })
      .sort((a, b) => {
        // Actifs d’abord, puis alpha
        if (a.group.is_active !== b.group.is_active)
          return a.group.is_active ? -1 : 1;
        return a.group.name.localeCompare(b.group.name, "fr");
      });
  }, [rows, q, catFilter, categories, playerCounts]);

  const inputWrapStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.55)",
    padding: "12px 12px 12px 44px",
    fontWeight: 800,
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.55)",
    padding: "12px 12px",
    fontWeight: 800,
    outline: "none",
  };

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">Groupes</div>

          {/* Filtres (style Player) */}
          <div className="glass-card" style={{ marginTop: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 0.6fr",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={inputWrapStyle}>
                <Search
                  size={18}
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    opacity: 0.7,
                  }}
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher un groupe, un club, une catégorie…"
                  style={inputStyle}
                />
              </div>

              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="">Toutes</option>
                {allCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Badge
                label={`${filtered.length} groupe${filtered.length > 1 ? "s" : ""}`}
                tone="neutral"
              />
              {catFilter ? (
                <button
                  onClick={() => setCatFilter("")}
                  style={{
                    border: "none",
                    background: "transparent",
                    textDecoration: "underline",
                    fontWeight: 900,
                    opacity: 0.75,
                    cursor: "pointer",
                  }}
                >
                  effacer filtre catégorie
                </button>
              ) : null}
              {q.trim() ? (
                <button
                  onClick={() => setQ("")}
                  style={{
                    border: "none",
                    background: "transparent",
                    textDecoration: "underline",
                    fontWeight: 900,
                    opacity: 0.75,
                    cursor: "pointer",
                  }}
                >
                  effacer recherche
                </button>
              ) : null}
            </div>
          </div>

          {/* Liste (style Player : grid-2) */}
<div style={{ marginTop: 12, display: "grid", gap: 12 }}>            {/* Colonne gauche : liste */}
            <div className="glass-card">
              <div className="card-title">Mes groupes</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>Chargement…</div>
              ) : filtered.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>
                  Aucun groupe trouvé.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {filtered.map((x) => {
                    const cats = x.cats ?? [];
                    const players = x.players ?? 0;
                    const clubName = x.clubName ?? "Club";

                    return (
                      <Link
                        key={x.group.id}
                        href={`/coach/groups/${x.group.id}`}
                        className="glass-card"
                        style={{
                          padding: 14,
                          opacity: x.group.is_active ? 1 : 0.75,
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>{x.group.name}</div>
                        <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                          {clubName} • {players} joueur{players > 1 ? "s" : ""}
                        </div>

                        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <Badge
                            label={x.group.is_active ? "Actif" : "Inactif"}
                            tone={x.group.is_active ? "green" : "neutral"}
                          />
                          {x.is_head ? <Badge label="Head coach" tone="blue" /> : null}

                          {cats.length ? (
                            cats.slice(0, 4).map((c) => (
                              <Badge key={c} label={c} tone={toneForCategory(c) as any} />
                            ))
                          ) : (
                            <Badge label="Sans catégorie" tone="neutral" />
                          )}

                          {cats.length > 4 ? (
                            <Badge label={`+${cats.length - 4}`} tone="neutral" />
                          ) : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              <Link href="/coach/groups/new" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                Créer un groupe
              </Link>
            </div>

            {/* Colonne droite : résumé / actions */}
            <div className="glass-card">
              <div className="card-title">Actions</div>

              <div style={{ display: "grid", gap: 10 }}>
                <Link href="/coach/calendar" className="glass-card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 950 }}>Calendrier</div>
                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                    Planifier des entraînements
                  </div>
                </Link>

                <Link href="/coach/trainings" className="glass-card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 950 }}>Entraînements</div>
                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                    Voir tous les entraînements
                  </div>
                </Link>
              </div>

              <Link href="/coach/trainings/new" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                Ajouter un entraînement
              </Link>
            </div>
          </div>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}