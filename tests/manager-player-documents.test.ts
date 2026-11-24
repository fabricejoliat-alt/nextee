/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated database/storage fixtures only. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
const club = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const routePath = "app/api/manager/clubs/[clubId]/players/[playerId]/documents/route.ts";

function setup({ manager = true, player = true, authorized = true, signingFailure = false } = {}) {
  const tables: Record<string, Row[]> = {
    club_members: [
      { id: "manager", club_id: club, user_id: "manager", role: "manager", is_active: manager },
      { id: "player", club_id: club, user_id: "player", role: "player", is_active: player },
    ],
    profiles: [{ id: "coach", first_name: "Coach", last_name: "QA" }],
    club_events: [{ id: "event", club_id: club, title: "Training QA", starts_at: "2026-09-01T10:00:00Z" }],
    player_dashboard_documents: [
      { id: "own", organization_id: club, player_id: "player" },
      { id: "foreign-structure", organization_id: foreign, player_id: "player" },
      { id: "foreign-junior", organization_id: club, player_id: "another-player" },
    ].map(row => ({ ...row, uploaded_by: "coach", club_event_id: "event", coach_only: true, file_name: `${row.id}.pdf`, storage_bucket: "player-documents", storage_path: `${row.id}.pdf`, mime_type: "application/pdf", size_bytes: 2048, created_at: "2026-09-01T12:00:00Z" })),
  };
  const fake = managerDatabase(tables);
  const signed: string[] = [];
  (fake.db as any).storage = { from: () => ({ createSignedUrls: async (paths: string[]) => {
    signed.push(...paths);
    return { error: signingFailure ? { message: "Storage unavailable" } : null, data: paths.map(path => ({ path, signedUrl: `https://storage.invalid/${path}?token=temporary` })) };
  } }) };
  const route = loadManagerModule(routePath, { ...fake.mocks, "@/lib/server/personalHistoryAccess": { canReadPlayerHistory: async () => authorized } });
  const get = async (token = "test") => {
    const req = new Request("https://test.invalid/documents", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const response = await route.GET(req, { params: Promise.resolve({ clubId: club, playerId: "player" }) });
    return { response, body: await response.json() };
  };
  return { ...fake, signed, get };
}

test("the manager can open coach uploads, including staff-only activity documents in the current structure", async () => {
  const h = setup(); const { response, body } = await h.get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control")!, /private.*no-store/);
  assert.deepEqual(h.signed, ["own.pdf"]);
  assert.equal(body.documents.length, 1);
  assert.equal(body.documents[0].uploaded_by_name, "Coach QA");
  assert.equal(body.documents[0].event.title, "Training QA");
  assert.equal(body.documents[0].coach_only, true);
  assert.match(body.documents[0].url, /token=temporary/);
  assert.ok(body.documents[0].url_expires_at);
  assert.doesNotMatch(JSON.stringify(body), /foreign-structure|foreign-junior|storage_bucket/);
  assert.equal(h.writes.length, 0);
});

test("unauthenticated, inactive, foreign or unauthorized access cannot sign a document URL", async () => {
  for (const options of [{ token: "", status: 401 }, { manager: false, status: 403 }, { player: false, status: 404 }, { authorized: false, status: 403 }]) {
    const h = setup(options);
    assert.equal((await h.get("token" in options ? options.token : "test")).response.status, options.status);
    assert.equal(h.signed.length, 0);
    assert.equal(h.writes.length, 0);
  }
});

test("a signing failure is reported instead of returning incomplete download links", async () => {
  const { response, body } = await setup({ signingFailure: true }).get();
  assert.equal(response.status, 500);
  assert.equal(body.documents, undefined);
});

test("the documents view exposes opening links and removes them immediately when changing junior", async () => {
  const h = coachComponentHarness("components/manager/ManagerPlayerDocuments.tsx", {
    props: { clubId: club, playerId: "player" },
    fetch: async url => String(url).includes("/player/documents") ? Response.json({ documents: [{ id: "doc", file_name: "Coach QA.pdf", mime_type: "application/pdf", size_bytes: 2048, created_at: "2026-09-01", uploaded_by_name: "Coach QA", coach_only: true, url: "https://storage.invalid/own.pdf", event: { title: "Training QA", starts_at: "2026-09-01" } }] }) : Response.json({ error: "Forbidden" }, { status: 403 }),
  });
  try {
    let tree = h.render(); for (let i = 0; i < 4; i++) { await flush(); tree = h.render(); }
    assert.match(textContent(tree), /Coach QA.pdf/);
    const link = elements(tree).find(node => node.type === "a")!;
    assert.equal(link.props.href, "https://storage.invalid/own.pdf");
    assert.match(link.props.rel, /noreferrer/);
    tree = h.render({ clubId: club, playerId: "another-player" });
    assert.ok(!elements(tree).some(node => node.type === "a"));
    for (let i = 0; i < 4; i++) { await flush(); tree = h.render(); }
    assert.ok(elements(tree).some(node => node.props.role === "alert"));
    assert.ok(!elements(tree).some(node => node.type === "a"));
  } finally { h.cleanup(); }
});
