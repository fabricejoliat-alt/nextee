import assert from "node:assert/strict";
import test from "node:test";
import { notificationTemplateDefaults, NOTIFICATION_LOCALES, renderNotificationTemplate, validateNotificationTemplate, notificationTranslationsMatch, notificationVariableExamples, notificationKindsForRole } from "../lib/notificationCatalog.ts";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

test("all production categories have four complete templates and previews without unresolved placeholders", () => {
  for (const [key, template] of Object.entries(notificationTemplateDefaults)) for (const locale of NOTIFICATION_LOCALES) {
    assert.equal(validateNotificationTemplate(key, template[locale]), null, key + locale);
    assert(notificationTranslationsMatch(template.fr, template[locale]), key + locale);
    const rendered = renderNotificationTemplate(key, locale, notificationVariableExamples);
    assert.doesNotMatch(rendered.title + rendered.body, /[{}]/);
  }
});
test("Coach settings exclude player evaluations and competitions; Player excludes presence reports", () => {
  assert(!notificationKindsForRole("coach").includes("coach_player_evaluated"));
  assert(!notificationKindsForRole("coach").includes("competition_reminder"));
  assert(notificationKindsForRole("coach").includes("player_marked_absent"));
  assert(!notificationKindsForRole("player").includes("player_marked_absent"));
});
test("locationPart contains only the place, including previously stored bullet prefixes", () => {
  assert.equal(notificationVariableExamples.locationPart, "Practice");
  for (const locale of NOTIFICATION_LOCALES) {
    for (const locationPart of ["Practice", " · Practice", " • Practice"]) {
      const result = renderNotificationTemplate("notif.coachEventCreated", locale, {locationPart}, {
        "notif.coachEventCreated.body": "Lieu : {locationPart}",
      });
      assert.equal(result.body, "Lieu : Practice");
    }
    const result = renderNotificationTemplate("notif.coachEventCreated", locale, {eventType:"Training",dateTime:"17:00",locationPart:"Practice"});
    assert(result.body.endsWith("17:00 Practice"));
    const legacy = renderNotificationTemplate("notif.coachEventCreated", locale, {dateTime:"17:00",locationPart:" · Practice"}, {"notif.coachEventCreated.body":"{dateTime}{locationPart}"});
    assert.equal(legacy.body,"17:00 Practice");
  }
});
test("unknown, malformed and moved variables fail validation", () => {
  assert(validateNotificationTemplate("notif.coachPlayerEvaluated", { title: "Hi", body: "{secret}" }));
  assert(validateNotificationTemplate("notif.coachPlayerEvaluated", { title: "Hi", body: "{{playerName}}" }));
  assert(validateNotificationTemplate("toString", { title: "Hi", body: "message" }));
  assert(!notificationTranslationsMatch({ title: "{playerName}", body: "message" }, { title: "message", body: "{playerName}" }));
});
const request = (value: object) => new Request("https://app.invalid/api/admin/notification-templates", { method: "POST", headers: { authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify(value) });
function adminRoute(allowed = true, translated?: object, upstream?: {status:number;code:string}) {
  const { db, writes } = managerDatabase(); let aiCalls = 0;
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/adminAudit": { withAdminMutationAudit: (fn: unknown) => fn },
    "../news/_lib": { createAdminClient: () => db, requirePlatformAdmin: async () => allowed ? { ok: true, callerId: "admin" } : { ok: false, status: 403, error: "Forbidden" } },
    "../../news/_lib": { createAdminClient: () => db, requirePlatformAdmin: async () => allowed ? { ok: true, callerId: "admin" } : { ok: false, status: 403, error: "Forbidden" } },
    fetch: async () => { aiCalls++; return upstream ? Response.json({error:{code:upstream.code}}, {status:upstream.status}) : Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(translated) }] }] }); },
  };
  return { db, writes, aiCalls: () => aiCalls, save: loadManagerModule<{ POST: (req: Request) => Promise<Response> }>("app/api/admin/notification-templates/route.ts", mocks).POST,
    translate: loadManagerModule<{ POST: (req: Request) => Promise<Response> }>("app/api/admin/notification-templates/translate/route.ts", mocks, { OPENAI_API_KEY: "test" }).POST };
}
test("template API rejects non-admin and saves four languages in one statement", async () => {
  const key = "notif.playerMarkedAbsent"; const definition = notificationTemplateDefaults[key];
  const translations = Object.fromEntries(NOTIFICATION_LOCALES.map(locale => [locale, definition[locale]]));
  const denied = adminRoute(false); assert.equal((await denied.save(request({ key, translations }))).status, 403); assert.equal(denied.writes.length, 0);
  const allowed = adminRoute(); assert.equal((await allowed.save(request({ key, translations }))).status, 200);
  assert.equal(allowed.writes.length, 1); assert.equal(allowed.writes[0].values.length, 8);
  translations.de = { title: "Falsch", body: "{secret}" };
  assert.equal((await allowed.save(request({ key, translations }))).status, 400); assert.equal(allowed.writes.length, 1);
});
test("AI translation requires Admin and preserves variables before returning a draft", async () => {
  const key = "notif.playerMarkedAbsent"; const definition = notificationTemplateDefaults[key];
  const input = { key, source: definition.fr };
  const denied = adminRoute(false); assert.equal((await denied.translate(request(input))).status, 403); assert.equal(denied.aiCalls(), 0);
  const good = adminRoute(true, { en: definition.en, de: definition.de, it: definition.it });
  assert.equal((await good.translate(request(input))).status, 200); assert.equal(good.writes.length, 0);
  const bad = adminRoute(true, { en: definition.en, de: { title: "Changed", body: "No variables" }, it: definition.it });
  assert.equal((await bad.translate(request(input))).status, 502); assert.equal(bad.writes.length, 0);
});
test("translation failures explain the upstream cause and never save drafts", async () => {
  for (const [status,code,expected] of [[429,"insufficient_quota","facturation"],[401,"invalid_api_key","clé"],[429,"rate_limit_exceeded","temporairement"],[404,"model_not_found","modèle"]] as const) {
    const route = adminRoute(true,undefined,{status,code});
    const response = await route.translate(request({key:"notif.coachEventCreated",source:notificationTemplateDefaults["notif.coachEventCreated"].fr}));
    assert.equal(response.status,502);
    const result = await response.json();
    assert(result.error.includes(expected));
    assert(result.error.includes("Vos textes sont conservés."));
    assert.equal(route.writes.length,0);
  }
});
test("push renders saved overrides using each device's language", async () => {
  const { db } = managerDatabase({
    user_notification_preferences: [{ user_id: "player", receive_push: true, receive_in_app: true, enabled_kinds: [] }],
    push_subscriptions: [{ id: 1, user_id: "player", endpoint: "https://web.push.apple.com/de", locale: "de" }, { id: 2, user_id: "player", endpoint: "https://fcm.googleapis.com/en", locale: "en" }],
    app_translations: [{ locale: "de", key: "notif.coachPlayerEvaluated.title", value: "Bewertung für {playerName}" }],
  });
  const delivered: { endpoint: string; title: string }[] = [];
  const { sendWebPush } = loadManagerModule<{ sendWebPush: (db: unknown, input: object) => Promise<{ sent: number }> }>("lib/server/webPush.ts", {
    "web-push": { __esModule: true, default: { setVapidDetails() {}, async sendNotification(sub: { endpoint: string }, payload: string) { delivered.push({ endpoint: sub.endpoint, title: JSON.parse(payload).title }); } } },
  }, { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "fixture", VAPID_PRIVATE_KEY: "fixture" });
  const result = await sendWebPush(db, { recipientUserIds: ["player"], kind: "coach_player_evaluated", title: "fallback", templateKey: "notif.coachPlayerEvaluated", templateParams: { playerName: "Léa", eventType: "Training", dateTime: "20.10.2026" } });
  assert.equal(result.sent, 2); assert.equal(delivered[0].title, "Bewertung für Léa"); assert.equal(delivered[1].title, "New coach evaluation");
});
test("planning changes notify only active assigned coaches, with a Coach destination and no self-notification", async () => {
  const { db, writes } = managerDatabase({
    club_events: [{ id: "event", club_id: "club", group_id: "group" }],
    club_event_coaches: [{ event_id: "event", coach_id: "actor" }, { event_id: "event", coach_id: "coach" }, { event_id: "event", coach_id: "inactive" }, { event_id: "other-event", coach_id: "outsider" }],
    club_members: [{ club_id: "club", user_id: "actor", role: "coach", is_active: true }, { club_id: "club", user_id: "coach", role: "coach", is_active: true }, { club_id: "club", user_id: "inactive", role: "coach", is_active: false }],
  });
  Object.assign(db, { rpc: async () => ({ data: true, error: null }) });
  const sends: Record<string, unknown>[] = [];
  const { notifyEventCoaches } = loadManagerModule<{ notifyEventCoaches: (db: unknown, input: object) => Promise<unknown> }>("lib/server/notificationStaff.ts", {
    "@/lib/server/webPush": { sendWebPush: async (_db: unknown, input: Record<string, unknown>) => { sends.push(input); return { sent: 1 }; } },
  });
  await notifyEventCoaches(db, { id: "notification", actor_user_id: "actor", kind: "coach_event_updated", title: "Updated", body: "Details", data: { event_id: "event", child_id: "player", url: "/player" } });
  assert.deepEqual(sends[0].recipientUserIds, ["coach"]); assert.equal(sends[0].url, "/coach/groups/group/planning/event");
  const created = writes.find(write => write.table === "notifications")!.values;
  assert.equal(created.data.child_id, undefined); assert.equal(created.data.staff_copy, true);
});
test("past attendance notification resolves the real player and checks recipients before delivery", async () => {
  const { db, writes } = managerDatabase({
    club_events: [{ id: "event", club_id: "club", group_id: "group", starts_at: "2026-09-29T15:00:00Z" }],
    club_event_coaches: [{ event_id: "event", coach_id: "allowed" }, { event_id: "event", coach_id: "revoked" }],
    profiles: [{ id: "player", first_name: "Léa", last_name: "Martin" }],
  });
  Object.assign(db, { rpc: async (_name: string, args: { p_actor: string }) => ({ data: args.p_actor === "allowed", error: null }) });
  const sends: Record<string, unknown>[] = [];
  const { notifyPlayerAttendance } = loadManagerModule<{ notifyPlayerAttendance: (db: unknown, input: object) => Promise<unknown> }>("lib/server/playerAttendanceNotifications.ts", {
    "@/lib/server/webPush": { sendWebPush: async (_db: unknown, input: Record<string, unknown>) => { sends.push(input); return { sent: 1 }; } },
  });
  await notifyPlayerAttendance(db, { actorId: "parent", playerId: "player", eventId: "event", status: "absent" });
  assert.deepEqual(sends[0].recipientUserIds, ["allowed"]); assert.equal(sends[0].kind, "player_marked_absent");
  assert.equal((sends[0].templateParams as Record<string, string>).playerName, "Léa Martin");
  assert.equal(writes.find(write => write.table === "notification_recipients")!.values.length, 1);
});
