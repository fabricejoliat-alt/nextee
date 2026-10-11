import assert from "node:assert/strict";
import test from "node:test";
import { requiresParentCode } from "../lib/legalParentConfirmation.ts";

test("only the configured service authorization can skip a second code", () => {
  const access = { kind: "parent_authorization", purpose_key: "service.parent_authorization" };
  assert.equal(requiresParentCode(false, access, false), false);
  assert.equal(requiresParentCode(false, access, true), true);
  assert.equal(requiresParentCode(false, { kind: "specific_consent", purpose_key: "coaching.rewrite" }, false), true);
  assert.equal(requiresParentCode(false, { kind: "parent_authorization", purpose_key: "other" }, false), true);
  assert.equal(requiresParentCode(false, null, false), true);
  assert.equal(requiresParentCode(true, access, true), false);
});
