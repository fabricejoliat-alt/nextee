import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function session(actor, aal = "aal2", extra = {}) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor, role: "authenticated", aal, ...extra })]);
  await db.exec("set role authenticated");
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    grant usage on schema auth,public to authenticated;
    create table app_admins(user_id uuid primary key);
    create table profiles(id uuid primary key);
    create table club_members(user_id uuid,club_id uuid,role text,is_active boolean);
    create table legal_enforcement_control(singleton boolean primary key,enabled boolean);
    insert into legal_enforcement_control values(true,true);
    create table legal_documents(id uuid primary key,kind text,scope text,club_id uuid,audience_roles text[],action_kind text,active boolean,required boolean,applicability jsonb);
    create table legal_versions(id uuid primary key,document_id uuid,version_number integer);
    create table legal_current_state(document_id uuid,beneficiary_id uuid,scope_key text,version_id uuid,conflict boolean,decision text);
    create function legal_version_matches_document(uuid,uuid) returns boolean language sql stable as $$select true$$;
    insert into app_admins values('${id(1)}');
    insert into legal_documents values('${id(100)}','terms','platform',null,array['admin','player','coach','manager','parent'],'accept',true,true,'{"rule":"all_members"}');
    insert into legal_versions values('${id(110)}','${id(100)}',1);
  `);
  for (const [n, role] of [[2,"player"],[3,"coach"],[4,"manager"],[5,"parent"]]) {
    await db.query("insert into club_members values($1,$2,$3,true)", [id(n),id(200),role]);
  }
  const security = read("20261127_admin_security.sql");
  for (const name of ["application_session_ready", "is_app_admin"]) {
    const definition = security.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"));
    assert.ok(definition, name);
    await db.exec(definition[0]);
  }
  const original = read("20261103_legal_access_coverage.sql").match(/CREATE OR REPLACE FUNCTION public\.legal_required_direct_access\([\s\S]*?\$function\$\s*;/i);
  assert.ok(original);
  await db.exec(original[0]);
  await db.exec("revoke all on function legal_required_direct_access(uuid) from public; grant execute on function legal_required_direct_access(uuid) to anon,authenticated,service_role;");
  await session(id(1));
  assert.equal(await scalar("select legal_required_direct_access()"), false, "reproduces the reported admin block");
  await db.exec("reset role");
  const acl = await scalar("select proacl::text from pg_proc where oid='legal_required_direct_access(uuid)'::regprocedure");
  const migration = read("20261208_superadmin_legal_exemption.sql");
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(await scalar("select proacl::text from pg_proc where oid='legal_required_direct_access(uuid)'::regprocedure"), acl);
  await db.exec(read("20261018_etiquette_learning.sql"));
  await db.exec(read("20261019_seed_etiquette_fr.sql"));
  const wrappers = read("20261101_legal_remaining_rpc_batch.sql");
  await db.exec(wrappers.slice(wrappers.indexOf("alter function public.etiquette_publish_theme"), wrappers.indexOf("notify pgrst")));
});
after(async () => { await db.close(); });

test("superadmin is exempt with MFA without writing acceptance evidence or disabling enforcement", async () => {
  await session(id(1));
  assert.equal(await scalar("select legal_required_direct_access()"), true);
  assert.equal(await scalar("select legal_required_direct_access($1)", [id(200)]), true);
  await db.exec("reset role");
  assert.equal(await scalar("select count(*)::int from legal_current_state"), 0);
  assert.equal(await scalar("select enabled from legal_enforcement_control"), true);
});

test("MFA, initial-password checks and database-backed role identity remain required", async () => {
  await session(id(1), "aal1");
  assert.equal(await scalar("select legal_required_direct_access()"), false);
  await session(id(1), "aal2", { app_metadata: { initial_password_required: true } });
  assert.equal(await scalar("select legal_required_direct_access()"), false);
  await session(id(2), "aal2", { user_metadata: { role: "admin", isSuperAdmin: true } });
  assert.equal(await scalar("select legal_required_direct_access()"), false);
  await session(null);
  assert.equal(await scalar("select legal_required_direct_access()"), false);
});

test("players, coaches, managers and parents still need a current acceptance", async () => {
  for (const n of [2,3,4,5]) {
    await session(id(n));
    assert.equal(await scalar("select legal_required_direct_access()"), false);
  }
  await db.exec("reset role");
  await db.query("insert into legal_current_state values($1,$2,'platform',$3,false,'accepted')", [id(100),id(3),id(110)]);
  await session(id(3));
  assert.equal(await scalar("select legal_required_direct_access()"), true);
  await db.exec("reset role");
  await db.query("insert into legal_versions values($1,$2,2)", [id(111),id(100)]);
  await session(id(3));
  assert.equal(await scalar("select legal_required_direct_access()"), false);
});

test("superadmin publication still requires three approved cards and persists all three versions", async () => {
  await db.exec("reset role");
  const theme = await scalar("select id from etiquette_themes where position=1");
  await session(id(1));
  await assert.rejects(db.query("select etiquette_publish_theme($1)", [theme]), /Three complete, approved cards/);
  await db.exec("reset role");
  assert.equal(await scalar("select status from etiquette_themes where id=$1", [theme]), "draft");
  await db.query("update etiquette_card_versions set editorial_status='approved',approved_at=now() where card_id in (select id from etiquette_cards where theme_id=$1)", [theme]);
  await session(id(1));
  await db.query("select etiquette_publish_theme($1)", [theme]);
  assert.equal(await scalar("select status from etiquette_themes where id=$1", [theme]), "published");
  assert.equal(await scalar("select count(*)::int from etiquette_cards where theme_id=$1 and published_version_id is not null", [theme]), 3);
  await session(id(1), "aal1");
  await assert.rejects(db.query("select etiquette_publish_theme($1)", [theme]), /Legal validation required/);
  await session(id(2));
  await assert.rejects(db.query("select etiquette_publish_theme($1)", [theme]), /Legal validation required/);
});
