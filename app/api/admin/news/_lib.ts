import { createClient } from "@supabase/supabase-js";

export const PLATFORM_NEWS_LOCALES = ["fr", "en", "de", "it"] as const;
export type PlatformNewsLocale = (typeof PLATFORM_NEWS_LOCALES)[number];
export const PLATFORM_NEWS_ROLES = ["player", "coach", "manager"] as const;
export type PlatformNewsRole = (typeof PLATFORM_NEWS_ROLES)[number];

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration Supabase manquante.");
  return createClient(url, key);
}

export async function requirePlatformAdmin(req: Request, database: ReturnType<typeof createAdminClient>) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return { ok: false as const, status: 401, error: "Session manquante." };
  const auth = await database.auth.getUser(token);
  if (auth.error || !auth.data.user) return { ok: false as const, status: 401, error: "Session invalide." };
  const admin = await database.from("app_admins").select("user_id").eq("user_id", auth.data.user.id).maybeSingle();
  if (admin.error || !admin.data) return { ok: false as const, status: 403, error: "Accès refusé." };
  return { ok: true as const, callerId: auth.data.user.id };
}

export function normalizeStatus(value: unknown) {
  const status = String(value ?? "draft");
  return (["draft", "scheduled", "published", "archived"].includes(status) ? status : "draft") as
    | "draft" | "scheduled" | "published" | "archived";
}

export function normalizeTranslations(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return PLATFORM_NEWS_LOCALES.map((locale) => {
    const raw = input[locale] && typeof input[locale] === "object" ? input[locale] as Record<string, unknown> : {};
    return {
      locale,
      title: String(raw.title ?? "").trim(),
      summary: String(raw.summary ?? "").trim() || null,
      body: String(raw.body ?? "").trim(),
    };
  }).filter((row) => row.title || row.summary || row.body);
}

export function normalizePlatformTargets(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  const byClub = new Map<string, Set<PlatformNewsRole>>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const clubId = String(raw.club_id ?? "").trim();
    if (!clubId) continue;
    const roles = Array.isArray(raw.roles)
      ? raw.roles.map(String).filter((role): role is PlatformNewsRole => PLATFORM_NEWS_ROLES.includes(role as PlatformNewsRole))
      : [];
    if (!roles.length) continue;
    const current = byClub.get(clubId) ?? new Set<PlatformNewsRole>();
    roles.forEach((role) => current.add(role));
    byClub.set(clubId, current);
  }
  return Array.from(byClub, ([club_id, roles]) => ({ club_id, roles: Array.from(roles) }));
}

export async function fetchPlatformNews(database: ReturnType<typeof createAdminClient>) {
  const [news, clubs, targets, translations] = await Promise.all([
    database.from("platform_news").select("id,status,scheduled_for,published_at,visible_on_home,image_url,created_at,updated_at").order("updated_at", { ascending: false }),
    database.from("clubs").select("id,name").order("name", { ascending: true }),
    database.from("platform_news_clubs").select("news_id,club_id,target_roles"),
    database.from("platform_news_translations").select("news_id,locale,title,summary,body"),
  ]);
  for (const result of [news, clubs, targets, translations]) if (result.error) throw new Error(result.error.message);

  const targetsByNews = new Map<string, Array<{ club_id: string; roles: PlatformNewsRole[] }>>();
  for (const row of targets.data ?? []) {
    const id = String(row.news_id); const values = targetsByNews.get(id) ?? [];
    values.push({ club_id: String(row.club_id), roles: (Array.isArray(row.target_roles) ? row.target_roles : PLATFORM_NEWS_ROLES) as PlatformNewsRole[] });
    targetsByNews.set(id, values);
  }
  const translationsByNews = new Map<string, Record<string, { title: string; summary: string | null; body: string }>>();
  for (const row of translations.data ?? []) {
    const id = String(row.news_id); const values = translationsByNews.get(id) ?? {};
    values[String(row.locale)] = { title: String(row.title), summary: row.summary == null ? null : String(row.summary), body: String(row.body ?? "") };
    translationsByNews.set(id, values);
  }
  return {
    clubs: (clubs.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? "Club") })),
    news: (news.data ?? []).map((row) => ({
      ...row,
      targets: targetsByNews.get(String(row.id)) ?? [],
      translations: translationsByNews.get(String(row.id)) ?? {},
    })),
  };
}
