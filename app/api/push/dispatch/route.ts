import { notifyEventCoaches } from "@/lib/server/notificationStaff";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWebPush, notificationPath } from "@/lib/server/webPush";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const actor = await db.auth.getUser(token);
    if (actor.error || !actor.data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const input = await req.json();
    if (!input.notificationId || !Array.isArray(input.recipientUserIds) || input.recipientUserIds.length > 500)
      return NextResponse.json({ error: "Invalid notification" }, { status: 400, headers });
    const notification = await db.from("notifications").select("id,actor_user_id,kind,title,body,data")
      .eq("id", input.notificationId).maybeSingle();
    if (notification.error) throw notification.error;
    if (!notification.data || notification.data.actor_user_id !== actor.data.user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    const recipients = await db.from("notification_recipients").select("user_id")
      .eq("notification_id", notification.data.id).in("user_id", input.recipientUserIds);
    if (recipients.error) throw recipients.error;
    const checked = await Promise.all((recipients.data ?? []).map(async row => {
      const access = await db.rpc("organization_notification_visible", { p_notification: notification.data!.id, p_actor: row.user_id });
      if (access.error) throw access.error;
      return access.data === true ? row.user_id : null;
    }));
    const staffResult = await notifyEventCoaches(db, notification.data);
    const result = await sendWebPush(db, { recipientUserIds: checked.filter((id): id is string => id !== null),
      kind: notification.data.kind, title: notification.data.title, body: notification.data.body,
      templateKey: notification.data.data?.template_key, templateParams: notification.data.data?.template_params,
      url: notificationPath(notification.data.data?.url) });
    if (staffResult) { result.sent += staffResult.sent; result.failed += staffResult.failed; result.attempted += staffResult.attempted; }
    return NextResponse.json({ ok: result.configured && result.failed === 0, ...result },
      { status: !result.configured || result.failed ? 503 : 200, headers });
  } catch { return NextResponse.json({ error: "Push dispatch unavailable" }, { status: 503, headers }); }
}
