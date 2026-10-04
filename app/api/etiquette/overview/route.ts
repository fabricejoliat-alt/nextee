import { NextRequest, NextResponse } from "next/server";
import { etiquetteAccess, etiquetteFields } from "@/lib/server/etiquetteApi";

export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get("scope");
    if (scope !== "player" && scope !== "coach" && scope !== "manager")
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    const access = await etiquetteAccess(req, scope);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const themes = await access.db.from("etiquette_themes").select("id,stable_key,position,title_i18n,status")
      .eq("status", "published").order("position");
    if (themes.error) throw themes.error;
    const selected = themes.data?.find((item) => item.stable_key === req.nextUrl.searchParams.get("theme")) ?? themes.data?.[0];
    if (!selected) return NextResponse.json({ themes: [], selectedTheme: null, cards: [] });
    const cards = await access.db.from("etiquette_cards").select("id,stable_key,position,published_version_id")
      .eq("theme_id", selected.id).order("position");
    if (cards.error) throw cards.error;
    const ids = (cards.data ?? []).map((item) => item.published_version_id).filter((id): id is string => Boolean(id));
    const versions = ids.length ? await access.db.from("etiquette_card_versions").select(etiquetteFields)
      .in("id", ids).eq("editorial_status", "approved") : { data: [], error: null };
    if (versions.error) throw versions.error;
    const byId = new Map((versions.data ?? []).map((item) => [item.id, item]));
    const locale = req.nextUrl.searchParams.get("locale");
    const translations = locale && ["en", "de", "it"].includes(locale) && cards.data?.length
      ? await access.db.from("etiquette_card_versions").select(etiquetteFields)
        .in("card_id", cards.data.map((card) => card.id)).eq("locale", locale).eq("editorial_status", "approved")
      : { data: [], error: null };
    if (translations.error) throw translations.error;
    return NextResponse.json({ themes: themes.data ?? [], selectedTheme: selected,
      cards: (cards.data ?? []).flatMap((card) => {
        const french = byId.get(card.published_version_id);
        if (!french) return [];
        const translation = (translations.data ?? []).find((item) => item.card_id === card.id && item.version === french.version && item.approved_at);
        return [{ ...card, version: translation ?? french }];
      }) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load etiquette" }, { status: 500 });
  }
}
