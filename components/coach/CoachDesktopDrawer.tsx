"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, BookOpen, CalendarCheck, CalendarDays, ChevronRight, ClipboardCheck, Home, LogOut, Medal, Newspaper, Tent, User, UserRound, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import OrganizationContextSelect from "@/components/organizations/OrganizationContextSelect";
import styles from "./CoachDesktopDrawer.module.css";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { etiquetteText } from "@/lib/etiquetteLabels";

const ROUTES = {
  home: "/coach", calendar: "/coach/calendar", groups: "/coach/groups", players: "/coach/players",
  camps: "/coach/camps", evaluations: "/coach/calendar?view=evaluations&period=year", validations: "/coach/validations",
  merit: "/coach/om", rules: "/coach/rules", etiquette: "/coach/etiquette", news: "/coach/news", notifications: "/coach/notifications", profile: "/coach/profile",
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
  const { t, locale } = useI18n();
  const [fullName, setFullName] = useState(t("common.defaultName"));
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex]'))
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, onClose]);

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
      { label: etiquetteText(locale).title, icon: BookOpen, href: ROUTES.etiquette },
    ] },
    { label: t("coach.nav.information"), items: [
      { label: t("nav.news"), icon: Newspaper, href: ROUTES.news },
      { label: t("coach.nav.notifications"), icon: Bell, href: ROUTES.notifications },
    ] },
  ], [t, locale, pendingEvaluationCount]);

  async function logout() {
    await supabase.auth.signOut(); onClose(); router.push("/"); router.refresh();
  }

  if (!open) return null;
  return <>
    <button type="button" className="drawer-overlay" aria-label={t("common.close")} onClick={onClose} />
    <aside ref={panelRef} id="coach-navigation-drawer" tabIndex={-1} role="dialog" aria-modal="true" className={`drawer-panel drawer-panel--left drawer-panel--coach drawer-panel--compact ${styles.panel}`} aria-label={t("common.navigation")}>
      <nav className="drawer-nav">
        {sections.map((section) => <section key={section.label} className="drawer-section">
          <div className="drawer-section-label">{section.label}</div>
          <div className="drawer-sub">{section.items.map((item) => { const Icon = item.icon; const badgeCount = "badgeCount" in item ? Number(item.badgeCount ?? 0) : 0; const active = item.href.includes("view=evaluations") ? pathname === "/coach/calendar" && searchParams.get("view") === "evaluations" : item.href === ROUTES.calendar ? isActive(pathname, item.href) && searchParams.get("view") !== "evaluations" : isActive(pathname, item.href); return <Link key={item.label} href={item.href} className={`drawer-subitem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClose}><span className="drawer-item-left"><Icon size={16} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></span><span className="drawer-item-right">{badgeCount > 0 ? <span className="drawer-count-badge">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}<ChevronRight className="drawer-chevron" size={14} aria-hidden="true" /></span></Link>; })}</div>
        </section>)}
      </nav>
      <div className="drawer-account">
        <div className="drawer-account-name">{fullName}</div>
        <div className={styles.context}><OrganizationContextSelect variant="drawer" hideSingleOrganization onNavigate={onClose} /></div>
        <Link href={ROUTES.profile} className={`drawer-subitem drawer-subitem--account ${isActive(pathname, ROUTES.profile) ? "active" : ""}`} onClick={onClose}><span className="drawer-item-left"><User size={16} /><span>{t("common.profile")}</span></span></Link>
        <button type="button" className="drawer-subitem drawer-subitem--danger" onClick={logout}><span className="drawer-item-left"><LogOut size={16} /><span>{t("common.logout")}</span></span></button>
      </div>
    </aside>
  </>;
}
