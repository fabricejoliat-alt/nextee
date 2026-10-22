import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("native tokens are API-only and disappear on logout and account deletion", async () => {
  const db = new PGlite();
  const user = "11111111-1111-4111-8111-111111111111", session = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create schema auth;
      create table public.profiles(id uuid primary key);
      create table auth.sessions(id uuid primary key);
      grant usage on schema auth to supabase_auth_admin;
      grant delete on auth.sessions to supabase_auth_admin;
      grant usage on schema public to anon,authenticated,service_role;
      insert into profiles values('${user}'); insert into auth.sessions values('${session}');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261207_native_push.sql", import.meta.url), "utf8"));
    const register = () => db.query("insert into native_push_subscriptions(user_id,session_id,device_token,environment,bundle_id) values($1,$2,$3,'sandbox','golf.activitee.app')", [user, session, "ab".repeat(32)]);
    await db.exec("set role service_role"); await register(); await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from native_push_subscriptions"), /permission denied/);
      await assert.rejects(register(), /permission denied/);
      await db.exec("reset role");
    }
    // Auth's own role can delete sessions without public-table privileges.
    await db.exec("set role supabase_auth_admin; delete from auth.sessions; reset role");
    assert.equal((await db.query("select * from native_push_subscriptions")).rows.length, 0);
    await assert.rejects(register(), /foreign key/);
    await db.exec(`insert into auth.sessions values('${session}')`); await register();
    await db.exec("delete from profiles");
    assert.equal((await db.query("select * from native_push_subscriptions")).rows.length, 0);
  } finally { await db.close(); }
});

test("Android registrations deny client access and cascade with sessions and accounts", async () => {
  const db = new PGlite();
  const user = "11111111-1111-4111-8111-111111111111", session = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create schema auth;
      create table profiles(id uuid primary key); create table auth.sessions(id uuid primary key);
      grant usage on schema auth to supabase_auth_admin; grant delete on auth.sessions to supabase_auth_admin;
      grant usage on schema public to anon,authenticated,service_role;
      insert into profiles values('${user}'); insert into auth.sessions values('${session}');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261210_android_push.sql", import.meta.url), "utf8"));
    const register = (app = "golf.activitee.app") => db.query("insert into android_push_subscriptions(user_id,session_id,device_token,application_id) values($1,$2,$3,$4)", [user, session, "FCM_token-".repeat(8), app]);
    await db.exec("set role service_role"); await register(); await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from android_push_subscriptions"), /permission denied/);
      await assert.rejects(register(), /permission denied/); await db.exec("reset role");
    }
    await db.exec("set role supabase_auth_admin; delete from auth.sessions; reset role");
    assert.equal((await db.query("select * from android_push_subscriptions")).rows.length, 0);
    await assert.rejects(register(), /foreign key/);
    await db.exec(`insert into auth.sessions values('${session}')`);
    await assert.rejects(register("other.application"), /check constraint/); await register();
    await db.exec("delete from profiles");
    assert.equal((await db.query("select * from android_push_subscriptions")).rows.length, 0);
  } finally { await db.close(); }
});
