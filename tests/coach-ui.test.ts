import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildCoachValidations, type CoachValidationExerciseSource } from "../lib/coachValidations.ts";
import { coachMessages, coachText, coachDateLocale } from "../lib/i18n/coachMessages.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachUiErrorKey, coachCaughtErrorKey } from "../lib/coachUiErrors.ts";

const sections = [{ id: "putting", slug: "putting", name: "Putting", sort_order: 1, is_active: true }];
const exercise = (id: string, sequence_no: number): CoachValidationExerciseSource => ({
  id, sequence_no, section_id: "putting", external_code: null, level: 1, name: id,
  objective: null, short_description: null, detailed_description: null, equipment: null,
  validation_rule_text: null, illustration_url: null, is_active: true,
});
const exercises = [exercise("first", 1), exercise("second", 2), exercise("third", 3)];
const source = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("validation counts are distinct successes within the authorized population", () => {
  const result = buildCoachValidations(sections, exercises, ["A", "B", "A"], [], [
    { player_id: "A", exercise_id: "first", result: "success" },
    { player_id: "A", exercise_id: "first", result: "success" },
    { player_id: "A", exercise_id: "first", result: "failure" },
    { player_id: "B", exercise_id: "second", result: "failure" },
    { player_id: "outside", exercise_id: "third", result: "success" },
  ])[0].exercises;
  assert.deepEqual(result.map((row) => row.validated_player_count), [1, 0, 0]);
  assert.deepEqual(result.map((row) => row.player_count), [2, 2, 2]);
  assert.deepEqual(result.map((row) => row.challengers.map((player) => player.id)), [["B"], ["A"], []]);
  assert.ok(result.every((row) => !("is_validated" in row) && !("badge" in row)));
});

test("challengers must individually complete every previous active exercise", () => {
  const result = buildCoachValidations(sections, [...exercises].reverse(), ["A", "B"], [], [
    { player_id: "A", exercise_id: "first", result: "success" },
    { player_id: "B", exercise_id: "second", result: "success" },
  ])[0].exercises;
  assert.deepEqual(result.map((row) => row.challengers.map((player) => player.id)), [["B"], ["A"], []]);
  const inactive = buildCoachValidations([...sections, { ...sections[0], id: "hidden", is_active: false }],
    [{ ...exercises[0], is_active: false }, exercises[1]], ["A"], [], []);
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].exercises.length, 1);
  assert.deepEqual(inactive[0].exercises[0].challengers.map((player) => player.id), ["A"]);
});

test("empty clubs retain the catalogue but have zero validations and challengers", () => {
  const result = buildCoachValidations(sections, exercises, [], [], [ { player_id: "removed", exercise_id: "first", result: "success" } ]);
  assert.equal(result[0].exercises.length, 3);
  assert.ok(result[0].exercises.every((row) => row.player_count === 0 && row.validated_player_count === 0 && row.challengers.length === 0));
});

test("Coach copy exists in all four locales with matching interpolation tokens", () => {
  const tokens = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((item) => item[1]).sort();
  for (const key of Object.keys(coachMessages.fr) as Array<keyof typeof coachMessages.fr>) {
    for (const locale of ["fr", "en", "de", "it"] as const) {
      assert.ok(coachMessages[locale][key].trim(), locale + ":" + key);
      assert.equal(messages[locale][key], coachMessages[locale][key]);
      assert.deepEqual(tokens(coachMessages[locale][key]), tokens(coachMessages.fr[key]), locale + ":" + key);
    }
  }
  assert.equal(coachText((key) => messages.de[key], "coach.validation.playerCount", { validated: 2, total: 5 }), "2/5 Junioren haben diese Aufgabe bestanden");
  assert.equal(coachDateLocale("de"), "de-CH");
  assert.equal(coachDateLocale("it"), "it-CH");
});

test("all Coach UI dictionary references resolve and covered screens no longer fall back to English", () => {
  const files = ["app/coach/page.tsx", "app/coach/calendar/page.tsx", "app/coach/CoachLearningCards.tsx",
    "app/coach/validations/page.tsx", "components/coach/CoachDesktopDrawer.tsx",
    "app/coach/players/page.tsx", "app/coach/groups/page.tsx", "app/coach/camps/page.tsx",
    "components/coach/CoachPlayerTransferDialog.tsx", "components/coach/player-detail/CoachPlayerActivityCard.tsx",
    "app/coach/groups/[id]/page.tsx", "components/coach/CoachMemberPicker.tsx", "app/coach/groups/[id]/planning/page.tsx", "app/coach/groups/[id]/planning/add/page.tsx", "app/coach/groups/[id]/planning/[eventId]/edit/page.tsx"];
  for (const path of files) {
    const content = source(path);
    assert.doesNotMatch(content, /pickLocaleText|locale === "fr"/, path);
    for (const [, key] of content.matchAll(/"(coach\.[a-zA-Z.]*[a-zA-Z])"/g)) {
      for (const locale of ["fr", "en", "de", "it"] as const) assert.ok(messages[locale][key], path + ":" + locale + ":" + key);
    }
  }
});

test("guided errors are localized and never render raw backend or network details", () => {
  assert.equal(coachUiErrorKey(400, { code: "evaluation_conflict" }, "coach.error.save"), "coach.error.conflict");
  assert.equal(coachUiErrorKey(403, { code: "assistance_disabled" }, "coach.error.ai"), "coach.error.aiDisabled");
  assert.equal(coachUiErrorKey(400, { error: "event_not_finished" }, "coach.error.save"), "coach.error.notFinished");
  assert.equal(coachUiErrorKey(500, { error: "sensitive internal detail" }, "coach.error.save"), "coach.error.save");
  assert.equal(coachUiErrorKey(500, { code: "toString" }, "coach.error.save"), "coach.error.save");
  for (const [status, key] of [[401, "session"], [403, "forbidden"], [404, "notFound"], [409, "conflict"], [429, "rateLimit"]] as const) {
    assert.equal(coachUiErrorKey(status, null, "coach.error.load"), "coach.error." + key);
  }
  assert.equal(coachCaughtErrorKey(new Error("Failed to fetch"), "coach.error.load"), "coach.error.load");
  assert.equal(coachCaughtErrorKey(new Error("coach.error.session"), "coach.error.load"), "coach.error.session");
  const page = source("app/coach/groups/[id]/planning/[eventId]/debrief/page.tsx");
  assert.match(page, /t\(currentAi.error\)/);
  assert.match(page, /t\(currentPrivateAi.error\)/);
  assert.doesNotMatch(page, /json\?\.error|AI analysis failed|Save failed|Session invalide/);
});

test("Coach dialogs retain native modal focus containment; the navigation drawer sits beneath the header", () => {
  const dialog = source("components/ui/AccessibleDialog.tsx");
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /dialog.showModal\(\)/);
  assert.match(dialog, /onCancel=/);
  assert.match(dialog, /opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /document.body.style.overflow = previousOverflow/);
  assert.match(dialog, /event.shiftKey/);
  assert.match(dialog, /event.preventDefault\(\); last.focus\(\)/);
  assert.match(dialog, /event.preventDefault\(\); first.focus\(\)/);
  for (const path of ["app/coach/validations/page.tsx",
    "app/coach/camps/page.tsx", "components/coach/CoachPlayerTransferDialog.tsx", "app/coach/groups/[id]/planning/page.tsx", "app/coach/groups/[id]/planning/[eventId]/edit/page.tsx"]) {
    assert.match(source(path), /<AccessibleDialog/);
    assert.doesNotMatch(source(path), /addEventListener\("keydown"/);
  }
  const drawer = source("components/coach/CoachDesktopDrawer.tsx");
  const drawerStyle = source("components/coach/CoachDesktopDrawer.module.css");
  assert.match(drawer, /className="drawer-overlay"/);
  assert.match(drawer, /role="dialog" aria-modal="true"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.shiftKey/);
  assert.match(drawer, /opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(drawer, /hideSingleOrganization/);
  assert.doesNotMatch(drawer, /drawer-top|drawer-brand|drawer-close/);
  assert.match(drawerStyle, /top: calc\(var\(--safe-top, 0px\) \+ var\(--header-h, 60px\)\)/);
  assert.match(drawerStyle, /bottom: 0/);
  assert.match(drawer, /aria-current=/);
  assert.match(source("app/coach/calendar/page.tsx"), /aria-pressed=/);
});

test("validation UI exposes real counts without attributing individual medals to a group", () => {
  const page = source("app/coach/validations/page.tsx");
  assert.match(page, /exercise.validated_player_count > 0/);
  assert.match(page, /total: exercise.player_count/);
  assert.doesNotMatch(page, /is_validated|getValidationBadge/);
  assert.match(page, /unavailable \? "—" : validatedExercises/);
  assert.match(page, /!normalizedQuery && activeSectionId/);
});

test("secondary Coach screens have no hard-coded visible interface text", () => {
  for (const path of ["app/coach/players/page.tsx", "app/coach/groups/page.tsx", "app/coach/camps/page.tsx",
    "components/coach/CoachPlayerTransferDialog.tsx", "components/coach/player-detail/CoachPlayerActivityCard.tsx",
    "app/coach/groups/[id]/page.tsx", "components/coach/CoachMemberPicker.tsx", "app/coach/groups/[id]/planning/page.tsx", "app/coach/groups/[id]/planning/add/page.tsx", "app/coach/groups/[id]/planning/[eventId]/edit/page.tsx"]) {
    const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /\p{L}/u, path + ": " + node.text.trim());
      if (ts.isJsxAttribute(node) && ["aria-label", "title", "placeholder", "data-label"].includes(node.name.getText(file)) &&
        node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.doesNotMatch(node.initializer.text, /\p{L}/u, path + ": " + node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
});

test("group member lists compact mobile rows without handicap or the role label, preserving desktop data and actions", () => {
  const page = source("app/coach/groups/[id]/page.tsx");
  const css = source("app/coach/groups/[id]/CoachGroupDetail.module.css");
  assert.equal([...page.matchAll(/detailStyles.memberList/g)].length, 2);
  assert.match(page, /data-label=\{t\("coach.directory.handicap"\)\}/);
  assert.match(page, /data-label=\{t\("coach.group.role"\)\}/);
  assert.match(css, /\.page \.memberList\{min-width:0\}/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.page \.playerList tbody>tr:first-child\{padding-top:0\}/);
  assert.match(page, /className=\{detailStyles.memberHandicap\}/);
  assert.match(page, /className=\{detailStyles.memberRole\}/);
  assert.equal([...page.matchAll(/className=\{detailStyles.memberActions\}/g)].length, 2);
  assert.match(css, /\.memberHandicap\{display:none\}/);
  assert.match(css, /\.memberRole::before\{content:none\}/);
  assert.match(css, /\.memberRole\{grid-column:3;grid-row:1;justify-self:end;text-align:right\}/);
  assert.match(css, /\.coachList \.memberActions\{grid-column:3;grid-row:2\}/);
  assert.match(css, /\.memberActions>div\{[^}]*flex-wrap:nowrap/);
  assert.match(css, /\.memberActions>button\{width:44px;height:44px/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(css, /\.playerList \.memberActions\{grid-column:2;grid-row:2\}/);
  assert.doesNotMatch(css, /\.memberActions\{display:none/);
});
