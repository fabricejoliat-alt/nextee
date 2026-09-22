"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, BookOpen, CalendarCheck, CalendarDays, ChevronRight, ClipboardCheck, Home, LogOut, Medal, Newspaper, Tent, User, UserRound, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

const ROUTES = {
  home: "/coach", calendar: "/coach/calendar", groups: "/coach/groups", players: "/coach/players",
  camps: "/coach/camps", evaluations: "/coach/calendar?view=evaluations", validations: "/coach/validations",
  merit: "/coach/om", rules: "/coach/rules", news: "/coach/news", notifications: "/coach/notifications", profile: "/coach/profile",
} as const;

type Props = { open: boolean; onClose: () => void };

function isActive(pathname: string, href: string) {
  const cleanHref = href.split("?")[0];
  if (cleanHref === "/coach") return pathname === "/coach";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

export default function CoachDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();
  const [fullName, setFullName] = useState(t("common.defaultName"));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    { label: locale === "fr" ? "Accueil" : "Home", items: [
      { label: locale === "fr" ? "Tableau de bord" : "Dashboard", icon: Home, href: ROUTES.home },
    ] },
    { label: locale === "fr" ? "Mon activité" : "My activity", items: [
      { label: locale === "fr" ? "Activités" : "Activities", icon: CalendarDays, href: ROUTES.calendar },
      { label: locale === "fr" ? "Mes groupes" : "My groups", icon: Users, href: ROUTES.groups },
      { label: locale === "fr" ? "Juniors" : "Players", icon: UserRound, href: ROUTES.players },
      { label: locale === "fr" ? "Stages / camps" : "Camps", icon: Tent, href: ROUTES.camps },
    ] },
    { label: locale === "fr" ? "Suivi" : "Tracking", items: [
      { label: locale === "fr" ? "Évaluations à faire" : "Evaluations to do", icon: ClipboardCheck, href: ROUTES.evaluations },
      { label: "Validations", icon: CalendarCheck, href: ROUTES.validations },
      { label: locale === "fr" ? "Ordre du mérite" : "Order of Merit", icon: Medal, href: ROUTES.merit },
      { label: locale === "fr" ? "Règles de golf" : "Rules of golf", icon: BookOpen, href: ROUTES.rules },
    ] },
    { label: "Information", items: [
      { label: locale === "fr" ? "Actualités" : "News", icon: Newspaper, href: ROUTES.news },
      { label: "Notifications", icon: Bell, href: ROUTES.notifications },
    ] },
  ], [locale]);

  async function logout() {
    await supabase.auth.signOut(); onClose(); router.push("/"); router.refresh();
  }

  if (!open) return null;
  return <>
    <button type="button" className="drawer-overlay" aria-label={t("common.close")} onClick={onClose} />
    <aside className="drawer-panel drawer-panel--left" aria-label={t("common.navigation")}>
      <div className="drawer-top">
        <Link href={ROUTES.home} className="drawer-brand" onClick={onClose} aria-label="ActiviTee"><span className="drawer-brand-nex">Activi</span><span className="drawer-brand-tee">Tee</span></Link>
        <button className="icon-btn drawer-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={20} /></button>
      </div>
      <nav className="drawer-nav">
        {sections.map((section) => <section key={section.label} className="drawer-section">
          <div className="drawer-section-label">{section.label}</div>
          <div className="drawer-sub">{section.items.map((item) => { const Icon = item.icon; const active = item.href.includes("view=evaluations") ? pathname === "/coach/calendar" && searchParams.get("view") === "evaluations" : item.href === ROUTES.calendar ? isActive(pathname, item.href) && searchParams.get("view") !== "evaluations" : isActive(pathname, item.href); return <Link key={item.label} href={item.href} className={`drawer-subitem ${active ? "active" : ""}`} onClick={onClose}><span className="drawer-item-left"><Icon size={16} strokeWidth={1.8} /><span>{item.label}</span></span><ChevronRight className="drawer-chevron" size={14} aria-hidden="true" /></Link>; })}</div>
        </section>)}
      </nav>
      <div className="drawer-account">
        <div className="drawer-account-name">{fullName}</div>
        <Link href={ROUTES.profile} className={`drawer-subitem drawer-subitem--account ${isActive(pathname, ROUTES.profile) ? "active" : ""}`} onClick={onClose}><span className="drawer-item-left"><User size={16} /><span>{t("common.profile")}</span></span></Link>
        <button type="button" className="drawer-subitem drawer-subitem--danger" onClick={logout}><span className="drawer-item-left"><LogOut size={16} /><span>{t("common.logout")}</span></span></button>
      </div>
    </aside>
  </>;
}
