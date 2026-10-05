/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic, isolated test database and module loader. */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
export type Row = Record<string, any>;
export function loadManagerModule<T = any>(path: string, mocks: Record<string, unknown>, env: Record<string, string> = {}): T {
  const source = readFileSync(resolve(root, path), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "process", "fetch", code)((id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? id.slice(2) : resolve(path, "..", id);
      return loadManagerModule(existsSync(resolve(root, base)) ? base : base + ".ts", mocks, env);
    }
    return require(id);
  }, compiledModule, compiledModule.exports, { env: { SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", CRON_SECRET: "test", PERIODIC_REPORT_TRANSPORT: "brevo", BREVO_API_KEY: "test", ...env } }, mocks.fetch ?? (() => { throw new Error("Unexpected network access in test"); }));
  return compiledModule.exports as T;
}

export function managerDatabase(tables: Record<string, Row[]> = {}, options: {
  caller?: string | null; users?: Row[]; failureTable?: string; rpcError?: Row; rpcResult?: Row; maxRows?: number; applyOrder?: boolean;
} = {}) {
  const writes: Array<{ table: string; method: string; values: any; rows: Row[] }> = [];
  const rpcs: Array<{ name: string; args: Row }> = [];
  const authWrites: Row[] = [];
  const authPages: number[] = [];
  const users = options.users ?? [{ id: "target", email: "target@example.invalid" }];
  const db = {
    auth: {
      getUser: async () => ({ data: { user: options.caller === null ? null : { id: options.caller ?? "manager" } }, error: null }),
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          authPages.push(page); return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
        },
        getUserById: async (id: string) => ({ data: { user: users.find((user) => user.id === id) ?? null }, error: null }),
        updateUserById: async (id: string, patch: Row) => { authWrites.push({ id, patch }); return { error: null }; },
        createUser: async (patch: Row) => { authWrites.push(patch); return { data: { user: { id: "new-user" } }, error: null }; },
      },
    },
    rpc: async (name: string, args: Row) => { rpcs.push({ name, args }); return { error: options.rpcError ?? null, data: options.rpcResult ?? { ok: true, consent: { status: args.p_values?.status }, history: [] } }; },
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const ordering: Array<{ key: string; ascending: boolean }> = [];
      let singular = false, head = false;
      let mutation: { method: string; values: any } | null = null;
      const query = {
        select(_columns?: string, opts?: Row) { head = opts?.head ?? false; return query; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        neq(key: string, value: unknown) { rows = rows.filter((row) => row[key] !== value); return query; },
        in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        is(key: string, value: unknown) { rows = rows.filter((row) => (row[key] ?? null) === value); return query; },
        ilike(key: string, value: string) { rows = rows.filter((row) => String(row[key] ?? "").toLowerCase() === value.toLowerCase()); return query; },
        gte(key: string, value: string) { rows = rows.filter((row) => row[key] != null && String(row[key]) >= value); return query; },
        lte(key: string, value: string) { rows = rows.filter((row) => row[key] != null && String(row[key]) <= value); return query; },
        lt(key: string, value: string) { rows = rows.filter((row) => row[key] != null && String(row[key]) < value); return query; },
        gt(key: string, value: string) { rows = rows.filter((row) => row[key] != null && String(row[key]) > value); return query; },
        contains(key: string, values: unknown[]) { rows = rows.filter((row) => values.every((v) => row[key]?.includes(v))); return query; },
        order(key: string, opts?: { ascending?: boolean }) {
          ordering.push({ key, ascending: opts?.ascending !== false });
          if (options.applyOrder) rows.sort((a, b) => {
            for (const order of ordering) {
              const delta = (a[order.key] < b[order.key] ? -1 : a[order.key] > b[order.key] ? 1 : 0) * (order.ascending ? 1 : -1);
              if (delta) return delta;
            }
            return 0;
          });
          return query;
        },
        limit(count: number) { rows = rows.slice(0, count); return query; },
        range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
        maybeSingle() { singular = true; return query; },
        single() { singular = true; return query; },
        insert(values: any) { mutation = { method: "insert", values }; return query; },
        upsert(values: any) { mutation = { method: "upsert", values }; return query; },
        update(values: any) { mutation = { method: "update", values }; return query; },
        delete() { mutation = { method: "delete", values: null }; return query; },
        then(yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) {
          if (mutation) writes.push({ table, ...mutation, rows });
          const error = table === options.failureTable ? { message: "Database failure" } : singular && !mutation && rows.length > 1 ? { message: "Multiple rows" } : null;
          const data = mutation && ["insert", "upsert"].includes(mutation.method)
            ? (Array.isArray(mutation.values) ? mutation.values : [{ id: "created", ...mutation.values }]) : rows;
          return Promise.resolve({ error, data: error || head ? null : singular ? data[0] ?? null : data.slice(0, options.maxRows), count: rows.length }).then(yes, no);
        },
      };
      return query;
    },
  };
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } },
    "@supabase/supabase-js": { createClient: () => db },
    "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: options.caller ?? "manager", supabaseAdmin: db }) },
  };
  return { db, mocks, writes, rpcs, authWrites, authPages };
}

export function managerFixture(): Record<string, Row[]> {
  return {
    club_members: [
      { id: "manager-A", user_id: "manager", club_id: "A", role: "manager", is_active: true },
      { id: "player-A", user_id: "player", club_id: "A", role: "player", is_active: true, player_consent_status: "granted" },
      { id: "parent-A", user_id: "parent", club_id: "A", role: "parent", is_active: true },
      { id: "target-A", user_id: "target", club_id: "A", role: "coach", is_active: true },
      { id: "outside-B", user_id: "outside", club_id: "B", role: "player", is_active: true },
    ],
    profiles: [{ id: "player", first_name: "Junior", username: "junior" }, { id: "target", first_name: "Coach", username: "coach", phone: "preserve" }],
    player_guardians: [{ player_id: "player", guardian_user_id: "parent", can_view: true, can_edit: true, is_primary: true }],
    coach_groups: [{ id: "group-A", club_id: "A", club_season_id: "season-A" }, { id: "group-B", club_id: "B" }],
    clubs: [{ id: "A", name: "Club A" }],
  };
}

export const managerRequest = (method: string, body: Row = {}, token = "test") => new Request("http://localhost/api/test", {
  method, headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
