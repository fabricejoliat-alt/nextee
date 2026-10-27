"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { etiquetteText } from "@/lib/etiquetteLabels";
import {
  Home,
  Flag,
  ClipboardList,
  CalendarDays,
  Dumbbell,
  FileText,
  Store,
  User,
  CircleHelp,
  LogOut,
  X,
  Trophy,
  ListChecks,
  Tent,
  Newspaper,
  ShieldCheck,
  BookOpen,
  ChevronRight,
} from "lucide-react";

/**
 * ✅ Adapte ici si tes routes ne correspondent pas exactement
 */
const ROUTES = {
  home: "/player",
  golfDashboard: "/player/golf",
  golfTrainings: "/player/golf?section=trainings",
  golfRounds: "/player/golf?section=rounds",
  golfEvaluations: "/player/golf?section=evaluations",
  golfDocuments: "/player/golf?section=documents",
  
  trainingsList: "/player/golf/trainings?type=all",
  news: "/player/news",
  trainingsListTraining: "/player/golf/trainings?type=training",
  trainingsToComplete: "/player/golf/trainings/to-complete",
  trainingsNew: "/player/golf/trainings/new",

  roundsList: "/player/golf/rounds",
  roundsNew: "/player/golf/rounds/new",
  camps: "/player/camps",
  om: "/player/om",
  validations: "/player/validations",
  rules: "/player/rules",
  etiquette: "/player/etiquette",

  marketplaceAll: "/player/marketplace",
  marketplaceMine: "/player/marketplace/mine",
  marketplaceNew: "/player/marketplace/new",

  profileEdit: "/player/profile",
  help: "/player/help",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

type ParentChildLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  is_primary: boolean;
};

type DrawerFooterCache = {
  fullName: string;
  viewerRole: "player" | "parent";
  parentChildren: ParentChildLite[];
  selectedChildId: string;
  savedAt: number;
};

const DRAWER_FOOTER_CACHE_KEY = "player:drawer:footer:v1";
const DRAWER_FOOTER_CACHE_TTL_MS = 10 * 60_000;

function isActive(pathname: string, href: string) {
  const hrefPath = href.split("?")[0] || href;
  const hrefQuery = href.includes("?") ? new URLSearchParams(href.split("?")[1] ?? "") : null;
  // Active exact match or prefix match (useful for nested pages)
  if (hrefPath === "/player") return pathname === "/player";
  if (hrefPath === "/player/golf") {
    const inGolf = pathname === hrefPath || pathname.startsWith(hrefPath + "/");
    const inTrainings = pathname === "/player/golf/trainings" || pathname.startsWith("/player/golf/trainings/");
    return inGolf && !inTrainings;
  }
  if (hrefPath === "/player/golf/trainings" && hrefQuery?.get("type") === "training") {
    return false; // handled by isTrainingChildActive()
  }
  return pathname === hrefPath || pathname.startsWith(hrefPath + "/");
}

function isTrainingChildActive(pathname: string, searchParams: URLSearchParams, href: string) {
  const hrefPath = href.split("?")[0] || href;
  if (hrefPath === "/player/golf") {
    const requestedSection = new URLSearchParams(href.split("?")[1] ?? "").get("section") || "overview";
    const currentSection = searchParams.get("section") || "overview";
    return pathname === hrefPath && requestedSection === currentSection;
  }
  if (hrefPath === "/player/om") {
    const hrefQuery = href.includes("?") ? new URLSearchParams(href.split("?")[1] ?? "") : null;
    const requestedView = hrefQuery?.get("view") || "summary";
    const currentView = searchParams.get("view") || "summary";
    return pathname === hrefPath && requestedView === currentView;
  }
  if (hrefPath !== "/player/golf/trainings") return isActive(pathname, href);
  const hrefQuery = href.includes("?") ? new URLSearchParams(href.split("?")[1] ?? "") : null;
  const requestedType = hrefQuery?.get("type");
  if (requestedType === "training") {
    return pathname === hrefPath && searchParams.get("type") === "training";
  }
  if (requestedType === "all") {
    const t = searchParams.get("type");
    return pathname === hrefPath && (t === null || t === "" || t === "all");
  }
  return pathname === hrefPath || pathname.startsWith(hrefPath + "/");
}

export default function PlayerDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();

  const [fullName, setFullName] = useState<string>(t("common.defaultName"));
  const [pendingEvalCount, setPendingEvalCount] = useState(0);
  const [viewerRole, setViewerRole] = useState<"player" | "parent">("player");
  const [parentChildren, setParentChildren] = useState<ParentChildLite[]>([]);
  const [selectedChildId, setSelectedChildId] = useState("");
  const [performanceEnabled, setPerformanceEnabled] = useState(false);

  function readDrawerFooterCache(): DrawerFooterCache | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(DRAWER_FOOTER_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DrawerFooterCache>;
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.savedAt !== "number") return null;
      if (Date.now() - parsed.savedAt > DRAWER_FOOTER_CACHE_TTL_MS) return null;
      if (typeof parsed.fullName !== "string") return null;
      const role = parsed.viewerRole === "parent" ? "parent" : "player";
      const children = Array.isArray(parsed.parentChildren) ? parsed.parentChildren : [];
      const selected = typeof parsed.selectedChildId === "string" ? parsed.selectedChildId : "";
      return {
        fullName: parsed.fullName,
        viewerRole: role,
        parentChildren: children as ParentChildLite[],
        selectedChildId: selected,
        savedAt: parsed.savedAt,
      };
    } catch {
      return null;
    }
  }

  function writeDrawerFooterCache(next: Omit<DrawerFooterCache, "savedAt">) {
    if (typeof window === "undefined") return;
    try {
      const payload: DrawerFooterCache = { ...next, savedAt: Date.now() };
      window.localStorage.setItem(DRAWER_FOOTER_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }

  function switchParentChild(nextChildId: string) {
    setSelectedChildId(nextChildId);
    if (typeof window === "undefined") return;
    window.localStorage.setItem("parent:selected_child_id", nextChildId);

    const url = new URL(window.location.href);
    url.searchParams.set("child_id", nextChildId);
    // Hard reload required: several player pages load data on mount only.
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

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
      // Instant render from local cache (then refresh in background).
      const cached = readDrawerFooterCache();
      if (cached) {
        setFullName(cached.fullName || t("common.defaultName"));
        setViewerRole(cached.viewerRole);
        setParentChildren(cached.parentChildren);
        setSelectedChildId(cached.selectedChildId);
      }

      const { data: auth } = await supabase.auth.getSession();
      const displayUserId = auth.session?.user.id ?? "";
      const headers = await authHeader();
      const [meRes, profileRes] = await Promise.all([
        fetch("/api/auth/me", { method: "GET", headers, cache: "no-store" }),
        displayUserId
          ? supabase
              .from("profiles")
              .select("first_name,last_name")
              .eq("id", displayUserId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as { data: null; error: null }),
      ]);

      const meJson = await meRes.json().catch(() => ({}));
      const role = meRes.ok ? String(meJson?.membership?.role ?? "player") : "player";
      const childrenRes = await fetch("/api/parent/children", { method: "GET", headers, cache: "no-store" });
      const childrenJson = await childrenRes.json().catch(() => ({}));
      const list = (childrenRes.ok ? (childrenJson?.children ?? []) : []) as ParentChildLite[];

      let resolvedViewerRole: "player" | "parent" = "player";
      let resolvedChildren: ParentChildLite[] = [];
      let resolvedSelectedChildId = "";
      if (role === "parent" || list.length > 0) {
        resolvedViewerRole = "parent";
        resolvedChildren = list;
        const queryChildId = String(searchParams.get("child_id") ?? "").trim();
        const stored = window.localStorage.getItem("parent:selected_child_id");
        resolvedSelectedChildId =
          (queryChildId && list.some((c) => c.id === queryChildId) && queryChildId) ||
          (stored && list.some((c) => c.id === stored) && stored) ||
          list.find((c) => c.is_primary)?.id ||
          list[0]?.id ||
          "";
        if (resolvedSelectedChildId) {
          window.localStorage.setItem("parent:selected_child_id", resolvedSelectedChildId);
        }
      }
      setViewerRole(resolvedViewerRole);
      setParentChildren(resolvedChildren);
      setSelectedChildId(resolvedSelectedChildId);

      const profile = profileRes.data;
      const fn = (profile?.first_name ?? "").trim();
      const ln = (profile?.last_name ?? "").trim();
      const name = `${fn} ${ln}`.trim();

      const resolvedFullName = name || t("common.defaultName");
      setFullName(resolvedFullName);
      writeDrawerFooterCache({
        fullName: resolvedFullName,
        viewerRole: resolvedViewerRole,
        parentChildren: resolvedChildren,
        selectedChildId: resolvedSelectedChildId,
      });
    })();
  }, [open, t, searchParams]);

  useEffect(() => {
    if (viewerRole !== "parent" || !selectedChildId) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("parent:selected_child_id", selectedChildId);
    }
  }, [viewerRole, selectedChildId]);

  const selectedChildIdForView = useMemo(() => {
    const queryChildId = String(searchParams.get("child_id") ?? "").trim();
    if (queryChildId && parentChildren.some((c) => c.id === queryChildId)) return queryChildId;
    return selectedChildId;
  }, [searchParams, parentChildren, selectedChildId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token || cancelled) return;
      const cached = readDrawerFooterCache();
      const role = viewerRole === "parent" ? viewerRole : cached?.viewerRole ?? viewerRole;
      const child = selectedChildIdForView || cached?.selectedChildId || "";
      const query = new URLSearchParams({ view: "pending" });
      if (role === "parent" && child) query.set("child_id", child);
      try {
        const response = await fetch(`/api/player/golf-data?${query}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled) return;
        setPerformanceEnabled(data.performanceEnabled === true);
        setPendingEvalCount(Array.isArray(data.rows) ? data.rows.length : 0);
      } catch {
        // Preserve the last confirmed count while a transient read is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [open, viewerRole, selectedChildIdForView, pathname]);

  const navSections = useMemo(
    () => [
      {
        label: t("nav.home"),
        items: [
          { label: t("nav.dashboard"), icon: Home, href: ROUTES.home },
          { label: t("nav.news"), icon: Newspaper, href: ROUTES.news },
        ],
      },
      {
        label: t("nav.calendar"),
        items: [
          { label: t("nav.calendar"), icon: CalendarDays, href: ROUTES.trainingsList },
          ...(performanceEnabled
            ? [
                {
                  label: t("player.activitiesToEvaluate"),
                  icon: ListChecks,
                  href: ROUTES.trainingsToComplete,
                  badgeCount: pendingEvalCount > 0 ? pendingEvalCount : 0,
                },
              ]
            : []),
        ],
      },
      {
        label: t("player.myGolf"),
        items: [
          { label: t("player.golfDashboard"), icon: Home, href: ROUTES.golfDashboard },
          { label: t("player.golfTrainings"), icon: Dumbbell, href: ROUTES.golfTrainings },
          { label: t("player.golfRounds"), icon: Flag, href: ROUTES.golfRounds },
          { label: t("player.camps"), icon: Tent, href: ROUTES.camps },
          { label: t("player.golfEvaluations"), icon: ClipboardList, href: ROUTES.golfEvaluations },
          { label: t("player.golfDocuments"), icon: FileText, href: ROUTES.golfDocuments },
        ],
      },
      {
        label: t("player.myProgression"),
        items: [
          { label: t("player.validations"), icon: ShieldCheck, href: ROUTES.validations },
          {
            label: t("player.rules"),
            icon: BookOpen,
            href: ROUTES.rules,
          },
          { label: etiquetteText(locale).title, icon: BookOpen, href: ROUTES.etiquette },
          ...(performanceEnabled
            ? [
                {
                  label: t("player.orderOfMerit"),
                  icon: Trophy,
                  href: ROUTES.om,
                },
              ]
            : []),
        ],
      },
      {
        label: t("player.myServices"),
        items: [
          { label: t("nav.marketplace"), icon: Store, href: ROUTES.marketplaceAll },
          { label: t("player.helpContact"), icon: CircleHelp, href: ROUTES.help },
        ],
      },
    ],
    [t, locale, pendingEvalCount, performanceEnabled]
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

      <aside id="player-navigation-drawer" className="drawer-panel drawer-panel--left drawer-panel--compact" aria-label={t("common.navigation")}>
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
          {navSections.map((section) => (
            <section key={section.label} className="drawer-section">
              <div className="drawer-section-label">{section.label}</div>
              <div className="drawer-sub">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const badgeCount = "badgeCount" in item ? Number(item.badgeCount ?? 0) : 0;
                  const active = isTrainingChildActive(pathname, searchParams, item.href);
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={`drawer-subitem ${active ? "active" : ""}`}
                      onClick={onClose}
                    >
                      <span className="drawer-item-left">
                        <Icon size={16} strokeWidth={1.8} />
                        <span>{item.label}</span>
                      </span>
                      <span className="drawer-item-right">
                        {badgeCount > 0 ? <span className="drawer-count-badge">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}
                        <ChevronRight className="drawer-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        {/* Account section bottom */}
        <div className="drawer-account">
          <div className="drawer-account-name">{fullName}</div>

          {viewerRole === "parent" && parentChildren.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>
                {t("player.selectedChild")}
              </div>
              <select
                value={selectedChildIdForView}
                onChange={(e) => switchParentChild(e.target.value)}
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.28)",
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                  padding: "8px 10px",
                  fontSize: 13,
                }}
              >
                {parentChildren.map((c) => {
                  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || t("player.playerFallback");
                  return (
                    <option key={c.id} value={c.id} style={{ color: "#111827" }}>
                      {name}
                      {c.is_primary ? ` (${t("player.primaryChild")})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

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
