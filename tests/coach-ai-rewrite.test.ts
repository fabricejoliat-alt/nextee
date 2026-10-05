import assert from "node:assert/strict";
import test from "node:test";
import { createRewriteReview, redactCoachRewriteText, validRewriteReview, type RewriteReviewContext } from "../lib/server/coachAiRewrite.ts";

test("redacts known names in mixed case, accents and compound names while preserving surrounding text", () => {
  assert.equal(redactCoachRewriteText("ÉLOÏSE Dupont progresse. Eloise, reste concentrée !", { first_name: "Éloïse", last_name: "Dupont" }),
    "[joueur] [joueur] progresse. [joueur], reste concentrée !");
  assert.equal(redactCoachRewriteText("Jean-Luc écoute Luc. 🏌️ Très bien.", { first_name: "Jean-Luc" }), "[joueur] écoute [joueur]. 🏌️ Très bien.");
  assert.equal(redactCoachRewriteText("Ann annonce sa routine.", { first_name: "Ann" }), "[joueur] annonce sa routine.");
});

test("redacts common contacts and identifiers; other free-text details are not claimed anonymous", () => {
  const out = redactCoachRewriteText("Élève unique du village. leon@example.invalid +41 79 123 45 67 https://example.invalid/leon 11111111-1111-4111-8111-111111111111", { first_name: "Léon" });
  assert.equal(out, "Élève unique du village. [courriel] [numero] [lien] [identifiant]");
});

const context: RewriteReviewContext = { actor: "coach", event: "event", player: "child", audience: "junior", language: "French", source: "raw", redacted: "masked", grant: "v1:p:c" };
test("review is bound to the source, recipient, actor, purpose and choices, and expires", () => {
  const now = Date.now(), secret = "fixture-only";
  const review = createRewriteReview(context, secret, now);
  assert.equal(validRewriteReview(review, context, secret, now + 1), true);
  assert.equal(validRewriteReview(review, context, secret, now + 300_000), false);
  assert.equal(validRewriteReview(review, context, "other", now), false);
  assert.equal(validRewriteReview(review, context, "", now), false);
  for (const key of Object.keys(context)) {
    assert.equal(validRewriteReview(review, { ...context, [key]: "changed" }, secret, now), false, key);
  }
  assert.equal(validRewriteReview({ ...review, expires: review.expires + 1 }, context, secret, now), false);
  assert.equal(JSON.stringify(review).includes("raw"), false);
});

test("the junior's own choice is not inferred from a parent's aggregate consent", async () => {
  const { managerDatabase, loadManagerModule, managerRequest } = await import("./helpers/managerRouteHarness.ts");
  const tables = {
    club_members: [{ user_id: "junior", club_id: "club", role: "player", is_active: true }],
    legal_documents: [{ id: "doc", scope: "club", club_id: "club", purpose_key: "coaching.rewrite", audience_roles: ["parent", "player"], active: true }],
    legal_versions: [{ id: "v1", document_id: "doc", version_number: 1 }],
    legal_current_state: [{ document_id: "doc", beneficiary_id: "junior", club_scope: "club", version_id: "v1", decision: "consented", conflict: false }],
    legal_decisions: [
      { document_id: "doc", version_id: "v1", actor_id: "parent", beneficiary_id: "junior", club_id: "club", decision: "consented", source: "user_flow", decided_at: "2026-09-02" },
      { document_id: "doc", version_id: "v1", actor_id: "junior", beneficiary_id: "other", club_id: "club", decision: "consented", source: "user_flow", decided_at: "2026-09-02" },
    ],
  };
  const harness = managerDatabase(tables, { caller: "junior", applyOrder: true });
  const route = loadManagerModule<{ GET: (r: Request) => Promise<Response> }>("app/api/legal/documents/route.ts", harness.mocks);
  const first = await route.GET(managerRequest("GET"));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).documents[0].own_choice, null);
  tables.legal_decisions.push({ ...tables.legal_decisions[0], actor_id: "junior", decision: "refused", decided_at: "2026-09-03" });
  const next = await route.GET(managerRequest("GET"));
  assert.equal((await next.json()).documents[0].own_choice.decision, "refused");
  assert.equal(harness.writes.length, 0);
});
