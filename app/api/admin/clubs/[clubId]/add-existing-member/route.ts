import { canReuseClubAccount, requireManagerClub } from "@/lib/server/managerAccess";
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

    const auth = await requireManagerClub(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => null);
    const userId = String(body?.user_id ?? "").trim();

    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    if (!auth.isSuperadmin && !(await canReuseClubAccount(supabaseAdmin, clubId, userId, "manager"))) {
      return NextResponse.json({ error: "Le rattachement de ce compte nécessite une validation par l’administration de la plateforme." }, { status: 409 });
    }

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
