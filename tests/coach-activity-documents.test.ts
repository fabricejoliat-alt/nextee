import assert from "node:assert/strict";
import test from "node:test";
import { uploadCoachActivityDocument } from "../lib/coachActivityDocumentUpload.ts";

const input = {
  playerId: "junior-1", eventId: "activity-2", organizationId: "club-3", token: "session",
  file: new File(["swing"], "swing.mov", { type: "" }), name: " Analyse du swing ",
};

function mockApi(fail?: "prepare" | "finalize" | "reservation") {
  const calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ endpoint: String(url), body });
    if (body.action === fail) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (body.action === "prepare") return Response.json(fail === "reservation" ? {} : {
      upload_url: "https://storage.example/signed", path: "club-3/junior-1/swing.mov",
      reservation_token: "reservation", mime_type: "video/quicktime",
    });
    return Response.json({ document: { id: "document-4", club_event_id: body.club_event_id, player_id: "junior-1" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

test("activity upload preserves the junior, organization and event through prepare and finalize", async () => {
  const api = mockApi();
  const phases: string[] = [];
  const document = await uploadCoachActivityDocument(input, {
    fetch: api.fetch,
    transfer: async (url, file, mimeType, progress) => {
      assert.equal(api.calls.length, 1, "finalization waits for the transfer");
      assert.equal(url, "https://storage.example/signed");
      assert.equal(file, input.file);
      assert.equal(mimeType, "video/quicktime", "mobile files use the validated MIME");
      progress(50);
    },
    progress: state => phases.push(state.phase),
  });
  assert.equal(document.club_event_id, "activity-2");
  assert.equal(document.player_id, "junior-1");
  assert.equal(api.calls.length, 2);
  for (const call of api.calls) {
    assert.equal(call.endpoint, "/api/coach/players/junior-1/documents?organization_id=club-3");
    assert.equal(call.body.organization_id, "club-3");
    assert.equal(call.body.club_event_id, "activity-2");
    assert.equal(call.body.coach_only, false);
  }
  assert.equal(api.calls[1].body.reservation_token, "reservation");
  assert.equal(api.calls[1].body.file_name, "Analyse du swing");
  assert.deepEqual(phases, ["preparing", "uploading", "uploading", "finalizing", "complete"]);
});

test("failed transfer never creates a document", async () => {
  const api = mockApi();
  await assert.rejects(uploadCoachActivityDocument(input, {
    fetch: api.fetch, transfer: async () => { throw new Error("offline"); }, progress: () => {},
  }), /offline/);
  assert.equal(api.calls.length, 1);
});

for (const failure of ["prepare", "reservation", "finalize"] as const) {
  test(`${failure} failure cannot be reported as a successful upload`, async () => {
    const api = mockApi(failure);
    let transferred = false;
    let completed = false;
    await assert.rejects(uploadCoachActivityDocument(input, {
      fetch: api.fetch, transfer: async () => { transferred = true; },
      progress: state => { if (state.phase === "complete") completed = true; },
    }));
    assert.equal(transferred, failure === "finalize");
    assert.equal(completed, false);
  });
}

test("missing activity or invalid file is rejected before requesting storage", async () => {
  const api = mockApi();
  const dependencies = { fetch: api.fetch, transfer: async () => {}, progress: () => {} };
  await assert.rejects(uploadCoachActivityDocument({ ...input, eventId: "" }, dependencies));
  await assert.rejects(uploadCoachActivityDocument({ ...input, file: new File(["bad"], "file.exe") }, dependencies));
  assert.equal(api.calls.length, 0);
});
