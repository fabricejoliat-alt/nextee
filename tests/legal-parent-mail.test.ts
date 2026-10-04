import assert from "node:assert/strict";
import { test } from "node:test";
import { sendLegalParentCode } from "../lib/server/legalParentMail.ts";

test("parent code transport receives only the designated verified address and no secret is returned", async () => {
  let calls = 0;
  const result = await sendLegalParentCode({ email: "parent@example.test", code: "037218", apiKey: "test-key", from: "noreply@example.test",
    transport: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.to, [{ email: "parent@example.test" }]);
      assert.match(body.textContent, /037218/);
      assert.equal(JSON.stringify(body).includes("child_id"), false);
      return { ok: true };
    } });
  assert.equal(calls, 1);
  assert.equal(result, true);
});
