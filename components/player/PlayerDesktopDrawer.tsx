"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import {
  Home,
  Flag,
  ClipboardList,
  PlusCircle,
  Map,
  Store,
  Tags,
  User,
  LogOut,
  X,
} from "lucide-react";

/**
 * ✅ Adapte ici si tes routes ne correspondent pas exactement
 */
const ROUTES = {
  home: "/player",
  golfDashboard: "/player/golf",
  
  trainingsList: "/player/golf/trainings",
  trainingsNew: "/player/golf/trainings/new",

  roundsList: "/player/golf/rounds",
  roundsNew: "/player/golf/rounds/new",

  marketplaceAll: "/player/marketplace",
  marketplaceMine: "/player/marketplace/mine",
  marketplaceNew: "/player/marketplace/new",

  profileEdit: "/player/profile",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

function isActive(pathname: string, href: string) {
  // Active exact match or prefix match (useful for nested pages)
  if (href === "/player") return pathname === "/player";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function PlayerDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();

  const [fullName, setFullName] = useState<string>(t("common.defaultName"));

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Load profile name when drawer opens (light + robust)
  useEffect(() => {
    if (!open) return;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        setFullName(t("common.defaultName"));
        return;
      }

      // Assumption: table "profiles" has first_name/last_name
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
      {
        label: t("nav.home"),
        icon: Home,
        href: ROUTES.home,
      },
      {
        label: t("player.myGolf"),
        icon: Flag,
        children: [
          { label: "Dashboard", icon: Home, href: ROUTES.golfDashboard },
          { label: t("player.trainings"), icon: ClipboardList, href: ROUTES.trainingsList },
          { label: t("player.newTraining"), icon: PlusCircle, href: ROUTES.trainingsNew },
          { label: t("player.rounds"), icon: Map, href: ROUTES.roundsList },
          { label: t("player.newRound"), icon: PlusCircle, href: ROUTES.roundsNew },
        ],
      },
      {
        label: t("nav.marketplace"),
        icon: Store,
        children: [
          { label: t("player.allListings"), icon: Tags, href: ROUTES.marketplaceAll },
          { label: t("player.myListings"), icon: ClipboardList, href: ROUTES.marketplaceMine },
          { label: t("player.newListing"), icon: PlusCircle, href: ROUTES.marketplaceNew },
        ],
      },
    ],
    [t]
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
      <button
        type="button"
        className="drawer-overlay"
        aria-label={t("common.close")}
        onClick={onClose}
      />

      <aside className="drawer-panel drawer-panel--left" aria-label={t("common.navigation")}>
        {/* Top bar */}
        <div className="drawer-top">
          <Link href={ROUTES.home} className="drawer-brand" onClick={onClose} aria-label="ActiviTee">
            <span className="drawer-brand-nex">Activi</span>
            <span className="drawer-brand-tee">Tee</span>
          </Link>

          <button className="icon-btn drawer-close" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="drawer-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const activeTop = item.href ? isActive(pathname, item.href) : item.children?.some((c) => isActive(pathname, c.href));

            if (item.href) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`drawer-item ${activeTop ? "active" : ""}`}
                  onClick={onClose}
                >
                  <span className="drawer-item-left">
                    <Icon size={18} strokeWidth={2} />
                    <span>{item.label}</span>
                  </span>
                </Link>
              );
            }

            // Section with children
            return (
              <div key={item.label} className="drawer-group">
                <div className={`drawer-item drawer-item--group ${activeTop ? "active" : ""}`}>
                  <span className="drawer-item-left">
                    <Icon size={18} strokeWidth={2} />
                    <span>{item.label}</span>
                  </span>
                </div>

                <div className="drawer-sub">
                  {item.children?.map((c) => {
                    const CIcon = c.icon;
                    const active = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.label}
                        href={c.href}
                        className={`drawer-subitem ${active ? "active" : ""}`}
                        onClick={onClose}
                      >
                        <span className="drawer-item-left">
                          <CIcon size={16} strokeWidth={2} />
                          <span>{c.label}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Account section bottom */}
        <div className="drawer-account">
          <div className="drawer-account-name">{fullName}</div>

          <Link href={ROUTES.profileEdit} className={`drawer-subitem drawer-subitem--account ${isActive(pathname, ROUTES.profileEdit) ? "active" : ""}`} onClick={onClose}>
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
