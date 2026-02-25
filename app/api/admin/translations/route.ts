import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertSuperadmin(req: NextRequest, supabaseAdmin: any) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing Authorization token." };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token." };

  const callerId = callerData.user.id;
  const { data: isAdminRow, error: isAdminErr } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (isAdminErr || !isAdminRow) return { ok: false as const, status: 403, error: "Forbidden." };
  return { ok: true as const, callerId };
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertSuperadmin(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const locale = (searchParams.get("locale") || "").trim();

    let query = supabaseAdmin.from("app_translations").select("locale,key,value,updated_at");
    if (locale) query = query.eq("locale", locale);

    const { data, error } = await query.order("key", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ rows: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertSuperadmin(req, supabaseAdmin);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const locale = String(body.locale ?? "").trim().toLowerCase();
    const key = String(body.key ?? "").trim();
    const value = String(body.value ?? "");

    if (!locale || !["fr", "en"].includes(locale)) {
      return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
    }
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

    if (value.trim() === "") {
      const { error } = await supabaseAdmin
        .from("app_translations")
        .delete()
        .eq("locale", locale)
        .eq("key", key);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, deleted: true });
    }

    const { error } = await supabaseAdmin.from("app_translations").upsert(
      {
        locale,
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: auth.callerId,
      },
      { onConflict: "locale,key" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
