import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type PushSubscriptionJson = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

async function getCaller(req: Request, supabaseAdmin: any) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  return { ok: true as const, userId: userData.user.id };
}

export async function POST(req: Request) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const caller = await getCaller(req, supabaseAdmin);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const body = (await req.json().catch(() => ({}))) as { subscription?: PushSubscriptionJson };
    const sub = body.subscription;

    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription payload" }, { status: 400 });
    }

    const ua = req.headers.get("user-agent") || null;

    const up = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        user_id: caller.userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: ua,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const caller = await getCaller(req, supabaseAdmin);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    const endpoint = String(body.endpoint ?? "").trim();

    if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

    const del = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", caller.userId)
      .eq("endpoint", endpoint);

    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
