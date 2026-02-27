"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X } from "lucide-react";

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type GroupLite = {
  id: string;
  name: string;
  is_active: boolean;
  head_coach_user_id: string | null;
  club_id: string;
};

type GroupCategory = { group_id: string; category: string };
type GroupPlayer = { group_id: string; player_user_id: string };
type GroupCoach = { group_id: string; coach_user_id: string; is_head: boolean | null };

type DragPayload = {
  actorType: "player" | "coach";
  userId: string;
  fromGroupId: string | null;
};

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "Sans nom";
}

function initials(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function Avatar({ p }: { p?: ProfileLite | null }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        fontWeight: 900,
        fontSize: 9,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.9)",
      }}
    >
      {p?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials(p)
      )}
    </div>
  );
}

export default function OrganizationGroupsBoard({
  organizationId,
}: {
  organizationId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [coaches, setCoaches] = useState<ProfileLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [categories, setCategories] = useState<GroupCategory[]>([]);
  const [groupPlayers, setGroupPlayers] = useState<GroupPlayer[]>([]);
  const [groupCoaches, setGroupCoaches] = useState<GroupCoach[]>([]);
  const [dragging, setDragging] = useState<DragPayload | null>(null);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    return { Authorization: `Bearer ${token}` };
  }

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Load failed");

      setPlayers((json.players ?? []) as ProfileLite[]);
      setCoaches((json.coaches ?? []) as ProfileLite[]);
      setGroups((json.groups ?? []) as GroupLite[]);
      setCategories((json.categories ?? []) as GroupCategory[]);
      setGroupPlayers((json.groupPlayers ?? []) as GroupPlayer[]);
      setGroupCoaches((json.groupCoaches ?? []) as GroupCoach[]);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const playersById = useMemo(() => {
    const map: Record<string, ProfileLite> = {};
    players.forEach((p) => (map[p.id] = p));
    return map;
  }, [players]);

  const coachesById = useMemo(() => {
    const map: Record<string, ProfileLite> = {};
    coaches.forEach((c) => (map[c.id] = c));
    return map;
  }, [coaches]);

  const categoriesByGroup = useMemo(() => {
    const out: Record<string, string[]> = {};
    categories.forEach((c) => {
      if (!out[c.group_id]) out[c.group_id] = [];
      out[c.group_id].push(c.category);
    });
    Object.keys(out).forEach((gid) => {
      out[gid] = Array.from(new Set(out[gid])).sort((a, b) => a.localeCompare(b, "fr"));
    });
    return out;
  }, [categories]);

  const playersInGroups = useMemo(() => {
    const out: Record<string, string[]> = {};
    groupPlayers.forEach((r) => {
      if (!out[r.group_id]) out[r.group_id] = [];
      out[r.group_id].push(r.player_user_id);
    });
    return out;
  }, [groupPlayers]);

  const coachesInGroups = useMemo(() => {
    const out: Record<string, string[]> = {};
    groupCoaches.forEach((r) => {
      if (!out[r.group_id]) out[r.group_id] = [];
      out[r.group_id].push(r.coach_user_id);
    });
    return out;
  }, [groupCoaches]);

  const playerHasGroup = useMemo(() => {
    const set = new Set(groupPlayers.map((r) => r.player_user_id));
    return set;
  }, [groupPlayers]);

  const coachHasGroup = useMemo(() => {
    const set = new Set(groupCoaches.map((r) => r.coach_user_id));
    return set;
  }, [groupCoaches]);

  const sortedGroups = useMemo(() => {
    return groups
      .slice()
      .sort((a, b) => {
        const aHead = fullName(coachesById[a.head_coach_user_id ?? ""]).toLocaleLowerCase("fr");
        const bHead = fullName(coachesById[b.head_coach_user_id ?? ""]).toLocaleLowerCase("fr");
        const byHead = aHead.localeCompare(bHead, "fr");
        if (byHead !== 0) return byHead;
        return (a.name ?? "").localeCompare(b.name ?? "", "fr");
      });
  }, [groups, coachesById]);

  async function moveMember(toGroupId: string, payload: DragPayload) {
    if (!toGroupId || payload.fromGroupId === toGroupId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          actorType: payload.actorType,
          userId: payload.userId,
          toGroupId,
          fromGroupId: payload.fromGroupId,
          removeFromSource: Boolean(payload.fromGroupId),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Move failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur de déplacement.");
    } finally {
      setBusy(false);
      setDragging(null);
    }
  }

  async function removeFromGroup(actorType: "player" | "coach", groupId: string, userId: string) {
    if (!groupId || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/admin/organizations/${organizationId}/group-assignments`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          actorType,
          groupId,
          userId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Remove failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur de suppression.");
    } finally {
      setBusy(false);
    }
  }

  function chipStyle(active: boolean): React.CSSProperties {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      padding: "4px 8px",
      border: "1px solid rgba(0,0,0,0.08)",
      background: active ? "rgba(22,163,74,0.16)" : "rgba(107,114,128,0.14)",
      color: "rgba(17,24,39,0.95)",
      fontSize: 11,
      fontWeight: 800,
      cursor: "grab",
      userSelect: "none",
      lineHeight: 1.1,
    };
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error ? (
        <div className="card">
          <div style={{ border: "1px solid #ffd3d3", background: "#fff7f7", color: "#a00", borderRadius: 10, padding: 8, fontSize: 12 }}>
            {error}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Joueurs du club</h3>
        {loading ? (
          <div style={{ fontSize: 12 }}>Chargement…</div>
        ) : players.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Aucun joueur.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {players
              .slice()
              .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"))
              .map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDragging({ actorType: "player", userId: p.id, fromGroupId: null })}
                  style={chipStyle(playerHasGroup.has(p.id))}
                  title={playerHasGroup.has(p.id) ? "Déjà dans au moins un groupe" : "Aucun groupe"}
                >
                  <Avatar p={p} />
                  {fullName(p)}
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Coachs du club</h3>
        {loading ? (
          <div style={{ fontSize: 12 }}>Chargement…</div>
        ) : coaches.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Aucun coach.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {coaches
              .slice()
              .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"))
              .map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => setDragging({ actorType: "coach", userId: c.id, fromGroupId: null })}
                  style={chipStyle(coachHasGroup.has(c.id))}
                  title={coachHasGroup.has(c.id) ? "Déjà dans au moins un groupe" : "Aucun groupe"}
                >
                  <Avatar p={c} />
                  {fullName(c)}
                </div>
              ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "start",
        }}
      >
        {sortedGroups.map((g) => {
          const groupPlayerIds = playersInGroups[g.id] ?? [];
          const groupCoachIds = coachesInGroups[g.id] ?? [];
          const headCoach = coachesById[g.head_coach_user_id ?? ""] ?? null;
          const otherCoachIds = groupCoachIds.filter((id) => id !== g.head_coach_user_id);

          return (
            <div
              className="card"
              key={g.id}
              style={{
                borderColor: "rgba(15,23,42,0.14)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
                padding: 10,
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 14 }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>
                      Head coach: {headCoach ? fullName(headCoach) : "Non défini"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(categoriesByGroup[g.id] ?? []).map((cat) => (
                      <span
                        key={cat}
                        style={{
                          borderRadius: 999,
                          padding: "3px 8px",
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.04)",
                          fontSize: 10,
                          fontWeight: 800,
                        }}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    onDragOver={(e) => {
                      if (dragging?.actorType === "player") e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!dragging || dragging.actorType !== "player") return;
                      void moveMember(g.id, dragging);
                    }}
                    style={{
                      border: "1px dashed rgba(15,23,42,0.22)",
                      borderRadius: 10,
                      padding: 8,
                      minHeight: 42,
                      background: "rgba(16,185,129,0.04)",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 6 }}>
                      Joueurs ({groupPlayerIds.length}) - déposer ici
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {groupPlayerIds.map((pid) => {
                        const p = playersById[pid];
                        return (
                          <div
                            key={`${g.id}-${pid}`}
                            draggable
                            onDragStart={() =>
                              setDragging({ actorType: "player", userId: pid, fromGroupId: g.id })
                            }
                            style={chipStyle(true)}
                            title="Glisser vers un autre groupe pour transférer"
                          >
                            <Avatar p={p} />
                            {fullName(p)}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void removeFromGroup("player", g.id, pid);
                              }}
                              disabled={busy}
                              title="Retirer du groupe"
                              style={{
                                border: "none",
                                background: "transparent",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                                marginLeft: 2,
                                cursor: busy ? "default" : "pointer",
                                opacity: 0.72,
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => {
                      if (dragging?.actorType === "coach") e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!dragging || dragging.actorType !== "coach") return;
                      void moveMember(g.id, dragging);
                    }}
                    style={{
                      border: "1px dashed rgba(15,23,42,0.22)",
                      borderRadius: 10,
                      padding: 8,
                      minHeight: 42,
                      background: "rgba(59,130,246,0.04)",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 6 }}>
                      Coachs ({groupCoachIds.length}) - déposer ici
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {otherCoachIds.map((cid) => {
                        const c = coachesById[cid];
                        return (
                          <div
                            key={`${g.id}-${cid}`}
                            draggable
                            onDragStart={() =>
                              setDragging({ actorType: "coach", userId: cid, fromGroupId: g.id })
                            }
                            style={chipStyle(true)}
                            title="Glisser vers un autre groupe pour transférer"
                          >
                            <Avatar p={c} />
                            {fullName(c)}
                          </div>
                        );
                      })}
                      {headCoach ? (
                        <div style={{ ...chipStyle(true), cursor: "default", opacity: 0.9 }} title="Head coach (non transférable ici)">
                          <Avatar p={headCoach} />
                          {fullName(headCoach)} (Head)
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
