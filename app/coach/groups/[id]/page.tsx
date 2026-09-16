"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CalendarDays, ChevronRight, PlusCircle, Save, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import CoachPlayerTransferDialog from "@/components/coach/CoachPlayerTransferDialog";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

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
type CoachMembershipPermissions = {
  role: Role;
  can_manage_assigned_groups: boolean | null;
  can_manage_assigned_group_planning: boolean | null;
  can_transfer_players_between_club_groups: boolean | null;
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
      if (!el.contains(e.target as Node)) setOpen(false);
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
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [clubRole, setClubRole] = useState<Role | null>(null);
  const [coachPermissions, setCoachPermissions] = useState({ manageGroups: false, managePlanning: false, transferPlayers: false });

  const [group, setGroup] = useState<CoachGroup | null>(null);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRow[]>([]);
  const [coaches, setCoaches] = useState<GroupCoachRow[]>([]);
  const [plannedEvents, setPlannedEvents] = useState<PlannedEventLite[]>([]);

  // editable group info
  const [groupName, setGroupName] = useState("");

  // categories
  const [newCat, setNewCat] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  // club members (for adding)
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]); // ✅ only role=coach

  async function loadClubMembers(cid: string, uid: string) {
    if (!cid) {
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
      setClubMembersCoaches([]);
      return;
    }

    const members = (mem as ClubMemberRow[] | null) ?? [];
    const uniq = (arr: string[]) => Array.from(new Set(arr)).filter(Boolean);

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

    const coachProfiles = await fetchProfiles(coachIds);
    coachProfiles.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));

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

    // access check
    const { data: linkRow, error: linkErr } = await supabase
      .from("coach_group_coaches")
      .select("id")
      .eq("group_id", groupId)
      .eq("coach_user_id", uid)
      .maybeSingle();

    if (linkErr) {
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

    const g = (gRes.data ?? null) as unknown as CoachGroup | null;
    if (!g) {
      setErr(t("coachGroupEdit.accessDeniedOrNotFound"));
      setLoading(false);
      return;
    }
    if (!linkRow) {
      const transferAccess = await supabase.from("club_members")
        .select("id")
        .eq("club_id", g.club_id).eq("user_id", uid).eq("role", "coach").eq("is_active", true)
        .eq("can_transfer_players_between_club_groups", true).maybeSingle();
      if (transferAccess.error || !transferAccess.data) {
        setErr(t("coachGroupEdit.accessDeniedOrNotFound"));
        setLoading(false);
        return;
      }
    }
    setGroup(g);
    if (g?.club_id) {
      const roleRes = await supabase
        .from("club_members")
        .select("role,can_manage_assigned_groups,can_manage_assigned_group_planning,can_transfer_players_between_club_groups")
        .eq("club_id", g.club_id)
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();
      if (!roleRes.error && roleRes.data) {
        const membership = roleRes.data as unknown as CoachMembershipPermissions;
        setClubRole(membership.role);
        setCoachPermissions({
          manageGroups: Boolean(membership.can_manage_assigned_groups),
          managePlanning: Boolean(membership.can_manage_assigned_group_planning),
          transferPlayers: Boolean(membership.can_transfer_players_between_club_groups),
        });
      } else { setClubRole(null); setCoachPermissions({ manageGroups: false, managePlanning: false, transferPlayers: false }); }
    } else {
      setClubRole(null);
    }

    if (g) {
      setGroupName(g.name ?? "");
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

    setPlayers((pRes.data ?? []) as unknown as GroupPlayerRow[]);

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

    setCoaches((cRes.data ?? []) as unknown as GroupCoachRow[]);

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

  const canManagePlayers = useMemo(() => clubRole === "manager" || coachPermissions.manageGroups, [clubRole, coachPermissions.manageGroups]);
  const canSaveInfo = useMemo(() => {
    if (busy) return false;
    if (!group) return false;
    if (!canManagePlayers) return false;
    if (groupName.trim().length < 2) return false;
    return true;
  }, [busy, group, groupName, canManagePlayers]);

  // --------- GROUP INFO ----------
  async function saveGroupInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!canSaveInfo || !group) return;

    setBusy(true);
    setErr(null);

    const session = await supabase.auth.getSession();
    const response = await fetch(`/api/coach/groups/${group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ name: groupName.trim() }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(json.error ?? "Enregistrement impossible.");
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
    if (!canManagePlayers) return;
    const v = newCat.trim();
    if (!v || savingCat || busy) return;

    setSavingCat(true);
    const session = await supabase.auth.getSession();
    const response = await fetch(`/api/coach/groups/${groupId}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ category: v }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(json.error ?? "Ajout impossible.");
      setSavingCat(false);
      return;
    }

    setNewCat("");
    await load();
    setSavingCat(false);
  }

  // ✅ FIX RLS: delete category via RPC (security definer)
  async function removeCategory(catId: string) {
    if (!canManagePlayers || !catId || busy) return;
    setBusy(true);
    setErr(null);

    const session = await supabase.auth.getSession();
    const response = await fetch(`/api/coach/groups/${groupId}?categoryId=${encodeURIComponent(catId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(json.error ?? "Suppression impossible.");
      setBusy(false);
      return;
    }

    await load();
    setBusy(false);
  }

  // --------- PLAYERS ----------
  // ✅ FIX RLS: delete player via RPC (security definer)
  async function removePlayerFromGroup(rowId: string) {
    if (!rowId || busy) return;

    setBusy(true);
    setErr(null);

    const session = await supabase.auth.getSession();
    const response = await fetch(`/api/coach/groups/${groupId}/players/${rowId}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErr(json.error ?? "Impossible de retirer ce junior.");
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

  const canPlan = clubRole === "manager" || coachPermissions.managePlanning;
  return (
    <main className={styles.page}>
      <nav className={actionStyles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><ChevronRight size={13} aria-hidden="true" /><Link href="/coach/groups">Mes groupes</Link><ChevronRight size={13} aria-hidden="true" /><span>{group?.name ?? "Groupe"}</span></nav>
      <div className={styles.topline}>
        <div><h1>{group?.name ?? "Groupe"}</h1><p className={styles.lead}>Consultez la composition, l’encadrement et la planification du groupe.</p></div>
        <div className={actionStyles.topActions}><Link className={actionStyles.secondaryButton} href="/coach/groups">Retour aux groupes</Link>{group ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning`}><CalendarDays size={16} aria-hidden="true" />Planification</Link> : null}</div>
      </div>
      {err ? <div className={actionStyles.errorAlert} role="alert">{err}</div> : null}
      {loading ? <section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section> : !group ? <section className={styles.quickPanel}>{t("coachGroupEdit.accessDeniedOrNotFound")}</section> : <>
        <form className={styles.quickPanel} onSubmit={saveGroupInfo}>
          <div className={styles.sectionHeading}><div><h2>Informations du groupe</h2><p>{canManagePlayers ? "Modifiez les informations opérationnelles autorisées." : "Informations générales du groupe."}</p></div></div>
          <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">Nom du groupe</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} disabled={busy || !canManagePlayers} /></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">Statut</span><input value={group.is_active ? "Actif" : "Inactif"} disabled /></label></div>
          {canManagePlayers ? <div className="user-mgmt-card-actions"><button className={actionStyles.primaryButton} type="submit" disabled={!canSaveInfo}><Save size={16} aria-hidden="true" />{busy ? "Enregistrement…" : "Enregistrer les modifications"}</button></div> : null}
        </form>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>Catégories</h2><p>Catégories utilisées pour structurer ce groupe.</p></div></div>
          {canManagePlayers ? <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10 }}><input value={newCat} onChange={(event) => setNewCat(event.target.value)} disabled={busy} placeholder={t("coachGroupEdit.addCategoryPlaceholder")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCategory(); } }} /><button type="button" className={actionStyles.secondaryButton} onClick={() => void addCategory()} disabled={busy || savingCat || !canAddCat} aria-label="Ajouter une catégorie" title="Ajouter" style={{ width: 44, padding: 0 }}><PlusCircle size={18} aria-hidden="true" /></button></div> : null}
          {cats.length === 0 ? <p className="user-mgmt-empty-state">Aucune catégorie ajoutée.</p> : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{cats.map((category) => <div key={category.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="pill-soft">{category.category}</span>{canManagePlayers ? <button type="button" className={`${actionStyles.dangerButton} coach-group-compact-action`} onClick={() => void removeCategory(category.id)} disabled={busy} aria-label={`Supprimer ${category.category}`} title="Supprimer"><Trash2 size={15} aria-hidden="true" /></button> : null}</div>)}</div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>Juniors</h2><p>{players.length} junior{players.length > 1 ? "s" : ""} associé{players.length > 1 ? "s" : ""} à ce groupe.</p></div></div>
          {players.length === 0 ? <p className="user-mgmt-empty-state">Aucun junior dans ce groupe.</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list"><thead><tr><th aria-label="Avatar" /><th>Nom et prénom</th><th>Handicap</th><th aria-label="Actions" /></tr></thead><tbody>{players.slice().sort((a, b) => fullName(a.profiles).localeCompare(fullName(b.profiles), "fr")).map((row) => { const profile = row.profiles ?? null; return <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(profile)}</span></td><td><b>{fullName(profile)}</b></td><td>{typeof profile?.handicap === "number" ? profile.handicap.toFixed(1) : "—"}</td><td><div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={`/coach/players/${row.player_user_id}?returnTo=${encodeURIComponent(`/coach/groups/${groupId}`)}`}>Consulter</Link>{coachPermissions.transferPlayers ? <CoachPlayerTransferDialog playerId={row.player_user_id} playerName={fullName(profile)} sourceGroupId={groupId} onTransferred={() => void load()} /> : null}{canManagePlayers ? <button type="button" className={actionStyles.dangerButton} onClick={() => void removePlayerFromGroup(row.id)} disabled={busy} aria-label={`Retirer ${fullName(profile)}`} title="Retirer"><Trash2 size={16} aria-hidden="true" /></button> : null}</div></td></tr>; })}</tbody></table></div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>Équipe encadrante</h2><p>Coachs associés à ce groupe et rôle dans l’encadrement.</p></div></div>
          {clubRole === "manager" ? <SearchSelect label="Ajouter un coach" placeholder="Tapez un nom…" items={coachCandidates} disabled={busy} itemSubtitle={() => "Coach"} onSelect={addCoachToGroup} /> : null}
          {coaches.length === 0 ? <p className="user-mgmt-empty-state">Aucun coach associé.</p> : <div className="user-mgmt-table-wrap"><table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list"><thead><tr><th aria-label="Avatar" /><th>Coach</th><th>Rôle</th><th aria-label="Actions" /></tr></thead><tbody>{coaches.map((row) => <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td><span className="pill-soft">{row.is_head ? t("trainingNew.headCoach") : t("trainingNew.extraCoach")}</span></td><td>{clubRole === "manager" && !row.is_head ? <button type="button" className={actionStyles.dangerButton} onClick={() => void removeCoachFromGroup(row)} disabled={busy} aria-label={`Retirer ${fullName(row.profiles)}`} title="Retirer"><Trash2 size={16} aria-hidden="true" /></button> : null}</td></tr>)}</tbody></table></div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>Planification</h2><p>Consultez les activités planifiées pour ce groupe.</p></div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><span className="pill-soft">À venir : {planningSummary.upcomingCount}</span><span className="pill-soft">Planifiées : {planningSummary.totalScheduled}</span><span className="pill-soft">Récurrentes : {planningSummary.recurringCount}</span></div>
          <p className="user-mgmt-empty-state" style={{ margin: 0 }}>{planningSummary.nextStartsAt ? `Prochaine activité : ${new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(planningSummary.nextStartsAt))}` : t("coachGroupEdit.noUpcomingTraining")}</p>
          <div className="user-mgmt-card-actions"><Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning`}><CalendarDays size={16} aria-hidden="true" />{canPlan ? "Gérer la planification" : "Voir la planification"}</Link></div>
        </section>
      </>}
    </main>
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
