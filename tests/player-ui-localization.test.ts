import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localizedHelpSections } from "../app/player/help/localizedHelp.ts";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { pickLocaleText } from "../lib/i18n/pickLocaleText.ts";
import { marketplaceConditionLabel } from "../lib/marketplaceLabels.ts";

const locales: AppLocale[] = ["fr", "en", "de", "it"];
const playerGlossaryKeys = [
  "common.breadcrumb",
  "player.space",
  "player.activities",
  "player.myGolf",
  "player.camps",
  "player.rules",
  "player.orderOfMerit",
  "help.title",
  "help.contents",
] as const;

test("the Player glossary is complete in every supported locale", () => {
  for (const locale of locales) {
    for (const key of playerGlossaryKeys) {
      const value = messages[locale][key];
      assert.ok(value && value !== key, `${locale}.${key} must be translated`);
    }
  }

  assert.equal(messages.fr["player.myGolf"], "Mon golf");
  assert.equal(messages.fr["player.activities"], "Mes activités");
});

test("localized help covers the same Player journeys in English, German and Italian", () => {
  const expectedIds = localizedHelpSections.en.map((section) => section.id);
  assert.equal(expectedIds.length, 17);

  for (const locale of ["en", "de", "it"] as const) {
    const sections = localizedHelpSections[locale];
    assert.deepEqual(sections.map((section) => section.id), expectedIds);
    assert.ok(sections.every((section) => section.title.trim() && section.blocks.length > 0));
    assert.ok(sections.every((section) => section.blocks.some((block) =>
      Boolean(block.paragraphs?.length || block.bullets?.length || block.ordered?.length),
    )));
  }
});

test("pickLocaleText accepts reviewed German and Italian copy", () => {
  assert.equal(pickLocaleText("de", "Aide", "Help", "Hilfe", "Aiuto"), "Hilfe");
  assert.equal(pickLocaleText("it", "Aide", "Help", "Hilfe", "Aiuto"), "Aiuto");
  assert.equal(pickLocaleText("de", "Mon golf", "My golf"), "Mein Golf");
  assert.equal(pickLocaleText("it", "Mon golf", "My golf"), "Il mio golf");
});

test("Marketplace conditions use the selected Player language", () => {
  assert.equal(marketplaceConditionLabel("fr", "New"), "Neuf");
  assert.equal(marketplaceConditionLabel("en", "Like new"), "Like new");
  assert.equal(marketplaceConditionLabel("de", "Good condition"), "Guter Zustand");
  assert.equal(marketplaceConditionLabel("it", "To repair"), "Da riparare");
  assert.equal(marketplaceConditionLabel("fr", "Custom condition"), "Custom condition");
});

test("Player entry points do not import role-specific CSS modules", () => {
  for (const relativePath of [
    "../app/player/page.tsx",
    "../app/player/golf/page.tsx",
    "../components/player/PlayerNewsFeed.tsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /@\/app\/(?:coach|manager)\/.*\.module\.css/);
    assert.doesNotMatch(source, /@\/components\/(?:coach|admin)\/.*\.module\.css/);
  }
});
