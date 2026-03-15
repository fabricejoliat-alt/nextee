import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { requireCaller } from "@/app/api/messages/_lib";

function buildSenderName(row: any) {
  const full = `${String(row?.first_name ?? "").trim()} ${String(row?.last_name ?? "").trim()}`.trim();
  const fallback = String(row?.username ?? "").trim();
  return full || fallback || "";
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

async function dispatchPushForRecipients(
  supabaseAdmin: any,
  opts: { title: string; body: string; url: string; recipientUserIds: string[] }
) {
  const recipients = uniq(opts.recipientUserIds);
  if (recipients.length === 0) return;

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:contact@activitee.app";
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const subsRes = await supabaseAdmin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", recipients);
  if (subsRes.error) return;

  const payload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    url: opts.url,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    timestamp: Date.now(),
  });

  const staleIds: number[] = [];
  await Promise.all(
    (subsRes.data ?? []).map(async (sub: any) => {
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
        if (statusCode === 404 || statusCode === 410) staleIds.push(Number(sub.id));
      }
    })
  );

  if (staleIds.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
  }
}

async function dispatchPushPerUser(
  supabaseAdmin: any,
  opts: { title: string; body: string; url: string; recipientUserId: string }
) {
  await dispatchPushForRecipients(supabaseAdmin, {
    title: opts.title,
    body: opts.body,
    url: opts.url,
    recipientUserIds: [opts.recipientUserId],
  });
}

async function enrichAndDispatchEventThreadNotification(
  supabaseAdmin: any,
  opts: {
    actorUserId: string;
    threadId: string;
    thread: {
      title: string | null;
      thread_type: string | null;
      event_id: string | null;
      group_id: string | null;
      organization_id: string | null;
    };
    body: string;
  }
) {
  const threadType = String(opts.thread.thread_type ?? "").trim();
  const eventId = String(opts.thread.event_id ?? "").trim();
  if (threadType !== "event" || !eventId) return;

  const notificationRes = await supabaseAdmin
    .from("notifications")
    .select("id,title,body,data")
    .eq("kind", "thread_message")
    .filter("data->>thread_id", "eq", opts.threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (notificationRes.error || !notificationRes.data?.id) return;

  const groupId = String(opts.thread.group_id ?? "").trim();
  const organizationId = String(opts.thread.organization_id ?? "").trim();
  const eventTitle = String(opts.thread.title ?? "").trim() || "Événement";

  const existingData = (notificationRes.data.data ?? {}) as Record<string, unknown>;
  const nextData = {
    ...existingData,
    thread_id: opts.threadId,
    thread_type: "event",
    event_id: eventId,
    group_id: groupId || null,
    organization_id: organizationId || null,
  };

  await supabaseAdmin
    .from("notifications")
    .update({ data: nextData })
    .eq("id", notificationRes.data.id);

  const participantsRes = await supabaseAdmin
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", opts.threadId);
  if (participantsRes.error) return;

  const recipientIds = uniq(
    (participantsRes.data ?? [])
      .map((row: any) => String(row?.user_id ?? "").trim())
      .filter((id) => id && id !== opts.actorUserId)
  );
  if (recipientIds.length === 0) return;

  const membershipsRes = organizationId
    ? await supabaseAdmin
        .from("club_members")
        .select("user_id,role")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .in("user_id", recipientIds)
    : ({ data: [], error: null } as any);
  if (membershipsRes.error) return;

  const rolesByUserId = new Map<string, Set<string>>();
  for (const row of membershipsRes.data ?? []) {
    const userId = String((row as any).user_id ?? "").trim();
    const role = String((row as any).role ?? "").trim();
    if (!userId || !role) continue;
    if (!rolesByUserId.has(userId)) rolesByUserId.set(userId, new Set<string>());
    rolesByUserId.get(userId)!.add(role);
  }

  const playerIds = recipientIds.filter(
    (id) =>
      rolesByUserId.get(id)?.has("player") ||
      (!rolesByUserId.get(id)?.has("coach") && !rolesByUserId.get(id)?.has("manager"))
  );
  const coachIds = recipientIds.filter((id) => rolesByUserId.get(id)?.has("coach"));
  const managerIds = recipientIds.filter((id) => rolesByUserId.get(id)?.has("manager"));

  const threadMessagesRes = await supabaseAdmin
    .from("thread_messages")
    .select("created_at,sender_user_id")
    .eq("thread_id", opts.threadId);
  if (threadMessagesRes.error) return;

  const participantsReadRes = await supabaseAdmin
    .from("thread_participants")
    .select("user_id,last_read_at")
    .eq("thread_id", opts.threadId)
    .in("user_id", recipientIds);
  if (participantsReadRes.error) return;

  const lastReadByUserId = new Map<string, number>();
  for (const row of participantsReadRes.data ?? []) {
    lastReadByUserId.set(
      String((row as any).user_id ?? "").trim(),
      (row as any).last_read_at ? new Date(String((row as any).last_read_at)).getTime() : 0
    );
  }

  const unreadCountByUserId = new Map<string, number>();
  for (const userId of recipientIds) unreadCountByUserId.set(userId, 0);
  for (const row of threadMessagesRes.data ?? []) {
    const senderUserId = String((row as any).sender_user_id ?? "").trim();
    const createdAt = new Date(String((row as any).created_at ?? "")).getTime();
    for (const userId of recipientIds) {
      if (userId === senderUserId) continue;
      const lastReadAt = lastReadByUserId.get(userId) ?? 0;
      if (createdAt > lastReadAt) unreadCountByUserId.set(userId, (unreadCountByUserId.get(userId) ?? 0) + 1);
    }
  }

  async function dispatchGroup(recipientUserIds: string[], url: string) {
    await Promise.all(
      recipientUserIds.map(async (recipientUserId) => {
        const unreadCount = unreadCountByUserId.get(recipientUserId) ?? 1;
        const title = unreadCount > 1 ? "Nouveaux messages" : "Nouveau message";
        const body = unreadCount > 1 ? eventTitle : `${eventTitle}\n${String(opts.body ?? "").trim()}`.trim();
        await dispatchPushPerUser(supabaseAdmin, { title, body, url, recipientUserId });
      })
    );
  }

  if (playerIds.length > 0) {
    await dispatchGroup(playerIds, `/player/golf/trainings/new?club_event_id=${encodeURIComponent(eventId)}`);
  }
  if (coachIds.length > 0 && groupId) {
    await dispatchGroup(coachIds, `/coach/groups/${encodeURIComponent(groupId)}/planning/${encodeURIComponent(eventId)}`);
  }
  if (managerIds.length > 0) {
    await dispatchGroup(managerIds, `/manager/calendar?event=${encodeURIComponent(eventId)}`);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { threadId } = await ctx.params;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const canReadRes = await supabaseAdmin.rpc("can_read_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canReadRes.error) return NextResponse.json({ error: canReadRes.error.message }, { status: 400 });
    if (!canReadRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const before = (url.searchParams.get("before") ?? "").trim();

    let query = supabaseAdmin
      .from("thread_messages")
      .select("id,thread_id,sender_user_id,message_type,body,payload,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) query = query.lt("created_at", before);

    const msgRes = await query;
    if (msgRes.error) return NextResponse.json({ error: msgRes.error.message }, { status: 400 });

    const rows = msgRes.data ?? [];
    const senderIds = Array.from(new Set(rows.map((r: any) => String(r.sender_user_id ?? "")).filter(Boolean)));
    const namesById = new Map<string, string>();
    if (senderIds.length > 0) {
      const profRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", senderIds);
      if (!profRes.error) {
        for (const p of profRes.data ?? []) {
          namesById.set(String((p as any).id), buildSenderName(p));
        }
      }
    }

    const enriched = rows.map((r: any) => ({
      ...r,
      sender_name: namesById.get(String(r.sender_user_id ?? "")) || null,
    }));
    return NextResponse.json({ messages: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { threadId } = await ctx.params;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const messageType = String(body?.message_type ?? "text").trim();
    const content = String(body?.body ?? "").trim();
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    if (!content && messageType === "text") return NextResponse.json({ error: "Missing body" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const canPostRes = await supabaseAdmin.rpc("can_post_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canPostRes.error) return NextResponse.json({ error: canPostRes.error.message }, { status: 400 });
    if (!canPostRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const threadRes = await supabaseAdmin
      .from("message_threads")
      .select("title,thread_type,event_id,group_id,organization_id")
      .eq("id", threadId)
      .maybeSingle();
    if (threadRes.error) return NextResponse.json({ error: threadRes.error.message }, { status: 400 });

    if (threadRes.data?.thread_type === "event" && threadRes.data?.event_id) {
      await supabaseAdmin.rpc("sync_event_thread_participants", {
        p_event_id: String(threadRes.data.event_id),
      });
    }

    const insRes = await supabaseAdmin
      .from("thread_messages")
      .insert({
        thread_id: threadId,
        sender_user_id: callerId,
        message_type: messageType,
        body: content,
        payload,
      })
      .select("id,thread_id,sender_user_id,message_type,body,payload,created_at")
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

    const senderProfileRes = await supabaseAdmin
      .from("profiles")
      .select("first_name,last_name,username")
      .eq("id", callerId)
      .maybeSingle();
    const senderName = senderProfileRes.error ? "" : buildSenderName(senderProfileRes.data ?? {});

    if (threadRes.data) {
      await enrichAndDispatchEventThreadNotification(supabaseAdmin, {
        actorUserId: callerId,
        threadId,
        thread: {
          title: (threadRes.data as any).title ?? null,
          thread_type: threadRes.data.thread_type ?? null,
          event_id: threadRes.data.event_id ?? null,
          group_id: (threadRes.data as any).group_id ?? null,
          organization_id: (threadRes.data as any).organization_id ?? null,
        },
        body: content,
      });
    }

    return NextResponse.json({
      message: {
        ...(insRes.data as any),
        sender_name: senderName || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
