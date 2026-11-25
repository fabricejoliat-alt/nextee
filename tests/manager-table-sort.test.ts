/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated render fixtures, no network or real player data. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent } from "./helpers/coachComponentHarness.ts";
import { sortingContext, juniorSortingData, coachSortingData } from "./helpers/managerSortingFixtures.ts";
const { sortManagerTable, toggleTableSort } = loadManagerModule("lib/managerTableSort.ts", {});

test("numeric sorting preserves zeroes and ties, keeps unknowns last in both directions, and never mutates rows", () => {
  const rows = [{ id: "ten", n: 10 }, { id: "missing", n: null }, { id: "zero", n: 0 }, { id: "two", n: 2 }, { id: "also-two", n: 2 }, { id: "invalid", n: NaN }];
  const original = rows.map(row => row.id);
  for (const [direction, expected] of [["asc", ["zero", "two", "also-two", "ten", "missing", "invalid"]], ["desc", ["ten", "two", "also-two", "zero", "missing", "invalid"]]] as const) assert.deepEqual(sortManagerTable(rows, { key: "n", direction }, (row: any) => row.n, "fr").map((row: any) => row.id), expected);
  assert.deepEqual(rows.map(row => row.id), original);
  assert.deepEqual(toggleTableSort({ key: "n", direction: "asc" }, "n"), { key: "n", direction: "desc" });
  assert.deepEqual(toggleTableSort({ key: "n", direction: "desc" }, "name"), { key: "name", direction: "asc" });
  assert.deepEqual(sortManagerTable(["Équipe 10", "Equipe 2", "Alpha"], { key: "name", direction: "asc" }, (row: string) => row, "fr"), ["Alpha", "Equipe 2", "Équipe 10"]);
});

function harness(kind: "Junior" | "Coach", data: any) {
  let requests = 0;
  const h = coachComponentHarness(`components/manager/Manager${kind}PerformancePage.tsx`, {
    inlineComponentNames: ["JuniorTable", "CoachTable", "GroupTable", "SortHeader", "TableSortControls"],
    modules: { "@/components/manager/usePerformanceContext": { usePerformanceContext: () => sortingContext }, "./useManagerResource": { useManagerResource: () => ({ data, loading: false, error: "", reload() {} }) }, recharts: new Proxy({}, { get: (_, key) => String(key) }) },
    fetch: async () => { requests++; throw new Error("Sorting must not request data"); },
  });
  return { h, requests: () => requests };
}
const names = (tree: any) => elements(tree).filter(node => node.type === "a" && String(node.props.href).includes("/user-management/")).map(textContent);
function sortHeader(tree: any, label: string) { return elements(tree).find(node => node.type === "th" && textContent(node).trim() === label)!; }
function clickHeader(tree: any, label: string) { elements(sortHeader(tree, label)).find(node => node.type === "button")!.props.onClick(); }

test("all junior columns toggle ascending/descending using real values, with Parcours and Objectif FTEM labels", () => {
  const { h, requests } = harness("Junior", juniorSortingData);
  try {
    let tree = h.render();
    for (const [label, ascending, descending] of [
      ["Junior", ["Alice", "Béa", "Zoé"], ["Zoé", "Béa", "Alice"]],
      ["Groupe / FTEM", ["Alice", "Zoé", "Béa"], ["Béa", "Zoé", "Alice"]],
      ["Assiduité", ["Zoé", "Alice", "Béa"], ["Alice", "Zoé", "Béa"]],
      ["Entraînement", ["Zoé", "Béa", "Alice"], ["Alice", "Béa", "Zoé"]],
      ["Objectif FTEM", ["Béa", "Zoé", "Alice"], ["Alice", "Zoé", "Béa"]],
      ["Parcours", ["Béa", "Zoé", "Alice"], ["Alice", "Zoé", "Béa"]],
      ["Progression", ["Zoé", "Alice", "Béa"], ["Alice", "Zoé", "Béa"]],
    ] as const) {
      assert.ok(sortHeader(tree, label), label);
      clickHeader(tree, label); tree = h.render(); assert.deepEqual(names(tree), ascending, label);
      assert.equal(sortHeader(tree, label).props["aria-sort"], "ascending");
      clickHeader(tree, label); tree = h.render(); assert.deepEqual(names(tree), descending, label);
      assert.equal(sortHeader(tree, label).props["aria-sort"], "descending");
    }
    assert.equal(requests(), 0);
    const alice = elements(tree).find(node => node.type === "tr" && textContent(node).trim().startsWith("Alice"))!;
    assert.equal(textContent(elements(alice).find(node => node.props["data-label"] === "Parcours")), "10");
  } finally { h.cleanup(); }
});

test("attendance group columns and the competition table sort without changing filtered membership", () => {
  const { h } = harness("Junior", juniorSortingData);
  try {
    let tree = h.render(); elements(tree).find(node => node.type === "tabs")!.props.onChange("attendance"); tree = h.render();
    const groups = () => elements(tree).filter(node => node.type === "td" && node.props["data-label"] === "Groupe").map(textContent);
    for (const [label, expected] of [["Groupe", ["Alpha", "Beta", "Gamma"]], ["Juniors", ["Beta", "Gamma", "Alpha"]], ["Assiduité", ["Alpha", "Gamma", "Beta"]], ["Volume médian", ["Alpha", "Beta", "Gamma"]]] as const) { clickHeader(tree, label); tree = h.render(); assert.deepEqual(groups(), expected, label); clickHeader(tree, label); tree = h.render(); assert.equal(sortHeader(tree, label).props["aria-sort"], "descending"); }
    elements(tree).find(node => node.type === "tabs")!.props.onChange("competition"); tree = h.render();
    clickHeader(tree, "Parcours"); tree = h.render(); assert.deepEqual(names(tree), ["Zoé", "Alice"]);
    clickHeader(tree, "Parcours"); tree = h.render(); assert.deepEqual(names(tree), ["Alice", "Zoé"]);
    const link = elements(tree).find(node => node.type === "a" && textContent(node) === "Alice")!;
    assert.match(link.props.href, /club=club&season=season&tab=statistics&statistics_scope=current&statistics_personal=true/);
  } finally { h.cleanup(); }
});

test("every coach table column sorts, and the mobile controls share the same order", () => {
  const { h, requests } = harness("Coach", coachSortingData);
  try {
    let tree = h.render();
    for (const [label, expected] of [["Coach", ["Alice", "Béa", "Zoé"]], ["Groupes / rôle", ["Béa", "Zoé", "Alice"]], ["Activités", ["Béa", "Zoé", "Alice"]], ["Heures-coachs", ["Béa", "Zoé", "Alice"]], ["Juniors", ["Béa", "Alice", "Zoé"]], ["Taille habituelle", ["Béa", "Alice", "Zoé"]], ["Évaluations", ["Zoé", "Alice", "Béa"]], ["En retard", ["Alice", "Béa", "Zoé"]], ["Dernière activité", ["Zoé", "Alice", "Béa"]]] as const) { assert.ok(sortHeader(tree, label), label); clickHeader(tree, label); tree = h.render(); assert.deepEqual(names(tree), expected, label); clickHeader(tree, label); tree = h.render(); assert.equal(sortHeader(tree, label).props["aria-sort"], "descending"); }
    const select = elements(tree).find(node => node.type === "select" && elements(node).some(option => option.props.value === "hours"))!;
    select.props.onChange({ target: { value: "hours" } }); tree = h.render(); assert.deepEqual(names(tree), ["Béa", "Zoé", "Alice"]);
    elements(tree).find(node => node.type === "button" && node.props["aria-label"] === "Trier par ordre décroissant")!.props.onClick(); tree = h.render(); assert.deepEqual(names(tree), ["Alice", "Zoé", "Béa"]);
    for (const tab of ["load", "evaluations"]) { elements(tree).find(node => node.type === "tabs")!.props.onChange(tab); tree = h.render(); assert.deepEqual(names(tree), ["Alice", "Zoé", "Béa"]); }
    assert.equal(requests(), 0);
  } finally { h.cleanup(); }
});
