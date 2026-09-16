import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clubId: string }> }
) {
  try {
    const supabaseAdmin = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const callerId = callerData.user.id;
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    let isAllowed = Boolean(adminRow);
    if (!isAllowed) {
      const { data: membership } = await supabaseAdmin
        .from("club_members")
        .select("id,role,is_active")
        .eq("club_id", clubId)
        .eq("user_id", callerId)
        .eq("is_active", true)
        .maybeSingle();
      isAllowed = Boolean(membership && membership.role === "manager");
    }

    if (!isAllowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const userId = String(body?.user_id ?? "").trim();

    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const { data: memberRow, error: memberError } = await supabaseAdmin
      .from("club_members")
      .upsert(
        {
          club_id: clubId,
          user_id: userId,
          role: "manager",
          is_active: true,
          player_consent_status: null,
        },
        { onConflict: "club_id,user_id,role" }
      )
      .select("id")
      .single();

    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

    return NextResponse.json({ ok: true, member_id: memberRow?.id ?? null });
  } catch (cause: unknown) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Server error" }, { status: 500 });
  }
}
