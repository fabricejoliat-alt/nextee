// Run with MANAGER_PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
// PostgreSQL runs entirely in memory; no Supabase connection or real records are used.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const modulePath = process.env.MANAGER_PGLITE_MODULE;
const PGlite = modulePath ? (await import(pathToFileURL(modulePath).href)).PGlite : null;
const db = PGlite ? new PGlite() : null;
const sqlTest = (name, run) => test(name, { skip: !db && "Set MANAGER_PGLITE_MODULE to run the PostgreSQL integration tests." }, run);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(101), B = id(102), manager = id(1), player = id(2), parent = id(3), secondParent = id(4), outside = id(6), foreignParent = id(8);
const mutation = (values, actor = manager, target = player) => db.query(
  "select public.save_manager_player_consent_v1($1,$2,$3,$4::jsonb) as result", [actor, A, target, JSON.stringify(values)],
);
const guardian = (targetParent, action = "upsert", targetPlayer = player) => db.query(
  "select public.manage_player_guardian_v1($1,$2,$3,$4,$5,'father',true)", [manager, A, targetPlayer, targetParent, action],
);

before(async () => {
  if (!db) return;
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles(id uuid primary key);
    create table public.clubs(id uuid primary key);
    create table public.app_admins(user_id uuid primary key references public.profiles);
    create table public.club_members(id uuid primary key default gen_random_uuid(), club_id uuid references public.clubs,
      user_id uuid references public.profiles, role text, is_active boolean, player_consent_status text,
      unique(club_id,user_id,role));
    create table public.player_guardians(player_id uuid references public.profiles, guardian_user_id uuid references public.profiles,
      relation text check(relation in ('mother','father','legal_guardian','other')), is_primary boolean not null default false,
      can_view boolean not null default true, can_edit boolean not null default false, primary key(player_id,guardian_user_id));
    create table public.player_periodic_report_configs(club_id uuid, player_user_id uuid, recipient_user_ids uuid[] not null default '{}', updated_at timestamptz);
    create table public.player_consents(club_id uuid references public.clubs, player_user_id uuid references public.profiles,
      status text not null check(status in ('pending','granted','refused','adult')), decided_at timestamptz,
      signer_guardian_user_id uuid references public.profiles, signer_name text, source text,
      consent_version text, internal_notes text, updated_by uuid references public.profiles,
      created_at timestamptz default now(), updated_at timestamptz default now(), primary key(club_id,player_user_id));
    create table public.player_consent_history(id uuid primary key default gen_random_uuid(), club_id uuid references public.clubs,
      player_user_id uuid references public.profiles, status text, decided_at timestamptz,
      signer_guardian_user_id uuid references public.profiles, signer_name text, source text,
      consent_version text, internal_notes text, changed_by uuid references public.profiles, changed_at timestamptz default now());
  `);
  const migration = await readFile(new URL("../supabase/migrations/20261008_manager_security_batch1.sql", import.meta.url), "utf8");
  await db.exec(migration);
  // Re-applying must preserve a valid schema and permissions.
  await db.exec(migration);
});

beforeEach(async () => {
  if (!db) return;
  await db.exec(`truncate player_consent_history,player_consents,player_guardians,player_periodic_report_configs,club_members,app_admins,profiles,clubs cascade;
    insert into profiles(id) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,9) n;
    insert into clubs values ('${A}'),('${B}');
    insert into club_members(club_id,user_id,role,is_active,player_consent_status) values
      ('${A}','${manager}','manager',true,null), ('${A}','${manager}','parent',true,null),
      ('${A}','${player}','player',true,'pending'), ('${B}','${player}','player',true,'pending'),
      ('${B}','${outside}','player',true,'pending'), ('${A}','${parent}','parent',true,null),
      ('${A}','${secondParent}','parent',true,null), ('${B}','${foreignParent}','parent',true,null);
    insert into player_guardians values ('${player}','${parent}','father',true,true,true);
    insert into player_periodic_report_configs values
      ('${A}','${player}',array['${parent}'::uuid,'${secondParent}'::uuid],now()),
      ('${B}','${player}',array['${parent}'::uuid],now());
  `);
});
after(() => db?.close());

sqlTest("SQL grants exclude anonymous/authenticated callers and allow only server entry points", async () => {
  for (const signature of ["manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean)", "save_manager_player_consent_v1(uuid,uuid,uuid,jsonb)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${signature}`]);
      assert.equal(result.rows[0].allowed, role === "service_role");
    }
  }
  await db.exec("set role authenticated");
  try { await assert.rejects(() => mutation({ status: "granted" }), /permission denied/); }
  finally { await db.exec("reset role"); }
});

sqlTest("SQL allows an active multi-role Manager and synchronizes authorized consent atomically", async () => {
  await db.exec("set role service_role");
  let result;
  try { result = await mutation({ status: "granted", source: "manager", signer_guardian_user_id: parent, signer_name: "Parent" }); }
  finally { await db.exec("reset role"); }
  assert.equal(result.rows[0].result.consent.status, "granted");
  assert.equal(result.rows[0].result.history.length, 1);
  const statuses = await db.query("select player_consent_status from club_members where user_id=$1 and role='player'", [player]);
  assert.deepEqual(statuses.rows.map((row) => row.player_consent_status), ["granted", "granted"]);
});

sqlTest("SQL denies foreign players and inactive Managers without touching status or history", async () => {
  await assert.rejects(() => mutation({ status: "granted" }, manager, outside), /player_not_found/);
  await db.query("update club_members set is_active=false where user_id=$1 and role='manager'", [manager]);
  await assert.rejects(() => mutation({ status: "granted" }), /manager_forbidden/);
  assert.equal((await db.query("select count(*)::int as count from player_consent_history")).rows[0].count, 0);
  assert.equal((await db.query("select count(*)::int as count from club_members where player_consent_status='granted'")).rows[0].count, 0);
});

sqlTest("SQL validates the consent signer and reserves parent_portal for the parent workflow", async () => {
  await assert.rejects(() => mutation({ status: "granted", signer_guardian_user_id: foreignParent }), /invalid_signer/);
  await assert.rejects(() => mutation({ status: "granted", source: "parent_portal" }), /invalid_consent/);
  await assert.rejects(() => mutation({ status: "unknown" }), /invalid_consent/);
  assert.equal((await db.query("select count(*)::int as count from player_consents")).rows[0].count, 0);
});

sqlTest("a history insertion failure rolls back consent and all club status changes", async () => {
  await db.exec(`create function public.test_history_failure() returns trigger language plpgsql as $$ begin raise exception 'simulated history failure'; end $$;
    create trigger test_history_failure before insert on player_consent_history for each row execute function public.test_history_failure();`);
  try {
    await assert.rejects(() => mutation({ status: "granted" }), /simulated history failure/);
    assert.equal((await db.query("select count(*)::int as count from player_consents")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::int as count from club_members where player_consent_status='granted'")).rows[0].count, 0);
  } finally { await db.exec("drop trigger test_history_failure on player_consent_history; drop function public.test_history_failure();"); }
});

sqlTest("SQL validates both sides of a guardian link before clearing the primary parent", async () => {
  await assert.rejects(() => guardian(foreignParent), /guardian_not_found/);
  await assert.rejects(() => guardian(parent, "upsert", outside), /player_not_found/);
  assert.equal((await db.query("select is_primary from player_guardians")).rows[0].is_primary, true);
});

sqlTest("a failed guardian insertion restores the previous primary parent", async () => {
  await db.exec(`create function public.test_guardian_failure() returns trigger language plpgsql as $$ begin raise exception 'simulated guardian failure'; end $$;
    create trigger test_guardian_failure before insert on player_guardians for each row execute function public.test_guardian_failure();`);
  try {
    await assert.rejects(() => guardian(secondParent), /simulated guardian failure/);
    assert.equal((await db.query("select is_primary from player_guardians")).rows[0].is_primary, true);
  } finally { await db.exec("drop trigger test_guardian_failure on player_guardians; drop function public.test_guardian_failure();"); }
});

sqlTest("primary-parent updates and deletion preserve other parents and remove scheduled access", async () => {
  await guardian(secondParent);
  const primary = await db.query("select guardian_user_id from player_guardians where is_primary=true");
  assert.deepEqual(primary.rows.map((row) => row.guardian_user_id), [secondParent]);
  await guardian(parent, "delete");
  const links = await db.query("select guardian_user_id from player_guardians");
  assert.deepEqual(links.rows.map((row) => row.guardian_user_id), [secondParent]);
  const recipients = await db.query("select recipient_user_ids from player_periodic_report_configs order by club_id");
  assert.deepEqual(recipients.rows.map((row) => row.recipient_user_ids), [[secondParent], []]);
});
