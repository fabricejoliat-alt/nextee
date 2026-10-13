/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated component hook fixture. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { loginMessages } from "../app/loginMessages.ts";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";

test("a slow page opening stays signed in and offers navigation again without an authentication error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const states: any[] = [], effects: any[] = [], navigations: string[] = [];
  let cursor = 0, effectCursor = 0, authCalls = 0;
  const jobs: Array<() => void> = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) jobs.push(() => {
        previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() };
      });
    },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const supabase = { auth: { signInWithPassword: async () => {
    authCalls++; return { data: { session: { access_token: "fixture-token" } }, error: null };
  } } };
  const code = ts.transpileModule(readFileSync("app/LoginClient.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", "window", "document", "fetch", code)((id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "next/link") return { default: "a" };
    if (id.endsWith(".css")) return { default: {} };
    if (id === "@/lib/supabaseClient") return { supabase };
    if (id === "./loginMessages") return { loginMessages };
    throw new Error(`Unexpected dependency: ${id}`);
  }, mod, mod.exports, {
    location: { hostname: "app.invalid", pathname: "/", replace: (path: string) => navigations.push(path) },
    localStorage: { getItem: () => "fr", setItem: () => {} },
  }, { documentElement: {} }, async (url: string) => Response.json(url.endsWith("resolve-login")
    ? { email: "fixture@example.invalid" } : { redirectTo: "/player" }));
  const render = () => { cursor = effectCursor = 0; const tree = mod.exports.default(); jobs.splice(0).forEach(job => job()); return tree; };
  const nodes = (tree: any): any[] => !tree || typeof tree !== "object" ? []
    : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const words = (tree: any): string => typeof tree === "string" ? tree : !tree ? ""
    : Array.isArray(tree) ? tree.map(words).join(" ") : words(tree.props?.children);
  let tree = render(); tree = render();
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  tree = render();
  assert.deepEqual(navigations, ["/player"]);
  assert.match(words(tree), /Ouverture de votre espace/);
  t.mock.timers.tick(16000);
  tree = render();
  assert.equal(nodes(tree).some(node => node.props?.role === "alert"), false);
  assert.match(words(tree), /Connexion réussie/);
  assert.equal(nodes(tree).find(node => words(node.props?.children) === "Réessayer l’ouverture").props.href, "/player");
  assert.equal(nodes(tree).find(node => node.props?.type === "submit").props.disabled, true);
  assert.equal(authCalls, 1);
  effects.forEach(effect => effect.cleanup?.());
});

test("separate Player requests never wait for another invocation's pending database fetch", async () => {
  const clients: Array<{ fetch: typeof fetch }> = [];
  let finishFirst!: (response: Response) => void, calls = 0;
  const { createPlayerAccessAdminClient } = loadManagerModule<any>("app/api/player/access.ts", {
    "@supabase/supabase-js": { createClient: (_url: string, _key: string, options: any) => { clients.push(options.global); return {}; } },
    fetch: () => ++calls === 1 ? new Promise<Response>(resolve => { finishFirst = resolve; }) : Promise.resolve(Response.json({ ok: true })),
  });
  createPlayerAccessAdminClient(); createPlayerAccessAdminClient();
  const url = "https://database.invalid/rest/v1/organization_members";
  const first = clients[0].fetch(url);
  await Promise.resolve();
  const second = await clients[1].fetch(url);
  assert.deepEqual(await second.json(), { ok: true });
  assert.equal(calls, 2);
  finishFirst(Response.json({ ok: true }));
  await first;
});
