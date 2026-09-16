import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AdminRow = { user_id: string | null };
type ProfileRow = { id: string; first_name: string | null; last_name: string | null; username: string | null; app_role: string | null };
type MembershipRow = { user_id: string | null; club_id: string | null; is_performance?: boolean | null };
type ClubRow = { id: string; name: string | null };

export async function GET(req: Request) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // caller
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;

    // superadmin only
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!adminRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // superadmins set (to exclude)
    const { data: admins } = await supabaseAdmin.from("app_admins").select("user_id");
    const adminIds = new Set<string>((admins ?? []).map((a) => String((a as AdminRow).user_id ?? "")).filter(Boolean));

    // profiles (exclude superadmins)
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, username, app_role")
      .eq("app_role", "manager")
      .order("created_at", { ascending: false });


    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

    const filtered = (profiles ?? []).filter((p) => !adminIds.has(String((p as ProfileRow).id)));
    const profileIds = filtered.map((p) => String((p as ProfileRow).id));

    const { data: managerMemberships, error: membershipsErr } = await supabaseAdmin
      .from("club_members")
      .select("user_id, club_id")
      .eq("role", "manager")
      .in("user_id", profileIds);
    if (membershipsErr) return NextResponse.json({ error: membershipsErr.message }, { status: 400 });

    const clubIds = Array.from(
      new Set((managerMemberships ?? []).map((row) => String((row as MembershipRow).club_id ?? "").trim()).filter(Boolean))
    );
    const { data: clubs, error: clubsErr } = clubIds.length
      ? await supabaseAdmin.from("clubs").select("id, name").in("id", clubIds)
      : { data: [], error: null };
    if (clubsErr) return NextResponse.json({ error: clubsErr.message }, { status: 400 });

    const clubNamesById = new Map<string, string>(
      (clubs ?? []).map((club) => [String((club as ClubRow).id), String((club as ClubRow).name ?? "")])
    );
    const organizationsByUserId = new Map<string, string[]>();
    for (const row of managerMemberships ?? []) {
      const userId = String((row as MembershipRow).user_id ?? "").trim();
      const clubId = String((row as MembershipRow).club_id ?? "").trim();
      if (!userId || !clubId) continue;
      const clubName = clubNamesById.get(clubId) ?? clubId;
      const existing = organizationsByUserId.get(userId) ?? [];
      if (!existing.includes(clubName)) existing.push(clubName);
      organizationsByUserId.set(userId, existing);
    }

    const out = filtered.map((p) => {
      const profile = p as ProfileRow;
      return {
        id: profile.id,
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        username: profile.username ?? null,
        role: profile.app_role ?? "player",
        organization: (organizationsByUserId.get(String(profile.id)) ?? []).join(" · ") || null,
        is_performance: false,
        email: null,
      };
    });

    return NextResponse.json({ users: out });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
