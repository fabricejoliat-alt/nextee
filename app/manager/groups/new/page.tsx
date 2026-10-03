"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { managerGroupFeedback, managerGroupFormat } from "@/lib/managerGroupPresentation";
import { managerLocaleTag } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
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
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSeasonId = searchParams.get("season") ?? "";
  const organizationId = String(searchParams.get("organizationId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useRef(false);
  const progress = useRef<{ id: string; headAdded: boolean; assistantsAdded: boolean; categoriesAdded: boolean; players: Set<string> } | null>(null);
  const [createdGroupId, setCreatedGroupId] = useState("");
  const [headCoachId, setHeadCoachId] = useState("");
  const [clubLoading, setClubLoading] = useState(false);
  const [userId, setUserId] = useState("");

  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string>("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string>(requestedSeasonId);

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
    try {
    setLoading(true);
    setError(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError("manager.profile.invalidSession");
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
      setError(clubsJson?.error ?? t("manager.administration.clubsError"));
      setLoading(false);
      return;
    }

    const list = (Array.isArray(clubsJson?.clubs) ? clubsJson.clubs : [])
      .map((c: ClubResponseItem) => ({ id: String(c?.id ?? ""), name: c?.name ?? null }))
      .filter((c: Club) => Boolean(c.id));

    if (list.length === 0) {
      setError("manager.groups.noClub");
      setClubs([]);
      setClubId("");
      setLoading(false);
      return;
    }

    const filteredList = organizationId ? list.filter((c) => c.id === organizationId) : list;
    if (organizationId && filteredList.length === 0) {
      setError("manager.groups.clubForbidden");
      setClubs([]);
      setClubId("");
      setLoading(false);
      return;
    }

    setClubs(filteredList);
    setClubId((prev) => prev || filteredList[0]?.id || "");

    setLoading(false);

    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
    } finally { setLoading(false); }
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
      throw memErr;
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
        throw error;
      }
      return (data ?? []) as ProfileLite[];
    }

    const [playerProfiles, coachProfiles] = await Promise.all([fetchProfiles(playerIds), fetchProfiles(coachIds)]);

    playerProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));

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
      throw groupsError;
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
      throw categoriesError;
    }

    setExistingCategories(
      Array.from(
        new Set(
          (categoriesData ?? [])
            .map((row) => String(row.category ?? "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, managerLocaleTag(locale)))
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    (async () => {
      setClubLoading(true);
      setSelectedPlayers({});
      setSelectedCoaches({});
      setHeadCoachId("");
      setError(null);
      try {
      if (clubId) {
        const { data, error: seasonError } = await supabase
          .from("club_seasons")
          .select("id,name,starts_on,ends_on,is_current")
          .eq("club_id", clubId)
          .order("starts_on", { ascending: true });
        if (seasonError) throw seasonError;
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
      } catch (cause) {
        setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.loadError");
      } finally { setClubLoading(false); }
    })();
    // Changing interface language must not reload membership or clear this draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const canSave = useMemo(() => {
    if (busy || clubLoading) return false;
    if (!userId) return false;
    if (!clubId) return false;
    if (groupName.trim().length < 2) return false;
    if (Object.keys(selectedCoaches).length < 1 || !selectedCoaches[headCoachId]) return false;
    return true;
  }, [busy, clubLoading, userId, clubId, groupName, selectedCoaches, headCoachId]);

  function addCategory() {
    const v = catInput.trim();
    if (!v) return;
    const exists = categories.some((c) => c.toLowerCase() === v.toLowerCase());
    if (exists) {
      setCatInput("");
      return;
    }
    setCategories((prev) => [...prev, v].sort((a, b) => a.localeCompare(b, managerLocaleTag(locale))));
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
    setCategories((prev) => [...prev, v].sort((a, b) => a.localeCompare(b, managerLocaleTag(locale))));
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

  function toggleCoach(person: ProfileLite) {
    const next = { ...selectedCoaches };
    if (next[person.id]) delete next[person.id];
    else next[person.id] = person;
    setSelectedCoaches(next);
    if (!next[headCoachId]) setHeadCoachId(Object.keys(next)[0] ?? "");
  }

  const selectedPlayersList = useMemo(
    () => Object.values(selectedPlayers).sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [selectedPlayers, locale]
  );

  const selectedCoachesList = useMemo(
    () => Object.values(selectedCoaches).sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [selectedCoaches, locale]
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
  if (!canSave || pending.current) return;
  pending.current = true;
  setBusy(true);
  setError(null);
  try {
    // Once the group is acknowledged, the draft is locked and retries only finish missing steps.
    if (!progress.current) {
      const pre = await supabase.from("club_members").select("role,is_active")
        .eq("user_id", userId).eq("club_id", clubId).maybeSingle();
      if (pre.error) throw pre.error;
      const role = String(pre.data?.role ?? "");
      if (!pre.data?.is_active || (role !== "coach" && role !== "manager")) {
        throw new Error("manager.groups.insufficientRights");
      }
      const id = crypto.randomUUID();
      const result = await supabase.from("coach_groups").insert({
        id, club_id: clubId, club_season_id: seasonId || null,
        name: groupName.trim(), is_active: isActive, head_coach_user_id: headCoachId,
      });
      if (result.error) throw result.error;
      progress.current = { id, headAdded: false, assistantsAdded: false, categoriesAdded: false, players: new Set() };
      setCreatedGroupId(id);
    }
    const step = progress.current;
    if (!step.headAdded) {
      const result = await supabase.from("coach_group_coaches").insert({ group_id: step.id, coach_user_id: headCoachId, is_head: true });
      if (result.error) throw result.error;
      step.headAdded = true;
    }
    if (!step.assistantsAdded) {
      const rows = selectedCoachesList.filter(person => person.id !== headCoachId).map(person => ({ group_id: step.id, coach_user_id: person.id, is_head: false }));
      if (rows.length) {
        const result = await supabase.from("coach_group_coaches").insert(rows);
        if (result.error) throw result.error;
      }
      step.assistantsAdded = true;
    }
    if (!step.categoriesAdded) {
      if (categories.length) {
        const result = await supabase.from("coach_group_categories").insert(categories.map(category => ({ group_id: step.id, category })));
        if (result.error) throw result.error;
      }
      step.categoriesAdded = true;
    }
    const authorization = await authHeader();
    for (const person of selectedPlayersList) {
      if (step.players.has(person.id)) continue;
      const response = await fetch(`/api/admin/organizations/${clubId}/group-assignments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authorization },
        body: JSON.stringify({ actorType: "player", userId: person.id, toGroupId: step.id, seasonId: seasonId || undefined }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error ?? "manager.administration.actionError");
      }
      step.players.add(person.id);
    }
    router.push(`/manager/groups/${step.id}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`);
  } catch (cause) {
    setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "manager.groups.createError");
  } finally {
    pending.current = false;
    setBusy(false);
  }
}


  return (
    <main className={`${styles.page} ${groupStyles.page}`}>
      <nav aria-label={t("manager.content.breadcrumb")} style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">{t("manager.content.groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{t("manager.groups.new")}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{t("manager.groups.new")}</h1>
          <p className={styles.lead}>{t("manager.groups.newLead")}</p>
        </div>
        <div className={actionStyles.topActions}>
          <label className="groups-season-nav-select">
            <select
              aria-label={t("manager.season")}
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
              disabled={busy || clubLoading || Boolean(createdGroupId) || seasons.length === 0}
            >
              {seasons.length === 0 ? <option value="">{t("manager.noSeason")}</option> : null}
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}{season.is_current ? t("manager.groups.currentSeason") : ""}
                </option>
              ))}
            </select>
          </label>
          <Link
            className={actionStyles.backButton}
            href={organizationId ? `/manager/organizations/${organizationId}/groups` : "/manager/groups"}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("manager.groups.back")} </Link>
        </div>
      </div>

      {createdGroupId ? <div className={groupStyles.partial} role="status">
        <p>{t("manager.groups.partialCreation")}</p>
        <Link className={actionStyles.secondaryButton} href={`/manager/groups/${createdGroupId}${seasonId ? `?season=${encodeURIComponent(seasonId)}` : ""}`}>{t("manager.groups.openGroup")}</Link>
      </div> : null}
      {error && (
        <div className={actionStyles.errorAlert} role="alert">
          {managerGroupFeedback(t, error)}
        </div>
      )}

      {loading ? (
        <section className={styles.quickPanel}>
          <CompactLoadingBlock label={t("common.loading")} />
        </section>
      ) : clubs.length === 0 ? (
        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.60)" }}>
          {t("manager.groups.noClub")} </div>
      ) : (
        <form onSubmit={handleCreate} style={{ display: "grid", gap: 18 }}>
          <fieldset className={groupStyles.draft} disabled={busy || clubLoading || Boolean(createdGroupId)}>
          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>{t("manager.groups.info")}</h2>
                <p>{t("manager.groups.infoHelp")}</p>
              </div>
            </div>

            <div className="user-mgmt-form-grid">
              {clubs.length > 1 ? <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.groups.club")}</span><select value={clubId} onChange={e => { setClubId(e.target.value); setClubLoading(true); }} disabled={Boolean(organizationId)}>{clubs.map(club => <option key={club.id} value={club.id}>{club.name ?? "—"}</option>)}</select></label> : null}
                    <label className="user-mgmt-field">
                      <span className="user-mgmt-field-label">{t("coach.group.name")} <span aria-hidden="true">*</span></span>
                      <input
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        disabled={busy}
                        placeholder={t("manager.groups.namePlaceholder")}
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
                      <span>{t("manager.groups.active")}</span>
                    </label>
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>{t("coach.group.categories")}</h2>
                <p>{t("manager.groups.categoryHelp")}</p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                <input
                  value={catInput}
                  onChange={(e) => setCatInput(e.target.value)}
                  disabled={busy}
                  placeholder={t("manager.groups.categoryPlaceholder")}
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
                  aria-label={t("coach.group.addCategory")}
                  title={t("common.add")}
                  style={{ width: 44, padding: 0, justifyContent: "center" }}
                >
                  <PlusCircle size={18} />
                </button>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#6d786e", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {t("manager.groups.usedCategories")} </div>
                {existingCategories.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.groups.noExistingCategories")} </div>
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
                          title={alreadySelected ? t("manager.groups.alreadySelected") : t("manager.groups.addThisCategory")}
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
                  {t("manager.groups.noCategories")} </div>
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
                        aria-label={managerGroupFormat(t, "removeNamed", { name: c })}
                        title={t("manager.content.delete")}
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
                <h2>{t("manager.fields.player")}</h2>
                <p>{t("manager.groups.juniorHelp")}</p>
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
                  placeholder={t("manager.groups.juniorSearch")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{managerGroupFormat(t, "selectedJuniors", { count: selectedPlayersList.length.toLocaleString(managerLocaleTag(locale)) })}</div>

                {selectedPlayersList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.groups.noSelectedJuniors")} </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label={t("manager.groups.avatar")} />
                          <th>{t("manager.administration.fullName")}</th>
                          <th aria-label={t("manager.content.actions")} />
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
                                aria-label={managerGroupFormat(t, "removeNamed", { name: fullName(p) })}
                                title={t("manager.content.remove")}
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
                <div className="pill-soft">{managerGroupFormat(t, "juniorCandidates", { count: candidatesPlayers.length.toLocaleString(managerLocaleTag(locale)) })}</div>

                {clubId && clubMembersPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.groups.noActiveJuniors")} </div>
                ) : candidatesPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("coach.picker.empty")} </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label={t("manager.groups.avatar")} />
                          <th>{t("manager.administration.fullName")}</th>
                          <th aria-label={t("manager.content.actions")} />
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
                                aria-label={managerGroupFormat(t, "addNamed", { name: fullName(p) })}
                                title={t("common.add")}
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
                <h2>{t("manager.fields.coach")}</h2>
                <p>{t("manager.groups.coachHelp")}</p>
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
                  placeholder={t("manager.groups.coachSearch")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.groups.headCoach")}</span><select value={headCoachId} onChange={e => setHeadCoachId(e.target.value)} disabled={!selectedCoachesList.length} required><option value="">{t("manager.groups.headRequired")}</option>{selectedCoachesList.map(person => <option key={person.id} value={person.id}>{fullName(person)}</option>)}</select></label>
              <div className="pill-soft">{managerGroupFormat(t, "selectedCoaches", { count: selectedCoachesList.length.toLocaleString(managerLocaleTag(locale)) })}</div>

                {selectedCoachesList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.groups.noSelectedCoaches")} </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label={t("manager.groups.avatar")} />
                          <th>{t("manager.administration.fullName")}</th>
                          <th aria-label={t("manager.content.actions")} />
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
                                onClick={() => toggleCoach(p)}
                                disabled={busy}
                                aria-label={managerGroupFormat(t, "removeNamed", { name: fullName(p) })}
                                title={t("manager.content.remove")}
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
                <div className="pill-soft">{managerGroupFormat(t, "coachCandidates", { count: candidatesCoaches.length.toLocaleString(managerLocaleTag(locale)) })}</div>

                {clubId && clubMembersCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.groups.noActiveCoaches")} </div>
                ) : candidatesCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("coach.picker.empty")} </div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--staff user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead>
                        <tr>
                          <th aria-label={t("manager.groups.avatar")} />
                          <th>{t("manager.administration.fullName")}</th>
                          <th aria-label={t("manager.content.actions")} />
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
                                onClick={() => toggleCoach(p)}
                                disabled={busy}
                                aria-label={managerGroupFormat(t, "addNamed", { name: fullName(p) })}
                                title={t("common.add")}
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

          </fieldset>
          <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <Link
              href={organizationId ? `/manager/organizations/${organizationId}/groups` : "/manager/groups"}
              className={actionStyles.secondaryButton}
            >
              {t("manager.cancel")} </Link>
            <button className={actionStyles.primaryButton} type="submit" disabled={!canSave || busy}>
              {busy ? <RefreshCw size={16} className={styles.spin} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {busy ? t("manager.settings.seasons.creating") : createdGroupId ? t("manager.groups.resumeCreation") : t("manager.groups.create")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
