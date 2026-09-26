import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPlayerActorAuthorization, visibleGuardianLinks } from "@/app/api/player/access";
import { selectPrimaryApplicationRole } from "@/lib/playerAccessPolicy";

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

    const actor = await loadPlayerActorAuthorization(supabaseAdmin, userId);
    const primaryRole = selectPrimaryApplicationRole(actor.actorRoles);
    const primaryMembership = primaryRole
      ? actor.memberships
          .filter((membership) => membership.role === primaryRole)
          .sort((left, right) => String(left.club_id ?? "").localeCompare(String(right.club_id ?? "")))[0] ?? null
      : null;
    const membership = primaryMembership
      ? { club_id: primaryMembership.club_id, role: primaryMembership.role, is_active: true }
      : null;
    const parentHasChildren = actor.actorRoles.includes("parent") && visibleGuardianLinks(actor.guardianLinks).length > 0;

    return NextResponse.json({
      userId,
      isSuperAdmin: false,
      membership,
      memberships: actor.memberships.map((row) => ({ ...row, is_active: true })),
      roles: actor.actorRoles,
      parentHasChildren,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
