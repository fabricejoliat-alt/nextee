import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWebPush, validPushEndpoint } from "@/lib/server/webPush";
import { validNativePushDevice } from "@/lib/server/apns";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const user = await db.auth.getUser(token);
    if (user.error || !user.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const input = await req.json();
    if (input.nativeDevice ? !validNativePushDevice(input.nativeDevice) : !validPushEndpoint(String(input.endpoint ?? ""))) return NextResponse.json({ error: "Invalid device" }, { status: 400, headers });
    const messages = {
      fr: "Les notifications ActiviTee sont actives sur cet appareil.",
      en: "ActiviTee notifications are active on this device.",
      de: "ActiviTee-Benachrichtigungen sind auf diesem Gerät aktiv.",
      it: "Le notifiche ActiviTee sono attive su questo dispositivo.",
    };
    const locale = String(input.locale ?? "fr") as keyof typeof messages;
    const result = await sendWebPush(db, { recipientUserIds: [user.data.user.id], kind: "push_test", title: "ActiviTee",
      body: messages[locale] ?? messages.fr, url: "/", ...(input.nativeDevice ? { nativeDevice: input.nativeDevice } : { endpoint: input.endpoint }), test: true });
    return NextResponse.json({ ok: result.sent > 0, ...result }, { status: result.sent ? 200 : 503, headers });
  } catch { return NextResponse.json({ error: "Push test unavailable" }, { status: 503, headers }); }
}
