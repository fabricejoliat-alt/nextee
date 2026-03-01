"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  
  trainingsList: "/player/golf/trainings?type=all",
  trainingsListTraining: "/player/golf/trainings?type=training",
  trainingsToComplete: "/player/golf/trainings/to-complete",
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

      const { data: auth } = await supabase.auth.getUser();
      const displayUserId = auth.user?.id ?? "";
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

      let resolvedViewerRole: "player" | "parent" = "player";
      let resolvedChildren: ParentChildLite[] = [];
      let resolvedSelectedChildId = "";
      if (role === "parent") {
        resolvedViewerRole = "parent";
        const childrenRes = await fetch("/api/parent/children", { method: "GET", headers, cache: "no-store" });
        const childrenJson = await childrenRes.json().catch(() => ({}));
        const list = (childrenRes.ok ? (childrenJson?.children ?? []) : []) as ParentChildLite[];
        resolvedChildren = list;
        const stored = window.localStorage.getItem("parent:selected_child_id");
        resolvedSelectedChildId =
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
  }, [open, t]);

  useEffect(() => {
    if (viewerRole !== "parent" || !selectedChildId) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("parent:selected_child_id", selectedChildId);
    }
  }, [viewerRole, selectedChildId]);

  useEffect(() => {
    if (!open) return;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      let uid = auth.user?.id ?? "";
      if (viewerRole === "parent" && selectedChildId) uid = selectedChildId;
      if (!uid) {
        setPendingEvalCount(0);
        return;
      }

      const sRes = await supabase
        .from("training_sessions")
        .select("id,start_at,club_event_id,motivation,difficulty,satisfaction")
        .eq("user_id", uid);
      if (sRes.error) {
        setPendingEvalCount(0);
        return;
      }
      const sessions = sRes.data ?? [];
      const sessionIds = sessions.map((s: any) => s.id as string);

      const sessionItemsById: Record<string, { minutes: number }[]> = {};
      if (sessionIds.length > 0) {
        const itemsRes = await supabase
          .from("training_session_items")
          .select("session_id,minutes")
          .in("session_id", sessionIds);
        if (!itemsRes.error) {
          for (const row of itemsRes.data ?? []) {
            const sid = row.session_id as string;
            if (!sessionItemsById[sid]) sessionItemsById[sid] = [];
            sessionItemsById[sid].push({ minutes: Number(row.minutes ?? 0) });
          }
        }
      }

      const completeSessionIds = new Set<string>();
      for (const s of sessions as any[]) {
        const items = sessionItemsById[s.id] ?? [];
        const hasPoste = items.some((it) => (it.minutes ?? 0) > 0);
        const hasSensations =
          typeof s.motivation === "number" &&
          typeof s.difficulty === "number" &&
          typeof s.satisfaction === "number";
        if (hasPoste && hasSensations) completeSessionIds.add(s.id);
      }

      const nowTs = Date.now();
      const incompletePastSessionsCount = (sessions as any[])
        .filter((s) => new Date(String(s.start_at)).getTime() < nowTs)
        .filter((s) => !completeSessionIds.has(String(s.id))).length;

      const completedEventIds = new Set(
        (sessions as any[])
          .filter((s) => completeSessionIds.has(String(s.id)))
          .map((s) => (s.club_event_id ? String(s.club_event_id) : null))
          .filter((x): x is string => !!x)
      );
      const eventIdsWithAnySession = new Set(
        (sessions as any[])
          .map((s) => (s.club_event_id ? String(s.club_event_id) : null))
          .filter((x): x is string => !!x)
      );

      const aRes = await supabase
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", uid);
      if (aRes.error) {
        setPendingEvalCount(incompletePastSessionsCount);
        return;
      }
      const eventIds = Array.from(new Set((aRes.data ?? []).map((r: any) => String(r.event_id))));

      let incompleteEventsCount = 0;
      if (eventIds.length > 0) {
        const eRes = await supabase
          .from("club_events")
          .select("id,event_type,starts_at,status")
          .in("id", eventIds);
        if (!eRes.error) {
          incompleteEventsCount = (eRes.data ?? [])
            .filter((ev: any) => ev.status === "scheduled")
            .filter((ev: any) => ev.event_type === "training")
            .filter((ev: any) => new Date(String(ev.starts_at)).getTime() < nowTs)
            .filter((ev: any) => !completedEventIds.has(String(ev.id)))
            .filter((ev: any) => !eventIdsWithAnySession.has(String(ev.id))).length;
        }
      }

      setPendingEvalCount(incompletePastSessionsCount + incompleteEventsCount);
    })();
  }, [open, viewerRole, selectedChildId]);

  const nav = useMemo(
    () => [
      {
        label: t("nav.home"),
        icon: Home,
        href: ROUTES.home,
      },
      {
        label: locale === "fr" ? "Mon activité" : "My activity",
        icon: ClipboardList,
        href: ROUTES.trainingsList,
      },
      {
        label: t("player.myGolf"),
        icon: Flag,
        children: [
          { label: "Dashboard", icon: Home, href: ROUTES.golfDashboard },
          {
            label: locale === "fr" ? "Mes entrainements" : "My trainings",
            icon: ClipboardList,
            href: ROUTES.trainingsListTraining,
          },
          {
            label: locale === "fr" ? "Ajouter un entrainement" : "Add training",
            icon: PlusCircle,
            href: ROUTES.trainingsNew,
          },
          {
            label:
              locale === "fr"
                ? `Entrainement à évaluer (${pendingEvalCount})`
                : `To complete (${pendingEvalCount})`,
            icon: ClipboardList,
            href: ROUTES.trainingsToComplete,
          },
          { label: locale === "fr" ? "Mes parcours" : t("player.rounds"), icon: Map, href: ROUTES.roundsList },
          { label: locale === "fr" ? "Ajouter un parcours" : t("player.newRound"), icon: PlusCircle, href: ROUTES.roundsNew },
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
    [t, locale, pendingEvalCount]
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
            const activeTop = item.href
              ? isTrainingChildActive(pathname, searchParams, item.href)
              : item.children?.some((c) => isTrainingChildActive(pathname, searchParams, c.href));

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
                    const active = isTrainingChildActive(pathname, searchParams, c.href);
                    return (
                      <Link
                        key={c.label}
                        href={c.href}
                        className={`drawer-subitem ${active ? "active" : ""}`}
                        onClick={onClose}
                      >
                        <span className="drawer-item-left">
                          <CIcon size={16} strokeWidth={2} />
                          <span
                            style={
                              c.href === ROUTES.trainingsToComplete && pendingEvalCount > 0
                                ? { color: "#b91c1c", fontWeight: 900 }
                                : undefined
                            }
                          >
                            {c.label}
                          </span>
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

          {viewerRole === "parent" && parentChildren.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>
                Enfant sélectionné
              </div>
              <select
                value={selectedChildId}
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
                  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Joueur";
                  return (
                    <option key={c.id} value={c.id} style={{ color: "#111827" }}>
                      {name}
                      {c.is_primary ? " (principal)" : ""}
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
