import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fcmConfigured, validAndroidPushDevice } from "@/lib/server/fcm";

const headers = { "Cache-Control": "private, no-store" };

async function caller(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  let sessionId: unknown;
  try { sessionId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id; } catch { return null; }
  if (typeof sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  return { db, userId: data.user.id, sessionId };
}

export async function GET(req: Request) {
  try {
    const auth = await caller(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const storage = await auth.db.from("android_push_subscriptions").select("id").limit(1);
    return NextResponse.json({ configured: fcmConfigured() && !storage.error }, { headers });
  } catch { return NextResponse.json({ configured: false }, { status: 503, headers }); }
}

export async function POST(req: Request) {
  try {
    const auth = await caller(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const input = await req.json();
    const locale = ["fr", "en", "de", "it"].includes(input?.locale) ? input.locale : "fr";
    if (!validAndroidPushDevice(input)) return NextResponse.json({ error: "Invalid device" }, { status: 400, headers });
    if (!fcmConfigured()) return NextResponse.json({ error: "Push not configured" }, { status: 503, headers });
    const { error } = await auth.db.from("android_push_subscriptions").upsert({ user_id: auth.userId, session_id: auth.sessionId,
      device_token: input.token, application_id: input.applicationId, locale, updated_at: new Date().toISOString() },
      { onConflict: "device_token,application_id" });
    return NextResponse.json(error ? { error: "Device registration unavailable" } : { ok: true }, { status: error ? 503 : 200, headers });
  } catch { return NextResponse.json({ error: "Device registration unavailable" }, { status: 503, headers }); }
}

export async function DELETE(req: Request) {
  try {
    const auth = await caller(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const input = await req.json();
    if (!validAndroidPushDevice(input)) return NextResponse.json({ error: "Invalid device" }, { status: 400, headers });
    const { error } = await auth.db.from("android_push_subscriptions").delete().eq("user_id", auth.userId)
      .eq("device_token", input.token).eq("application_id", input.applicationId);
    return NextResponse.json(error ? { error: "Device removal unavailable" } : { ok: true }, { status: error ? 503 : 200, headers });
  } catch { return NextResponse.json({ error: "Device removal unavailable" }, { status: 503, headers }); }
}
