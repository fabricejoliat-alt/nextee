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
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;

    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true);
    if (membershipsError) return NextResponse.json({ error: membershipsError.message }, { status: 400 });

    const clubIds = Array.from(new Set((memberships ?? []).map((m: any) => String(m?.club_id ?? "")).filter(Boolean)));
    if (clubIds.length === 0) return NextResponse.json({ events: [] });

    const nowIso = new Date().toISOString();
    const { data: events, error: eventsErr } = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
      .in("club_id", clubIds)
      .eq("status", "scheduled")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(limit);
    if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 400 });

    return NextResponse.json({ events: events ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

