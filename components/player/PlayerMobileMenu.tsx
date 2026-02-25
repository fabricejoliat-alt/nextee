"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type NavItem = { href: string; label: string };

export default function PlayerMobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();

  const NAV: NavItem[] = [
    { href: "/player", label: t("nav.home") },
    { href: "/player/golf", label: t("player.myGolf") },
    { href: "/player/marketplace", label: t("nav.marketplace") },
    { href: "/player/profile", label: t("common.profile") },
  ];

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("common.openMenu")}
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
        }}
      >
        ☰
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 40,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 72,
              right: 12,
              width: 260,
              background: "white",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 12,
              zIndex: 50,
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
              display: "grid",
              gap: 6,
            }}
          >
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "block",
                    padding: "10px 12px",
                    borderRadius: 12,
                    textDecoration: "none",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    background: active ? "rgba(0,0,0,0.05)" : "white",
                    fontWeight: active ? 800 : 600,
                  }}
                >
                  {item.label}
                </Link>
              );
            })}

            <button
              onClick={handleLogout}
              style={{
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "white",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {t("common.logout")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
