import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the migration scopes AI assistance to one active Coach membership", () => {
  const migration = source("supabase/migrations/20260926_add_per_coach_training_assistance.sql");
  assert.match(migration, /alter table public\.club_members/);
  assert.match(migration, /coach_training_assistance_enabled boolean not null default false/);
  assert.match(migration, /is_coach_training_assistance_enabled_for_coach/);
  assert.match(migration, /membership\.user_id = p_coach_id/);
  assert.match(migration, /membership\.role = 'coach'/);
  assert.match(migration, /membership\.is_active = true/);
});

test("manager navigation and Coach details expose the individual setting", () => {
  const drawer = source("components/manager/ManagerDesktopDrawer.tsx");
  const page = source("app/manager/ai-assistance/page.tsx");
  const coachDetails = source("components/manager/CoachEditPage.tsx");
  assert.match(drawer, /aiAssistance: "\/manager\/ai-assistance"/);
  assert.match(drawer, /icon: WandSparkles/);
  assert.match(page, /coach_training_assistance_enabled/);
  assert.match(page, /ManagerMemberAvatar/);
  assert.match(page, /user-mgmt-field-label">\{t\("manager.settings.search"\)\}/);
  assert.doesNotMatch(page, /Voir la fiche/);
  assert.match(page, /role="switch"/);
  assert.match(page, /aria-checked=\{enabled\}/);
  assert.match(coachDetails, /label=\{t\("manager.nav.ai"\)\}/);
});

test("Coach AI routes pass the authenticated Coach id to the authorization helper", () => {
  const helper = source("lib/server/coachTrainingAssistance.ts");
  const eventRoute = source("app/api/coach/events/[eventId]/route.ts");
  const insightRoute = source("app/api/coach/events/[eventId]/preparation-insights/route.ts");
  assert.match(helper, /p_coach_id: normalizedCoachId/);
  assert.match(eventRoute, /clubId, callerId/);
  assert.match(insightRoute, /targetEvent\.club_id, callerId/);
});

test("training-volume no longer renders or saves the old club-wide toggle", () => {
  const page = source("app/manager/training-volume/page.tsx");
  assert.doesNotMatch(page, /coachTrainingAssistanceEnabled/);
  assert.doesNotMatch(page, /managerTrainingAssistance\.title/);
});
