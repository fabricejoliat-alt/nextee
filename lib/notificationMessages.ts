import { renderNotificationTemplate, type NotificationLocale, type NotificationParams } from "@/lib/notificationCatalog";
export { notificationTemplateDefaults } from "@/lib/notificationCatalog";
export type { NotificationLocale } from "@/lib/notificationCatalog";
const loadedAt = new Map<NotificationLocale, number>();
const overridesByLocale = new Map<NotificationLocale, Record<string, string>>();
const inFlightByLocale = new Map<NotificationLocale, Promise<Record<string, string>>>();

async function loadOverrides(locale: NotificationLocale) {
  const cached = overridesByLocale.get(locale);
  if (cached && Date.now() - (loadedAt.get(locale) ?? 0) < 30_000) return cached;

  const pending = inFlightByLocale.get(locale);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`/api/i18n/messages?locale=${locale}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return {};
      const map = (json.overrides ?? {}) as Record<string, string>;
      overridesByLocale.set(locale, map); loadedAt.set(locale, Date.now());
      return map;
    } catch {
      return {};
    } finally {
      inFlightByLocale.delete(locale);
    }
  })();

  inFlightByLocale.set(locale, p);
  return p;
}

export async function getNotificationMessage(key: string, locale: NotificationLocale, params: NotificationParams = {}) {
  const overrides = await loadOverrides(locale);
  return { ...renderNotificationTemplate(key, locale, params, overrides), templateKey: key, templateParams: params };
}
