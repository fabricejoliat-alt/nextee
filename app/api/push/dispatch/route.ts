import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getCaller(req: Request, supabaseAdmin: ReturnType<typeof createClient>) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  return { ok: true as const, userId: userData.user.id };
}

type DispatchBody = {
  notificationId?: string;
  title: string;
  body?: string;
  url?: string;
  recipientUserIds: string[];
};

export async function POST(req: Request) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const caller = await getCaller(req, supabaseAdmin);
    if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

    const vapidPublic = mustEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const vapidPrivate = mustEnv("VAPID_PRIVATE_KEY");
    const vapidSubject = process.env.VAPID_SUBJECT || "mailto:contact@activitee.app";

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const body = (await req.json().catch(() => ({}))) as DispatchBody;
    const title = String(body.title ?? "").trim();
    const textBody = String(body.body ?? "").trim();
    const url = String(body.url ?? "").trim();
    const recipientUserIds = Array.from(new Set((body.recipientUserIds ?? []).map((id) => String(id).trim()).filter(Boolean)));

    if (!title || recipientUserIds.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    if (body.notificationId) {
      const check = await supabaseAdmin
        .from("notifications")
        .select("id,actor_user_id")
        .eq("id", body.notificationId)
        .maybeSingle();
      if (check.error) return NextResponse.json({ error: check.error.message }, { status: 400 });
      if (!check.data || check.data.actor_user_id !== caller.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const subsRes = await supabaseAdmin
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", recipientUserIds);

    if (subsRes.error) return NextResponse.json({ error: subsRes.error.message }, { status: 400 });

    const payload = JSON.stringify({
      title,
      body: textBody || null,
      url: url || null,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      timestamp: Date.now(),
    });

    const staleIds: number[] = [];

    await Promise.all(
      (subsRes.data ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
        } catch (err: unknown) {
          const statusCode = Number((err as { statusCode?: number } | null)?.statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
        }
      })
    );

    if (staleIds.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
    }

    return NextResponse.json({ ok: true, sent: (subsRes.data ?? []).length, cleaned: staleIds.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
