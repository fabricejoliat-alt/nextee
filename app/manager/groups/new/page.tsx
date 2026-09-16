"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { ArrowLeft, PlusCircle, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";



type Role = "coach" | "manager" | "player";

type Club = { id: string; name: string | null };
type ClubResponseItem = { id?: string | null; name?: string | null };
type Season = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean };

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
  const searchParams = useSearchParams();
  const organizationId = String(searchParams.get("organizationId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string>("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string>("");

  const [groupName, setGroupName] = useState("");
  const [isActive, setIsActive] = useState(true);

  // categories
  const [catInput, setCatInput] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);

  // club members split by role
  const [clubMembersPlayers, setClubMembersPlayers] = useState<ProfileLite[]>([]);
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]);

  // players selection
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});

  // assistants selection
  const [queryCoaches, setQueryCoaches] = useState("");
  const [selectedCoaches, setSelectedCoaches] = useState<Record<string, ProfileLite>>({});

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

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

    const headers = await authHeader();
    const clubsRes = await fetch("/api/manager/my-clubs", {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const clubsJson = await clubsRes.json().catch(() => ({}));
    if (!clubsRes.ok) {
      setError(clubsJson?.error ?? "Impossible de charger les clubs manager.");
      setLoading(false);
      return;
    }

    const list = (Array.isArray(clubsJson?.clubs) ? clubsJson.clubs : [])
      .map((c: ClubResponseItem) => ({ id: String(c?.id ?? ""), name: c?.name ?? null }))
      .filter((c: Club) => Boolean(c.id));

    if (list.length === 0) {
      setError(t("coachGroupNew.noClubPermission"));
      setClubs([]);
      setClubId("");
      setLoading(false);
      return;
    }

    const filteredList = organizationId ? list.filter((c) => c.id === organizationId) : list;
    if (organizationId && filteredList.length === 0) {
      setError("Organisation introuvable ou non autorisée.");
      setClubs([]);
      setClubId("");
      setLoading(false);
      return;
    }

    setClubs(filteredList);
    setClubId((prev) => prev || filteredList[0]?.id || "");

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

  async function loadExistingCategories(cid: string) {
    if (!cid) {
      setExistingCategories([]);
      return;
    }

    const { data: groupsData, error: groupsError } = await supabase
      .from("coach_groups")
      .select("id")
      .eq("club_id", cid);

    if (groupsError) {
      console.error(groupsError);
      setExistingCategories([]);
      return;
    }

    const groupIds = (groupsData ?? []).map((group) => String(group.id)).filter(Boolean);
    if (!groupIds.length) {
      setExistingCategories([]);
      return;
    }

    const { data: categoriesData, error: categoriesError } = await supabase
      .from("coach_group_categories")
      .select("category,group_id")
      .in("group_id", groupIds);

    if (categoriesError) {
      console.error(categoriesError);
      setExistingCategories([]);
      return;
    }

    setExistingCategories(
      Array.from(
        new Set(
          (categoriesData ?? [])
            .map((row) => String(row.category ?? "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "fr"))
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    (async () => {
      if (clubId) {
        const { data } = await supabase
          .from("club_seasons")
          .select("id,name,starts_on,ends_on,is_current")
          .eq("club_id", clubId)
          .order("starts_on", { ascending: true });
        const nextSeasons = (data ?? []) as Season[];
        setSeasons(nextSeasons);
        setSeasonId((current) => nextSeasons.some((season) => season.id === current)
          ? current
          : nextSeasons.find((season) => season.is_current)?.id ?? nextSeasons[0]?.id ?? "");
      } else {
        setSeasons([]);
        setSeasonId("");
      }
      await Promise.all([loadClubMembers(clubId), loadExistingCategories(clubId)]);
      setQueryPlayers("");
      setQueryCoaches("");
      setSelectedPlayers({});
      setSelectedCoaches({});
    })();
  }, [clubId]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (!userId) return false;
    if (!clubId) return false;
    if (groupName.trim().length < 2) return false;
    if (Object.keys(selectedCoaches).length < 1) return false;
    return true;
  }, [busy, userId, clubId, groupName, selectedCoaches]);

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

  function addExistingCategory(value: string) {
    const v = value.trim();
    if (!v) return;
    const exists = categories.some((c) => c.toLowerCase() === v.toLowerCase());
    if (exists) return;
    setCategories((prev) => [...prev, v].sort((a, b) => a.localeCompare(b, "fr")));
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

  const selectedCoachIds = selectedCoachesList.map((p) => p.id);
  const selectedPlayerIds = selectedPlayersList.map((p) => p.id);
  const headCoachId = selectedCoachIds[0] ?? "";
  if (!headCoachId) {
    setError("Sélectionne au moins un coach.");
    setBusy(false);
    return;
  }

  // ✅ Pré-check droits sur le club sélectionné
  const pre = await supabase
    .from("club_members")
    .select("role,is_active")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .maybeSingle();

 

  const role = String(pre.data?.role ?? "");
  if (!pre.data?.is_active || (role !== "coach" && role !== "manager")) {
    setError(`Droits insuffisants sur le club sélectionné (${role || "—"}).`);
    setBusy(false);
    return;
  }

  // ✅ IMPORTANT: pas de .select().single() (RETURNING) car ta policy SELECT bloque avant l'ajout du head coach
  const groupIdNew = crypto.randomUUID();

  const gRes = await supabase.from("coach_groups").insert({
    id: groupIdNew,
    club_id: clubId,
    club_season_id: seasonId || null,
    name: groupName.trim(),
    is_active: isActive,
    head_coach_user_id: headCoachId,
  });


  if (gRes.error) {
    setError(gRes.error?.message ?? t("coachGroupNew.createError"));
    setBusy(false);
    return;
  }

  // ✅ head coach (obligatoire)
  const headRes = await supabase.from("coach_group_coaches").insert({
    group_id: groupIdNew,
    coach_user_id: headCoachId,
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
  const assistantIds = selectedCoachIds.filter((id) => id !== headCoachId);
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
  if (selectedPlayerIds.length > 0) {
    const authorization = await authHeader();
    const playerResults = await Promise.all(selectedPlayerIds.map((playerId) => fetch(`/api/admin/organizations/${clubId}/group-assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authorization },
      body: JSON.stringify({ actorType: "player", userId: playerId, toGroupId: groupIdNew, seasonId: seasonId || undefined }),
    })));
    const failedPlayer = playerResults.find((response) => !response.ok);
    if (failedPlayer) {
      const payload = await failedPlayer.json().catch(() => ({}));
      setError(`Groupe créé, mais erreur ajout joueurs: ${payload.error ?? "Action impossible."}`);
    }
  }

  router.push(`/manager/groups/${groupIdNew}`);
}
  

  return (
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">Groupes</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>Nouveau groupe</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>Nouveau groupe</h1>
          <p className={styles.lead}>Composez le groupe, ses catégories, ses juniors et son encadrement.</p>
        </div>
        <div className={actionStyles.topActions}>
          <label className="groups-season-nav-select">
            <select
              aria-label="Saison"
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
              disabled={seasons.length === 0}
            >
              {seasons.length === 0 ? <option value="">Aucune saison configurée</option> : null}
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}{season.is_current ? " · Saison en cours" : ""}
                </option>
              ))}
            </select>
          </label>
          <Link
            className={actionStyles.backButton}
            href={organizationId ? `/manager/organizations/${organizationId}/groups` : "/manager/groups"}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Retour aux groupes
          </Link>
        </div>
      </div>

      {error && (
        <div className={actionStyles.errorAlert} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <section className={styles.quickPanel}>
          <CompactLoadingBlock label="Chargement..." />
        </section>
      ) : clubs.length === 0 ? (
        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
          Aucun club trouvé pour ton compte.
        </div>
      ) : (
        <form onSubmit={handleCreate} style={{ display: "grid", gap: 18 }}>
          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Informations du groupe</h2>
                <p>Prépare le cadre du groupe.</p>
              </div>
            </div>

            <div className="user-mgmt-form-grid">
                    <label className="user-mgmt-field">
                      <span className="user-mgmt-field-label">Nom du groupe <span aria-hidden="true">*</span></span>
                      <input
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        disabled={busy}
                        placeholder={t("coachGroupNew.categoryPlaceholder")}
                        required
                      />
                    </label>

                    <label className="user-mgmt-checkbox-label" style={{ gridColumn: "1 / -1" }}>
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        disabled={busy}
                      />
                      <span>Groupe actif</span>
                    </label>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Catégories</h2>
                <p>Les catégories servent à structurer le groupe.</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
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
                  className={actionStyles.secondaryButton}
                  onClick={addCategory}
                  disabled={busy || !catInput.trim()}
                  aria-label={t("coachGroupNew.addCategory")}
                  title="Ajouter"
                  style={{ width: 44, padding: 0, justifyContent: "center" }}
                >
                  <PlusCircle size={18} />
                </button>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#6d786e", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Catégories déjà utilisées
                </div>
                {existingCategories.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucune catégorie existante dans ce club.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {existingCategories.map((value) => {
                      const alreadySelected = categories.some((category) => category.toLowerCase() === value.toLowerCase());
                      return (
                        <button
                          key={value}
                          type="button"
                          className="pill-soft"
                          onClick={() => addExistingCategory(value)}
                          disabled={busy || alreadySelected}
                          title={alreadySelected ? "Déjà sélectionnée" : "Ajouter cette catégorie"}
                          style={{
                            border: 0,
                            cursor: alreadySelected ? "default" : "pointer",
                            opacity: alreadySelected ? 0.65 : 1,
                          }}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                )}
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
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Juniors</h2>
                <p>Optionnel à la création. Tu peux aussi ajouter les juniors plus tard.</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
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
                  disabled={busy}
                  placeholder="Rechercher un junior (nom, handicap)…"
                  style={{ paddingLeft: 44 }}
                />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Junior(s) sélectionné(s) ({selectedPlayersList.length})</div>

                {selectedPlayersList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun junior sélectionné.
                  </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label="Avatar" />
                          <th>Nom et prénom</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPlayersList.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="user-mgmt-member-avatar" aria-hidden="true">
                                {avatarNode(p)}
                              </span>
                            </td>
                            <td>
                              <b>{fullName(p)}</b>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-danger soft"
                                onClick={() => toggleSelected(setSelectedPlayers, p)}
                                disabled={busy}
                                aria-label="Retirer"
                                title="Retirer"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Ajouter un junior ({candidatesPlayers.length})</div>

                {clubId && clubMembersPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun junior actif trouvé dans ce club.
                  </div>
                ) : candidatesPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun résultat.
                  </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label="Avatar" />
                          <th>Nom et prénom</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {candidatesPlayers.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="user-mgmt-member-avatar" aria-hidden="true">
                                {avatarNode(p)}
                              </span>
                            </td>
                            <td>
                              <b>{fullName(p)}</b>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={actionStyles.secondaryButton}
                                onClick={() => toggleSelected(setSelectedPlayers, p)}
                                disabled={busy}
                                aria-label="Ajouter junior"
                                title="Ajouter"
                                style={{ width: 44, padding: 0, justifyContent: "center" }}
                              >
                                <PlusCircle size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Coachs</h2>
                <p>Sélectionne au moins un coach. Le premier devient Head Coach.</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
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
                <div className="pill-soft">Coach(s) sélectionné(s) ({selectedCoachesList.length})</div>

                {selectedCoachesList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun coach supplémentaire sélectionné.
                  </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label="Avatar" />
                          <th>Nom et prénom</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCoachesList.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="user-mgmt-member-avatar" aria-hidden="true">
                                {avatarNode(p)}
                              </span>
                            </td>
                            <td>
                              <b>{fullName(p)}</b>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-danger soft"
                                onClick={() => toggleSelected(setSelectedCoaches, p)}
                                disabled={busy}
                                aria-label="Retirer coach"
                                title="Retirer"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">Ajouter un coach ({candidatesCoaches.length})</div>

                {clubId && clubMembersCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun coach actif trouvé dans ce club.
                  </div>
                ) : candidatesCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    Aucun résultat.
                  </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label="Avatar" />
                          <th>Nom et prénom</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {candidatesCoaches.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="user-mgmt-member-avatar" aria-hidden="true">
                                {avatarNode(p)}
                              </span>
                            </td>
                            <td>
                              <b>{fullName(p)}</b>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={actionStyles.secondaryButton}
                                onClick={() => toggleSelected(setSelectedCoaches, p)}
                                disabled={busy}
                                aria-label="Ajouter coach"
                                title="Ajouter"
                                style={{ width: 44, padding: 0, justifyContent: "center" }}
                              >
                                <PlusCircle size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <Link
              href={organizationId ? `/manager/organizations/${organizationId}/groups` : "/manager/groups"}
              className={actionStyles.secondaryButton}
            >
              Annuler
            </Link>
            <button className={actionStyles.primaryButton} type="submit" disabled={!canSave || busy}>
              {busy ? <RefreshCw size={16} className={styles.spin} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {busy ? t("coachGroupNew.creating") : t("coachGroupNew.createGroup")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
