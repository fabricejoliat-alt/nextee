// Optional real PostgreSQL test, isolated in memory (no Supabase connection).
// Verified with @electric-sql/pglite 0.5.8; no project dependency is required.
// COACH_SECURITY_PGLITE_PATH=/absolute/path/node_modules/@electric-sql/pglite/dist/index.js
// node --test tests/coach-security-sql.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { prepareReliabilitySchema, runReliabilitySqlTests } from "./helpers/coach-reliability-sql.mjs";
import { runOccurrenceSqlTests } from "./helpers/coach-occurrence-sql.mjs";
import { runCreationSqlTests } from "./helpers/coach-creation-sql.mjs";
import { runDeletionSqlTests } from "./helpers/coach-deletion-sql.mjs";

const runtimePath = process.env.COACH_SECURITY_PGLITE_PATH;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [clubA, clubB, coach, player, parent, manager, other, groupA, groupB, eventA, eventB, revoked] = Array.from({ length: 12 }, (_, i) => uuid(i + 1));

test("Coach SQL security against a real isolated PostgreSQL engine", {
  skip: runtimePath ? false : "Set COACH_SECURITY_PGLITE_PATH to run the isolated PostgreSQL tests",
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(runtimePath).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table public.club_members (club_id uuid, user_id uuid, role text, is_active boolean,
      can_manage_assigned_groups boolean default true, can_manage_assigned_group_planning boolean default true);
    create table public.coach_groups (id uuid primary key, club_id uuid, head_coach_user_id uuid, is_active boolean default true);
    create table public.coach_group_coaches (group_id uuid, coach_user_id uuid);
    create table public.coach_group_players (group_id uuid, player_user_id uuid);
    create table public.club_events (id uuid primary key, group_id uuid, club_id uuid, event_type text default 'training', status text default 'scheduled',
      starts_at timestamptz default now() - interval '2 hours', ends_at timestamptz default now() - interval '1 hour', duration_minutes int default 60);
    create table public.club_event_coaches (event_id uuid, coach_id uuid);
    create table public.club_event_attendees (event_id uuid, player_id uuid, status text,
      coach_recorded_status text, coach_recorded_by uuid, coach_recorded_at timestamptz, primary key (event_id, player_id));
    create table public.club_event_series (id uuid, group_id uuid, club_id uuid);
    create table public.club_event_player_structure_items (event_id uuid, player_id uuid, note text);
    create table public.club_event_coach_feedback (event_id uuid, player_id uuid, coach_id uuid,
      engagement int, attitude int, performance int, visible_to_player boolean, private_note text, player_note text,
      primary key (event_id, player_id, coach_id));
    create table public.coach_player_private_notes (event_id uuid, player_id uuid, organization_id uuid, body text);
    create table public.coach_training_debriefs (id uuid primary key default gen_random_uuid(), event_id uuid unique, organization_id uuid,
      report_text text, report_scope text, collective_summary_text text, individual_comments jsonb, report_version int default 1,
      author_coach_id uuid, updated_at timestamptz default now());
    create table public.player_guardians (player_id uuid, guardian_user_id uuid, can_view boolean);
    create table public.player_dashboard_documents (id uuid, organization_id uuid, player_id uuid, club_event_id uuid, uploaded_by uuid, coach_only boolean default false);
    create function public.is_group_staff_member(uuid, uuid) returns boolean language sql as $$ select true $$;
    grant all on all tables in schema public to authenticated, service_role;
    alter table public.club_event_coach_feedback enable row level security;
    create policy legacy_feedback_read on public.club_event_coach_feedback for select to authenticated using (true);
    create policy legacy_feedback_insert on public.club_event_coach_feedback for insert to authenticated with check (true);
    create policy legacy_feedback_update on public.club_event_coach_feedback for update to authenticated using (true);
    alter table public.club_events enable row level security;
    alter table public.club_event_coaches enable row level security;
    alter table public.club_event_attendees enable row level security;
    alter table public.club_event_series enable row level security;
    alter table public.club_event_player_structure_items enable row level security;
    alter table public.player_dashboard_documents enable row level security;
    insert into club_members (club_id,user_id,role,is_active) values
      ('${clubA}','${coach}','coach',true), ('${clubB}','${coach}','coach',true),
      ('${clubA}','${player}','player',true), ('${clubB}','${player}','player',true),
      ('${clubA}','${manager}','manager',true), ('${clubA}','${revoked}','coach',false);
    insert into coach_groups (id,club_id,head_coach_user_id) values ('${groupA}','${clubA}','${other}'),('${groupB}','${clubB}','${other}');
    insert into coach_group_coaches values ('${groupA}','${coach}'),('${groupA}','${revoked}');
    insert into coach_group_players values ('${groupA}','${player}'),('${groupB}','${player}');
    insert into club_events (id,group_id,club_id) values ('${eventA}','${groupA}','${clubA}'),('${eventB}','${groupB}','${clubB}');
    insert into club_event_coaches values ('${eventA}','${revoked}');
    insert into club_event_attendees (event_id,player_id,status) values ('${eventA}','${player}','present');
    insert into club_event_player_structure_items values ('${eventA}','${player}','planned-note');
    insert into player_guardians values ('${player}','${parent}',true);
    insert into club_event_coach_feedback values ('${eventA}','${player}','${coach}',4,4,4,true,'private-A','shared-A');
    insert into coach_player_private_notes values ('${eventA}','${player}','${clubA}','private-derived');
    insert into player_dashboard_documents (id,organization_id,player_id,club_event_id,uploaded_by) values ('${uuid(20)}','${clubA}','${player}',null,'${coach}'),('${uuid(21)}','${clubB}','${player}',null,'${other}');
  `);
  await prepareReliabilitySchema(db);
  const permissionMigration = readFileSync(new URL("../supabase/migrations/20260912_add_coach_club_permissions_and_player_transfers.sql", import.meta.url), "utf8");
  await db.exec(permissionMigration.match(/create or replace function public\.can_manage_assigned_group\([\s\S]*?\$\$;/)[0]);
  const migration = readFileSync(new URL("../supabase/migrations/20261002_harden_coach_security_batch1.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Re-applying must not restore old grants or lose data.
  await db.exec(readFileSync(new URL("../supabase/migrations/20260926_save_coach_training_player_evaluation.sql", import.meta.url), "utf8"));

  async function asActor(actorId, run, role = "authenticated") {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${actorId}',false); select set_config('request.jwt.claim.role','${role}',false);`);
    try { await run(); } finally { await db.exec("reset role"); }
  }

  await t.test("player and parent can read shared feedback but never private_note or SELECT *", async () => {
    for (const actor of [player, parent]) await asActor(actor, async () => {
      assert.deepEqual((await db.query("select player_note from club_event_coach_feedback")).rows, [{ player_note: "shared-A" }]);
      await assert.rejects(db.query("select private_note from club_event_coach_feedback"), /permission denied/);
      await assert.rejects(db.query("select * from club_event_coach_feedback"), /permission denied/);
      await assert.rejects(db.query("select body from coach_player_private_notes"), /permission denied/);
      await assert.rejects(db.query("select * from coach_training_debriefs"), /permission denied/);
    });
  });
  await t.test("invisible feedback and revoked guardian permission remain hidden", async () => {
    await db.exec("update club_event_coach_feedback set visible_to_player = false");
    await asActor(parent, async () => assert.deepEqual((await db.query("select player_note from club_event_coach_feedback")).rows, []));
    await db.exec("update club_event_coach_feedback set visible_to_player = true; update player_guardians set can_view = false");
    await asActor(parent, async () => assert.deepEqual((await db.query("select player_note from club_event_coach_feedback")).rows, []));
    await db.exec("update player_guardians set can_view = true");
  });
  await t.test("revoked coach cannot read the event or shared feedback through historical assignments", async () => {
    await asActor(revoked, async () => {
      assert.deepEqual((await db.query("select id from club_events")).rows, []);
      assert.deepEqual((await db.query("select player_note from club_event_coach_feedback")).rows, []);
      assert.deepEqual((await db.query("select note from club_event_player_structure_items")).rows, []);
      assert.equal((await db.query(`select can_manage_coach_event('${eventA}','${coach}') as allowed`)).rows[0].allowed, false);
    });
  });
  await t.test("same-club membership alone does not allow another group's event or private documents", async () => {
    await asActor(coach, async () => {
      assert.deepEqual((await db.query("select id from club_events")).rows, [{ id: eventA }]);
      assert.deepEqual((await db.query("select organization_id from player_dashboard_documents")).rows, [{ organization_id: clubA }]);
      assert.equal((await db.query(`select can_read_coach_player_sensitive('${clubB}','${player}') as allowed`)).rows[0].allowed, false);
      // Other SQL authorization helpers use this predicate to check a target user.
      assert.equal((await db.query(`select is_group_staff_member('${groupA}','${revoked}') as allowed`)).rows[0].allowed, false);
      assert.equal((await db.query(`select is_group_staff_member('${groupA}','${coach}') as allowed`)).rows[0].allowed, true);
    });
  });
  await t.test("manager access stays within their own club", async () => {
    await asActor(manager, async () => {
      assert.equal((await db.query(`select can_manage_coach_event('${eventA}') as allowed`)).rows[0].allowed, true);
      assert.equal((await db.query(`select can_manage_coach_event('${eventB}') as allowed`)).rows[0].allowed, false);
      assert.deepEqual((await db.query("select organization_id from player_dashboard_documents")).rows, [{ organization_id: clubA }]);
    });
  });
  await t.test("authorized server access retains the actual private notes", async () => {
    await asActor(coach, async () => {
      assert.deepEqual((await db.query("select private_note from club_event_coach_feedback")).rows, [{ private_note: "private-A" }]);
      assert.deepEqual((await db.query("select body from coach_player_private_notes")).rows, [{ body: "private-derived" }]);
    }, "service_role");
  });
  await t.test("direct feedback writes are disabled, even for a valid coach", async () => {
    await asActor(coach, async () => {
      await assert.rejects(db.exec("update club_event_coach_feedback set player_note = 'bypass'"), /permission denied/);
      await assert.rejects(db.exec("delete from club_event_coach_feedback"), /permission denied/);
      await assert.rejects(db.query(`select save_manager_event_feedback_v1('${eventA}','${player}', '{}'::jsonb)`), /forbidden/);
    });
  });
  await t.test("Manager feedback save remains usable through its scoped RPC", async () => {
    await asActor(manager, async () => {
      const feedback = JSON.stringify({ private_note: "manager-private", player_note: "manager-shared", visible_to_player: true });
      await db.query("select save_manager_event_feedback_v1($1, $2, $3::jsonb)", [eventA, player, feedback]);
      await assert.rejects(db.query("select save_manager_event_feedback_v1($1, $2, $3::jsonb)", [eventB, player, feedback]), /forbidden/);
      await assert.rejects(db.query("select save_manager_event_feedback_v1($1, $2, $3::jsonb)", [eventA, other, feedback]), /unknown_attendee/);
    });
  });
  await t.test("guided save remains atomic and checks coach, participant, timing and cancellation", async () => {
    const call = (coachId, playerId = player, eventId = eventA, rating = 4) => db.query(
      "select save_coach_training_player_evaluation_v1($1,$2,$3,'present',$4,4,4,'shared-new','private-new',true)", [eventId, coachId, playerId, rating]);
    await asActor(coach, async () => {
      await assert.rejects(call(revoked), /forbidden/);
      await assert.rejects(call(coach, other), /unknown_attendee/);
      await assert.rejects(call(coach, player, eventA, 7), /ratings_required/);
      assert.equal((await db.query("select private_note from club_event_coach_feedback where coach_id = $1", [coach])).rows[0].private_note, "private-A");
      await call(coach);
      assert.deepEqual((await db.query("select private_note, player_note from club_event_coach_feedback")).rows,
        [{ private_note: "private-new", player_note: "shared-new" }]);
      assert.equal((await db.query("select coach_recorded_status from club_event_attendees")).rows[0].coach_recorded_status, "present");
      await db.exec("update club_events set status = 'cancelled'");
      await assert.rejects(call(coach), /event_cancelled/);
      await db.exec("update club_events set status = 'scheduled', ends_at = now() + interval '1 hour'");
      await assert.rejects(call(coach), /event_not_finished/);
    }, "service_role");
  });
  await runReliabilitySqlTests(t,db,{clubA,clubB,coach,player,manager,other,revoked,groupA,eventA,eventB},asActor);
  await runOccurrenceSqlTests(t,db,{clubA,clubB,coach,player,manager,other,revoked,groupA,eventA,eventB},asActor);
  await runCreationSqlTests(t,db,{clubA,clubB,coach,player,manager,other,revoked,groupA,groupB,eventA,eventB},asActor);
  await runDeletionSqlTests(t,db,{clubA,clubB,coach,player,manager,revoked,groupA,groupB},asActor);
});
