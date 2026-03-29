import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseAdmin,
  dispatchNews,
  fetchClubNewsList,
  fetchNewsTargetOptions,
  getManagerContext,
  normalizeNewsStatus,
  normalizePublication,
  normalizeSchedule,
  normalizeTargets,
  resolveNewsRecipients,
} from "@/app/api/manager/news/_lib";

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const ctx = await getManagerContext(req, supabaseAdmin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const requestedClubId = String(new URL(req.url).searchParams.get("club_id") ?? "").trim();
    const selectedClubId =
      (requestedClubId && ctx.managedClubs.some((club) => club.id === requestedClubId) ? requestedClubId : "") ||
      ctx.managedClubs[0]?.id ||
      "";

    if (!selectedClubId) {
      return NextResponse.json({
        clubs: ctx.managedClubs,
        selected_club_id: "",
        target_options: {
          clubs: ctx.managedClubs,
          members: [],
          groups: [],
          group_categories: [],
          age_bands: [],
        },
        news: [],
      });
    }

    const [targetOptions, news] = await Promise.all([
      fetchNewsTargetOptions(supabaseAdmin, ctx.managedClubs, selectedClubId),
      fetchClubNewsList(supabaseAdmin, selectedClubId),
    ]);

    return NextResponse.json({
      clubs: ctx.managedClubs,
      selected_club_id: selectedClubId,
      target_options: targetOptions,
      news,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const ctx = await getManagerContext(req, supabaseAdmin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = await req.json().catch(() => ({}));
    const clubId = String(body.club_id ?? "").trim();
    const title = String(body.title ?? "").trim();
    const summary = String(body.summary ?? "").trim() || null;
    const content = String(body.body ?? "").trim();
    const status = normalizeNewsStatus(body.status);
    const scheduledFor = normalizeSchedule(body.scheduled_for);
    const normalizedStatus = normalizePublication(status, scheduledFor);
    const sendNotification = body.send_notification !== false;
    const sendEmail = Boolean(body.send_email);
    const includeLinkedParents = Boolean(body.include_linked_parents);
    const targets = normalizeTargets(body.targets);

    if (!clubId || !ctx.managedClubs.some((club) => club.id === clubId)) {
      return NextResponse.json({ error: "Club invalide." }, { status: 400 });
    }
    if (!title) return NextResponse.json({ error: "Titre obligatoire." }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Contenu obligatoire." }, { status: 400 });
    if (targets.length === 0) return NextResponse.json({ error: "Ajoute au moins une cible." }, { status: 400 });
    if (status === "scheduled" && !scheduledFor) {
      return NextResponse.json({ error: "Date de programmation obligatoire." }, { status: 400 });
    }

    const publishedAt = normalizedStatus === "published" ? new Date().toISOString() : null;

    const insertRes = await supabaseAdmin
      .from("club_news")
      .insert({
        club_id: clubId,
        created_by: ctx.callerId,
        updated_by: ctx.callerId,
        title,
        summary,
        body: content,
        status: normalizedStatus,
        scheduled_for: normalizedStatus === "scheduled" ? scheduledFor : null,
        published_at: publishedAt,
        send_notification: sendNotification,
        send_email: sendEmail,
        include_linked_parents: includeLinkedParents,
      })
      .select("id,last_notification_sent_at,last_email_sent_at")
      .single();
    if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 400 });

    const newsId = String(insertRes.data.id ?? "");

    const targetInsertRes = await supabaseAdmin.from("club_news_targets").insert(
      targets.map((target) => ({
        news_id: newsId,
        target_type: target.target_type,
        target_value: target.target_value,
      }))
    );
    if (targetInsertRes.error) {
      await supabaseAdmin.from("club_news").delete().eq("id", newsId);
      return NextResponse.json({ error: targetInsertRes.error.message }, { status: 400 });
    }

    if (normalizedStatus === "published") {
      const recipients = await resolveNewsRecipients(supabaseAdmin, clubId, targets, includeLinkedParents);
      const dispatch = await dispatchNews({
        supabaseAdmin,
        callerId: ctx.callerId,
        clubId,
        newsId,
        title,
        summary,
        body: content,
        sendNotification,
        sendEmail,
        lastNotificationSentAt: insertRes.data.last_notification_sent_at ?? null,
        lastEmailSentAt: insertRes.data.last_email_sent_at ?? null,
        recipientUserIds: recipients.recipientUserIds,
        emailRecipients: recipients.emailRecipients,
      });

      const updateDispatchRes = await supabaseAdmin
        .from("club_news")
        .update({
          last_notification_sent_at: dispatch.lastNotificationSentAt,
          last_email_sent_at: dispatch.lastEmailSentAt,
          last_dispatch_result: dispatch.lastDispatchResult,
        })
        .eq("id", newsId);
      if (updateDispatchRes.error) return NextResponse.json({ error: updateDispatchRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: newsId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
