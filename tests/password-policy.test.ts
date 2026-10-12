import assert from "node:assert/strict";
import test from "node:test";
import { isValidPassword } from "../lib/passwordPolicy.ts";

test("all password flows accept the shared six character rule", () => {
  assert.equal(isValidPassword("Abcde!"), true);
  assert.equal(isValidPassword("Abcd!"), false);
  assert.equal(isValidPassword("abcdef!"), false);
  assert.equal(isValidPassword("Abcdef"), false);
  assert.equal(isValidPassword("Abcde "), false);
  assert.equal(isValidPassword(`${"A".repeat(128)}!`), false);
});
