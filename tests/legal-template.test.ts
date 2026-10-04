import assert from "node:assert/strict";
import test from "node:test";
import { legalTemplateValid, legalTranslationsMatch } from "../lib/legalTemplate.ts";

test("legal translations preserve every occurrence of a reviewed variable", () => {
  const source = { title: "Club {{club_name}}", body: "{{child_name}} et {{child_name}}", action_label: "Autoriser" };
  assert.equal(legalTranslationsMatch(source, { title: "Club {{club_name}}", body: "{{child_name}} and {{child_name}}", action_label: "Authorize" },
    ["child_name", "club_name"]), true);
  assert.equal(legalTranslationsMatch(source, { title: "Club {{club_name}}", body: "{{child_name}}", action_label: "Authorize" },
    ["child_name", "club_name"]), false);
});

test("unreviewed and malformed placeholders are rejected", () => {
  assert.equal(legalTemplateValid("{{email}}", ["child_name"]), false);
  assert.equal(legalTemplateValid("{{child-name}}", ["child_name"]), false);
  assert.equal(legalTemplateValid("{{child_name}", ["child_name"]), false);
  assert.equal(legalTemplateValid("{{child_name}}", ["child_name"]), true);
});
