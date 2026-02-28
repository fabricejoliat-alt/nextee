import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;

    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true);

    if (membershipsError) return NextResponse.json({ error: membershipsError.message }, { status: 400 });

    const clubIds = Array.from(
      new Set((memberships ?? []).map((m: any) => String(m?.club_id ?? "")).filter(Boolean))
    );
    if (clubIds.length === 0) return NextResponse.json({ clubs: [] });

    const { data: clubsRows, error: clubsError } = await supabaseAdmin
      .from("clubs")
      .select("id,name")
      .in("id", clubIds);
    if (clubsError) return NextResponse.json({ error: clubsError.message }, { status: 400 });

    const clubNameById = new Map<string, string>();
    for (const row of clubsRows ?? []) {
      clubNameById.set(String((row as any).id), String((row as any).name ?? "Club"));
    }

    const clubs = clubIds.map((id) => ({
      id,
      name: clubNameById.get(id) ?? "Club",
    }));

    return NextResponse.json({ clubs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
