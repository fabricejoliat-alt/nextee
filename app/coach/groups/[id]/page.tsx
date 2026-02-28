"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { PlusCircle, Search, Trash2, Users, Tag, User, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type Role = "coach" | "manager" | "player";

type Club = { id: string; name: string | null };

type CoachGroup = {
  id: string;
  created_at: string;
  club_id: string;
  name: string;
  is_active: boolean;
  head_coach_user_id: string | null;
  clubs?: Club | null;
};

type ClubMemberRow = {
  club_id: string;
  user_id: string;
  is_active: boolean | null;
  role: Role;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type GroupPlayerRow = {
  id: string;
  group_id: string;
  player_user_id: string;
  profiles?: ProfileLite | null;
};

type GroupCoachRow = {
  id: string;
  group_id: string;
  coach_user_id: string;
  is_head: boolean;
  profiles?: ProfileLite | null;
};

type CategoryRow = {
  id: string;
  group_id: string;
  category: string;
};

type PlannedEventLite = {
  id: string;
  starts_at: string;
  status: "scheduled" | "cancelled";
  series_id?: string | null;
};

function fullName(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const s = `${f} ${l}`.trim();
  return s || "—";
}

function initials(p?: ProfileLite | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function avatarNode(p?: ProfileLite | null) {
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

/** Small, dependency-free searchable dropdown (combobox) */
function SearchSelect({
  label,
  placeholder,
  items,
  itemSubtitle,
  onSelect,
  disabled,
}: {
  label: string;
  placeholder: string;
  items: ProfileLite[];
  itemSubtitle?: (p: ProfileLite) => string;
  onSelect: (p: ProfileLite) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items.slice(0, 20);
    const res = items.filter((p) => {
      const n = fullName(p).toLowerCase();
      const h = typeof p.handicap === "number" ? String(p.handicap) : "";
      return n.includes(qq) || h.includes(qq);
    });
    return res.slice(0, 20);
  }, [items, q]);

  return (
    <div ref={wrapRef} style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={fieldLabelStyle}>{label}</span>
        {q ? (
          <button
            type="button"
            className="glass-btn"
            onClick={() => setQ("")}
            disabled={disabled}
            style={{
              height: 34,
              padding: "0 10px",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
            title="Effacer"
            aria-label="Effacer"
          >
            <X size={16} />
            Effacer
          </button>
        ) : null}
      </div>

      <div style={{ position: "relative" }}>
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
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          style={{ paddingLeft: 44 }}
        />

        {open ? (
          <div
            className="glass-card"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "calc(100% + 8px)",
              padding: 10,
              zIndex: 50,
              maxHeight: 320,
              overflow: "auto",
              border: "1px solid rgba(0,0,0,0.10)",
              background: "rgba(255,255,255,0.92)",
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                Aucun résultat.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="glass-btn"
                    disabled={disabled}
                    onClick={() => {
                      onSelect(p);
                      setOpen(false);
                      setQ("");
                      inputRef.current?.blur();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div style={avatarBoxStyle} aria-hidden="true">
                        {avatarNode(p)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 950 }} className="truncate">
                          {fullName(p)}
                        </div>
                        {itemSubtitle ? (
                          <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                            {itemSubtitle(p)}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        width: 42,
                        height: 40,
                        borderRadius: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "rgba(255,255,255,0.65)",
                      }}
                      aria-hidden="true"
                      title="Ajouter"
                    >
                      <PlusCircle size={18} />
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 800, opacity: 0.65 }}>
              Affiche {filtered.length} résultat{filtered.length > 1 ? "s" : ""} (max 20). Tape pour filtrer.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CoachGroupEditPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const groupId = String((params as any)?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [clubRole, setClubRole] = useState<Role | null>(null);

  const [group, setGroup] = useState<CoachGroup | null>(null);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRow[]>([]);
  const [coaches, setCoaches] = useState<GroupCoachRow[]>([]);
  const [plannedEvents, setPlannedEvents] = useState<PlannedEventLite[]>([]);

  // editable group info
  const [groupName, setGroupName] = useState("");
  const [isActive, setIsActive] = useState(true);

  // categories
  const [newCat, setNewCat] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  // club members (for adding)
  const [clubMembersPlayers, setClubMembersPlayers] = useState<ProfileLite[]>([]);
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]); // ✅ only role=coach

  async function loadClubMembers(cid: string, uid: string) {
    if (!cid) {
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
      return;
    }

    const { data: mem, error: memErr } = await supabase
      .from("club_members")
      .select("club_id,user_id,is_active,role")
      .eq("club_id", cid)
      .eq("is_active", true);

    if (memErr) {
      console.error(memErr);
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
      return;
    }

    const members = (mem as ClubMemberRow[] | null) ?? [];
    const uniq = (arr: string[]) => Array.from(new Set(arr)).filter(Boolean);

    const playerIds = uniq(members.filter((m) => m.role === "player").map((m) => m.user_id));

    // ✅ assistants = ONLY role "coach"
    const coachIds = uniq(members.filter((m) => m.role === "coach").map((m) => m.user_id));

    async function fetchProfiles(ids: string[]) {
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .in("id", ids);

      if (error) {
        console.error(error);
        return [];
      }
      return (data ?? []) as ProfileLite[];
    }

    const [playerProfiles, coachProfiles] = await Promise.all([
      fetchProfiles(playerIds),
      fetchProfiles(coachIds),
    ]);

    playerProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));

    setClubMembersPlayers(playerProfiles.filter((p) => p.id !== uid));
    setClubMembersCoaches(coachProfiles.filter((p) => p.id !== uid));
  }

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (authErr || !uid) {
      setErr("Session invalide. Reconnecte-toi.");
      setLoading(false);
      return;
    }
    setUserId(uid);

    // access check
    const { data: linkRow, error: linkErr } = await supabase
      .from("coach_group_coaches")
      .select("id")
      .eq("group_id", groupId)
      .eq("coach_user_id", uid)
      .maybeSingle();

    if (linkErr || !linkRow) {
      setErr(t("coachGroupEdit.accessDeniedOrNotFound"));
      setLoading(false);
      return;
    }

    const gRes = await supabase
      .from("coach_groups")
      .select(
        `
        id,created_at,club_id,name,is_active,head_coach_user_id,
        clubs:clubs ( id, name )
      `
      )
      .eq("id", groupId)
      .maybeSingle();

    if (gRes.error) {
      setErr(gRes.error.message);
      setLoading(false);
      return;
    }

    const g = (gRes.data ?? null) as any as CoachGroup | null;
    setGroup(g);
    if (g?.club_id) {
      const roleRes = await supabase
        .from("club_members")
        .select("role")
        .eq("club_id", g.club_id)
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();
      if (!roleRes.error && roleRes.data) setClubRole((roleRes.data as any).role as Role);
      else setClubRole(null);
    } else {
      setClubRole(null);
    }

    if (g) {
      setGroupName(g.name ?? "");
      setIsActive(!!g.is_active);
    }

    const catRes = await supabase
      .from("coach_group_categories")
      .select("id,group_id,category")
      .eq("group_id", groupId)
      .order("category", { ascending: true });

    setCats((catRes.data ?? []) as CategoryRow[]);

    const pRes = await supabase
      .from("coach_group_players")
      .select(
        `
        id,group_id,
        player_user_id,
        profiles:profiles ( id, first_name, last_name, handicap, avatar_url )
      `
      )
      .eq("group_id", groupId);

    setPlayers((pRes.data ?? []) as any);

    const cRes = await supabase
      .from("coach_group_coaches")
      .select(
        `
        id,group_id,
        coach_user_id,
        is_head,
        profiles:profiles ( id, first_name, last_name, handicap, avatar_url )
      `
      )
      .eq("group_id", groupId)
      .order("is_head", { ascending: false });

    setCoaches((cRes.data ?? []) as any);

    const evRes = await supabase
      .from("club_events")
      .select("id,starts_at,status,series_id")
      .eq("group_id", groupId)
      .order("starts_at", { ascending: true });

    if (!evRes.error) setPlannedEvents((evRes.data ?? []) as PlannedEventLite[]);
    else setPlannedEvents([]);

    if (g?.club_id) {
      await loadClubMembers(g.club_id, uid);
    } else {
      setClubMembersPlayers([]);
      setClubMembersCoaches([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!groupId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const planningSummary = useMemo(() => {
    const now = Date.now();
    const scheduled = plannedEvents.filter((e) => e.status === "scheduled");
    const upcoming = scheduled.filter((e) => new Date(e.starts_at).getTime() >= now);
    const next = upcoming
      .slice()
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
    const recurringCount = scheduled.filter((e) => Boolean(e.series_id)).length;
    return {
      totalScheduled: scheduled.length,
      upcomingCount: upcoming.length,
      recurringCount,
      nextStartsAt: next?.starts_at ?? null,
    };
  }, [plannedEvents]);

  const canSaveInfo = useMemo(() => {
    if (busy) return false;
    if (!group) return false;
    if (groupName.trim().length < 2) return false;
    return true;
  }, [busy, group, groupName]);

  const canManagePlayers = useMemo(() => clubRole === "manager", [clubRole]);
  const canDeleteGroup = useMemo(() => clubRole === "manager", [clubRole]);

  // --------- GROUP INFO ----------
  async function saveGroupInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!canSaveInfo || !group) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase
      .from("coach_groups")
      .update({
        name: groupName.trim(),
        is_active: isActive,
      })
      .eq("id", group.id);

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // --------- CATEGORIES ----------
  const canAddCat = useMemo(() => {
    const v = newCat.trim();
    if (!v) return false;
    const exists = cats.some((c) => c.category.toLowerCase() === v.toLowerCase());
    return !exists;
  }, [newCat, cats]);

  async function addCategory() {
    const v = newCat.trim();
    if (!v || savingCat || busy) return;

    setSavingCat(true);
    const { error } = await supabase.from("coach_group_categories").insert({
      group_id: groupId,
      category: v,
    });

    if (error) {
      setErr(error.message);
      setSavingCat(false);
      return;
    }

    setNewCat("");
    await load();
    setSavingCat(false);
  }

  // ✅ FIX RLS: delete category via RPC (security definer)
  async function removeCategory(catId: string) {
    if (!catId || busy) return;
    setBusy(true);
    setErr(null);

    const { error } = await supabase.rpc("coach_group_delete_category", {
      p_group_id: groupId,
      p_category_id: catId,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // --------- PLAYERS ----------
  const playerIdsInGroup = useMemo(() => new Set(players.map((p) => p.player_user_id)), [players]);

  const playerCandidates = useMemo(() => {
    return clubMembersPlayers.filter((p) => !playerIdsInGroup.has(p.id));
  }, [clubMembersPlayers, playerIdsInGroup]);

  async function addPlayerToGroup(p: ProfileLite) {
    if (!groupId || busy) return;
    if (playerIdsInGroup.has(p.id)) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.from("coach_group_players").insert({
      group_id: groupId,
      player_user_id: p.id,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // ✅ FIX RLS: delete player via RPC (security definer)
  async function removePlayerFromGroup(rowId: string) {
    if (!rowId || busy) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.rpc("coach_group_delete_player", {
      p_group_id: groupId,
      p_group_player_id: rowId,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // --------- COACHES ----------
  const coachIdsInGroup = useMemo(() => new Set(coaches.map((c) => c.coach_user_id)), [coaches]);

  const coachCandidates = useMemo(() => {
    return clubMembersCoaches.filter((p) => !coachIdsInGroup.has(p.id));
  }, [clubMembersCoaches, coachIdsInGroup]);

  async function addCoachToGroup(p: ProfileLite) {
    if (!groupId || busy) return;
    if (coachIdsInGroup.has(p.id)) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.from("coach_group_coaches").insert({
      group_id: groupId,
      coach_user_id: p.id,
      is_head: false,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  async function removeCoachFromGroup(row: GroupCoachRow) {
    if (!row?.id || busy) return;
    if (row.is_head) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.from("coach_group_coaches").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // --------- DELETE GROUP ----------
  async function deleteGroup() {
    if (!group) return;
    if (!canDeleteGroup) {
      setErr("Seul un manager peut supprimer ce groupe.");
      return;
    }

    const ok = window.confirm(
      `Supprimer le groupe "${group.name}" ?\n\nLes événements futurs de ce groupe seront supprimés.\nL'historique passé sera conservé.`
    );
    if (!ok) return;

    setBusy(true);
    setErr(null);

    const { error } = await supabase.rpc("coach_group_delete_keep_history", {
      p_group_id: group.id,
    });

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    router.push("/coach/groups");
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>{groupName || "Éditer un groupe"}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/coach/groups">
                Mes groupes
              </Link>

              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning`}>
                Planification
              </Link>
            </div>
          </div>

          {err && <div className="marketplace-error">{err}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>{t("common.loading")}</div>
            ) : !group ? (
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                {t("coachGroupEdit.accessDeniedOrNotFound")}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {/* INFO EDIT (save button inside) */}
                <form onSubmit={saveGroupInfo} style={{ display: "grid", gap: 12 }}>
                  <div className="glass-card" style={{ padding: 14 }}>
                    <div className="card-title">Info</div>

                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Nom du groupe</span>
                        <input
                          value={groupName}
                          onChange={(e) => setGroupName(e.target.value)}
                          disabled={busy}
                          placeholder="Nom du groupe"
                        />
                      </label>

                      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={(e) => setIsActive(e.target.checked)}
                          disabled={busy}
                          style={{ width: 18, height: 18 }}
                        />
                        <span style={fieldLabelStyle}>Groupe actif</span>
                      </label>

                      <button
                        className="btn"
                        type="submit"
                        disabled={!canSaveInfo || busy}
                        style={{
                          width: "100%",
                          background: "var(--green-dark)",
                          borderColor: "var(--green-dark)",
                          color: "#fff",
                          marginTop: 6,
                        }}
                      >
                        {busy ? "Enregistrement…" : "Enregistrer"}
                      </button>
                    </div>
                  </div>
                </form>

                {/* CATEGORIES */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Tag size={18} />
                    Catégories
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {cats.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        Aucune catégorie.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {cats.map((c) => (
                          <div key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span className="pill-soft">{c.category}</span>
                            <button
                              type="button"
                              className="btn btn-danger soft"
                              onClick={() => removeCategory(c.id)}
                              disabled={busy}
                              style={{ padding: "8px 10px" }}
                              aria-label={t("coachGroupNew.removeCategory")}
                              title="Supprimer"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                      <input
                        value={newCat}
                        onChange={(e) => setNewCat(e.target.value)}
                        disabled={busy}
                        placeholder={t("coachGroupEdit.addCategoryPlaceholder")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCategory();
                          }
                        }}
                      />

                      <button
                        type="button"
                        className="glass-btn"
                        onClick={addCategory}
                        disabled={busy || savingCat || !canAddCat}
                        style={{
                          width: 44,
                          height: 42,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(255,255,255,0.70)",
                          border: "1px solid rgba(0,0,0,0.08)",
                          opacity: busy || savingCat || !canAddCat ? 0.6 : 1,
                          pointerEvents: busy || savingCat || !canAddCat ? "none" : "auto",
                        }}
                        aria-label={t("coachGroupNew.addCategory")}
                        title="Ajouter"
                      >
                        <PlusCircle size={18} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* PLAYERS */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={18} />
                    Joueurs
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    <SearchSelect
                      label="Ajouter un joueur"
                      placeholder="Tape un nom ou handicap…"
                      items={playerCandidates}
                      disabled={busy || !canManagePlayers}
                      itemSubtitle={(p) =>
                        `Handicap ${typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}`
                      }
                      onSelect={addPlayerToGroup}
                    />

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Dans le groupe ({players.length})</div>

                      {players.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun joueur dans ce groupe.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {players
                            .slice()
                            .sort((a, b) => fullName(a.profiles).localeCompare(fullName(b.profiles), "fr"))
                            .map((row) => {
                              const p = row.profiles ?? null;
                              return (
                                <div
                                  key={row.id}
                                  style={{ ...lightRowCardStyle, cursor: "pointer" }}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() =>
                                    router.push(
                                      `/coach/players/${row.player_user_id}?returnTo=${encodeURIComponent(`/coach/groups/${groupId}`)}`
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      router.push(
                                        `/coach/players/${row.player_user_id}?returnTo=${encodeURIComponent(`/coach/groups/${groupId}`)}`
                                      );
                                    }
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                    <div style={avatarBoxStyle} aria-hidden="true">
                                      {avatarNode(p)}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontWeight: 950 }} className="truncate">
                                        {fullName(p)}
                                      </div>
                                      <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                        Handicap {typeof p?.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", gap: 10 }}>
                                    {canManagePlayers ? (
                                      <button
                                        type="button"
                                        className="btn btn-danger soft"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removePlayerFromGroup(row.id);
                                        }}
                                        disabled={busy}
                                        style={{ padding: "10px 12px" }}
                                        aria-label="Retirer joueur"
                                        title="Retirer"
                                      >
                                        <Trash2 size={18} />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* COACHES */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <User size={18} />
                    Coachs
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                      {t("coachGroupEdit.headCoachFixed")}
                    </div>

                    <SearchSelect
                      label="Ajouter un coach"
                      placeholder="Tape un nom…"
                      items={coachCandidates}
                      disabled={busy}
                      itemSubtitle={() => "Coach"}
                      onSelect={addCoachToGroup}
                    />

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Dans le groupe ({coaches.length})</div>

                      {coaches.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun coach associé.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {coaches.map((row) => {
                            const p = row.profiles ?? null;
                            return (
                              <div key={row.id} style={lightRowCardStyle}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                  <div style={avatarBoxStyle} aria-hidden="true">
                                    {avatarNode(p)}
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 950 }} className="truncate">
                                      {fullName(p)}
                                    </div>
                                      <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                      {row.is_head ? t("trainingNew.headCoach") : t("trainingNew.extraCoach")}
                                      </div>
                                    </div>
                                  </div>

                                {row.is_head ? (
                                  <span className="pill-soft">{t("trainingNew.headCoach")}</span>
                                ) : (
                                    <button
                                      type="button"
                                      className="btn btn-danger soft"
                                      onClick={() => removeCoachFromGroup(row)}
                                      disabled={busy}
                                      style={{ padding: "10px 12px" }}
                                      aria-label="Retirer coach"
                                      title="Retirer"
                                    >
                                    <Trash2 size={18} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* PLANNING */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title">{t("coachGroupEdit.trainingPlanning")}</div>

                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <span className="pill-soft">À venir: {planningSummary.upcomingCount}</span>
                      <span className="pill-soft">Planifiés: {planningSummary.totalScheduled}</span>
                      <span className="pill-soft">Récurrents: {planningSummary.recurringCount}</span>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                      {planningSummary.nextStartsAt
                        ? `Prochain événement: ${new Intl.DateTimeFormat("fr-CH", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(planningSummary.nextStartsAt))}`
                        : planningSummary.totalScheduled > 0
                        ? `${planningSummary.totalScheduled} événement${planningSummary.totalScheduled > 1 ? "s" : ""} planifié${planningSummary.totalScheduled > 1 ? "s" : ""}.`
                        : t("coachGroupEdit.noUpcomingTraining")}
                    </div>

                    <Link
                      className="cta-green cta-green-inline"
                      href={`/coach/groups/${groupId}/planning`}
                      style={{ width: "100%" }}
                    >
                      Gérer la planification
                    </Link>
                  </div>
                </div>

                {/* DELETE GROUP */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title">Danger</div>

                  <div style={{ marginTop: 8, fontWeight: 900, color: "#b91c1c" }}>
                    Attention, la suppression du groupe est irréversible.
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)", marginTop: 8 }}>
                    {canDeleteGroup ? (
                      <span>Tu es manager : tu peux supprimer ce groupe.</span>
                    ) : (
                      <span>Seul un manager peut supprimer ce groupe.</span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={deleteGroup}
                    disabled={busy || !canDeleteGroup}
                    style={{ width: "100%", marginTop: 12 }}
                  >
                    <Trash2 size={18} />
                    Supprimer le groupe
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

const avatarBoxStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(255,255,255,0.65)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};

const lightRowCardStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 14,
  background: "rgba(255,255,255,0.65)",
  padding: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};
