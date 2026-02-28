import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    // superadmin ?
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }

    const isSuperAdmin = !!adminRow;

    if (isSuperAdmin) {
      return NextResponse.json({
        userId,
        isSuperAdmin: true,
        membership: null,
      });
    }

    // membership actif (premier)
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("club_members")
      .select("club_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 400 });
    }

    let parentHasChildren = true;
    if (membership?.role === "parent") {
      const { data: linkRow, error: linkErr } = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", userId)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 400 });
      }
      parentHasChildren = Boolean(linkRow?.player_id);
    }

    return NextResponse.json({
      userId,
      isSuperAdmin: false,
      membership: membership ?? null, // {club_id, role, is_active}
      parentHasChildren,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
