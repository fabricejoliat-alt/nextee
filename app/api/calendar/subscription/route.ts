import { NextResponse } from "next/server";
import { legalActor, legalDb } from "@/lib/server/legalAccess";
import { verifiedAdminAssurance } from "@/lib/server/adminSecurity";
import { assertCalendarAccount, authorizeCalendar, CalendarAccessError, calendarHeaders, createSubscription,
  findSubscription, parseCalendarScope, publicSubscription, scopeKey } from "@/lib/server/calendarSubscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request) {
  try {
    const db = legalDb();
    const actor = await legalActor(req, db);
    if (!actor) throw new CalendarAccessError(401);
    assertCalendarAccount(actor);
    const params = new URL(req.url).searchParams;
    const scope = parseCalendarScope(params);
    const admin = await db.from("app_admins").select("user_id").eq("user_id", actor.id).maybeSingle();
    if (admin.error) throw admin.error;
    if (admin.data) {
      const assurance = await verifiedAdminAssurance(db, req.headers.get("authorization")!.replace(/^Bearer\s+/i, "").trim(), actor.id);
      if (!assurance.mfa || (req.method !== "GET" && !assurance.recent)) throw new CalendarAccessError(403);
    }
    if (req.method === "DELETE") {
      // Revocation remains possible even after a membership or guardian link is removed.
      const deleted = await db.from("calendar_subscriptions").delete().eq("user_id", actor.id).eq("kind", scope.kind).eq("scope_key", scopeKey(scope));
      if (deleted.error) throw deleted.error;
      return NextResponse.json({ subscription: null }, { headers: calendarHeaders });
    }
    await authorizeCalendar(db, actor.id, scope);
    const row = req.method === "POST" ? await createSubscription(db, actor.id, scope, params.get("locale")) : await findSubscription(db, actor.id, scope);
    return NextResponse.json({ subscription: publicSubscription(row, new URL(req.url).origin) }, { headers: calendarHeaders });
  } catch (error) {
    const status = error instanceof CalendarAccessError ? error.status : (error as { status?: number })?.status === 403 ? 403 : 503;
    return NextResponse.json({ error: "calendar.unavailable" }, { status, headers: calendarHeaders });
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
