import { legalDb } from "@/lib/server/legalAccess";
import { renderCalendar } from "@/lib/calendarSubscription";
import { assertCalendarAccount, CalendarAccessError, calendarHeaders, calendarTokenPattern, loadCalendarEntries, type Subscription } from "@/lib/server/calendarSubscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const feedHeaders = { ...calendarHeaders, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="activitee.ics"' };

/** Subscription clients have no app session. The opaque token grants only this feed. */
export async function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!calendarTokenPattern.test(token)) return new Response(null, { status: 404, headers: calendarHeaders });
    const db = legalDb();
    const result = await db.from("calendar_subscriptions").select("*").eq("token", token).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return new Response(null, { status: 404, headers: calendarHeaders });
    const row = result.data as Subscription;
    const actor = await db.auth.admin.getUserById(row.user_id);
    if (actor.error) {
      if (actor.error.status === 404) throw new CalendarAccessError(403);
      throw actor.error;
    }
    assertCalendarAccount(actor.data.user);
    const calendar = await loadCalendarEntries(db, row, new URL(req.url).origin);
    return new Response(renderCalendar(calendar.name, calendar.entries), { headers: feedHeaders });
  } catch (error) {
    // A valid feed whose access was withdrawn becomes empty, so calendars can
    // remove previously synced events. Transient failures never erase a schedule.
    if ((error as { status?: number })?.status === 403)
      return new Response(renderCalendar("ActiviTee", []), { headers: feedHeaders });
    return new Response(null, { status: 503, headers: { ...calendarHeaders, "Retry-After": "300" } });
  }
}
