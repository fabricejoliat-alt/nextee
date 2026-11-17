import assert from "node:assert/strict";
import test from "node:test";
import { requiresParentCode } from "../lib/legalParentConfirmation.ts";

test("service authorization and AI consents can use the configured verified-parent confirmation", () => {
  const access = { kind: "parent_authorization", purpose_key: "service.parent_authorization" };
  assert.equal(requiresParentCode(false, access, false), false);
  assert.equal(requiresParentCode(false, access, true), true);
  assert.equal(requiresParentCode(false, { kind: "specific_consent", purpose_key: "coaching.rewrite" }, false), false);
  assert.equal(requiresParentCode(false, { kind: "parent_authorization", purpose_key: "other" }, false), true);
  assert.equal(requiresParentCode(false, { kind: "specific_consent", purpose_key: "coaching.ai" }, false), false);
  assert.equal(requiresParentCode(false, { kind: "specific_consent", purpose_key: "coaching.rewrite" }, true), true);
  assert.equal(requiresParentCode(false, { kind: "specific_consent", purpose_key: "other" }, false), true);
  assert.equal(requiresParentCode(false, null, false), true);
  assert.equal(requiresParentCode(true, access, true), false);
});
