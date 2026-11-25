import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";

async function settle(h: ReturnType<typeof coachComponentHarness>) { let tree = h.render(); for (let i = 0; i < 4; i++) { await flush(); tree = h.render(); } return tree; }

test("Documents is a Son golf subsection and remains reachable when statistics cannot load", async () => {
  let reads = 0;
  const h = coachComponentHarness("components/manager/ManagerPlayerStatistics.tsx", {
    props: { clubId: "club", playerId: "player" },
    modules: { "./ManagerPlayerDocuments": { default: "documents-panel" } },
    fetch: async () => { reads++; return Response.json({ error: "Forbidden" }, { status: 403 }); },
  });
  try {
    let tree = await settle(h);
    assert.match(textContent(tree), /Son golf/);
    const tabs = elements(tree).find(node => node.type === "tabs")!;
    assert.ok(tabs.props.items.some((item: { value: string; label: string }) => item.value === "documents" && item.label === "Documents"));
    tabs.props.onChange("documents"); tree = await settle(h);
    assert.ok(elements(tree).some(node => node.type === "documents-panel" && node.props.clubId === "club" && node.props.playerId === "player"));
    assert.ok(!elements(tree).some(node => node.props.role === "alert"));
    assert.equal(elements(tree).filter(node => node.type === "select").length, 0);
    assert.equal(reads, 1);
  } finally { h.cleanup(); }
});

test("direct documents navigation loads independently of statistics", async () => {
  const h = coachComponentHarness("components/manager/ManagerPlayerStatistics.tsx", {
    props: { clubId: "club", playerId: "player", initialSection: "documents" },
    modules: { "./ManagerPlayerDocuments": { default: "documents-panel" } },
    fetch: async () => { throw new Error("Statistics should not load for Documents"); },
  });
  try { const tree = await settle(h); assert.ok(elements(tree).some(node => node.type === "documents-panel")); } finally { h.cleanup(); }
});

test("legacy documents links select Son golf and its Documents subsection without a duplicate main tab", async () => {
  const h = coachComponentHarness("components/manager/PlayerEditPage.tsx", {
    props: { memberId: "member" }, searchParams: "club=club&tab=player-documents",
    modules: { "@/components/manager/ManagerPlayerStatistics": { default: "golf-panel" } },
    fetch: async input => {
      const path = String(input).split("?")[0];
      return Response.json(path.endsWith("/members") ? { members: [{ id: "member", user_id: "player", role: "player", is_active: true, profiles: { first_name: "Junior", last_name: "QA" } }] }
        : path.endsWith("/consent") ? { consent: { status: "pending" }, history: [], guardians: [] }
        : path.endsWith("/guardians") ? { parents: [], all_links: [] }
        : path.endsWith("/seasons") ? { seasons: [] } : { juniors: [], parents: [] });
    },
  });
  try {
    const tree = await settle(h);
    const tabs = elements(tree).filter(node => node.props.role === "tab");
    assert.ok(tabs.some(node => textContent(node) === "Son golf" && node.props["aria-selected"] === true));
    assert.ok(!tabs.some(node => textContent(node) === "Documents" || textContent(node) === "Statistiques"));
    const panel = elements(tree).find(node => node.props.playerId === "player" && node.props.initialSection === "documents")!;
    assert.equal(panel.props.initialSection, "documents");
    assert.equal(panel.props.playerId, "player");
  } finally { h.cleanup(); }
});
