"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { User, LogOut, X, ShieldCheck, Link2, Building2, CalendarDays } from "lucide-react";

const ROUTES = {
  home: "/manager",
  users: "/manager/users",
  events: "/manager/calendar",
  eventsCreate: "/manager/events/new",
  consents: "/manager/parents",
  organizations: "/manager/organizations",
  profileEdit: "/manager/profile",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

function isActive(pathname: string, href: string) {
  if (href === "/manager") return pathname === "/manager";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function ManagerDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useI18n();

  const [fullName, setFullName] = useState<string>(t("common.defaultName"));

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        setFullName(t("common.defaultName"));
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name,last_name")
        .eq("id", userId)
        .maybeSingle();

      const fn = (profile?.first_name ?? "").trim();
      const ln = (profile?.last_name ?? "").trim();
      const name = `${fn} ${ln}`.trim();

      setFullName(name || t("common.defaultName"));
    })();
  }, [open, t]);

  const nav = useMemo(
    () => [
      { label: locale === "fr" ? "Gestion des utilisateurs" : "User management", icon: ShieldCheck, href: ROUTES.users },
      { label: locale === "fr" ? "Gestion des groupes" : "Group management", icon: Building2, href: ROUTES.organizations },
      { label: locale === "fr" ? "Gestion des événements" : "Event management", icon: CalendarDays, href: ROUTES.events },
      { label: locale === "fr" ? "Ajouter un événement" : "Add event", icon: CalendarDays, href: ROUTES.eventsCreate },
      { label: locale === "fr" ? "Gestion des consentements" : "Consent management", icon: Link2, href: ROUTES.consents },
    ],
    [locale]
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    onClose();
    router.push("/");
    router.refresh();
  }

  if (!open) return null;

  return (
    <>
      <button type="button" className="drawer-overlay" aria-label={t("common.close")} onClick={onClose} />

      <aside className="drawer-panel drawer-panel--left" aria-label={t("common.navigation")}>
        <div className="drawer-top">
          <Link href={ROUTES.home} className="drawer-brand" onClick={onClose} aria-label="ActiviTee">
            <span className="drawer-brand-nex">Activi</span>
            <span className="drawer-brand-tee">Tee</span>
          </Link>

          <button className="icon-btn drawer-close" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <nav className="drawer-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`drawer-item ${active ? "active" : ""}`}
                onClick={onClose}
              >
                <span className="drawer-item-left">
                  <Icon size={18} strokeWidth={2} />
                  <span>{item.label}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="drawer-account">
          <div className="drawer-account-name">{fullName}</div>

          <Link
            href={ROUTES.profileEdit}
            className={`drawer-subitem drawer-subitem--account ${isActive(pathname, ROUTES.profileEdit) ? "active" : ""}`}
            onClick={onClose}
          >
            <span className="drawer-item-left">
              <User size={16} strokeWidth={2} />
              <span>{t("common.profile")}</span>
            </span>
          </Link>

          <button type="button" className="drawer-subitem drawer-subitem--danger" onClick={handleLogout}>
            <span className="drawer-item-left">
              <LogOut size={16} strokeWidth={2} />
              <span>{t("common.logout")}</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
