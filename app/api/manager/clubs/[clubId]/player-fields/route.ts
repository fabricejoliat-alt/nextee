import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle();
  if (adminRow) return { ok: true as const, callerId };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || membership.role !== "manager") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, callerId };
}

function normalizeOptions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toFieldPayload(body: any) {
  const label = String(body?.label ?? "").trim();
  const fieldType = String(body?.field_type ?? "").trim().toLowerCase();
  const options = normalizeOptions(body?.options);
  const isActive = body?.is_active == null ? true : Boolean(body.is_active);
  const sortOrder = Number(body?.sort_order ?? 0);

  if (!label) throw new Error("Label manquant");
  if (!["text", "boolean", "select"].includes(fieldType)) throw new Error("Type invalide");
  if (fieldType === "select" && options.length === 0) throw new Error("Les options sont requises");

  return {
    label,
    field_type: fieldType,
    options_json: fieldType === "select" ? options : [],
    is_active: isActive,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data, error } = await supabaseAdmin
      .from("club_player_fields")
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,legacy_binding")
      .eq("club_id", clubId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      playerFields: (data ?? []).map((row: any) => ({
        ...row,
        options_json: normalizeOptions(row.options_json),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const payload = toFieldPayload(body);
    const baseKey = String(body?.field_key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const fieldKey = `${baseKey || "field"}_${randomUUID().slice(0, 8)}`;

    const { data, error } = await supabaseAdmin
      .from("club_player_fields")
      .insert({
        club_id: clubId,
        field_key: fieldKey,
        ...payload,
      })
      .select("id,club_id,field_key,label,field_type,options_json,is_active,sort_order,legacy_binding")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ field: { ...data, options_json: normalizeOptions((data as any).options_json) } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
