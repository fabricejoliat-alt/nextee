/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  reminderChannelFlags,
  renderCompetitionReminderTemplate,
  type CompetitionCategory,
  type CompetitionLevel,
  type ReminderChannel,
} from "@/lib/competitions";

export const runtime = "nodejs";

type ReminderRow = {
  id: string;
  event_id: string;
  channel: ReminderChannel;
  message_template: string;
  created_by: string;
};

type SupabaseAdminClient = any;
type PushSubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };
type AttendeeRow = { player_id: string | null };
type GuardianRow = { guardian_user_id: string | null; can_view: boolean | null };
type ProfileRow = { id: string; first_name: string | null; last_name: string | null };
type PreferenceRow = { user_id: string; receive_push: boolean | null; enabled_kinds: string[] | null };

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function levelLabel(level: CompetitionLevel | null) {
  return ({
    internal: "Tournoi interne",
    club: "Tournoi Club",
    regional: "Régional",
    national: "National",
    international: "International",
  } as Record<CompetitionLevel, string>)[level ?? "club"];
}

function categoryLabel(category: CompetitionCategory | null) {
  return category === "all" ? "Tous" : String(category ?? "").toUpperCase();
}

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(new Date(iso));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br />");
}

function parseMailFrom(raw: string) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^(.*)<([^>]+)>$/);
  if (!match) return { email: value || "noreply@activitee.golf", name: "ActiviTee" };
  return { name: match[1].trim().replace(/^"|"$/g, "") || "ActiviTee", email: match[2].trim() };
}

async function sendBrevoEmail(args: { to: string; name: string; subject: string; body: string; externalUrl: string | null }) {
  const apiKey = mustEnv("BREVO_API_KEY");
  const externalLink = args.externalUrl
    ? `<p><a href="${escapeHtml(args.externalUrl)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#35483b;color:#fff;text-decoration:none;font-weight:700">S’inscrire sur la plateforme externe</a></p>`
    : "";
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: parseMailFrom(process.env.MAIL_FROM || "ActiviTee <noreply@activitee.golf>"),
      to: [{ email: args.to, name: args.name }],
      subject: args.subject,
      textContent: args.body,
      htmlContent: `<p>${escapeHtml(args.body)}</p>${externalLink}`,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(json?.message ?? "Email send failed"));
}

async function dispatchPush(supabaseAdmin: SupabaseAdminClient, recipientIds: string[], title: string, body: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || recipientIds.length === 0) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@activitee.app", publicKey, privateKey);

  let pushRecipientIds = recipientIds;
  const preferences = await supabaseAdmin
    .from("user_notification_preferences")
    .select("user_id,receive_push,enabled_kinds")
    .in("user_id", recipientIds);
  if (!preferences.error) {
    const preferenceByUserId = new Map(
      ((preferences.data ?? []) as PreferenceRow[]).map((row) => [row.user_id, row]),
    );
    pushRecipientIds = recipientIds.filter((userId) => {
      const preference = preferenceByUserId.get(userId);
      if (!preference) return true;
      if (preference.receive_push !== true) return false;
      return !preference.enabled_kinds?.length || preference.enabled_kinds.includes("competition_reminder");
    });
  }
  if (pushRecipientIds.length === 0) return;

  const subscriptions = await supabaseAdmin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .in("user_id", pushRecipientIds);
  if (subscriptions.error) return;
  const staleIds: number[] = [];
  await Promise.all(((subscriptions.data ?? []) as PushSubscriptionRow[]).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ title, body, url: "/player/golf/trainings?type=competition", icon: "/icon-192.png", badge: "/icon-192.png" }),
      );
    } catch (error: unknown) {
      const status = Number((error as { statusCode?: number } | null)?.statusCode ?? 0);
      if (status === 404 || status === 410) staleIds.push(Number(subscription.id));
    }
  }));
  if (staleIds.length > 0) await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
}

async function loadEmails(supabaseAdmin: SupabaseAdminClient, userIds: string[]) {
  const targetIds = new Set(userIds);
  const emails = new Map<string, string>();
  let page = 1;
  while (targetIds.size > emails.size && page <= 20) {
    const result = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(result.error.message);
    for (const user of result.data.users) {
      if (targetIds.has(user.id) && user.email) emails.set(user.id, user.email);
    }
    if (result.data.users.length < 1000) break;
    page += 1;
  }
  return emails;
}

async function processReminder(supabaseAdmin: SupabaseAdminClient, reminder: ReminderRow) {
  const eventRes = await supabaseAdmin
    .from("club_events")
    .select("id,event_type,title,starts_at,ends_at,status,competition_level,competition_category,external_registration_url")
    .eq("id", reminder.event_id)
    .maybeSingle();
  if (eventRes.error) throw new Error(eventRes.error.message);
  const event = eventRes.data;
  if (!event || event.status !== "scheduled" || event.event_type !== "competition") {
    await supabaseAdmin.from("club_event_reminders").update({ status: "cancelled", last_error: null }).eq("id", reminder.id);
    return { id: reminder.id, status: "cancelled" };
  }

  const attendeesRes = await supabaseAdmin
    .from("club_event_attendees")
    .select("player_id")
    .eq("event_id", reminder.event_id);
  if (attendeesRes.error) throw new Error(attendeesRes.error.message);
  const playerIds = uniq(((attendeesRes.data ?? []) as AttendeeRow[]).map((row) => row.player_id));

  const guardiansRes = playerIds.length > 0
    ? await supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id,can_view").in("player_id", playerIds)
    : ({ data: [], error: null } as const);
  if (guardiansRes.error) throw new Error(guardiansRes.error.message);
  const guardianIds = uniq(((guardiansRes.data ?? []) as GuardianRow[]).filter((row) => row.can_view !== false).map((row) => row.guardian_user_id));
  const recipientIds = uniq([...playerIds, ...guardianIds]).filter((id) => id !== reminder.created_by);

  const body = renderCompetitionReminderTemplate(reminder.message_template, {
    competition_name: String(event.title ?? "Compétition"),
    start_date: dateLabel(event.starts_at),
    end_date: dateLabel(event.ends_at),
    level: levelLabel(event.competition_level as CompetitionLevel | null),
    category: categoryLabel(event.competition_category as CompetitionCategory | null),
    external_registration_url: String(event.external_registration_url ?? ""),
  });
  const title = `Rappel compétition · ${String(event.title ?? "Compétition")}`;
  const flags = reminderChannelFlags(reminder.channel);
  const errors: string[] = [];

  if (flags.inApp && recipientIds.length > 0) {
    try {
      const notificationRes = await supabaseAdmin.from("notifications").insert({
        actor_user_id: reminder.created_by,
        type: "competition_reminder",
        kind: "competition_reminder",
        title,
        body,
        data: {
          event_id: event.id,
          url: "/player/golf/trainings?type=competition",
          external_registration_url: event.external_registration_url ?? null,
        },
      }).select("id").single();
      if (notificationRes.error) throw new Error(notificationRes.error.message);
      const recipientsRes = await supabaseAdmin.from("notification_recipients").upsert(
        recipientIds.map((userId) => ({ notification_id: notificationRes.data.id, user_id: userId })),
        { onConflict: "notification_id,user_id" },
      );
      if (recipientsRes.error) throw new Error(recipientsRes.error.message);
      await dispatchPush(supabaseAdmin, recipientIds, title, body);
    } catch (error: unknown) {
      errors.push(`in_app: ${error instanceof Error ? error.message : "dispatch failed"}`);
    }
  }

  if (flags.email && recipientIds.length > 0) {
    try {
      const [emails, profilesRes] = await Promise.all([
        loadEmails(supabaseAdmin, recipientIds),
        supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", recipientIds),
      ]);
      if (profilesRes.error) throw new Error(profilesRes.error.message);
      const names = new Map<string, string>(((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [
        String(profile.id),
        `${String(profile.first_name ?? "").trim()} ${String(profile.last_name ?? "").trim()}`.trim() || "Utilisateur",
      ]));
      let sent = 0;
      for (const userId of recipientIds) {
        const email = emails.get(userId);
        if (!email) continue;
        await sendBrevoEmail({
          to: email,
          name: names.get(userId) ?? "Utilisateur",
          subject: title,
          body,
          externalUrl: event.external_registration_url ?? null,
        });
        sent += 1;
      }
      if (sent === 0) throw new Error("Aucune adresse e-mail disponible pour les destinataires.");
    } catch (error: unknown) {
      errors.push(`email: ${error instanceof Error ? error.message : "dispatch failed"}`);
    }
  }

  const completedAt = new Date().toISOString();
  const updateRes = await supabaseAdmin.from("club_event_reminders").update({
    status: errors.length === 0 ? "sent" : "failed",
    sent_at: errors.length === 0 ? completedAt : null,
    last_error: errors.length > 0 ? errors.join(" | ") : null,
  }).eq("id", reminder.id).eq("status", "processing");
  if (updateRes.error) throw new Error(updateRes.error.message);
  return { id: reminder.id, status: errors.length === 0 ? "sent" : "failed", errors };
}

async function handler(req: NextRequest) {
  try {
    const cronSecret = mustEnv("CRON_SECRET");
    if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const claimRes = await supabaseAdmin.rpc("claim_due_club_event_reminders", { p_limit: 50 });
    if (claimRes.error) return NextResponse.json({ error: claimRes.error.message }, { status: 500 });
    const claimed = (claimRes.data ?? []) as ReminderRow[];
    const results = [];
    for (const reminder of claimed) {
      try {
        results.push(await processReminder(supabaseAdmin, reminder));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Reminder processing failed";
        await supabaseAdmin.from("club_event_reminders").update({ status: "failed", last_error: message }).eq("id", reminder.id).eq("status", "processing");
        results.push({ id: reminder.id, status: "failed", errors: [message] });
      }
    }
    return NextResponse.json({ ok: true, claimed: claimed.length, results });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
