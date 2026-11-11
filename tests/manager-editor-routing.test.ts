import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferred } from "./helpers/coachComponentHarness.ts";

test("Manager edit waits for request route parameters before mounting the editor", async () => {
  const params = deferred<{ id: string; eventId: string }>();
  const suspense = Symbol("Suspense");
  const mocks: Record<string, unknown> = {
    react: { Suspense: suspense },
    "react/jsx-runtime": { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }) },
    "./ManagerEventEditor": { __esModule: true, default: "editor", ManagerEventEditorLoading: "loading" },
  };
  const source = readFileSync("app/manager/groups/[id]/planning/[eventId]/edit/page.tsx", "utf8");
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
  const resolved = { id: "6e7385f1-9ca1-4d1a-9539-b2e2dac133d2", eventId: "0cefd2e2-6496-44dd-bede-d45f87be3079" };
  params.resolve(resolved);
  assert.deepEqual(await content, { type: "editor", props: { routeParams: resolved } });
});
