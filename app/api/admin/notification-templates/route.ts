import { NextResponse } from "next/server";
import { createAdminClient, requirePlatformAdmin } from "../news/_lib";
import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NOTIFICATION_LOCALES, notificationTemplateDefaults, validateNotificationTemplate, notificationTranslationsMatch } from "@/lib/notificationCatalog";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    const db = createAdminClient(); const auth = await requirePlatformAdmin(req, db);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    const keys = Object.keys(notificationTemplateDefaults).flatMap(key => [`${key}.title`, `${key}.body`]);
    const result = await db.from("app_translations").select("locale,key,value").in("key", keys);
    if (result.error) throw result.error;
    return NextResponse.json({ rows: result.data ?? [], translationAvailable: Boolean(process.env.OPENAI_API_KEY) }, { headers });
  } catch { return NextResponse.json({ error: "Impossible de charger les modèles." }, { status: 503, headers }); }
}

export const POST = withAdminMutationAudit(async (req: Request) => {
  try {
    const db = createAdminClient(); const auth = await requirePlatformAdmin(req, db);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    const input = await req.json(); const key = String(input.key ?? "");
    if (!Object.hasOwn(notificationTemplateDefaults, key)) return NextResponse.json({ error: "Modèle inconnu." }, { status: 400, headers });
    const translations = input.translations;
    for (const locale of NOTIFICATION_LOCALES) {
      const error = validateNotificationTemplate(key, translations?.[locale]);
      if (error) return NextResponse.json({ error: `${locale.toUpperCase()} : ${error}` }, { status: 400, headers });
      if (!notificationTranslationsMatch(translations.fr, translations[locale])) return NextResponse.json({ error: `${locale.toUpperCase()} : les variables doivent correspondre au français.` }, { status: 400, headers });
    }
    const rows = NOTIFICATION_LOCALES.flatMap(locale => (["title", "body"] as const).map(field => ({
      locale, key: `${key}.${field}`, value: translations[locale][field].trim(), updated_by: auth.callerId, updated_at: new Date().toISOString(),
    })));
    // One database statement publishes the four languages together.
    const result = await db.from("app_translations").upsert(rows, { onConflict: "locale,key" });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true }, { headers });
  } catch { return NextResponse.json({ error: "Impossible d’enregistrer les modèles. Aucun succès confirmé." }, { status: 503, headers }); }
});
