"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle, Search } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

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
type GroupPlayerRow = {
  group_id: string;
  player_user_id: string;
  profiles?: ProfileMini | ProfileMini[] | null;
};
type ProfileMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

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

function fullName(p?: ProfileMini | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function initials(p?: ProfileMini | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function avatarNode(p?: ProfileMini | null) {
  if (p?.avatar_url) {
    return (
      <img
        src={p.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(p);
}

export default function CoachGroupsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoachGroupCoachRow[]>([]);
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [playersByGroup, setPlayersByGroup] = useState<Record<string, ProfileMini[]>>({});
  const [coachesByGroup, setCoachesByGroup] = useState<Record<string, ProfileMini[]>>({});
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
      setPlayersByGroup({});
      setCoachesByGroup({});
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
      setPlayersByGroup({});
      setCoachesByGroup({});
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
      setPlayersByGroup({});
      setCoachesByGroup({});
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
      .select("group_id,player_user_id,profiles:player_user_id(id,first_name,last_name,avatar_url)")
      .in("group_id", groupIds);

    if (!pErr) {
      const counts: Record<string, number> = {};
      const byGroup: Record<string, ProfileMini[]> = {};
      (players as GroupPlayerRow[] | null)?.forEach((p) => {
        counts[p.group_id] = (counts[p.group_id] ?? 0) + 1;
        const prof = Array.isArray(p.profiles) ? (p.profiles[0] ?? null) : (p.profiles ?? null);
        if (!byGroup[p.group_id]) byGroup[p.group_id] = [];
        byGroup[p.group_id].push({
          id: prof?.id ?? p.player_user_id,
          first_name: prof?.first_name ?? null,
          last_name: prof?.last_name ?? null,
          avatar_url: prof?.avatar_url ?? null,
        });
      });
      setPlayerCounts(counts);
      Object.keys(byGroup).forEach((gid) => {
        byGroup[gid] = byGroup[gid]
          .slice()
          .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
      });
      setPlayersByGroup(byGroup);
    } else {
      console.error(pErr);
      setPlayerCounts({});
      setPlayersByGroup({});
    }

    const { data: coachLinks, error: coachErr } = await supabase
      .from("coach_group_coaches")
      .select("group_id,coach_user_id,profiles:coach_user_id(id,first_name,last_name,avatar_url)")
      .in("group_id", groupIds);

    if (!coachErr) {
      const byGroup: Record<string, ProfileMini[]> = {};
      (coachLinks ?? []).forEach((row: any) => {
        const gid = String(row.group_id ?? "");
        if (!gid) return;
        const prof = row.profiles ?? null;
        if (!byGroup[gid]) byGroup[gid] = [];
        byGroup[gid].push({
          id: prof?.id ?? String(row.coach_user_id ?? ""),
          first_name: prof?.first_name ?? null,
          last_name: prof?.last_name ?? null,
          avatar_url: prof?.avatar_url ?? null,
        });
      });
      Object.keys(byGroup).forEach((gid) => {
        byGroup[gid] = byGroup[gid]
          .slice()
          .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
      });
      setCoachesByGroup(byGroup);
    } else {
      console.error(coachErr);
      setCoachesByGroup({});
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
        const playerProfiles = playersByGroup[r.group_id] ?? [];
        const coachProfiles = coachesByGroup[r.group_id] ?? [];
        const playerSearch = playerProfiles.map((p) => fullName(p).toLowerCase());
        const coachSearch = coachProfiles.map((p) => fullName(p).toLowerCase());

        return {
          group_id: r.group_id,
          is_head: r.is_head,
          group: g,
          clubName,
          cats,
          players,
          playerProfiles,
          coachProfiles,
          playerSearch,
          coachSearch,
        };
      });

    return mapped
      .filter((x) => {
        const matchesQ =
          !query ||
          x.group.name.toLowerCase().includes(query) ||
          (x.clubName ?? "").toLowerCase().includes(query) ||
          x.cats.some((c) => c.toLowerCase().includes(query)) ||
          x.playerSearch.some((name) => name.includes(query)) ||
          x.coachSearch.some((name) => name.includes(query));

        const matchesCat = !catFilter || x.cats.includes(catFilter);
        return matchesQ && matchesCat;
      })
      .sort((a, b) => {
        // Actifs d’abord, puis alpha
        if (a.group.is_active !== b.group.is_active)
          return a.group.is_active ? -1 : 1;
        return a.group.name.localeCompare(b.group.name, "fr");
      });
  }, [rows, q, catFilter, categories, playerCounts, playersByGroup, coachesByGroup]);

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
          <div className="section-title">{t("coach.myGroups")}</div>

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
                  placeholder={t("coachGroups.searchPlaceholder")}
                  style={inputStyle}
                />
              </div>

              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="">{t("coachGroups.allCategories")}</option>
                {allCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
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
                  {t("coachGroups.clearCategoryFilter")}
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
                  {t("coachGroups.clearSearch")}
                </button>
              ) : null}
            </div>
          </div>

          {/* Liste */}
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div className="glass-card">
              <div className="card-title">{t("coach.myGroups")}</div>

              {loading ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
              ) : filtered.length === 0 ? (
                <div style={{ opacity: 0.8, fontWeight: 800 }}>
                  {t("coachGroups.noneFound")}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {filtered.map((x) => {
                    const cats = x.cats ?? [];
                    const players = x.players ?? 0;
                    const clubName = x.clubName ?? t("common.club");
                    const playerProfiles = x.playerProfiles ?? [];
                    const coachProfiles = x.coachProfiles ?? [];

                    return (
                      <Link
                        key={x.group.id}
                        href={`/manager/groups/${x.group.id}`}
                        className="glass-card"
                        style={{
                          padding: 14,
                          opacity: x.group.is_active ? 1 : 0.75,
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>{x.group.name}</div>
                        <div
                          style={{
                            opacity: 0.62,
                            fontWeight: 700,
                            fontSize: 12,
                            marginTop: 6,
                            lineHeight: 1.25,
                          }}
                        >
                          {clubName} • {players} {t(players > 1 ? "coachGroups.playersPlural" : "coachGroups.playersSingle")}
                        </div>

                        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <Badge
                            label={x.group.is_active ? t("coachGroups.active") : t("coachGroups.inactive")}
                            tone={x.group.is_active ? "green" : "neutral"}
                          />
                          {x.is_head ? <Badge label={t("trainingNew.headCoach")} tone="blue" /> : null}

                          {cats.length ? (
                            cats.slice(0, 4).map((c) => (
                              <Badge key={c} label={c} tone={toneForCategory(c) as any} />
                            ))
                          ) : (
                            <Badge label={t("coachGroups.noCategory")} tone="neutral" />
                          )}

                          {cats.length > 4 ? (
                            <Badge label={`+${cats.length - 4}`} tone="neutral" />
                          ) : null}
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{t("coachGroups.playersTitle")}</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {playerProfiles.length === 0 ? (
                                <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.6 }}>{t("coachGroups.noPlayer")}</div>
                              ) : (
                                <>
                                  {playerProfiles.slice(0, 3).map((p) => (
                                    <div key={p.id} style={miniRowStyle}>
                                      <div style={miniAvatarBoxStyle} aria-hidden="true">
                                        {avatarNode(p)}
                                      </div>
                                      <div className="truncate" style={{ fontSize: 12, fontWeight: 900 }}>
                                        {fullName(p)}
                                      </div>
                                    </div>
                                  ))}
                                  {playerProfiles.length > 3 ? (
                                    <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>
                                      +{playerProfiles.length - 3} {t(playerProfiles.length - 3 > 1 ? "coachGroups.otherPlural" : "coachGroups.otherSingle")}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{t("coachGroups.coachesTitle")}</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {coachProfiles.length === 0 ? (
                                <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.6 }}>{t("coachGroups.noCoach")}</div>
                              ) : (
                                <>
                                  {coachProfiles.slice(0, 3).map((p) => (
                                    <div key={p.id} style={miniRowStyle}>
                                      <div style={miniAvatarBoxStyle} aria-hidden="true">
                                        {avatarNode(p)}
                                      </div>
                                      <div className="truncate" style={{ fontSize: 12, fontWeight: 900 }}>
                                        {fullName(p)}
                                      </div>
                                    </div>
                                  ))}
                                  {coachProfiles.length > 3 ? (
                                    <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>
                                      +{coachProfiles.length - 3} {t(coachProfiles.length - 3 > 1 ? "coachGroups.otherPlural" : "coachGroups.otherSingle")}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              <Link href="/manager/groups/new" className="cta-green" style={{ marginTop: 12 }}>
                <PlusCircle size={18} />
                {t("coachGroups.createGroup")}
              </Link>
            </div>
          </div>
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}

const miniRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 10,
  background: "rgba(255,255,255,0.58)",
  padding: "6px 8px",
  minWidth: 0,
};

const miniAvatarBoxStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  overflow: "hidden",
  background: "rgba(255,255,255,0.70)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 900,
  fontSize: 11,
  color: "var(--green-dark)",
  flexShrink: 0,
};
