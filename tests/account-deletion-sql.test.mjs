import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = JSON.parse(readFileSync(new URL("./fixtures/account-deletion-schema.json", import.meta.url)));
const migration = readFileSync(new URL("../supabase/migrations/20261203_account_deletion.sql", import.meta.url), "utf8");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (name) => `"${name.replaceAll('"', '""')}"`;
function type(raw) {
  if (raw === "uuid[]" || raw === "uuid") return raw;
  if (raw?.endsWith("[]") || raw === "array") return "text[]";
  if (["boolean", "integer", "bigint", "smallint", "numeric", "double precision", "real", "date", "timestamp with time zone", "timestamp without time zone", "time without time zone", "json", "jsonb"].includes(raw)) return raw;
  return "text";
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'service_role') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"aal":"aal2"}'::jsonb $$;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);`);
  for (const [name, d] of Object.entries(schema)) {
    const primary = Object.entries(d.columns).filter(([, c]) => c.primary).map(([k]) => k);
    const columns = Object.entries(d.columns).map(([k, c]) =>
      `${q(k)} ${type(c.type)}${k === "id" && c.type === "uuid" ? " default gen_random_uuid()" : ""}`);
    await db.exec(`create table public.${q(name)}(${columns.join(",")}${primary.length ? `,primary key(${primary.map(q).join(",")})` : ""});`);
  }
  for (const [name, d] of Object.entries(schema)) {
    for (const [col, c] of Object.entries(d.columns)) if (c.reference) {
      const [target, targetCol] = c.reference.split(".");
      // The captured PostgREST schema has single-column FK descriptions.
      await db.exec(`alter table ${q(name)} add foreign key(${q(col)}) references ${q(target)}(${q(targetCol)});`);
    }
  }
  await db.exec(migration);
  for (const name of ["legal_presentations", "legal_decisions", "legal_conflict_resolutions", "legal_representative_events", "legal_data_request_events"]) {
    await db.exec(`create trigger immutable before update or delete on ${q(name)} for each row execute function public.legal_prevent_evidence_mutation();`);
  }
  await db.exec("grant usage on schema public,auth to anon,authenticated,service_role;");
  const insert = async (table, fields) => {
    const keys = Object.keys(fields);
    await db.query(`insert into ${table}(${keys.map(q).join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(fields));
  };
  for (const n of [1, 2, 3, 4, 5]) {
    await insert("auth.users", { id: uuid(n), email: `fixture-${n}@example.test` });
    await insert("profiles", { id: uuid(n) });
  }
  await insert("app_admins", { user_id: uuid(1) });
  await insert("organizations", { id: uuid(10) });
  await insert("organizations", { id: uuid(11) });
  const request = async (user) => (await db.query("select (public.request_account_deletion($1,$2,$3,'fr')).*",
    [user, user.replaceAll("-", "").repeat(2), `fixture@example.test`])).rows[0];
  const erase = (id) => db.query("select public.erase_account_data($1,$2)", [id, uuid(1)]);
  const finish = (id) => db.query("select public.finish_account_deletion($1,$2)", [id, uuid(1)]);
  const rows = async (table) => (await db.query(`select * from ${table}`)).rows;
  return { db, insert, request, erase, finish, rows };
}

test("account erasure preserves other members and shared club activities", async (t) => {
  const f = await fixture(), { db, insert, request, erase, finish, rows } = f;
  try {
    await insert("player_guardians", { player_id: uuid(3), guardian_user_id: uuid(2) });
    await insert("club_members", { id: uuid(20), club_id: uuid(10), user_id: uuid(3) });
    await insert("club_members", { id: uuid(21), club_id: uuid(11), user_id: uuid(3) });
    await insert("club_members", { id: uuid(22), club_id: uuid(10), user_id: uuid(4) });
    await insert("club_events", { id: uuid(30), club_id: uuid(10), created_by: uuid(5) });
    await insert("club_event_attendees", { event_id: uuid(30), player_id: uuid(3) });
    await insert("club_event_attendees", { event_id: uuid(30), player_id: uuid(4) });
    await insert("golf_rounds", { id: uuid(31), user_id: uuid(3) });
    await insert("golf_round_holes", { id: uuid(32), round_id: uuid(31) });
    await insert("golf_rounds", { id: uuid(33), user_id: uuid(4) });
    await insert("marketplace_items", { id: uuid(34), user_id: uuid(3), contact_email: "child@example.test" });
    await insert("marketplace_images", { id: uuid(35), item_id: uuid(34), path: `${uuid(3)}/photo.jpg` });
    await insert("storage.objects", { bucket_id: "marketplace", name: `${uuid(3)}/photo.jpg` });
    await insert("storage.objects", { bucket_id: "avatars", name: `${uuid(4)}/avatar.jpg` });
    await insert("player_dashboard_documents", { id: uuid(36), player_id: uuid(3), uploaded_by: uuid(5), storage_bucket: "player-documents", storage_path: "club/player/document.pdf" });
    await insert("storage.objects", { bucket_id: "player-documents", name: "club/player/document.pdf" });
    // Three dependency levels exercise correlated predicates, not just FK cascades.
    await insert("club_seasons", { id: uuid(37), club_id: uuid(10) });
    await insert("club_player_fields", { id: uuid(38), club_id: uuid(10) });
    await insert("club_player_season_records", { id: uuid(39), club_member_id: uuid(20), club_season_id: uuid(37) });
    await insert("club_player_season_field_values", { club_player_season_record_id: uuid(39), field_id: uuid(38) });
    const r = await request(uuid(3));
    await t.test("unauthenticated clients cannot request or execute erasure RPCs", async () => {
      await db.exec("set role authenticated");
      await assert.rejects(erase(r.id), /permission denied/);
      await assert.rejects(request(uuid(4)), /permission denied/);
      await db.exec("reset role");
      await assert.rejects(db.query("select erase_account_data($1,$2)", [r.id, uuid(2)]), /Forbidden/);
    });
    await t.test("duplicate requests preserve the original deadline", async () => {
      assert.equal((await request(uuid(3))).due_at.toISOString(), r.due_at.toISOString());
      assert.equal((await rows("account_deletion_requests")).length, 1);
    });
    await erase(r.id);
    await t.test("personal data and both memberships are removed; parent and peer remain", async () => {
      assert.equal((await rows("golf_rounds"))[0].id, uuid(33));
      assert.equal((await rows("golf_round_holes")).length, 0);
      assert.equal((await rows("marketplace_items")).length, 0);
      assert.equal((await rows("marketplace_images")).length, 0);
      assert.equal((await rows("club_members")).length, 1);
      assert.equal((await rows("club_event_attendees"))[0].player_id, uuid(4));
      assert.equal((await rows("club_events")).length, 1);
      assert.equal((await rows("club_player_season_field_values")).length, 0);
      assert.equal((await rows("account_deletion_files")).length, 2);
      assert.ok((await rows("profiles")).some((p) => p.id === uuid(2)));
    });
    await t.test("storage failures prevent a false completion and can be resumed", async () => {
      await assert.rejects(finish(r.id), /Files remain/);
      assert.ok((await rows("auth.users")).some((p) => p.id === uuid(3)));
      await erase(r.id);
      assert.equal((await rows("account_deletion_files")).length, 2);
      await db.query("delete from storage.objects where name<>$1", [`${uuid(4)}/avatar.jpg`]);
      await db.query("update account_deletion_files set removed_at=now() where request_id=$1", [r.id]);
      await finish(r.id);
      assert.equal((await rows("account_deletion_requests"))[0].status, "completed");
      assert.equal((await rows("auth.users")).some((p) => p.id === uuid(3)), false);
      assert.equal((await rows("profiles")).some((p) => p.id === uuid(3)), false);
      assert.equal((await rows("storage.objects")).length, 1);
      await finish(r.id);
    });
    await t.test("a deleted user's old JWT cannot pass the session gate", async () => {
      await db.query("select set_config('test.uid',$1,false),set_config('test.role','authenticated',false)", [uuid(3)]);
      assert.equal((await db.query("select application_session_ready() ok")).rows[0].ok, false);
      await db.query("select set_config('test.uid',$1,false)", [uuid(4)]);
      assert.equal((await db.query("select application_session_ready() ok")).rows[0].ok, true);
    });
  } finally { await db.close(); }
});

test("parent and coach requests do not delete children's accounts or club events", async () => {
  const f = await fixture(), { db, insert, request, erase, finish, rows } = f;
  try {
    await insert("player_guardians", { player_id: uuid(3), guardian_user_id: uuid(2) });
    await insert("club_events", { id: uuid(30), club_id: uuid(10), created_by: uuid(5) });
    await insert("club_trainings", { id: uuid(31), club_id: uuid(10), created_by: uuid(5) });
    await insert("coach_groups", { id: uuid(32), club_id: uuid(10), head_coach_user_id: uuid(5) });
    await insert("coach_player_private_notes", { id: uuid(33), player_id: uuid(3), author_coach_id: uuid(5), body: "Private fixture" });
    await insert("training_sessions", { id: uuid(34), user_id: uuid(3), coach_user_id: uuid(5) });
    for (const id of [uuid(2), uuid(5)]) { const r = await request(id); await erase(r.id); await finish(r.id); }
    assert.ok((await rows("auth.users")).some((p) => p.id === uuid(3)));
    assert.equal((await rows("player_guardians")).length, 0);
    assert.equal((await rows("club_events"))[0].created_by, null);
    assert.equal((await rows("club_trainings"))[0].created_by, null);
    assert.equal((await rows("training_sessions"))[0].user_id, uuid(3));
    assert.equal((await rows("training_sessions"))[0].coach_user_id, null);
    assert.equal((await rows("coach_player_private_notes")).length, 0);
  } finally { await db.close(); }
});

test("new dependencies abort final deletion instead of cascading through unreviewed records", async () => {
  const { db, insert, request, erase, finish, rows } = await fixture();
  try {
    await db.exec("create table new_shared_record(id uuid primary key,owner_id uuid references profiles(id) on delete cascade)");
    await insert("new_shared_record", { id: uuid(50), owner_id: uuid(3) });
    const r = await request(uuid(3)); await erase(r.id);
    await assert.rejects(finish(r.id), /Unprocessed reference/);
    assert.equal((await rows("new_shared_record")).length, 1);
    assert.ok((await rows("auth.users")).some((p) => p.id === uuid(3)));
  } finally { await db.close(); }
});

test("legal evidence can only be erased inside the authorized erasure transaction", async () => {
  const { db, insert, request, erase, finish, rows } = await fixture();
  try {
    await insert("legal_documents", { id: uuid(60) });
    await insert("legal_versions", { id: uuid(61), document_id: uuid(60) });
    await insert("legal_presentations", { id: uuid(62), actor_id: uuid(2), beneficiary_id: uuid(3), document_id: uuid(60), version_id: uuid(61), rendered_snapshot: { title: "Fictional child data" } });
    await insert("legal_decisions", { id: uuid(63), presentation_id: uuid(62), actor_id: uuid(2), beneficiary_id: uuid(3), document_id: uuid(60), version_id: uuid(61) });
    await insert("legal_current_state", { document_id: uuid(60), beneficiary_id: uuid(3), scope_key: "platform", version_id: uuid(61), decision_id: uuid(63) });
    await assert.rejects(db.query("delete from legal_presentations where id=$1", [uuid(62)]), /immutable/);
    const r = await request(uuid(3)); await erase(r.id); await finish(r.id);
    assert.equal((await rows("legal_presentations")).length, 0);
    assert.equal((await rows("legal_decisions")).length, 0);
    assert.equal((await rows("legal_current_state")).length, 0);
    assert.equal((await rows("legal_versions")).length, 1);
    assert.ok((await rows("auth.users")).some((p) => p.id === uuid(2)));
  } finally { await db.close(); }
});

test("late signed uploads are tracked and cannot survive a premature completion", async () => {
  const { db, insert, request, erase, finish, rows } = await fixture();
  try {
    await insert("player_document_upload_reservations", { id: uuid(70), player_id: uuid(3), uploaded_by: uuid(5),
      storage_bucket: "player-documents", storage_path: "club/child/pending.pdf", expires_at: new Date(Date.now() + 3600000) });
    await insert("storage.objects", { bucket_id: "player-documents", name: `player-documents/${uuid(10)}/${uuid(3)}/orphan.pdf` });
    const r = await request(uuid(3)); await erase(r.id);
    assert.equal((await rows("account_deletion_files")).length, 2);
    await db.query("update account_deletion_files set removed_at=now() where request_id=$1", [r.id]);
    await assert.rejects(finish(r.id), /upload links have not expired/);
    await insert("storage.objects", { bucket_id: "player-documents", name: "club/child/pending.pdf" });
    await db.query("update account_deletion_requests set files_ready_after=now()-interval '1 second' where id=$1", [r.id]);
    await erase(r.id);
    assert.equal((await rows("account_deletion_files"))[0].removed_at, null);
    await assert.rejects(finish(r.id), /Files remain/);
    const auth = (await rows("auth.users")).find((u) => u.id === uuid(3));
    assert.equal(auth.raw_app_meta_data.account_deletion_started, true);
    assert.ok(auth.banned_until > new Date());
  } finally { await db.close(); }
});
