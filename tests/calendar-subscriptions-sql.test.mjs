import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("calendar migration protects credentials, validates scopes and cascades account deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key); create table public.organizations(id uuid primary key);`);
    const migration = await readFile(new URL("../supabase/migrations/20261017_calendar_subscriptions.sql", import.meta.url), "utf8");
    await db.exec(migration); await db.exec(migration);
    const user = "00000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users values ($1)", [user]);
    await db.query("insert into profiles values ($1)", [user]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query("select has_table_privilege($1,'public.calendar_subscriptions','SELECT') as allowed", [role]);
      assert.equal(rows[0].allowed, role === "service_role");
    }
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.calendar_subscriptions"), /permission denied/);
    await db.exec("reset role");
    const insert = (kind, key, player) => db.query("insert into calendar_subscriptions(user_id,kind,scope_key,player_id,token) values ($1,$2,$3,$4,$5)", [user, kind, key, player, "a".repeat(43)]);
    await assert.rejects(insert("player", "all", user), /check constraint/);
    await insert("player", user, user);
    await assert.rejects(insert("player", user, user), /unique constraint/);
    await db.query("delete from auth.users where id=$1", [user]);
    assert.equal((await db.query("select count(*)::int as count from calendar_subscriptions")).rows[0].count, 0);
  } finally { await db.close(); }
});
