import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("first load shows a placeholder; reactivation and refresh retain the rendered data", () => {
  let state = true;
  const sandboxModule = { exports: {} as { useRetainedLoading: (initial?: boolean) => [boolean, (value: boolean | ((previous: boolean) => boolean)) => void] } };
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/useRetainedLoading.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require: () => ({ useState: () => [state, (fn: (prev: boolean) => boolean) => { state = fn(state); }], useRef: () => ({ current: false }), useCallback: (fn: unknown) => fn }) });
  const [, loading] = sandboxModule.exports.useRetainedLoading();
  loading(true); assert.equal(state, true);
  loading(false); assert.equal(state, false);
  loading(true); assert.equal(state, false);
  loading(() => true); assert.equal(state, false);
  loading(false); assert.equal(state, false);
});
