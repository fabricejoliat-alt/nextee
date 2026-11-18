import assert from "node:assert/strict";
import test from "node:test";
import { managerDatabase, loadManagerModule } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, flush, textContent } from "./helpers/coachComponentHarness.ts";

function settingsFixture(admin = true) {
  const row = { singleton: true, instructions: "Conserver chaque observation et sa correction technique.", revision: 1, updated_at: "2026-11-18" };
  const { db, writes } = managerDatabase({ coach_ai_rewrite_settings: [row] });
  const route = loadManagerModule<{ GET: (req: Request) => Promise<Response>; PUT: (req: Request) => Promise<Response> }>("app/api/admin/coach-ai-settings/route.ts", {
    "@/lib/server/adminAudit": { withAdminMutationAudit: (handler: unknown) => handler },
    "@/lib/server/legalAccess": { legalDb: () => db, legalAdmin: async () => admin ? { id: "admin" } : null, legalNoStore: { "Cache-Control": "private, no-store" } },
  });
  return { row, writes, route, request: (body: object) => new Request("http://test.invalid/api/admin/coach-ai-settings", { method: "PUT", body: JSON.stringify(body) }) };
}
test("only admins may read or change platform rewrite instructions", async () => {
  const f = settingsFixture(false);
  assert.equal((await f.route.GET(new Request("http://test.invalid"))).status, 403);
  assert.equal((await f.route.PUT(f.request({ instructions: f.row.instructions, revision: 1 }))).status, 403);
  assert.equal(f.writes.length, 0);
});
test("admin writes advance the expected revision and stale edits are rejected", async () => {
  const f = settingsFixture();
  const read = await f.route.GET(new Request("http://test.invalid"));
  assert.match(read.headers.get("Cache-Control")!, /no-store/);
  assert.equal((await read.json()).revision, 1);
  const updated = await f.route.PUT(f.request({ instructions: "Conserver toutes les observations et tous les exercices sans résumé.", revision: 1 }));
  assert.equal(updated.status, 200); assert.equal(f.writes[0].values.revision, 2);
  Object.assign(f.row, f.writes[0].values);
  assert.equal((await f.route.PUT(f.request({ instructions: f.row.instructions, revision: 1 }))).status, 409);
});
test("invalid or unbounded guidance cannot be saved", async () => {
  const f = settingsFixture();
  for (const instructions of ["", "court", "x".repeat(6001), null]) {
    assert.equal((await f.route.PUT(f.request({ instructions, revision: 1 }))).status, 400);
  }
  assert.equal(f.writes.length, 0);
});

test("the admin can load, edit, save and reload common instructions", async () => {
  let stored = { instructions: "Conserver chaque observation et sa correction technique.", revision: 1, default_instructions: "Consignes par défaut pour conserver toutes les informations." };
  const request: typeof fetch = async (_input, init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.revision, stored.revision);
      stored = { ...stored, instructions: body.instructions, revision: stored.revision + 1 };
    }
    return Response.json(stored);
  };
  const fixture = () => coachComponentHarness("components/admin/CoachAiSettingsAdmin.tsx", {
    fetch: request, modules: { "@/lib/adminFetch": { adminFetch: request } },
  });
  let h = fixture();
  try {
    h.render(); await flush(); let tree = h.render();
    const textarea = elements(tree).find(node => node.type === "textarea")!;
    assert.equal(textarea.props.value, stored.instructions);
    textarea.props.onChange({ target: { value: "Conserver le constat du club légèrement intérieur au milieu du backswing et la correction des poignets." } });
    tree = h.render(); await elements(tree).find(node => node.type === "form")!.props.onSubmit({ preventDefault() {} });
    await flush(); tree = h.render();
    assert.match(textContent(tree), /Consignes enregistrées/);
    assert.equal(stored.revision, 2);
    h.cleanup(); h = fixture(); h.render(); await flush(); tree = h.render();
    assert.equal(elements(tree).find(node => node.type === "textarea")!.props.value, stored.instructions);
    assert.match(stored.instructions, /légèrement intérieur au milieu du backswing/);
  } finally { h.cleanup(); }
});
