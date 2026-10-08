"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey } from "@/lib/coachUiErrors";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
// Reuse the Camps module so Coach tables remain visually identical to Manager tables.
import styles from "@/app/manager/camps/Camps.module.css";
import groupStyles from "./CoachGroups.module.css";

type Group = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null; clubName: string; isAssigned: boolean; isHead: boolean; playerCount: number; coachCount: number; categories: string[] };
type RawGroup = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null };
function isOperationalGroup(group: RawGroup) {
  const name = group.name.trim();
  return group.is_active && name !== "Groupe spécifique" && !name.startsWith("__EVENT_SPECIFIQUE__") && !name.startsWith("__ARCHIVE_DELETED__");
}

export default function CoachGroupsPage() {
  const { locale, t } = useI18n();
  const [reload, setReload] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState("");
  useEffect(() => { let active = true; void (async () => {
    setLoading(true); setError("");
    try {
      const auth = await supabase.auth.getUser(); if (!auth.data.user) throw new Error("coach.error.session"); const userId = auth.data.user.id;
      const [memberships, links, headed] = await Promise.all([
        supabase.from("club_members").select("club_id,can_transfer_players_between_club_groups").eq("user_id", userId).eq("role", "coach").eq("is_active", true),
        supabase.from("coach_group_coaches").select("group_id,is_head").eq("coach_user_id", userId),
        supabase.from("coach_groups").select("id").eq("head_coach_user_id", userId),
      ]);
      if (memberships.error || links.error || headed.error) throw new Error(memberships.error?.message ?? links.error?.message ?? headed.error?.message);
      const clubIds = [...new Set((memberships.data ?? []).map((row) => row.club_id))];
      const transferClubs = new Set((memberships.data ?? []).filter((row) => row.can_transfer_players_between_club_groups).map((row) => row.club_id));
      const assignedIds = new Set([...(links.data ?? []).map((row) => row.group_id), ...(headed.data ?? []).map((row) => row.id)]);
      if (!clubIds.length) { if (active) setGroups([]); return; }
      const [groupResult, clubResult] = await Promise.all([supabase.from("coach_groups").select("id,club_id,name,is_active,head_coach_user_id").in("club_id", clubIds).eq("is_active", true), supabase.from("organizations").select("id,name").in("id", clubIds)]);
      if (groupResult.error || clubResult.error) throw new Error(groupResult.error?.message ?? clubResult.error?.message);
      const visible = ((groupResult.data ?? []) as RawGroup[]).filter((group) => isOperationalGroup(group) && (assignedIds.has(group.id) || transferClubs.has(group.club_id))); const ids = visible.map((group) => group.id); const clubNames = new Map((clubResult.data ?? []).map((club) => [club.id, club.name ?? ""]));
      if (!ids.length) { if (active) setGroups([]); return; }
      const [players, coaches, categories] = await Promise.all([
        supabase.from("coach_group_players").select("group_id").in("group_id", ids), supabase.from("coach_group_coaches").select("group_id").in("group_id", ids), supabase.from("coach_group_categories").select("group_id,category").in("group_id", ids),
      ]);
      if (players.error || coaches.error || categories.error) throw new Error(players.error?.message ?? coaches.error?.message ?? categories.error?.message);
      const count = (rows: Array<{ group_id: string }>, id: string) => rows.filter((row) => row.group_id === id).length;
      if (active) setGroups(visible.map((group) => ({ ...group, clubName: clubNames.get(group.club_id) ?? "", isAssigned: assignedIds.has(group.id), isHead: group.head_coach_user_id === userId || Boolean((links.data ?? []).find((row) => row.group_id === group.id)?.is_head), playerCount: count(players.data ?? [], group.id), coachCount: count(coaches.data ?? [], group.id), categories: (categories.data ?? []).filter((row) => row.group_id === group.id).map((row) => row.category) })));
    } catch (cause) { if (active) { setError(coachCaughtErrorKey(cause, "coach.error.load")); setGroups([]); } } finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [reload]);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase(locale); return groups.filter((group) => !q || `${group.name} ${group.clubName || t("organization.context")} ${group.categories.join(" ")}`.toLocaleLowerCase(locale).includes(q)).sort((a, b) => a.name.localeCompare(b.name, locale)); }, [groups, query, locale, t]);
  return <main className={`${styles.page} ${groupStyles.page}`}><nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><span>/</span><strong>{t("coach.nav.groups")}</strong></nav><header className={styles.topline}><div><h1>{t("coach.nav.groups")}</h1><p className={styles.lead}>{t("coach.groups.intro")}</p></div></header>{error ? <div className={styles.alertError} role="alert">{t(error)} <button type="button" className={styles.secondary} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}<section className={styles.panel}><div className={styles.panelHeader}><div><h2>{t("coach.home.groups")}</h2><p>{loading ? t("common.loading") : error ? "—" : coachText(t, filtered.length === 1 ? "coach.groups.one" : "coach.groups.count", { count: filtered.length })}</p></div></div><div className={styles.toolbar}><label className={styles.field}><span>{t("coach.directory.search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("organization.groupSearch")} /></label></div>{loading ? <CoachListSkeleton label={t("coach.groups.loading")} /> : error ? null : !filtered.length ? <div className={styles.empty}><Users size={21} aria-hidden="true" />{t("coach.groups.empty")}</div> : <div className={styles.tableWrap}><table className={`${styles.table} ${groupStyles.table}`}><thead><tr><th>{t("coach.groups.group")}</th><th>{t("organization.context")}</th><th>{t("coach.nav.players")}</th><th>{t("coach.groups.coaches")}</th><th>{t("coach.directory.actions")}</th></tr></thead><tbody>{filtered.map((group) => <tr key={group.id}><td data-label={t("coach.groups.group")}><div className={styles.titleCell}><b>{group.name}</b><span className={styles.muted}>{group.categories.slice(0, 3).join(" · ") || t("coach.groups.noCategory")}{group.isHead ? ` · ${t("coach.groups.head")}` : !group.isAssigned ? ` · ${t("coach.groups.mobility")}` : ""}</span></div></td><td data-label={t("organization.context")}>{group.clubName || t("organization.context")}</td><td data-label={t("coach.nav.players")}>{group.playerCount}</td><td data-label={t("coach.groups.coaches")}>{group.coachCount}</td><td data-label={t("coach.directory.actions")}><Link className={styles.iconButton} href={`/coach/groups/${group.id}`} aria-label={coachText(t, "coach.directory.viewNamed", { name: group.name })} title={t("coach.directory.view")}><Eye size={16} aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>}</section></main>;
}
