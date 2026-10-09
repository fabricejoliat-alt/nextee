import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, normalizePlatformTargets, normalizeStatus, normalizeTranslations, requirePlatformAdmin } from "../_lib";

export const PATCH = withAdminMutationAudit(async function PATCH(req: NextRequest, context: { params: Promise<{ newsId: string }> }) {
  try {
    const { newsId } = await context.params;
    const database = createAdminClient(); const auth = await requirePlatformAdmin(req, database);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const current = await database.from("platform_news").select("id,published_at").eq("id", newsId).maybeSingle();
    if (current.error) return NextResponse.json({ error: current.error.message }, { status: 400 });
    if (!current.data) return NextResponse.json({ error: "Actualité introuvable." }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const targets = normalizePlatformTargets(body.targets);
    const translations = normalizeTranslations(body.translations); const french = translations.find((row) => row.locale === "fr");
    const status = normalizeStatus(body.status);
    const scheduledDate = body.scheduled_for ? new Date(String(body.scheduled_for)) : null;
    if (scheduledDate && Number.isNaN(scheduledDate.getTime())) return NextResponse.json({ error: "Date de programmation invalide." }, { status: 400 });
    const scheduledFor = scheduledDate?.toISOString() ?? null;
    if (!targets.length) return NextResponse.json({ error: "Sélectionne au moins un destinataire." }, { status: 400 });
    if (!french?.title) return NextResponse.json({ error: "Le titre français est obligatoire." }, { status: 400 });
    if (status === "scheduled" && !scheduledFor) return NextResponse.json({ error: "La date de programmation est obligatoire." }, { status: 400 });
    const translationMap = Object.fromEntries(translations.map((row) => [row.locale, row]));
    const saved = await database.rpc("save_platform_news_v2", {
      p_news_id: newsId, p_actor_id: auth.callerId, p_status: status,
      p_scheduled_for: status === "scheduled" ? scheduledFor : null,
      p_visible_on_home: Boolean(body.visible_on_home), p_image_url: String(body.image_url ?? "").trim() || null,
      p_targets: targets, p_translations: translationMap,
    });
    if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 }); }
});

export const DELETE = withAdminMutationAudit(async function DELETE(req: NextRequest, context: { params: Promise<{ newsId: string }> }) {
  try {
    const { newsId } = await context.params; const database = createAdminClient(); const auth = await requirePlatformAdmin(req, database);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const result = await database.from("platform_news").delete().eq("id", newsId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 }); }
});
