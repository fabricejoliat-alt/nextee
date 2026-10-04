"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { etiquetteText } from "@/lib/etiquetteLabels";
import { isManagerClubScopedRoute, managerScopedHref } from "@/lib/managerNavigationContext";
import { requestManagerClubChange } from "@/components/manager/useManagerClubChangeGuard";
import { User, LogOut, X, ShieldCheck, Building2, CalendarDays, List, PlusCircle, Trophy, Gauge, Mail, Tent, Users, Newspaper, ChevronRight, Settings, LayoutDashboard, UserRound, SlidersHorizontal, FolderKanban, Network, Medal, CalendarRange, Bell, KeyRound, ListChecks, Sparkles, ClipboardCheck, ChartNoAxesCombined, ChartSpline, BookOpen, WandSparkles } from "lucide-react";

const ROUTES = {
  home: "/manager",
  userManagementPlayers: "/manager/user-management/players",
  userManagementParents: "/manager/user-management/parents",
  userManagementCoaches: "/manager/user-management/coaches",
  userManagementManagers: "/manager/user-management/managers",
  userManagementCustomFields: "/manager/user-management/custom-fields",
  userManagementSeasons: "/manager/user-management/seasons",
  userManagementEmailConfiguration: "/manager/user-management/email-configuration",
  news: "/manager/news",
  notifications: "/manager/notifications",
  groups: "/manager/groups",
  groupsNew: "/manager/groups/new",
  events: "/manager/calendar",
  camps: "/manager/camps",
  access: "/manager/access",
  om: "/manager/om",
  omContests: "/manager/om/contests",
  omTournaments: "/manager/om/tournaments",
  performanceJuniors: "/manager/performance/juniors",
  performanceCoaches: "/manager/performance/coaches",
  trainingVolume: "/manager/training-volume",
  evaluationCriteria: "/manager/evaluation-criteria",
  aiAssistance: "/manager/ai-assistance",
  rules: "/manager/rules",
  etiquette: "/manager/etiquette",
  profileEdit: "/manager/profile",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
};
type ManagedClub = { id: string; name: string | null };

function isActive(pathname: string, href: string) {
  if (href === "/manager") return pathname === "/manager";
  if (href === "/manager/groups") return pathname === "/manager/groups";
  if (href === "/manager/om") return pathname === "/manager/om";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function ManagerDesktopDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();

  const [fullName, setFullName] = useState<string>(t("common.defaultName"));
  const [organizationId, setOrganizationId] = useState<string>("");
  const [managedClubs, setManagedClubs] = useState<ManagedClub[]>([]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
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
  }, [t]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/manager/my-clubs", {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      const clubs = (Array.isArray(json?.clubs) ? json.clubs : [])
        .map((club: ManagedClub) => ({ id: String(club?.id ?? ""), name: club?.name ?? null }))
        .filter((club: ManagedClub) => Boolean(club.id));
      setManagedClubs(clubs);
      const firstClub = clubs[0];
      setOrganizationId((current) => current || String(firstClub?.id ?? ""));
    })();
  }, []);

  const requestedClubId = searchParams.get("club");
  const activeOrganizationId = requestedClubId && managedClubs.some((club) => club.id === requestedClubId)
    ? requestedClubId
    : organizationId;

  function handleNavigate() {
    setOrganizationId(activeOrganizationId);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    Object.values(ROUTES).forEach((href) => router.prefetch(href));
    if (activeOrganizationId) {
      router.prefetch(`/manager/organizations/${activeOrganizationId}/groups`);
    }
  }, [open, activeOrganizationId, router]);

  const navSections = useMemo(
    () => [
      {
        label: t("manager.nav.home"),
        items: [{ label: t("manager.nav.dashboard"), icon: LayoutDashboard, href: ROUTES.home }],
      },
      {
        label: t("manager.nav.organization"),
        groups: [
          {
            label: t("manager.nav.users"),
            icon: Users,
            children: [
              { label: t("manager.nav.juniors"), icon: UserRound, href: ROUTES.userManagementPlayers },
              { label: t("manager.administration.parents.title"), icon: Users, href: ROUTES.userManagementParents },
              { label: t("manager.nav.coaches"), icon: User, href: ROUTES.userManagementCoaches },
              { label: t("manager.nav.managers"), icon: ShieldCheck, href: ROUTES.userManagementManagers },
              { label: t("manager.fields.title"), icon: SlidersHorizontal, href: ROUTES.userManagementCustomFields },
              { label: t("manager.nav.familyAccess"), icon: KeyRound, href: ROUTES.access },
            ],
          },
          {
            label: t("manager.nav.groups"),
            icon: FolderKanban,
            children: [
              { label: t("manager.nav.allGroups"), icon: List, href: ROUTES.groups },
              { label: t("manager.nav.addGroup"), icon: PlusCircle, href: ROUTES.groupsNew },
              { label: t("manager.nav.groupOrganization"), icon: Network, href: activeOrganizationId ? `/manager/organizations/${activeOrganizationId}/groups` : ROUTES.groups },
            ],
          },
        ],
        itemsLabel: t("manager.nav.organization"),
        items: [
          { label: t("manager.nav.activities"), icon: CalendarDays, href: ROUTES.events },
          { label: t("manager.nav.camps"), icon: Tent, href: ROUTES.camps },
          { label: t("manager.nav.news"), icon: Newspaper, href: ROUTES.news },
        ],
      },
      {
        label: t("manager.nav.tracking"),
        itemsLabel: t("manager.nav.performance"),
        itemsIcon: Trophy,
        items: [
          { label: t("manager.nav.juniorStatistics"), icon: ChartNoAxesCombined, href: ROUTES.performanceJuniors },
          { label: t("manager.nav.coachStatistics"), icon: ChartSpline, href: ROUTES.performanceCoaches },
          { label: t("manager.nav.merit"), icon: Medal, href: ROUTES.om },
          { label: t("manager.nav.contests"), icon: ListChecks, href: ROUTES.omContests },
          { label: t("manager.nav.rules"), icon: BookOpen, href: ROUTES.rules },
          { label: etiquetteText(locale).title, icon: BookOpen, href: ROUTES.etiquette },
        ],
      },
      {
        label: t("manager.nav.settings"),
        itemsLabel: t("manager.nav.settings"),
        itemsIcon: Settings,
        items: [
          { label: t("manager.nav.seasons"), icon: CalendarRange, href: ROUTES.userManagementSeasons },
          { label: t("manager.nav.emails"), icon: Mail, href: ROUTES.userManagementEmailConfiguration },
          { label: t("manager.nav.trainingVolume"), icon: Gauge, href: ROUTES.trainingVolume },
          { label: t("manager.nav.criteria"), icon: ClipboardCheck, href: ROUTES.evaluationCriteria },
          { label: t("manager.nav.ai"), icon: WandSparkles, href: ROUTES.aiAssistance },
          { label: t("manager.nav.tournaments"), icon: Sparkles, href: ROUTES.omTournaments },
          { label: t("manager.nav.notifications"), icon: Bell, href: ROUTES.notifications },
        ],
      },
    ],
    [t, locale, activeOrganizationId]
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
          <Link href={ROUTES.home} className="drawer-brand" onClick={handleNavigate} aria-label="ActiviTee">
            <span className="drawer-brand-nex">Activi</span>
            <span className="drawer-brand-tee">Tee</span>
          </Link>

          <button className="icon-btn drawer-close" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <nav className="drawer-nav">
          {navSections.map((section) => (
            <section key={section.label} className="drawer-section">
              {section.groups?.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.label} className="drawer-group">
                    <div className="drawer-group-label">
                      <GroupIcon size={15} strokeWidth={1.8} />
                      <span>{group.label}</span>
                    </div>
                    <div className="drawer-sub">
                      {group.children.map((c) => {
                        const CIcon = c.icon;
                        const active = isActive(pathname, c.href);
                        return (
                          <Link key={c.label} href={managerScopedHref(c.href, activeOrganizationId)} className={`drawer-subitem ${active ? "active" : ""}`} onClick={handleNavigate}>
                            <span className="drawer-item-left"><CIcon size={15} strokeWidth={1.8} /><span>{c.label}</span></span>
                            <ChevronRight className="drawer-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {section.itemsLabel ? (
                <>
                  <div className="drawer-subsection-label">
                    {(() => {
                      const ItemsIcon = section.itemsIcon ?? Building2;
                      return <ItemsIcon size={15} strokeWidth={1.8} />;
                    })()}
                    <span>{section.itemsLabel}</span>
                  </div>
                  <div className="drawer-sub">
                    {section.items?.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(pathname, item.href);
                      return (
                        <Link key={item.label} href={managerScopedHref(item.href, activeOrganizationId)} className={`drawer-subitem ${active ? "active" : ""}`} onClick={handleNavigate}>
                          <span className="drawer-item-left"><Icon size={15} strokeWidth={1.8} /><span>{item.label}</span></span>
                          <ChevronRight className="drawer-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>
                </>
              ) : section.items?.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item.href);
                  return (
                  <Link key={item.label} href={managerScopedHref(item.href, activeOrganizationId)} className={`drawer-item ${active ? "active" : ""}`} onClick={handleNavigate}>
                      <span className="drawer-item-left"><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span></span>
                      <ChevronRight className="drawer-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
                    </Link>
                  );
                })}
            </section>
          ))}
        </nav>

        <div className="drawer-account">
          <div className="drawer-account-name">{fullName}</div>

          {managedClubs.length > 1 ? (
            <label className="drawer-club-context drawer-club-context--account">
              <span>{t("manager.nav.activeClub")}</span>
              <select value={activeOrganizationId} onChange={(event) => {
                const nextId = event.target.value;
                if (!requestManagerClubChange()) return;
                setOrganizationId(nextId);
                if (pathname.includes("/organizations/") && pathname.endsWith("/groups")) router.push(`/manager/organizations/${nextId}/groups`);
                if (pathname === "/manager/groups") router.push(`/manager/groups?club=${encodeURIComponent(nextId)}`);
                if (isManagerClubScopedRoute(pathname) && pathname !== ROUTES.groups) router.push(managerScopedHref(pathname, nextId));
              }}>
                {managedClubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? t("common.club")}</option>)}
              </select>
            </label>
          ) : null}

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
