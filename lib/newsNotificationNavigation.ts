/** Resolve only news notifications; all other notification routes stay unchanged. */
export function newsNotificationHref(notification: { kind: string; data: Record<string, unknown> } | null, homeHref: string) {
  if (notification?.kind !== "manager_news") return null;
  const data = notification.data ?? {};
  const newsId = String(data.platform_news_id ?? data.news_id ?? "").trim();
  if (!newsId) return null;
  const role = homeHref === "/manager" ? "manager" : homeHref === "/coach" ? "coach" : "player";
  const params = new URLSearchParams({ news_id: newsId });
  if (role === "manager" && data.club_id) params.set("club", String(data.club_id));
  if (role === "player" && data.child_id) params.set("child_id", String(data.child_id));
  return `/${role}/news?${params}`;
}
