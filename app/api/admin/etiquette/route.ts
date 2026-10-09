import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { etiquetteAccess, etiquetteFields } from "@/lib/server/etiquetteApi";

export async function GET(req: NextRequest) {
  try {
    const access = await etiquetteAccess(req);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const themes = await access.db.from("etiquette_themes").select("*").order("position");
    if (themes.error) throw themes.error;
    const cards = await access.db.from("etiquette_cards").select("*").order("position");
    if (cards.error) throw cards.error;
    const versions = await access.db.from("etiquette_card_versions").select(etiquetteFields).order("version", { ascending: false });
    if (versions.error) throw versions.error;
    const latest = new Map<string, (typeof versions.data)[number]>();
    for (const version of versions.data ?? []) if (version.locale === "fr" && !latest.has(version.card_id)) latest.set(version.card_id, version);
    return NextResponse.json({ themes: (themes.data ?? []).map((theme) => ({ ...theme,
      cards: (cards.data ?? []).filter((card) => card.theme_id === theme.id).map((card) => ({
        ...card, latest: latest.get(card.id) ?? null,
      })),
    })) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load etiquette" }, { status: 500 });
  }
}

export const PATCH = withAdminMutationAudit(async function PATCH(req: NextRequest) {
  try {
    const access = await etiquetteAccess(req);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (body.action === "publish") {
      const themeId = String(body.themeId ?? "");
      const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        global: { headers: { Authorization: `Bearer ${access.token}` } }, auth: { persistSession: false },
      });
      const result = await userDb.rpc("etiquette_publish_theme", { p_theme_id: themeId });
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
      return NextResponse.json({ published: true });
    }
    if (body.action === "save_theme") {
      const title = String(body.title_fr ?? "").trim();
      if (!title) return NextResponse.json({ error: "French title required" }, { status: 400 });
      const current = await access.db.from("etiquette_themes").select("title_i18n").eq("id", String(body.themeId)).single();
      if (current.error) throw current.error;
      const result = await access.db.from("etiquette_themes").update({ title_i18n: { ...current.data.title_i18n, fr: title } })
        .eq("id", String(body.themeId)).select("*").single();
      if (result.error) throw result.error;
      return NextResponse.json({ theme: result.data });
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to update etiquette" }, { status: 500 });
  }
});
