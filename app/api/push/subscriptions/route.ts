import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validPushEndpoint, webPushConfigured } from "@/lib/server/webPush";

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

    const body = (await req.json().catch(() => ({}))) as { subscription?: PushSubscriptionJson; locale?: string };
    const sub = body.subscription;

    if (!sub?.endpoint || !validPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription payload" }, { status: 400 });
    }

    if (!webPushConfigured()) return NextResponse.json({ error: "Push not configured", code: "PUSH_NOT_CONFIGURED" }, { status: 503 });
    if (typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string" ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys.auth) ||
      Buffer.from(sub.keys.p256dh, "base64url").length !== 65 || Buffer.from(sub.keys.auth, "base64url").length !== 16)
      return NextResponse.json({ error: "Invalid device keys" }, { status: 400 });
    const ua = req.headers.get("user-agent") || null;

    const up = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        user_id: caller.userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: ua,
        locale: ["fr", "en", "de", "it"].includes(body.locale ?? "") ? body.locale : "fr",
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

export async function GET(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const db = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const caller = await getCaller(req, db);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
    const subscriptions = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", caller.userId);
    if (subscriptions.error) return NextResponse.json({ error: "Device registration unavailable" }, { status: 503, headers });
    return NextResponse.json({ configured: webPushConfigured(), devices: subscriptions.count ?? 0 }, { headers });
  } catch { return NextResponse.json({ error: "Push unavailable" }, { status: 503, headers }); }
}
