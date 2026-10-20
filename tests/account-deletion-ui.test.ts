import { test } from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";

const control = (tree: unknown, type: string, text?: string) => {
  const node = elements(tree).find((n) => n.type === type && (!text || textContent(n).includes(text)));
  assert.ok(node, `${type} ${text ?? ""}`);
  return node;
};

test("account holder must confirm the consequences and provide a password before submitting", async () => {
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { window: { location: { hash: "", pathname: "/legal/delete-account", origin: "http://fixture.local" }, history: { replaceState: () => {} } } });
  const posts: Array<Record<string, unknown>> = [];
  const h = coachComponentHarness("app/legal/delete-account/page.tsx", { fetch: async (_input, init) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ request: { id: "request", status: "requested", due_at: "2026-11-20T12:00:00Z" } });
    }
    return Response.json({ request: null });
  } });
  try {
    for (let i = 0; i < 4; i++) { h.render(); await flush(); }
    assert.equal(control(h.render(), "button", "Confirmer la suppression").props.disabled, true);
    const input = (type: string) => elements(h.render()).find((n) => n.type === "input" && n.props.type === type)!;
    input("password").props.onChange({ target: { value: "fictional-password" } });
    assert.equal(control(h.render(), "button", "Confirmer la suppression").props.disabled, true);
    input("checkbox").props.onChange({ target: { checked: true } });
    assert.equal(control(h.render(), "button", "Confirmer la suppression").props.disabled, false);
    await control(h.render(), "form").props.onSubmit({ preventDefault() {} });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].confirm, true);
    assert.match(String(posts[0].receipt), /^[a-f0-9]{64}$/);
    assert.equal(posts[0].user_id, undefined);
    const result = h.render();
    assert.match(textContent(result), /Votre demande est enregistrée/);
    assert.match(textContent(result), /Conservez ce lien de suivi/);
    assert.equal(elements(result).some((n) => n.type === "input" && n.props.type === "password"), false);
  } finally { h.cleanup(); Object.assign(globalThis, { window: oldWindow }); }
});

test("an Admin must explicitly select and confirm a particular deletion request", async () => {
  const posts: Array<Record<string, unknown>> = [];
  const h = coachComponentHarness("components/legal/AccountDeletionAdmin.tsx", { fetch: async (_input, init) => {
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ completed: true }); }
    return Response.json({ requests: [{ id: "request", user_id: "fixture-user", status: "requested", due_at: "2090-01-01", contact_email: null }] });
  } });
  try {
    await control(h.render(), "button", "Charger les suppressions").props.onClick();
    await flush();
    control(h.render(), "button", "Préparer la suppression").props.onClick();
    assert.equal(control(h.render(), "button", "Supprimer définitivement").props.disabled, true);
    control(h.render(), "input").props.onChange({ target: { value: "SUPPRIMER" } });
    const action = control(h.render(), "button", "Supprimer définitivement");
    assert.equal(action.props.disabled, false);
    await action.props.onClick(); await flush();
    assert.deepEqual(posts, [{ id: "request", confirm_request_id: "request" }]);
  } finally { h.cleanup(); }
});
