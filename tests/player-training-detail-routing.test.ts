import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferred } from "./helpers/coachComponentHarness.ts";

test("Player activity detail waits for resolved route parameters before loading the activity", async () => {
  const params = deferred<{ sessionId: string }>();
  const suspense = Symbol("Suspense");
  const mocks: Record<string, unknown> = {
    react: { Suspense: suspense },
    "react/jsx-runtime": { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }) },
    "./PlayerTrainingDetailClient": { __esModule: true, default: "detail" },
    "@/components/player/TrainingPageSkeleton": { __esModule: true, default: "loading" },
  };
  const source = readFileSync("app/player/golf/trainings/[sessionId]/page.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const page = { default: undefined as unknown as (props: { params: typeof params.promise }) => { type: unknown; props: { fallback: { type: string }; children: { type: (props: unknown) => Promise<unknown>; props: unknown } } } };
  const compiledModule = { exports: page };
  new Function("require", "module", "exports", code)((id: string) => { assert.ok(id in mocks, id); return mocks[id]; }, compiledModule, page);
  const tree = page.default({ params: params.promise });
  assert.equal(tree.type, suspense);
  assert.equal(tree.props.fallback.type, "loading");
  let mounted = false;
  const content = tree.props.children.type(tree.props.children.props).then((value: unknown) => { mounted = true; return value; });
  await Promise.resolve();
  assert.equal(mounted, false);
  const resolved = { sessionId: "0cefd2e2-6496-44dd-bede-d45f87be3079" };
  params.resolve(resolved);
  assert.deepEqual(await content, { type: "detail", props: resolved });
});

test("activity requests use the resolved session even when navigation contains a prerender placeholder", async () => {
  const { coachComponentHarness, flush, textContent } = await import("./helpers/coachComponentHarness.ts");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { href: "https://activitee.app/player/golf/trainings/session?child_id=child" },
    localStorage: { getItem: () => null },
  } });
  const requests: string[] = [];
  const harness = coachComponentHarness("app/player/golf/trainings/[sessionId]/PlayerTrainingDetailClient.tsx", {
    props: { sessionId: "resolved-session" },
    params: { sessionId: "%%drp:sessionId%%" },
    fetch: async (url) => {
      requests.push(String(url));
      return Response.json({ session: { id: "resolved-session", start_at: "2026-06-24T14:00:00Z", session_type: "individual", club_event_id: null },
        items: [], playerId: "child", canEdit: false, isCampDay: false, performanceEnabled: false, clubName: "", attendance: null });
    },
    modules: {
      "next/image": { __esModule: true, default: "image" },
      "@/components/player/PlayerBreadcrumb": { __esModule: true, default: "breadcrumb" },
    },
  });
  try {
    harness.render(); await flush();
    assert.deepEqual(requests, ["/api/player/trainings/resolved-session/detail?child_id=child"]);
    assert.doesNotMatch(textContent(harness.render()), /Impossible de charger toutes les données|Aucune donnée/);
  } finally {
    harness.cleanup();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
