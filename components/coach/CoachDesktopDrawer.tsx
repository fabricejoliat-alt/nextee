"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, BookOpen, CalendarCheck, CalendarDays, ChevronRight, ClipboardCheck, Home, LogOut, Medal, Newspaper, Tent, User, UserRound, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import styles from "./CoachDesktopDrawer.module.css";
import { useI18n } from "@/components/i18n/AppI18nProvider";

const ROUTES = {
  home: "/coach", calendar: "/coach/calendar", groups: "/coach/groups", players: "/coach/players",
  camps: "/coach/camps", evaluations: "/coach/calendar?view=evaluations&period=year", validations: "/coach/validations",
  merit: "/coach/om", rules: "/coach/rules", news: "/coach/news", notifications: "/coach/notifications", profile: "/coach/profile",
} as const;

type Props = { open: boolean; onClose: () => void; pendingEvaluationCount: number };

function isActive(pathname: string, href: string) {
  const cleanHref = href.split("?")[0];
  if (cleanHref === "/coach") return pathname === "/coach";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

export default function CoachDesktopDrawer({ open, onClose, pendingEvaluationCount }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useI18n();
  const [fullName, setFullName] = useState(t("common.defaultName"));

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const profile = await supabase.from("profiles").select("first_name,last_name").eq("id", data.user.id).maybeSingle();
      const name = `${profile.data?.first_name ?? ""} ${profile.data?.last_name ?? ""}`.trim();
      setFullName(name || t("common.defaultName"));
    })();
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    Object.values(ROUTES).forEach((href) => router.prefetch(href));
  }, [open, router]);

  const sections = useMemo(() => [
    { label: t("nav.home"), items: [
      { label: t("nav.dashboard"), icon: Home, href: ROUTES.home },
    ] },
    { label: t("coach.nav.activity"), items: [
      { label: t("coach.nav.activities"), icon: CalendarDays, href: ROUTES.calendar },
      { label: t("coach.nav.evaluations"), icon: ClipboardCheck, href: ROUTES.evaluations, badgeCount: pendingEvaluationCount },
      { label: t("coach.nav.groups"), icon: Users, href: ROUTES.groups },
      { label: t("coach.nav.players"), icon: UserRound, href: ROUTES.players },
      { label: t("coach.nav.camps"), icon: Tent, href: ROUTES.camps },
    ] },
    { label: t("coach.nav.tracking"), items: [
      { label: t("coach.nav.validations"), icon: CalendarCheck, href: ROUTES.validations },
      { label: t("coach.nav.merit"), icon: Medal, href: ROUTES.merit },
      { label: t("coach.nav.rules"), icon: BookOpen, href: ROUTES.rules },
    ] },
    { label: t("coach.nav.information"), items: [
      { label: t("nav.news"), icon: Newspaper, href: ROUTES.news },
      { label: t("coach.nav.notifications"), icon: Bell, href: ROUTES.notifications },
    ] },
  ], [t, pendingEvaluationCount]);

  async function logout() {
    await supabase.auth.signOut(); onClose(); router.push("/"); router.refresh();
  }

  if (!open) return null;
  return <AccessibleDialog onClose={onClose} className={`drawer-panel drawer-panel--left drawer-panel--coach ${styles.dialog}`} label={t("common.navigation")}>
      <div className="drawer-top">
        <Link href={ROUTES.home} className="drawer-brand" onClick={onClose} aria-label="ActiviTee"><span className="drawer-brand-nex">Activi</span><span className="drawer-brand-tee">Tee</span></Link>
        <button className="icon-btn drawer-close" type="button" autoFocus onClick={onClose} aria-label={t("common.close")}><X size={20} /></button>
      </div>
      <nav className="drawer-nav">
        {sections.map((section) => <section key={section.label} className="drawer-section">
          <div className="drawer-section-label">{section.label}</div>
          <div className="drawer-sub">{section.items.map((item) => { const Icon = item.icon; const badgeCount = "badgeCount" in item ? Number(item.badgeCount ?? 0) : 0; const active = item.href.includes("view=evaluations") ? pathname === "/coach/calendar" && searchParams.get("view") === "evaluations" : item.href === ROUTES.calendar ? isActive(pathname, item.href) && searchParams.get("view") !== "evaluations" : isActive(pathname, item.href); return <Link key={item.label} href={item.href} className={`drawer-subitem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClose}><span className="drawer-item-left"><Icon size={16} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></span><span className="drawer-item-right">{badgeCount > 0 ? <span className="drawer-count-badge">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}<ChevronRight className="drawer-chevron" size={14} aria-hidden="true" /></span></Link>; })}</div>
        </section>)}
      </nav>
      <div className="drawer-account">
        <div className="drawer-account-name">{fullName}</div>
        <Link href={ROUTES.profile} className={`drawer-subitem drawer-subitem--account ${isActive(pathname, ROUTES.profile) ? "active" : ""}`} onClick={onClose}><span className="drawer-item-left"><User size={16} /><span>{t("common.profile")}</span></span></Link>
        <button type="button" className="drawer-subitem drawer-subitem--danger" onClick={logout}><span className="drawer-item-left"><LogOut size={16} /><span>{t("common.logout")}</span></span></button>
      </div>
  </AccessibleDialog>;
}
