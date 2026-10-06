import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/notifications.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("notifications.ts", source, ts.ScriptTarget.Latest, true);
const countFunction = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "getUnreadNotificationsCount"
);
assert.ok(countFunction);
const compiled = ts.transpileModule(`${countFunction.getText(ast)}\nexport { getUnreadNotificationsCount };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

type Preferences = { receiveInApp: boolean; enabledKinds: string[] };

function makeCounter(prefs: Preferences, kinds: Record<string, string>) {
  const recipients = Object.keys(kinds).map((notification_id, index) => ({ id: index + 1, notification_id }));
  // A recipient whose notification is no longer readable must not produce a badge.
  recipients.push({ id: 99, notification_id: "missing" });
  const supabase = {
    from(table: string) {
      if (table === "notification_recipients") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { eq: async () => ({ data: recipients, error: null }) };
                  },
                };
              },
            };
          },
        };
      }
      assert.equal(table, "notifications");
      return { select: () => ({ in: async () => ({ data: Object.entries(kinds).map(([id, kind]) => ({ id, kind })), error: null }) }) };
    },
  };
  const exports: Record<string, unknown> = {};
  new Function("supabase", "loadMyNotificationPreferences", "isKindEnabled", "exports", compiled)(
    supabase,
    async () => prefs,
    (kind: string, settings: Preferences) => settings.receiveInApp && (settings.enabledKinds.length === 0 || settings.enabledKinds.includes(kind)),
    exports,
  );
  return exports.getUnreadNotificationsCount as (userId: string, options?: { hideThreadNotifications?: boolean }) => Promise<number>;
}

test("the badge counts only visible and readable notifications for each section", async () => {
  const count = makeCounter(
    { receiveInApp: true, enabledKinds: [] },
    { message: "thread_message", training: "coach_event_created" }
  );
  assert.equal(await count("player", { hideThreadNotifications: true }), 1);
  assert.equal(await count("manager", { hideThreadNotifications: true }), 1);
  assert.equal(await count("coach"), 2);
});

test("the badge respects notification preferences", async () => {
  const kinds = { message: "thread_message", training: "coach_event_created" };
  assert.equal(await makeCounter({ receiveInApp: false, enabledKinds: [] }, kinds)("player"), 0);
  assert.equal(await makeCounter({ receiveInApp: true, enabledKinds: ["coach_event_created"] }, kinds)("player"), 1);
});
