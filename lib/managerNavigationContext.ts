const CLUB_SCOPED_ROUTES = new Set([
  "/manager/user-management/players",
  "/manager/user-management/parents",
  "/manager/user-management/coaches",
  "/manager/user-management/managers",
  "/manager/user-management/custom-fields",
  "/manager/user-management/seasons",
  "/manager/user-management/email-configuration",
  "/manager/training-volume",
  "/manager/ai-assistance",
  "/manager/evaluation-criteria",
  "/manager/groups",
  "/manager/access",
  "/manager/performance/juniors",
  "/manager/performance/coaches",
  "/manager/om",
  "/manager/news",
]);

export function managerScopedHref(href: string, clubId: string) {
  if (clubId && href === "/manager/groups/new") return `${href}?organizationId=${encodeURIComponent(clubId)}`;
  return clubId && CLUB_SCOPED_ROUTES.has(href) ? `${href}?club=${encodeURIComponent(clubId)}` : href;
}

export function isManagerClubScopedRoute(href: string) {
  return CLUB_SCOPED_ROUTES.has(href);
}
