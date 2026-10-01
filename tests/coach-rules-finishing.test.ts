import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";

const overview = { season: { title_i18n: { fr: "Saison témoin" } }, series: [], currentSeriesId: null, cards: [], progress: [] };
const init = (fetcher: typeof fetch) => coachComponentHarness("components/rules/RulesWorkspace.tsx", {
  props: { scope: "coach" }, fetch: fetcher,
  modules: {
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "./PlayerRulesWorkspace": { __esModule: true, default: "player-rules", PlayerRulesLoading: "player-loading" },
    "./CoachRulesWorkspace": { __esModule: true, default: "coach-rules", CoachRulesLoading: "coach-loading" },
  },
});

test("rules network errors are recoverable and never expose backend details", async () => {
  let reads = 0;
  const harness = init(async () => { if (++reads === 1) throw new Error("private network detail"); return Response.json(overview); });
  try {
    harness.render(); await flush();
    const error = harness.render();
    assert.equal(error.type, "coach-loading");
    assert.equal(error.props.error, "Chargement impossible. Réessayez.");
    error.props.onRetry(); await flush();
    assert.equal(harness.render().type, "coach-rules");
  } finally { harness.cleanup(); }
});

test("rules ignore an older response after a language change", async () => {
  const older = deferred<Response>(); let reads = 0;
  const harness = init(async () => ++reads === 1 ? older.promise : Response.json(overview));
  try {
    harness.render(); await flush();
    harness.setLocale("de"); harness.render(); await flush();
    assert.equal(harness.render().props.phaseLabel, messages.de["coach.rules.phase.preparing"]);
    older.resolve(Response.json({ error: "stale error" }, { status: 500 })); await flush();
    assert.equal(harness.render().type, "coach-rules");
  } finally { harness.cleanup(); }
});

test("rules reject malformed success payloads instead of crashing during render", async () => {
  const harness = init(async () => Response.json({ season: {}, series: null }));
  try { harness.render(); await flush(); assert.equal(harness.render().type, "coach-loading"); assert.ok(harness.render().props.error); }
  finally { harness.cleanup(); }
});

test("Coach rules interface and reader use all four languages and the accessible dialog", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setInterval: () => 1, clearInterval() {} } });
  const card = { position: 1, card_version_id: "card", rules_card_versions: { title: "Fiche témoin", official_reference: "Référence", situation: "Situation", simple_explanation: "Explication", action_text: "Action", common_mistake: "Erreur", coach_tip: "Conseil", image_url: null } };
  const harness = coachComponentHarness("components/rules/CoachRulesWorkspace.tsx", {
    props: { series: [], current: null, cards: [card], read: new Set(), phaseLabel: "" },
    fetch: async () => { throw new Error("Unexpected request"); }, modules: { "next/image": { __esModule: true, default: "img" } },
  });
  try {
    for (const locale of ["fr", "en", "de", "it"] as const) {
      harness.setLocale(locale);
      let tree = harness.render();
      assert.ok(textContent(tree).includes(messages[locale]["coach.rules.explore"]));
      const cardButton = elements(tree).find((node) => node.type === "button" && textContent(node).includes("Fiche témoin"));
      assert.ok(cardButton); cardButton.props.onClick();
      tree = harness.render();
      const dialog = elements(tree).find((node) => node.type === "dialog");
      assert.ok(dialog); assert.equal(dialog.props.labelledBy, "coach-rule-title");
      assert.ok(textContent(dialog).includes(messages[locale]["coach.rules.understand"]));
      dialog.props.onClose();
      assert.ok(!elements(harness.render()).some((node) => node.type === "dialog"));
    }
  } finally {
    harness.cleanup();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("rules headings stay white on the hero without recoloring card surfaces", () => {
  const css = readFileSync(new URL("../components/rules/CoachRulesWorkspace.module.css", import.meta.url), "utf8");
  assert.match(css, /\.sectionHeading h2\{[^}]*color:#fff!important/);
  assert.match(css, /\.feature h2\{[^}]*color:#35483b/);
});
