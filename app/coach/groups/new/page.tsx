"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { PlusCircle, Search, Trash2, Users, Tag, User } from "lucide-react";



type Role = "coach" | "manager" | "player";

type Club = { id: string; name: string | null };

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

export default function CoachGroupNewPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [currentClubRole, setCurrentClubRole] = useState<Role | null>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string>("");

  const [groupName, setGroupName] = useState("");
  const [isActive, setIsActive] = useState(true);

  // categories
  const [catInput, setCatInput] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  // club members split by role
  const [clubMembersPlayers, setClubMembersPlayers] = useState<ProfileLite[]>([]);
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]);

  // players selection
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});

  // assistants selection
  const [queryCoaches, setQueryCoaches] = useState("");
  const [selectedCoaches, setSelectedCoaches] = useState<Record<string, ProfileLite>>({});

  async function load() {
    setLoading(true);
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError("Session invalide. Reconnecte-toi.");
      setLoading(false);
      return;
    }

    const uid = userRes.user.id;
    setUserId(uid);

    const memRes = await supabase
  .from("club_members")
  .select("club_id,role,is_active")
  .eq("user_id", uid)
  .eq("is_active", true)
  .in("role", ["coach", "manager"]); // ✅ UNIQUEMENT clubs coach/manager

    if (memRes.error) {
      setError(memRes.error.message);
      setLoading(false);
      return;
    }

  const clubIds = Array.from(new Set((memRes.data ?? []).map((r: any) => r.club_id))).filter(Boolean);

if (clubIds.length === 0) {
  setError(t("coachGroupNew.noClubPermission"));
  setClubs([]);
  setClubId("");
  setLoading(false);
  return;
}

    if (clubIds.length > 0) {
      const clubsRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
      if (clubsRes.error) {
        setError(clubsRes.error.message);
        setLoading(false);
        return;
      }

      const list = (clubsRes.data ?? []) as Club[];
      setClubs(list);
      setClubId((prev) => prev || list[0]?.id || "");
    } else {
      setClubs([]);
      setClubId("");
    }

    setLoading(false);
  }

  async function loadClubMembers(cid: string) {
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
    const meInClub = members.find((m) => m.user_id === userId);
    setCurrentClubRole((meInClub?.role as Role | undefined) ?? null);

    const uniq = (arr: string[]) => Array.from(new Set(arr)).filter(Boolean);

    const playerIds = uniq(members.filter((m) => m.role === "player").map((m) => m.user_id));
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

    const [playerProfiles, coachProfiles] = await Promise.all([fetchProfiles(playerIds), fetchProfiles(coachIds)]);

    playerProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));

    setClubMembersPlayers(playerProfiles);
    setClubMembersCoaches(coachProfiles);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      await loadClubMembers(clubId);
      setQueryPlayers("");
      setQueryCoaches("");
      setSelectedPlayers({});
      setSelectedCoaches({});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!userId) return false;
    if (!clubId) return false;
    if (groupName.trim().length < 2) return false;
    return true;
  }, [busy, userId, clubId, groupName]);

  const canManagePlayers = useMemo(() => currentClubRole === "manager", [currentClubRole]);

  function addCategory() {
    const v = catInput.trim();
    if (!v) return;
    const exists = categories.some((c) => c.toLowerCase() === v.toLowerCase());
    if (exists) {
      setCatInput("");
      return;
    }
    setCategories((prev) => [...prev, v].sort((a, b) => a.localeCompare(b, "fr")));
    setCatInput("");
  }

  function removeCategory(v: string) {
    setCategories((prev) => prev.filter((x) => x !== v));
  }

  function toggleSelected(
    mapSetter: React.Dispatch<React.SetStateAction<Record<string, ProfileLite>>>,
    p: ProfileLite
  ) {
    mapSetter((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  }

  const selectedPlayersList = useMemo(
    () => Object.values(selectedPlayers).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [selectedPlayers]
  );

  const selectedCoachesList = useMemo(
    () => Object.values(selectedCoaches).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [selectedCoaches]
  );

  const candidatesPlayers = useMemo(() => {
    const q = queryPlayers.trim().toLowerCase();
    const base = clubMembersPlayers.filter((p) => p.id !== userId && !selectedPlayers[p.id]);

    const filtered = !q
      ? base
      : base.filter((p) => {
          const n = fullName(p).toLowerCase();
          const h = typeof p.handicap === "number" ? String(p.handicap) : "";
          return n.includes(q) || h.includes(q);
        });

    return filtered.slice(0, 30);
  }, [clubMembersPlayers, queryPlayers, selectedPlayers, userId]);

  const candidatesCoaches = useMemo(() => {
    const q = queryCoaches.trim().toLowerCase();
    const base = clubMembersCoaches.filter((p) => p.id !== userId && !selectedCoaches[p.id]);

    const filtered = !q
      ? base
      : base.filter((p) => {
          const n = fullName(p).toLowerCase();
          return n.includes(q);
        });

    return filtered.slice(0, 30);
  }, [clubMembersCoaches, queryCoaches, selectedCoaches, userId]);

  
async function handleCreate(e: React.FormEvent) {
  e.preventDefault();
  if (!canSave) return;

  setBusy(true);
  setError(null);

 

  // ✅ Pré-check droits sur le club sélectionné
  const pre = await supabase
    .from("club_members")
    .select("role,is_active")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .maybeSingle();

 

  const role = String(pre.data?.role ?? "");
  setCurrentClubRole((role as Role) ?? null);
  if (!pre.data?.is_active || (role !== "coach" && role !== "manager")) {
    setError(`Droits insuffisants sur le club sélectionné (${role || "—"}).`);
    setBusy(false);
    return;
  }

  const { data: u } = await supabase.auth.getUser();
  console.log("getUser()", u.user?.id);

  // ✅ IMPORTANT: pas de .select().single() (RETURNING) car ta policy SELECT bloque avant l'ajout du head coach
  const groupIdNew = crypto.randomUUID();

  const gRes = await supabase.from("coach_groups").insert({
    id: groupIdNew,
    club_id: clubId,
    name: groupName.trim(),
    is_active: isActive,
    head_coach_user_id: userId,
  });

  const check = await supabase.from("coach_groups").select("id,club_id").eq("id", groupIdNew).maybeSingle();


  if (gRes.error) {
    setError(gRes.error?.message ?? t("coachGroupNew.createError"));
    setBusy(false);
    return;
  }

  // ✅ head coach (obligatoire)
  const headRes = await supabase.from("coach_group_coaches").insert({
    group_id: groupIdNew,
    coach_user_id: userId,
    is_head: true,
  });

  if (headRes.error) {
    // best-effort rollback
    await supabase.from("coach_groups").delete().eq("id", groupIdNew);
    setError(headRes.error.message);
    setBusy(false);
    return;
  }

  // ✅ assistants (optionnel)
  const assistantIds = Object.keys(selectedCoaches);
  if (assistantIds.length > 0) {
    const rows = assistantIds.map((cid) => ({
      group_id: groupIdNew,
      coach_user_id: cid,
      is_head: false,
    }));
    const aRes = await supabase.from("coach_group_coaches").insert(rows);
    if (aRes.error) setError(`Groupe créé, mais erreur ajout coachs supplémentaires: ${aRes.error.message}`);
  }

  // ✅ categories (optionnel)
  if (categories.length > 0) {
    const rows = categories.map((c) => ({ group_id: groupIdNew, category: c }));
    const catRes = await supabase.from("coach_group_categories").insert(rows);
    if (catRes.error) setError(`Groupe créé, mais erreur catégories: ${catRes.error.message}`);
  }

  // ✅ players (optionnel)
  const playerIds = Object.keys(selectedPlayers);
  if (canManagePlayers && playerIds.length > 0) {
    const rows = playerIds.map((pid) => ({ group_id: groupIdNew, player_user_id: pid }));
    const pRes = await supabase.from("coach_group_players").insert(rows);
    if (pRes.error) setError(`Groupe créé, mais erreur ajout joueurs: ${pRes.error.message}`);
  }

  router.push(`/coach/groups/${groupIdNew}`);
}
  

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header section */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Créer un groupe
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <button
                type="button"
                className="cta-green cta-green-inline"
                onClick={() => router.back()}
                disabled={busy}
              >
                Retour
              </button>

              <Link className="cta-green cta-green-inline" href="/coach/groups">
                Mes groupes
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Form */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div>Chargement…</div>
            ) : clubs.length === 0 ? (
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                Aucun club trouvé pour ton compte.
              </div>
            ) : (
              <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
                {/* INFO CARD */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title">Info</div>

                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Club</span>
                      <select value={clubId} onChange={(e) => setClubId(e.target.value)} disabled={busy}>
                        {clubs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name ?? "Club"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>Nom du groupe</span>
                      <input
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        disabled={busy}
                        placeholder={t("coachGroupNew.categoryPlaceholder")}
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
                  </div>
                </div>

                {/* CATEGORIES CARD */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Tag size={18} />
                    Catégories
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                      <input
                        value={catInput}
                        onChange={(e) => setCatInput(e.target.value)}
                        disabled={busy}
                        placeholder="Ex: U12, U14, Elite, Adultes…"
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
                        disabled={busy || !catInput.trim()}
                        style={{
                          width: 44,
                          height: 42,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(255,255,255,0.70)",
                          border: "1px solid rgba(0,0,0,0.08)",
                        }}
                        aria-label={t("coachGroupNew.addCategory")}
                        title="Ajouter"
                      >
                        <PlusCircle size={18} />
                      </button>
                    </div>

                    {categories.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        Aucune catégorie ajoutée.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {categories.map((c) => (
                          <div key={c} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span className="pill-soft">{c}</span>
                            <button
                              type="button"
                              className="btn btn-danger soft"
                              onClick={() => removeCategory(c)}
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
                  </div>
                </div>

                {/* PLAYERS CARD */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={18} />
                    Joueurs
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    {!canManagePlayers ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                        Seul un manager peut ajouter/retirer des juniors du groupe.
                      </div>
                    ) : null}
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
                        value={queryPlayers}
                        onChange={(e) => setQueryPlayers(e.target.value)}
                        disabled={busy || !canManagePlayers}
                        placeholder="Rechercher un joueur (nom, handicap)…"
                        style={{ paddingLeft: 44 }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Sélection ({selectedPlayersList.length})</div>

                      {selectedPlayersList.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun joueur sélectionné.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {selectedPlayersList.map((p) => (
                            <div key={p.id} style={lightRowCardStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div style={avatarBoxStyle} aria-hidden="true">
                                  {avatarNode(p)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                    Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                                  </div>
                                </div>
                              </div>

                              {canManagePlayers ? (
                                <button
                                  type="button"
                                  className="btn btn-danger soft"
                                  onClick={() => toggleSelected(setSelectedPlayers, p)}
                                  disabled={busy}
                                  style={{ padding: "10px 12px" }}
                                  aria-label="Retirer"
                                  title="Retirer"
                                >
                                  <Trash2 size={18} />
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Ajouter depuis le club ({candidatesPlayers.length})</div>

                      {clubId && clubMembersPlayers.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun joueur actif trouvé dans ce club.
                        </div>
                      ) : candidatesPlayers.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun résultat.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {candidatesPlayers.map((p) => (
                            <div key={p.id} style={lightRowCardStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div style={avatarBoxStyle} aria-hidden="true">
                                  {avatarNode(p)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                    Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className="glass-btn"
                                onClick={() => toggleSelected(setSelectedPlayers, p)}
                                disabled={busy || !canManagePlayers}
                                style={{
                                  width: 44,
                                  height: 42,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "rgba(255,255,255,0.70)",
                                  border: "1px solid rgba(0,0,0,0.08)",
                                }}
                                aria-label="Ajouter joueur"
                                title="Ajouter"
                              >
                                <PlusCircle size={18} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* COACHES CARD */}
                <div className="glass-card" style={{ padding: 14 }}>
                  <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <User size={18} />
                    Coach
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
                      Tu es automatiquement <b>Head Coach</b>. Ajoute des coachs supplémentaires (coach/manager).
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
                        value={queryCoaches}
                        onChange={(e) => setQueryCoaches(e.target.value)}
                        disabled={busy}
                        placeholder="Rechercher un coach (nom)…"
                        style={{ paddingLeft: 44 }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Coachs supplémentaires ({selectedCoachesList.length})</div>

                      {selectedCoachesList.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun coach supplémentaire sélectionné.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {selectedCoachesList.map((p) => (
                            <div key={p.id} style={lightRowCardStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div style={avatarBoxStyle} aria-hidden="true">
                                  {avatarNode(p)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                    Coach supplémentaire
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className="btn btn-danger soft"
                                onClick={() => toggleSelected(setSelectedCoaches, p)}
                                disabled={busy}
                                style={{ padding: "10px 12px" }}
                                aria-label="Retirer coach"
                                title="Retirer"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pill-soft">Ajouter un coach ({candidatesCoaches.length})</div>

                      {clubId && clubMembersCoaches.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun coach/manager actif trouvé dans ce club.
                        </div>
                      ) : candidatesCoaches.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          Aucun résultat.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {candidatesCoaches.map((p) => (
                            <div key={p.id} style={lightRowCardStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div style={avatarBoxStyle} aria-hidden="true">
                                  {avatarNode(p)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4 }}>
                                    Ajouter comme coach
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className="glass-btn"
                                onClick={() => toggleSelected(setSelectedCoaches, p)}
                                disabled={busy}
                                style={{
                                  width: 44,
                                  height: 42,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "rgba(255,255,255,0.70)",
                                  border: "1px solid rgba(0,0,0,0.08)",
                                }}
                                aria-label="Ajouter coach"
                                title="Ajouter"
                              >
                                <PlusCircle size={18} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ACTIONS */}
                <button
                  className="cta-green cta-green-inline"
                  type="submit"
                  disabled={!canSave || busy}
                  style={{ width: "100%" }}
                >
                  {busy ? t("coachGroupNew.creating") : t("coachGroupNew.createGroup")}
                </button>

                <Link href="/coach/groups" className="btn" style={{ width: "100%", textAlign: "center" }}>
                  Annuler
                </Link>
              </form>
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
