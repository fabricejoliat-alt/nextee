"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Home, Building2, Users, CalendarDays, Settings, Bell, LogOut, X } from "lucide-react";

const ROUTES = {
  home: "/admin",
  organizations: "/admin/organizations",
  users: "/admin/users",
  events: "/admin/events",
  settings: "/admin/settings",
  notifications: "/admin/notifications",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AdminDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const [fullName, setFullName] = useState<string>("Superadmin");

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
        setFullName("Superadmin");
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
      setFullName(name || "Superadmin");
    })();
  }, [open]);

  const nav = useMemo(
    () => [
      { label: "Accueil", icon: Home, href: ROUTES.home },
      { label: "Organisations", icon: Building2, href: ROUTES.organizations },
      { label: "Utilisateurs", icon: Users, href: ROUTES.users },
      { label: "Événements", icon: CalendarDays, href: ROUTES.events },
      { label: "Réglages", icon: Settings, href: ROUTES.settings },
      { label: "Notifications", icon: Bell, href: ROUTES.notifications },
    ],
    []
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
      <button type="button" className="drawer-overlay" aria-label="Fermer" onClick={onClose} />

      <aside className="drawer-panel drawer-panel--left" aria-label="Navigation admin">
        <div className="drawer-top">
          <Link href={ROUTES.home} className="drawer-brand" onClick={onClose} aria-label="ActiviTee">
            <span className="drawer-brand-nex">Activi</span>
            <span className="drawer-brand-tee">Tee</span>
          </Link>

          <button className="icon-btn drawer-close" type="button" onClick={onClose} aria-label="Fermer">
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

          <button type="button" className="drawer-subitem drawer-subitem--danger" onClick={handleLogout}>
            <span className="drawer-item-left">
              <LogOut size={16} strokeWidth={2} />
              <span>Déconnexion</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
