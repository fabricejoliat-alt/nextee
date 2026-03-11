import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const clubIds = uniq((membershipsRes.data ?? []).map((m: any) => String(m?.club_id ?? "").trim()));
    if (clubIds.length === 0) {
      return NextResponse.json({ messages_count: 0, notifications_count: 0 });
    }

    const [threadsRes, activeMembersRes] = await Promise.all([
      supabaseAdmin
        .from("message_threads")
        .select("id")
        .in("organization_id", clubIds),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .in("club_id", clubIds)
        .eq("is_active", true),
    ]);
    if (threadsRes.error) return NextResponse.json({ error: threadsRes.error.message }, { status: 400 });
    if (activeMembersRes.error) return NextResponse.json({ error: activeMembersRes.error.message }, { status: 400 });

    const threadIds = uniq(((threadsRes.data ?? []) as Array<{ id: string | null }>).map((r) => String(r.id ?? "").trim()));
    const orgUserIds = uniq(((activeMembersRes.data ?? []) as Array<{ user_id: string | null }>).map((r) => String(r.user_id ?? "").trim()));

    let messagesCount = 0;
    for (const ids of chunk(threadIds, 200)) {
      const countRes = await supabaseAdmin
        .from("thread_messages")
        .select("id", { count: "exact", head: true })
        .in("thread_id", ids);
      if (countRes.error) return NextResponse.json({ error: countRes.error.message }, { status: 400 });
      messagesCount += countRes.count ?? 0;
    }

    let notificationsCount = 0;
    for (const ids of chunk(orgUserIds, 200)) {
      const countRes = await supabaseAdmin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .in("actor_user_id", ids);
      if (countRes.error) return NextResponse.json({ error: countRes.error.message }, { status: 400 });
      notificationsCount += countRes.count ?? 0;
    }

    return NextResponse.json({
      messages_count: messagesCount,
      notifications_count: notificationsCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

