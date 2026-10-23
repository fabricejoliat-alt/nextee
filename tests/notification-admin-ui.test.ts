import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
import { notificationTemplateDefaults } from "../lib/notificationCatalog.ts";

test("changing French invalidates translations, previews variables, and publishes all languages only after translation", async () => {
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  const fetcher = async (input: unknown, init?: RequestInit) => {
    const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body });
    if (!body) return Response.json({ rows: [], translationAvailable: true });
    if (url.endsWith("/translate")) {
      const definition = notificationTemplateDefaults[body.key];
      return Response.json({ translations: { en: definition.en, de: definition.de, it: definition.it } });
    }
    return Response.json({ ok: true });
  };
  const h = coachComponentHarness("components/admin/notifications/NotificationTemplatesAdmin.tsx", {
    fetch: fetcher, modules: { "@/lib/adminFetch": { adminFetch: fetcher } },
  });
  try {
    h.render(); await flush();
    let tree = h.render();
    const button = (label: string) => elements(tree).find(node => node.type === "button" && textContent(node).includes(label))!;
    button("Nouvelle activité").props.onClick(); tree = h.render();
    assert(textContent(tree).includes("20.10.2026 à 17:00 Practice"));
    const titleInput = elements(tree).find(node => node.type === "input" && node.props.maxLength === 160)!;
    titleInput.props.onChange({ target: { value: "Nouvelle séance" } }); tree = h.render();
    assert.equal(button("Enregistrer les 4 langues").props.disabled, true);
    await button("Traduire et prévisualiser").props.onClick(); await flush(); tree = h.render();
    assert.equal(button("Enregistrer les 4 langues").props.disabled, false);
    await button("Enregistrer les 4 langues").props.onClick(); await flush(); tree = h.render();
    const saved = requests.find(item => item.body?.translations)!;
    assert.equal((saved.body!.translations as Record<string, { title: string }>).fr.title, "Nouvelle séance");
    assert.deepEqual(Object.keys(saved.body!.translations as object), ["fr", "en", "de", "it"]);
    assert(textContent(tree).includes("Les quatre langues sont enregistrées"));
  } finally { h.cleanup(); }
});
test("a failed Admin load cannot expose writable fallback texts", async () => {
  const fetcher = async () => Response.json({ error: "Chargement indisponible" }, { status: 503 });
  const h = coachComponentHarness("components/admin/notifications/NotificationTemplatesAdmin.tsx", { fetch: fetcher, modules: { "@/lib/adminFetch": { adminFetch: fetcher } } });
  try { h.render(); await flush(); const tree = h.render(); assert(textContent(tree).includes("Chargement indisponible")); assert(!elements(tree).some(node => node.type === "textarea")); }
  finally { h.cleanup(); }
});
test("Coach home explains partial evaluation without asking to redo completed players", async () => {
  const fetcher = async (input: unknown) => Response.json(String(input).includes("/home") ? {
    me: { first_name: "Alex" }, organizationNames: [], groupNameById: { group: "Juniors" }, clubNameByGroupId: {}, upcomingEvents: [],
    pendingEvalEvents: [{ id: "event", group_id: "group", event_type: "training", starts_at: "2026-09-29T15:00:00Z", totalPlayers: 4, completedPlayers: 1, remainingPlayers: 3 }],
  } : { news: [] });
  const h = coachComponentHarness("app/coach/page.tsx", { fetch: fetcher,
    modules: { "@/lib/organizationFetch": { organizationFetch: fetcher }, "./CoachLearningCards": { __esModule: true, default: "learning-cards" } } });
  try { h.render(); await flush(); const tree = h.render(); const label = textContent(tree);
    assert(label.includes("Joueurs restant à évaluer : 3")); assert(label.includes("1 / 4 évaluations terminées"));
    assert(elements(tree).some(node => node.props.href === "/coach/groups/group/planning/event/debrief"));
  } finally { h.cleanup(); }
});
