import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseAdmin,
  dispatchNews,
  getManagerContext,
  normalizeLinkedItemId,
  normalizeNewsStatus,
  normalizePublication,
  normalizeSchedule,
  normalizeTargets,
  resolveNewsRecipients,
  validateLinkedNewsContent,
} from "@/app/api/manager/news/_lib";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ newsId: string }> }) {
  try {
    const { newsId } = await ctx.params;
    if (!newsId) return NextResponse.json({ error: "Missing newsId" }, { status: 400 });

    const supabaseAdmin = createSupabaseAdmin();
    const managerCtx = await getManagerContext(req, supabaseAdmin);
    if (!managerCtx.ok) return NextResponse.json({ error: managerCtx.error }, { status: managerCtx.status });

    const currentRes = await supabaseAdmin
      .from("club_news")
      .select("id,club_id,title,summary,body,status,scheduled_for,published_at,send_notification,send_email,include_linked_parents,last_notification_sent_at,last_email_sent_at,linked_club_event_id,linked_camp_id")
      .eq("id", newsId)
      .maybeSingle();
    if (currentRes.error) return NextResponse.json({ error: currentRes.error.message }, { status: 400 });
    if (!currentRes.data) return NextResponse.json({ error: "Actualité introuvable." }, { status: 404 });

    const clubId = String(currentRes.data.club_id ?? "");
    if (!managerCtx.managedClubs.some((club) => club.id === clubId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? currentRes.data.title ?? "").trim();
    const summary = String(body.summary ?? currentRes.data.summary ?? "").trim() || null;
    const content = String(body.body ?? currentRes.data.body ?? "").trim();
    const status = normalizeNewsStatus(body.status ?? currentRes.data.status);
    const scheduledFor = normalizeSchedule(body.scheduled_for ?? currentRes.data.scheduled_for);
    const normalizedStatus = normalizePublication(status, scheduledFor);
    const sendNotification =
      typeof body.send_notification === "boolean" ? body.send_notification : Boolean(currentRes.data.send_notification);
    const sendEmail = typeof body.send_email === "boolean" ? body.send_email : Boolean(currentRes.data.send_email);
    const includeLinkedParents =
      typeof body.include_linked_parents === "boolean"
        ? body.include_linked_parents
        : Boolean(currentRes.data.include_linked_parents);
    const linkedClubEventId =
      body.linked_club_event_id !== undefined
        ? normalizeLinkedItemId(body.linked_club_event_id)
        : (currentRes.data.linked_club_event_id == null ? null : String(currentRes.data.linked_club_event_id));
    const linkedCampId =
      body.linked_camp_id !== undefined
        ? normalizeLinkedItemId(body.linked_camp_id)
        : (currentRes.data.linked_camp_id == null ? null : String(currentRes.data.linked_camp_id));
    const targets = normalizeTargets(body.targets);

    if (!title) return NextResponse.json({ error: "Titre obligatoire." }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Contenu obligatoire." }, { status: 400 });
    if (targets.length === 0) return NextResponse.json({ error: "Ajoute au moins une cible." }, { status: 400 });
    if (status === "scheduled" && !scheduledFor) {
      return NextResponse.json({ error: "Date de programmation obligatoire." }, { status: 400 });
    }
    await validateLinkedNewsContent({ supabaseAdmin, clubId, linkedClubEventId, linkedCampId });

    const publishedAt =
      normalizedStatus === "published"
        ? currentRes.data.published_at ?? new Date().toISOString()
        : null;

    const updateRes = await supabaseAdmin
      .from("club_news")
      .update({
        updated_by: managerCtx.callerId,
        title,
        summary,
        body: content,
        status: normalizedStatus,
        scheduled_for: normalizedStatus === "scheduled" ? scheduledFor : null,
        published_at: publishedAt,
        send_notification: sendNotification,
        send_email: sendEmail,
        include_linked_parents: includeLinkedParents,
        linked_club_event_id: linkedClubEventId,
        linked_camp_id: linkedCampId,
      })
      .eq("id", newsId);
    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });

    const deleteTargetsRes = await supabaseAdmin.from("club_news_targets").delete().eq("news_id", newsId);
    if (deleteTargetsRes.error) return NextResponse.json({ error: deleteTargetsRes.error.message }, { status: 400 });

    const insertTargetsRes = await supabaseAdmin.from("club_news_targets").insert(
      targets.map((target) => ({
        news_id: newsId,
        target_type: target.target_type,
        target_value: target.target_value,
      }))
    );
    if (insertTargetsRes.error) return NextResponse.json({ error: insertTargetsRes.error.message }, { status: 400 });

    if (normalizedStatus === "published") {
      const recipients = await resolveNewsRecipients(supabaseAdmin, clubId, targets, includeLinkedParents);
      const dispatch = await dispatchNews({
        supabaseAdmin,
        callerId: managerCtx.callerId,
        clubId,
        newsId,
        linkedClubEventId,
        linkedCampId,
        title,
        summary,
        body: content,
        sendNotification,
        sendEmail,
        lastNotificationSentAt: currentRes.data.last_notification_sent_at ?? null,
        lastEmailSentAt: currentRes.data.last_email_sent_at ?? null,
        recipientUserIds: recipients.recipientUserIds,
        emailRecipients: recipients.emailRecipients,
      });

      const dispatchRes = await supabaseAdmin
        .from("club_news")
        .update({
          last_notification_sent_at: dispatch.lastNotificationSentAt,
          last_email_sent_at: dispatch.lastEmailSentAt,
          last_dispatch_result: dispatch.lastDispatchResult,
        })
        .eq("id", newsId);
      if (dispatchRes.error) return NextResponse.json({ error: dispatchRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ newsId: string }> }) {
  try {
    const { newsId } = await ctx.params;
    if (!newsId) return NextResponse.json({ error: "Missing newsId" }, { status: 400 });

    const supabaseAdmin = createSupabaseAdmin();
    const managerCtx = await getManagerContext(req, supabaseAdmin);
    if (!managerCtx.ok) return NextResponse.json({ error: managerCtx.error }, { status: managerCtx.status });

    const newsRes = await supabaseAdmin
      .from("club_news")
      .select("id,club_id")
      .eq("id", newsId)
      .maybeSingle();
    if (newsRes.error) return NextResponse.json({ error: newsRes.error.message }, { status: 400 });
    if (!newsRes.data) return NextResponse.json({ error: "Actualité introuvable." }, { status: 404 });

    const clubId = String(newsRes.data.club_id ?? "");
    if (!managerCtx.managedClubs.some((club) => club.id === clubId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleteRes = await supabaseAdmin.from("club_news").delete().eq("id", newsId);
    if (deleteRes.error) return NextResponse.json({ error: deleteRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
