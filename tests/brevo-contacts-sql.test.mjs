import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20261215_brevo_contacts.sql", import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,banned_until timestamptz,deleted_at timestamptz);
    create table profiles(id uuid primary key,first_name text,last_name text);
    create table clubs(id uuid primary key,name text);
    create table organizations(id uuid primary key,name text,is_active boolean default true);
    create table club_members(user_id uuid,club_id uuid,role text,is_active boolean default true);
    create table organization_members(user_id uuid,organization_id uuid,role text,is_active boolean default true);`);
  await db.exec(migration);
  await db.query("insert into clubs values($1,'Sion'),($2,'Académie')", [id(10), id(11)]);
  await db.query("insert into organizations(id,name) values($1,'Sion'),($2,'Académie')", [id(10), id(11)]);
  async function person(n, email, role, club = 10) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id(n), email]);
    await db.query("insert into profiles values($1,$2,$3)", [id(n), `Prénom ${n}`, `Nom ${n}`]);
    await db.query("insert into club_members(user_id,club_id,role) values($1,$2,$3)", [id(n), id(club), role]);
  }
  const prepare = (token = id(90), list = 42) => db.query("select prepare_brevo_contact_sync($1,$2) as acquired", [token, list]);
  const due = (token = id(90)) => db.query("select * from due_brevo_contact_sync($1,25)", [token]);
  const release = () => db.exec("update brevo_contact_sync_control set lease_until=null,lease_token=null");
  return { db, person, prepare, due, release };
}

test("shared mailbox: adult identity, all roles, exact per-role clubs, no fake emails or inactive members", async () => {
  const { db, person } = await fixture();
  try {
    await person(1, " Family@example.org ", "player");
    await person(2, "family@example.org", "parent", 11);
    await db.query("insert into organization_members(user_id,organization_id,role) values($1,$2,'coach')", [id(2), id(10)]);
    await person(3, "fake@noemail.local", "player");
    await person(4, "coach@example.org", "coach");
    await db.query("update club_members set is_active=false where user_id=$1", [id(4)]);
    await person(5, "banned@example.org", "manager");
    await db.query("update auth.users set banned_until=now()+interval '1 year' where id=$1", [id(5)]);
    const rows = (await db.query("select * from brevo_contact_directory")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "family@example.org");
    assert.equal(rows[0].attributes.ACTIVITEE_FIRSTNAME, "Prénom 2");
    assert.equal(rows[0].attributes.ACTIVITEE_ROLES, "|coach|parent|player|");
    assert.equal(rows[0].attributes.ACTIVITEE_PARENT_CLUBS, `|${id(11)}|`);
    assert.equal(rows[0].attributes.ACTIVITEE_COACH_CLUBS, `|${id(10)}|`);
    assert.deepEqual(rows[0].user_ids, [id(1), id(2)]);
  } finally { await db.close(); }
});

test("initial import, exclusive lease, unchanged contacts skipped, changes and removals reconciled", async () => {
  const { db, person, prepare, due, release } = await fixture();
  try {
    await person(1, "parent@example.org", "parent");
    assert.equal((await prepare()).rows[0].acquired, true);
    assert.equal((await prepare(id(91))).rows[0].acquired, false);
    assert.equal((await due(id(91))).rows.length, 0);
    assert.equal((await due()).rows.length, 1);
    await db.exec("update brevo_contact_sync_state set synced_hash=desired_hash");
    await release(); await prepare();
    assert.equal((await due()).rows.length, 0);
    await db.exec("update profiles set first_name='Modifié'");
    await release(); await prepare();
    assert.equal((await due()).rows[0].attributes.ACTIVITEE_FIRSTNAME, "Modifié");
    await db.exec("update club_members set is_active=false");
    await release(); await prepare();
    assert.deepEqual((await due()).rows[0].attributes, { ACTIVITEE_ACTIVE: false });
    assert.equal(JSON.stringify((await due()).rows).includes("Modifié"), false);
    await db.exec("delete from brevo_contact_sync_state");
    await release(); await prepare();
    assert.equal((await due()).rows.length, 0); // Never import inactive accounts.
  } finally { await db.close(); }
});

test("email change cleans the old mailbox and carries webhook suppression by account identity", async () => {
  const { db, person, prepare, due, release } = await fixture();
  try {
    await person(1, "old@example.org", "player"); await prepare();
    await db.query("select suppress_brevo_contact($1,$2,'unsubscribe')", ["old@example.org", "a".repeat(64)]);
    await db.exec("update auth.users set email='new@example.org'");
    await release(); await prepare();
    const rows = (await db.query("select * from brevo_contact_sync_state")).rows;
    assert.equal(rows.length, 2);
    assert.equal((await due()).rows.length, 1); // New email waits for the old mailbox cleanup.
    assert.equal((await due()).rows[0].email, "old@example.org");
    assert.deepEqual(rows.find(r => r.email === "old@example.org").attributes, { ACTIVITEE_ACTIVE: false });
    const suppressed = (await db.query("select * from brevo_contact_suppressions")).rows[0];
    assert.deepEqual(suppressed.user_ids, [id(1)]);
    assert.equal(JSON.stringify(suppressed).includes("old@example.org"), false);
    assert.deepEqual(rows.find(r => r.email === "new@example.org").user_ids, suppressed.user_ids);
  } finally { await db.close(); }
});

test("retry backoff survives reconciliation, expired leases recover, provider cooldown is global", async () => {
  const { db, person, prepare, due, release } = await fixture();
  try {
    await person(1, "coach@example.org", "coach"); await prepare();
    await db.exec("update brevo_contact_sync_state set attempts=3,last_error='BREVO_HTTP_429',next_attempt_at=now()+interval '1 hour'");
    await db.exec("update brevo_contact_sync_control set lease_until=now()-interval '1 minute'");
    assert.equal((await prepare(id(91))).rows[0].acquired, true);
    assert.equal((await due(id(91))).rows.length, 0);
    assert.equal((await db.query("select attempts from brevo_contact_sync_state")).rows[0].attempts, 3);
    await release();
    await db.exec("update brevo_contact_sync_control set cooldown_until=now()+interval '1 hour'");
    assert.equal((await prepare()).rows[0].acquired, false);
    await db.exec("update brevo_contact_sync_control set cooldown_until=null");
    await assert.rejects(prepare(id(90), 43), /brevo_target_list_changed/);
  } finally { await db.close(); }
});

test("directory, personal state and RPCs are unavailable to browser database roles", async () => {
  const { db } = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const query of ["select * from brevo_contact_directory", "select * from brevo_contact_sync_state",
        "select * from brevo_contact_suppressions", "select brevo_contact_sync_stats()",
        `select prepare_brevo_contact_sync('${id(90)}',42)`, `select suppress_brevo_contact('x@example.org','${"a".repeat(64)}','spam')`]) {
        await assert.rejects(db.query(query), /permission denied/);
      }
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
