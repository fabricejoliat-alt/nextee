import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function database() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

async function authorize(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const db = database();
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const admin = await db.from("app_admins").select("user_id").eq("user_id", auth.data.user.id).maybeSingle();
  if (admin.error || !admin.data) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { db, userId: auth.data.user.id } as const;
}

function finiteInteger(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function validIso(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const access = await authorize(req);
    if ("error" in access) return access.error;
    const { db } = access;
    const seasonsResult = await db.from("rules_seasons").select("*").order("created_at", { ascending: false });
    if (seasonsResult.error) throw seasonsResult.error;
    const season = seasonsResult.data?.[0] ?? null;
    if (!season) return NextResponse.json({ seasons: [], season: null, series: [] });
    const seriesResult = await db.from("rules_series").select("*").eq("season_id", season.id).order("position");
    if (seriesResult.error) throw seriesResult.error;
    const series = seriesResult.data ?? [];
    const seriesIds = series.map((item) => item.id);
    const cardsResult = seriesIds.length ? await db.from("rules_series_cards").select("series_id,position,card_version_id,rules_card_versions(id,title,official_reference,human_review_required,approved_at,image_status,rules_cards(id,stable_key,difficulty,recommended_age_min,recommended_age_max,editorial_status))").in("series_id", seriesIds).order("position") : { data: [], error: null };
    if (cardsResult.error) throw cardsResult.error;
    const validations = await Promise.all(series.map(async (item) => {
      const result = await db.rpc("validate_rules_series_for_publication", { p_series_id: item.id });
      return [item.id, result.error ? { valid: false, card_count: 0, invalid_card_count: 0, error: result.error.message } : result.data] as const;
    }));
    const cardsBySeries = Object.fromEntries(seriesIds.map((seriesId) => [seriesId, (cardsResult.data ?? []).filter((card) => card.series_id === seriesId)]));
    return NextResponse.json({ seasons: seasonsResult.data ?? [], season, series: series.map((item) => ({ ...item, validation: Object.fromEntries(validations)[item.id], cards: cardsBySeries[item.id] ?? [] })) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load rules administration" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const access = await authorize(req);
    if ("error" in access) return access.error;
    const { db, userId } = access;
    const body = await req.json().catch(() => ({}));
    const entity = String(body?.entity ?? "");
    const id = String(body?.id ?? "");
    const action = String(body?.action ?? "save");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    if (entity === "season") {
      const current = await db.from("rules_seasons").select("id,status").eq("id", id).single();
      if (current.error) throw current.error;
      if (action === "publish") {
        if (current.data.status === "published") return NextResponse.json({ season: current.data });
        if (current.data.status !== "draft") {
          return NextResponse.json({ error: "Cette saison ne peut pas être activée dans son état actuel." }, { status: 409 });
        }
        const series = await db.from("rules_series").select("id").eq("season_id", id).eq("status", "published").limit(1);
        if (series.error) throw series.error;
        if (!series.data?.length) return NextResponse.json({ error: "Publiez d’abord au moins une série validée." }, { status: 409 });
        const published = await db.from("rules_seasons").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", id).eq("status", current.data.status).select("*").single();
        if (published.error) throw published.error;
        await db.from("rules_admin_events").insert({ actor_user_id: userId, entity_type: "season", entity_id: id, action: "published", details: { first_published_series_id: series.data[0].id } });
        return NextResponse.json({ season: published.data });
      }
      if (current.data.status === "published" || current.data.status === "archived") {
        return NextResponse.json({ error: "Le barème d’une saison publiée est verrouillé." }, { status: 409 });
      }
      const points = finiteInteger(body.points_per_correct, 0, 10_000);
      const maxSpeed = finiteInteger(body.max_speed_bonus, 0, 1_000);
      const freeSeconds = finiteInteger(body.free_reading_seconds, 0, 3_600);
      const decaySeconds = finiteInteger(body.speed_decay_seconds, 1, 3_600);
      const perfect = finiteInteger(body.perfect_bonus, 0, 10_000);
      const retained = finiteInteger(body.retained_scores, 10, 15);
      const minimum = finiteInteger(body.minimum_club_participants, 1, 1_000);
      if ([points, maxSpeed, freeSeconds, decaySeconds, perfect, retained, minimum].some((value) => value === null) || ![10, 15].includes(retained!)) {
        return NextResponse.json({ error: "Invalid scoring configuration" }, { status: 400 });
      }
      const titleFr = String(body?.title_fr ?? "").trim();
      const titleEn = String(body?.title_en ?? "").trim();
      if (!titleFr) return NextResponse.json({ error: "French title is required" }, { status: 400 });
      const update = await db.from("rules_seasons").update({
        title_i18n: { fr: titleFr, en: titleEn },
        reference_version: String(body?.reference_version ?? "").trim(),
        points_per_correct: points,
        speed_bonus_enabled: Boolean(body?.speed_bonus_enabled),
        max_speed_bonus: maxSpeed,
        free_reading_seconds: freeSeconds,
        speed_decay_seconds: decaySeconds,
        perfect_bonus: perfect,
        retained_scores: retained,
        minimum_club_participants: minimum,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select("*").single();
      if (update.error) throw update.error;
      await db.from("rules_admin_events").insert({ actor_user_id: userId, entity_type: "season", entity_id: id, action: "updated", details: { scoring: true } });
      return NextResponse.json({ season: update.data });
    }

    if (entity === "series") {
      const current = await db.from("rules_series").select("*").eq("id", id).single();
      if (current.error) throw current.error;
      if (action === "publish") {
        if (current.data.status === "published") return NextResponse.json({ series: current.data });
        if (current.data.locked_at || !["draft", "scheduled"].includes(current.data.status)) {
          return NextResponse.json({ error: "Cette série est déjà verrouillée ou archivée." }, { status: 409 });
        }
        const validation = await db.rpc("validate_rules_series_for_publication", { p_series_id: id });
        if (validation.error) throw validation.error;
        if (!validation.data?.valid) return NextResponse.json({ error: "La série est incomplète et ne peut pas être publiée.", validation: validation.data }, { status: 409 });
        const now = new Date().toISOString();
        const published = await db.from("rules_series").update({ status: "published", published_at: now, locked_at: now }).eq("id", id).eq("status", current.data.status).is("locked_at", null).select("*").single();
        if (published.error) throw published.error;
        await db.from("rules_admin_events").insert({ actor_user_id: userId, entity_type: "series", entity_id: id, action: "published", details: validation.data });
        return NextResponse.json({ series: published.data, validation: validation.data });
      }
      if (current.data.locked_at) return NextResponse.json({ error: "Cette série publiée est verrouillée. Créez une nouvelle version pour la modifier." }, { status: 409 });
      const discovery = validIso(body.discovery_starts_at);
      const opens = validIso(body.quiz_opens_at);
      const closes = validIso(body.quiz_closes_at);
      const results = validIso(body.results_published_at);
      if (!discovery || !opens || !closes || !results || !(discovery < opens && opens < closes && closes <= results)) {
        return NextResponse.json({ error: "Les dates de la série sont incohérentes." }, { status: 400 });
      }
      const titleFr = String(body?.title_fr ?? "").trim();
      const titleEn = String(body?.title_en ?? "").trim();
      if (!titleFr) return NextResponse.json({ error: "French title is required" }, { status: 400 });
      const updated = await db.from("rules_series").update({
        title_i18n: { fr: titleFr, en: titleEn }, discovery_starts_at: discovery,
        quiz_opens_at: opens, quiz_closes_at: closes, results_published_at: results,
        status: body?.status === "scheduled" ? "scheduled" : "draft",
      }).eq("id", id).select("*").single();
      if (updated.error) throw updated.error;
      await db.from("rules_admin_events").insert({ actor_user_id: userId, entity_type: "series", entity_id: id, action: "updated", details: { dates: true } });
      return NextResponse.json({ series: updated.data });
    }
    return NextResponse.json({ error: "Unsupported entity" }, { status: 400 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to update rules administration" }, { status: 500 });
  }
}
