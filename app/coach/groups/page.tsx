"use client";
import { useRetainedLoading } from "@/lib/useRetainedLoading";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { organizationFetch as fetch } from "@/lib/organizationFetch";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachText } from "@/lib/i18n/coachMessages";
import { coachUiErrorKey, coachCaughtErrorKey } from "@/lib/coachUiErrors";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
// Reuse the Camps module so Coach tables remain visually identical to Manager tables.
import styles from "@/app/manager/camps/Camps.module.css";
import groupStyles from "./CoachGroups.module.css";

type Person = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type Group = { id: string; club_id: string; name: string; is_active: boolean; head_coach_user_id: string | null; clubName: string; isAssigned: boolean; isHead: boolean; playerCount: number; coachCount: number; categories: string[]; players: Person[]; coaches: Person[] };

export default function CoachGroupsPage() {
  const { locale, t } = useI18n();
  const [reload, setReload] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]); const [loading, setLoading] = useRetainedLoading(); const [error, setError] = useState(""); const [query, setQuery] = useState("");
  useEffect(() => { let active = true; void (async () => {
    setLoading(true); setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("coach.error.session");
      const response = await fetch("/api/coach/directory?view=groups", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(coachUiErrorKey(response.status, body, "coach.error.load"));
      if (active) { setGroups(body.groups ?? []); }

    } catch (cause) { if (active) { setError(coachCaughtErrorKey(cause, "coach.error.load")); setGroups([]); } } finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [reload, setLoading]);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase(locale); return groups.filter((group) => !q || `${group.name} ${group.clubName || t("organization.context")} ${group.categories.join(" ")}`.toLocaleLowerCase(locale).includes(q)).sort((a, b) => a.name.localeCompare(b.name, locale)); }, [groups, query, locale, t]);
  function people(items: Person[] = []) {
    return <ul className={groupStyles.people}>{[...items].sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, locale)).map((person) => {
      const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "—";
      return <li key={person.id}><span className={groupStyles.avatar} aria-hidden="true">{person.avatar_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={person.avatar_url} alt="" /> : `${person.first_name?.[0] ?? ""}${person.last_name?.[0] ?? ""}`.toUpperCase()}</span><span>{name}</span></li>;
    })}</ul>;
  }
  return <main className={`${styles.page} ${groupStyles.page}`}><nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><span>/</span><strong>{t("coach.nav.groups")}</strong></nav><header className={styles.topline}><div><h1>{t("coach.nav.groups")}</h1><p className={styles.lead}>{t("coach.groups.intro")}</p></div></header>{error ? <div className={styles.alertError} role="alert">{t(error)} <button type="button" className={styles.secondary} onClick={() => setReload((value) => value + 1)}>{t("coach.retry")}</button></div> : null}<section className={styles.panel}><div className={styles.panelHeader}><div><h2>{t("coach.home.groups")}</h2><p>{loading ? t("common.loading") : error ? "—" : coachText(t, filtered.length === 1 ? "coach.groups.one" : "coach.groups.count", { count: filtered.length })}</p></div></div><div className={styles.toolbar}><label className={styles.field}><span>{t("coach.directory.search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("organization.groupSearch")} /></label></div>{loading ? <CoachListSkeleton label={t("coach.groups.loading")} /> : error ? null : !filtered.length ? <div className={styles.empty}><Users size={21} aria-hidden="true" />{t("coach.groups.empty")}</div> : <div className={styles.tableWrap}><table className={`${styles.table} ${groupStyles.table}`}><thead><tr><th>{t("coach.groups.group")}</th><th>{t("organization.context")}</th><th>{t("coach.nav.players")}</th><th>{t("coach.groups.coaches")}</th><th>{t("coach.directory.actions")}</th></tr></thead><tbody>{filtered.map((group) => <tr key={group.id}><td data-label={t("coach.groups.group")}><div className={styles.titleCell}><b>{group.name}</b><span className={styles.muted}>{group.categories.slice(0, 3).join(" · ") || t("coach.groups.noCategory")}{group.isHead ? ` · ${t("coach.groups.head")}` : !group.isAssigned ? ` · ${t("coach.groups.mobility")}` : ""}</span></div></td><td data-label={t("organization.context")}>{group.clubName || t("organization.context")}</td><td data-label={t("coach.nav.players")}>{people(group.players)}</td><td data-label={t("coach.groups.coaches")}>{people(group.coaches)}</td><td data-label={t("coach.directory.actions")}><Link className={styles.iconButton} href={`/coach/groups/${group.id}`} aria-label={coachText(t, "coach.directory.viewNamed", { name: group.name })} title={t("coach.directory.view")}><Eye size={16} aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>}</section></main>;
}
