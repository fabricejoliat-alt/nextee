import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireManagerClub } from "@/lib/server/managerAccess";
import { managerMutationError } from "@/lib/server/managerMutationError";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const access = await requireManagerClub(req, db, clubId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { data, error } = await db.from("club_seasons").select("id,name,starts_on,ends_on,is_current").eq("club_id", clubId).order("starts_on", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ seasons: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const access = await requireManagerClub(req, db, clubId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = await req.json().catch(() => ({}));
    const seasonId = String(body.season_id ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!seasonId || !name) return NextResponse.json({ error: "Le nom de la saison est obligatoire." }, { status: 400 });

    const { data, error } = await db
      .from("club_seasons")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", seasonId)
      .eq("club_id", clubId)
      .select("id,name,starts_on,ends_on,is_current")
      .maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: "Une saison porte déjà ce nom dans ce club." }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Saison introuvable." }, { status: 404 });
    return NextResponse.json({ season: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const access = await requireManagerClub(req, db, clubId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const startsOn = String(body.starts_on ?? "");
    const endsOn = String(body.ends_on ?? "");
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn) {
      return NextResponse.json({ error: "Saison invalide" }, { status: 400 });
    }

    const result = await db.rpc("create_manager_season_v1", {
      p_actor: access.callerId, p_club: clubId,
      p_values: { name, starts_on: startsOn, ends_on: endsOn, is_current: Boolean(body.is_current) },
    });
    if (result.error) {
      if (result.error.code === "23505") return NextResponse.json({ error: "Une saison porte déjà ce nom dans ce club." }, { status: 409 });
      const failure = managerMutationError(result.error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
    return NextResponse.json(result.data, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
