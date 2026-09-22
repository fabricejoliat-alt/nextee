"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { User, LogOut, X, ShieldCheck, Building2, CalendarDays, List, PlusCircle, Trophy, Gauge, Mail, Tent, Users, Newspaper, ChevronRight, Settings, LayoutDashboard, UserRound, SlidersHorizontal, FolderKanban, Network, Medal, CalendarRange, Bell, KeyRound, ListChecks, Sparkles, ClipboardCheck, ChartNoAxesCombined, ChartSpline, BookOpen } from "lucide-react";

const ROUTES = {
  home: "/manager",
  userManagementPlayers: "/manager/user-management/players",
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
  rules: "/manager/rules",
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

  useEffect(() => {
    if (!open) return;
    Object.values(ROUTES).forEach((href) => router.prefetch(href));
    if (organizationId) {
      router.prefetch(`/manager/organizations/${organizationId}/groups`);
    }
  }, [open, organizationId, router]);

  const navSections = useMemo(
    () => [
      {
        label: locale === "fr" ? "Accueil" : "Home",
        items: [{ label: locale === "fr" ? "Tableau de bord" : "Dashboard", icon: LayoutDashboard, href: ROUTES.home }],
      },
      {
        label: locale === "fr" ? "Organisation" : "Organization",
        groups: [
          {
            label: locale === "fr" ? "Gestion des utilisateurs" : "User management",
            icon: Users,
            children: [
              { label: locale === "fr" ? "Juniors" : "Players", icon: UserRound, href: ROUTES.userManagementPlayers },
              { label: "Coachs", icon: User, href: ROUTES.userManagementCoaches },
              { label: "Manager", icon: ShieldCheck, href: ROUTES.userManagementManagers },
              { label: locale === "fr" ? "Champs personnalisés" : "Custom fields", icon: SlidersHorizontal, href: ROUTES.userManagementCustomFields },
              { label: locale === "fr" ? "Accès aux familles" : "Family access", icon: KeyRound, href: ROUTES.access },
            ],
          },
          {
            label: locale === "fr" ? "Gestion des groupes" : "Group management",
            icon: FolderKanban,
            children: [
              { label: locale === "fr" ? "Tous les groupes" : "All groups", icon: List, href: ROUTES.groups },
              { label: locale === "fr" ? "Ajouter un groupe" : "Add group", icon: PlusCircle, href: ROUTES.groupsNew },
              { label: locale === "fr" ? "Organisation des groupes" : "Group organization", icon: Network, href: organizationId ? `/manager/organizations/${organizationId}/groups` : ROUTES.groups },
            ],
          },
        ],
        itemsLabel: locale === "fr" ? "Organisation" : "Organization",
        items: [
          { label: locale === "fr" ? "Activités" : "Activities", icon: CalendarDays, href: ROUTES.events },
          { label: locale === "fr" ? "Stages / camps" : "Camps", icon: Tent, href: ROUTES.camps },
          { label: "News", icon: Newspaper, href: ROUTES.news },
        ],
      },
      {
        label: locale === "fr" ? "Suivi" : "Tracking",
        itemsLabel: locale === "fr" ? "Performance" : "Performance",
        itemsIcon: Trophy,
        items: [
          { label: locale === "fr" ? "Statistiques juniors" : "Player statistics", icon: ChartNoAxesCombined, href: ROUTES.performanceJuniors },
          { label: locale === "fr" ? "Statistiques coachs" : "Coach statistics", icon: ChartSpline, href: ROUTES.performanceCoaches },
          { label: locale === "fr" ? "Ordre du mérite" : "Order of Merit", icon: Medal, href: ROUTES.om },
          { label: locale === "fr" ? "Concours internes" : "Internal contests", icon: ListChecks, href: ROUTES.omContests },
          { label: locale === "fr" ? "Règles de golf" : "Rules of golf", icon: BookOpen, href: ROUTES.rules },
        ],
      },
      {
        label: locale === "fr" ? "Paramètres" : "Settings",
        itemsLabel: locale === "fr" ? "Paramètres" : "Settings",
        itemsIcon: Settings,
        items: [
          { label: locale === "fr" ? "Saisons" : "Seasons", icon: CalendarRange, href: ROUTES.userManagementSeasons },
          { label: locale === "fr" ? "E-mails" : "Emails", icon: Mail, href: ROUTES.userManagementEmailConfiguration },
          { label: locale === "fr" ? "Volume d'entraînement" : "Training volume", icon: Gauge, href: ROUTES.trainingVolume },
          { label: locale === "fr" ? "Critères d’évaluation" : "Evaluation criteria", icon: ClipboardCheck, href: ROUTES.evaluationCriteria },
          { label: locale === "fr" ? "Tournois exceptionnels" : "Exceptional tournaments", icon: Sparkles, href: ROUTES.omTournaments },
          { label: locale === "fr" ? "Notifications" : "Notifications", icon: Bell, href: ROUTES.notifications },
        ],
      },
    ],
    [locale, organizationId]
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
                          <Link key={c.label} href={c.href} className={`drawer-subitem ${active ? "active" : ""}`} onClick={onClose}>
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
                        <Link key={item.label} href={item.href} className={`drawer-subitem ${active ? "active" : ""}`} onClick={onClose}>
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
                    <Link key={item.label} href={item.href} className={`drawer-item ${active ? "active" : ""}`} onClick={onClose}>
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
              <span>Club actif</span>
              <select value={organizationId} onChange={(event) => {
                const nextId = event.target.value;
                setOrganizationId(nextId);
                if (pathname.includes("/organizations/") && pathname.endsWith("/groups")) router.push(`/manager/organizations/${nextId}/groups`);
                if (pathname === "/manager/groups") router.push(`/manager/groups?club=${encodeURIComponent(nextId)}`);
              }}>
                {managedClubs.map((club) => <option key={club.id} value={club.id}>{club.name ?? "Club"}</option>)}
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
