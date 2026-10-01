"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CalendarDays, ChevronRight, PlusCircle, Save, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import CoachMemberPicker from "@/components/coach/CoachMemberPicker";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey, coachUiErrorKey } from "@/lib/coachUiErrors";
import CoachPlayerTransferDialog from "@/components/coach/CoachPlayerTransferDialog";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import detailStyles from "./CoachGroupDetail.module.css";

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

export default function CoachGroupEditPage() {
  const { locale, t } = useI18n();
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [clubRole, setClubRole] = useState<Role | null>(null);
  const [coachPermissions, setCoachPermissions] = useState({ manageGroups: false, managePlanning: false, transferPlayers: false });
  const [group, setGroup] = useState<CoachGroup | null>(null);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRow[]>([]);
  const [coaches, setCoaches] = useState<GroupCoachRow[]>([]);
  const [plannedEvents, setPlannedEvents] = useState<PlannedEventLite[]>([]);
  const [groupName, setGroupName] = useState("");
  const [newCat, setNewCat] = useState("");
  const [clubMembersCoaches, setClubMembersCoaches] = useState<ProfileLite[]>([]);
  const loadVersion = useRef(0);
  const scopeVersion = useRef(0);
  const mutationInFlight = useRef(false);
  const nameEdited = useRef(false);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setErr(null);
    try {
      const auth = await supabase.auth.getUser();
      const uid = auth.data.user?.id;
      if (auth.error || !uid) throw new Error("coach.error.session");
      const [linkRes, gRes] = await Promise.all([
        supabase.from("coach_group_coaches").select("id").eq("group_id", groupId).eq("coach_user_id", uid).maybeSingle(),
        supabase.from("coach_groups").select("id,created_at,club_id,name,is_active,head_coach_user_id,clubs:clubs ( id, name )").eq("id", groupId).maybeSingle(),
      ]);
      if (linkRes.error || gRes.error) throw new Error("coach.error.load");
      const g = gRes.data as unknown as CoachGroup | null;
      if (!g) throw new Error("coach.error.groupAccess");
      const roleRes = await supabase.from("club_members")
        .select("role,can_manage_assigned_groups,can_manage_assigned_group_planning,can_transfer_players_between_club_groups")
        .eq("club_id", g.club_id).eq("user_id", uid).eq("is_active", true).maybeSingle();
      if (roleRes.error) throw new Error("coach.error.load");
      const membership = roleRes.data as unknown as CoachMembershipPermissions | null;
      if (!membership || (!linkRes.data && !(membership.role === "coach" && membership.can_transfer_players_between_club_groups))) {
        throw new Error("coach.error.groupAccess");
      }
      const [catRes, pRes, cRes, evRes] = await Promise.all([
        supabase.from("coach_group_categories").select("id,group_id,category").eq("group_id", groupId).order("category", { ascending: true }),
        supabase.from("coach_group_players").select("id,group_id,player_user_id,profiles:profiles ( id, first_name, last_name, handicap, avatar_url )").eq("group_id", groupId),
        supabase.from("coach_group_coaches").select("id,group_id,coach_user_id,is_head,profiles:profiles ( id, first_name, last_name, handicap, avatar_url )").eq("group_id", groupId).order("is_head", { ascending: false }),
        supabase.from("club_events").select("id,starts_at,status,series_id").eq("group_id", groupId).order("starts_at", { ascending: true }),
      ]);
      // Never turn an incomplete read into a misleading empty group or zero activity count.
      if (catRes.error || pRes.error || cRes.error || evRes.error) throw new Error("coach.error.load");
      let candidateCoaches: ProfileLite[] = [];
      if (membership.role === "manager") {
        const members = await supabase.from("club_members").select("club_id,user_id,is_active,role").eq("club_id", g.club_id).eq("is_active", true);
        if (members.error) throw new Error("coach.error.load");
        const ids = [...new Set(((members.data ?? []) as ClubMemberRow[]).filter((row) => row.role === "coach").map((row) => row.user_id))];
        if (ids.length) {
          const profiles = await supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").in("id", ids);
          if (profiles.error) throw new Error("coach.error.load");
          candidateCoaches = ((profiles.data ?? []) as ProfileLite[]).filter((profile) => profile.id !== uid);
        }
      }
      if (version !== loadVersion.current) return false;
      setGroup(g);
      if (!nameEdited.current) setGroupName(g.name ?? "");
      setClubRole(membership.role);
      setCoachPermissions({
        manageGroups: Boolean(membership.can_manage_assigned_groups),
        managePlanning: Boolean(membership.can_manage_assigned_group_planning),
        transferPlayers: Boolean(membership.can_transfer_players_between_club_groups),
      });
      setCats((catRes.data ?? []) as CategoryRow[]);
      setPlayers((pRes.data ?? []) as unknown as GroupPlayerRow[]);
      setCoaches((cRes.data ?? []) as unknown as GroupCoachRow[]);
      setPlannedEvents((evRes.data ?? []) as PlannedEventLite[]);
      setClubMembersCoaches(candidateCoaches);
      setLoadFailed(false);
      return true;
    } catch (cause) {
      if (version === loadVersion.current) {
        setErr(coachCaughtErrorKey(cause, "coach.error.load"));
        setLoadFailed(true);
        // Keep form drafts in memory, but hide stale data and disable mutations.
        setGroup(null);
        setClubRole(null);
        setCoachPermissions({ manageGroups: false, managePlanning: false, transferPlayers: false });
      }
      return false;
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    nameEdited.current = false;
    setGroup(null);
    setGroupName("");
    setNewCat("");
    setSuccess(false);
    setBusy(false);
    if (groupId) void load();
    else { setErr("coach.error.groupAccess"); setLoading(false); }
    return () => {
      loadVersion.current += 1;
      scopeVersion.current += 1;
      mutationInFlight.current = false;
    };
  }, [groupId, load]);

  const planningSummary = useMemo(() => {
    const scheduled = plannedEvents.filter((event) => event.status === "scheduled");
    const upcoming = scheduled.filter((event) => new Date(event.starts_at).getTime() >= Date.now());
    const next = upcoming.slice().sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
    return { totalScheduled: scheduled.length, upcomingCount: upcoming.length,
      recurringCount: scheduled.filter((event) => Boolean(event.series_id)).length, nextStartsAt: next?.starts_at ?? null };
  }, [plannedEvents]);
  const canManagePlayers = Boolean(group && !loadFailed && (clubRole === "manager" || coachPermissions.manageGroups));
  const canSaveInfo = canManagePlayers && !busy && !loading && groupName.trim().length >= 2;
  const duplicateCategory = cats.some((category) => category.category.toLocaleLowerCase(locale) === newCat.trim().toLocaleLowerCase(locale));
  const canAddCat = Boolean(newCat.trim()) && !duplicateCategory;
  const coachIdsInGroup = useMemo(() => new Set(coaches.map((coach) => coach.coach_user_id)), [coaches]);
  const coachCandidates = useMemo(() => clubMembersCoaches.filter((coach) => !coachIdsInGroup.has(coach.id)), [clubMembersCoaches, coachIdsInGroup]);

  async function request(path: string, method: string, body?: Record<string, unknown>) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("coach.error.session");
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(coachUiErrorKey(response.status, json, "coach.error.save"));
  }

  async function mutate(operation: () => Promise<void>, onSaved?: () => void) {
    if (mutationInFlight.current || loading || loadFailed) return false;
    mutationInFlight.current = true;
    const scope = scopeVersion.current;
    setBusy(true);
    setErr(null);
    setSuccess(false);
    try {
      await operation();
      if (scope !== scopeVersion.current) return false;
      onSaved?.();
      const refreshed = await load();
      if (scope !== scopeVersion.current) return false;
      if (refreshed) setSuccess(true);
      else setErr("coach.error.groupRefresh");
      // A committed write is not a failed write merely because its refresh failed.
      return true;
    } catch (cause) {
      if (scope === scopeVersion.current) setErr(coachCaughtErrorKey(cause, "coach.error.save"));
      return false;
    } finally {
      if (scope === scopeVersion.current) { mutationInFlight.current = false; setBusy(false); }
    }
  }

  async function saveGroupInfo(event: React.FormEvent) {
    event.preventDefault();
    if (!canSaveInfo || !group) return;
    const name = groupName.trim();
    await mutate(() => request(`/api/coach/groups/${group.id}`, "PATCH", { name }), () => { nameEdited.current = false; setGroupName(name); });
  }
  async function addCategory() {
    if (!canManagePlayers || !canAddCat) return;
    await mutate(() => request(`/api/coach/groups/${groupId}`, "POST", { category: newCat.trim() }), () => setNewCat(""));
  }
  async function removeCategory(catId: string) {
    if (!canManagePlayers || !cats.some((category) => category.id === catId)) return;
    await mutate(() => request(`/api/coach/groups/${groupId}?categoryId=${encodeURIComponent(catId)}`, "DELETE"));
  }
  async function removePlayerFromGroup(rowId: string) {
    if (!canManagePlayers || !players.some((player) => player.id === rowId)) return;
    await mutate(() => request(`/api/coach/groups/${groupId}/players/${rowId}`, "DELETE"));
  }
  async function addCoachToGroup(profile: Pick<ProfileLite, "id">) {
    if (clubRole !== "manager" || !group || coachIdsInGroup.has(profile.id) || !coachCandidates.some((candidate) => candidate.id === profile.id)) return false;
    return mutate(async () => {
      const result = await supabase.from("coach_group_coaches").insert({ group_id: groupId, coach_user_id: profile.id, is_head: false });
      if (result.error) throw new Error("coach.error.save");
    });
  }
  async function removeCoachFromGroup(row: GroupCoachRow) {
    if (clubRole !== "manager" || !group || row.is_head || group.head_coach_user_id === row.coach_user_id) return;
    await mutate(async () => {
      const result = await supabase.from("coach_group_coaches").delete().eq("id", row.id).eq("group_id", groupId);
      if (result.error) throw new Error("coach.error.save");
    });
  }

  const canPlan = clubRole === "manager" || coachPermissions.managePlanning;
  return (
    <main className={`${styles.page} ${detailStyles.page}`}>
      <nav data-ui="breadcrumb" className={actionStyles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><ChevronRight size={13} aria-hidden="true" /><Link href="/coach/groups">{t("coach.nav.groups")}</Link><ChevronRight size={13} aria-hidden="true" /><span>{group?.name ?? t("coach.groups.group")}</span></nav>
      <div className={styles.topline}>
        <div><h1>{group?.name ?? t("coach.groups.group")}</h1><p className={styles.lead}>{t("coach.group.intro")}</p></div>
        <div className={actionStyles.topActions}><Link className={actionStyles.secondaryButton} href="/coach/groups">{t("coach.group.back")}</Link>{group ? <Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning`}><CalendarDays size={16} aria-hidden="true" />{t("coach.group.planning")}</Link> : null}</div>
      </div>
      {err ? <div className={`${actionStyles.errorAlert} ${detailStyles.alert}`} role="alert">{t(err)}{loadFailed ? <button type="button" className={actionStyles.secondaryButton} onClick={() => void load()} disabled={loading}>{t("coach.retry")}</button> : null}</div> : null}
      {success ? <p className={actionStyles.successAlert} role="status">{t("coach.group.saved")}</p> : null}
      {loading && !group ? <section className={styles.quickPanel}><CoachListSkeleton label={t("coach.group.loading")} /></section> : !group ? null : <>
        <form className={styles.quickPanel} onSubmit={saveGroupInfo} aria-busy={busy || loading}>
          <div className={styles.sectionHeading}><div><h2>{t("coach.group.info")}</h2><p>{t(canManagePlayers ? "coach.group.editHint" : "coach.group.infoHint")}</p></div></div>
          <div className="user-mgmt-form-grid"><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("coach.group.name")}</span><input value={groupName} onChange={(event) => { nameEdited.current = true; setGroupName(event.target.value); setSuccess(false); }} disabled={busy || loading || !canManagePlayers} minLength={2} required aria-describedby={canManagePlayers ? "group-name-hint" : undefined} /></label><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("coach.groups.status")}</span><input value={t(group.is_active ? "coach.groups.active" : "coach.group.inactive")} disabled /></label></div>
          {canManagePlayers ? <p id="group-name-hint" className={detailStyles.hint}>{t("coach.group.nameHint")}</p> : null}
          {canManagePlayers ? <div className="user-mgmt-card-actions"><button className={actionStyles.primaryButton} type="submit" disabled={!canSaveInfo}><Save size={16} aria-hidden="true" />{t(busy ? "coach.directory.saving" : "coach.group.save")}</button></div> : null}
        </form>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>{t("coach.group.categories")}</h2><p>{t("coach.group.categoriesHint")}</p></div></div>
          {canManagePlayers ? <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10 }}><input value={newCat} onChange={(event) => setNewCat(event.target.value)} disabled={busy || loading} aria-label={t("coach.group.category")} placeholder={t("coach.group.categoryPlaceholder")} aria-describedby={duplicateCategory && newCat.trim() ? "category-duplicate" : undefined} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCategory(); } }} /><button type="button" className={actionStyles.secondaryButton} onClick={() => void addCategory()} disabled={busy || loading || !canAddCat} aria-label={t("coach.group.addCategory")} title={t("common.add")} style={{ width: 44, padding: 0 }}><PlusCircle size={18} aria-hidden="true" /></button></div> : null}
          {canManagePlayers && duplicateCategory && newCat.trim() ? <p id="category-duplicate" role="status">{t("coach.group.duplicateCategory")}</p> : null}
          {cats.length === 0 ? <p className="user-mgmt-empty-state">{t("coach.group.noCategories")}</p> : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{cats.map((category) => <div key={category.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="pill-soft">{category.category}</span>{canManagePlayers ? <button type="button" className={`${actionStyles.dangerButton} coach-group-compact-action`} onClick={() => void removeCategory(category.id)} disabled={busy || loading} aria-label={coachText(t, "coach.group.deleteNamed", { name: category.category })} title={t("coach.group.delete")}><Trash2 size={15} aria-hidden="true" /></button> : null}</div>)}</div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>{t("coach.nav.players")}</h2><p>{coachText(t, players.length === 1 ? "coach.group.playerOne" : "coach.group.playerCount", { count: players.length })}</p></div></div>
          {players.length === 0 ? <p className="user-mgmt-empty-state">{t("coach.group.noPlayers")}</p> : <div className="user-mgmt-table-wrap"><table className={`user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list ${detailStyles.memberList}`}><thead><tr><th aria-label={t("coach.group.avatar")} /><th>{t("coach.group.fullName")}</th><th>{t("coach.directory.handicap")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead><tbody>{players.slice().sort((a, b) => fullName(a.profiles).localeCompare(fullName(b.profiles), locale)).map((row) => { const profile = row.profiles ?? null; return <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(profile)}</span></td><td><b>{fullName(profile)}</b></td><td data-label={t("coach.directory.handicap")}>{typeof profile?.handicap === "number" ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(profile.handicap) : "—"}</td><td><div className="user-mgmt-card-actions"><Link className={actionStyles.secondaryButton} href={`/coach/players/${row.player_user_id}?returnTo=${encodeURIComponent(`/coach/groups/${groupId}`)}`} aria-label={coachText(t, "coach.directory.viewNamed", { name: fullName(profile) })}>{t("coach.directory.view")}</Link>{coachPermissions.transferPlayers && !busy && !loading ? <CoachPlayerTransferDialog playerId={row.player_user_id} playerName={fullName(profile)} sourceGroupId={groupId} onTransferred={() => void load()} /> : null}{canManagePlayers ? <button type="button" className={actionStyles.dangerButton} onClick={() => void removePlayerFromGroup(row.id)} disabled={busy || loading} aria-label={coachText(t, "coach.group.removeNamed", { name: fullName(profile) })} title={t("coach.group.remove")}><Trash2 size={16} aria-hidden="true" /></button> : null}</div></td></tr>; })}</tbody></table></div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>{t("coach.group.team")}</h2><p>{t("coach.group.teamHint")}</p></div></div>
          {clubRole === "manager" ? <CoachMemberPicker label={t("coach.group.addCoach")} placeholder={t("coach.group.searchCoach")} items={coachCandidates} disabled={busy || loading} onSelect={addCoachToGroup} /> : null}
          {coaches.length === 0 ? <p className="user-mgmt-empty-state">{t("coach.group.noCoaches")}</p> : <div className="user-mgmt-table-wrap"><table className={`user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list ${detailStyles.memberList}`}><thead><tr><th aria-label={t("coach.group.avatar")} /><th>{t("common.coach")}</th><th>{t("coach.group.role")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead><tbody>{coaches.map((row) => { const isHead = row.is_head || group?.head_coach_user_id === row.coach_user_id; return <tr key={row.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(row.profiles)}</span></td><td><b>{fullName(row.profiles)}</b></td><td data-label={t("coach.group.role")}><span className="pill-soft">{isHead ? t("coach.group.headCoach") : t("coach.group.extraCoach")}</span></td><td>{clubRole === "manager" && !isHead ? <button type="button" className={actionStyles.dangerButton} onClick={() => void removeCoachFromGroup(row)} disabled={busy || loading} aria-label={coachText(t, "coach.group.removeNamed", { name: fullName(row.profiles) })} title={t("coach.group.remove")}><Trash2 size={16} aria-hidden="true" /></button> : null}</td></tr>; })}</tbody></table></div>}
        </section>

        <section className={styles.quickPanel}>
          <div className={styles.sectionHeading}><div><h2>{t("coach.group.planning")}</h2><p>{t("coach.group.planningHint")}</p></div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><span className="pill-soft">{coachText(t, "coach.group.upcoming", { count: planningSummary.upcomingCount })}</span><span className="pill-soft">{coachText(t, "coach.group.scheduled", { count: planningSummary.totalScheduled })}</span><span className="pill-soft">{coachText(t, "coach.group.recurring", { count: planningSummary.recurringCount })}</span></div>
          <p className="user-mgmt-empty-state" style={{ margin: 0 }}>{planningSummary.nextStartsAt ? coachText(t, "coach.group.next", { date: new Intl.DateTimeFormat(coachDateLocale(locale), { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(planningSummary.nextStartsAt)) }) : t("coach.groups.nonePlanned")}</p>
          <div className="user-mgmt-card-actions"><Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning`}><CalendarDays size={16} aria-hidden="true" />{t(canPlan ? "coach.group.managePlanning" : "coach.group.viewPlanning")}</Link></div>
        </section>
      </>}
    </main>
  );
}
