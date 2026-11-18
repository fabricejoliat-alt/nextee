import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("training guests can be evaluated only by active assigned staff in their own club and session", async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table club_events(id uuid,club_id uuid,group_id uuid,event_type text,status text);
      create table organization_members(organization_id uuid,user_id uuid,role text,is_active boolean);
      create table club_event_attendees(event_id uuid,player_id uuid);
      create table club_event_coaches(event_id uuid,coach_id uuid);
      create table academy_roster_entries(academy_id uuid,player_id uuid,status text);
      create function organization_actor_legal_ready(uuid,uuid) returns boolean language sql as $$select true$$;
      create function organization_player_authorized(uuid,uuid) returns boolean language sql as $$select false$$;
      create function organization_actor_access(uuid,uuid,uuid,boolean) returns boolean language sql as $$select false$$;
      create function is_group_staff_member(uuid,uuid) returns boolean language sql as $$select false$$;
      insert into club_events values ('${id(1)}','${id(2)}','${id(3)}','training','scheduled');
      insert into organization_members values ('${id(2)}','${id(4)}','coach',true),('${id(2)}','${id(5)}','player',true),
        ('${id(2)}','${id(6)}','coach',true),('${id(9)}','${id(7)}','coach',true);
      insert into club_event_attendees values ('${id(1)}','${id(5)}');
      insert into club_event_coaches values ('${id(1)}','${id(4)}');
    `);
    await db.exec(readFileSync("supabase/migrations/20261222_coach_evaluate_training_guests.sql", "utf8"));
    const access = async (actor = 4, event = 1, player = 5) =>
      (await db.query("select organization_event_player_access($1,$2,$3,true) as allowed", [id(actor),id(event),id(player)])).rows[0].allowed;
    assert.equal(await access(), true, "assigned coach can evaluate a guest without consent");
    assert.equal(await access(6), false, "unassigned coach");
    assert.equal(await access(7), false, "coach from another club");
    assert.equal(await access(4,1,8), false, "unregistered junior");
    assert.equal(await access(4,8), false, "another session");
    assert.equal(await access(5), false, "junior cannot use the staff exception");
    await db.exec("update club_events set status='cancelled'");
    assert.equal(await access(), false);
    await db.exec("update club_events set status='scheduled',event_type='interclub'");
    assert.equal(await access(), false, "exception is limited to training");
    await db.exec("update club_events set event_type='training'; update organization_members set is_active=false where role='coach'");
    assert.equal(await access(), false, "revoked coach");
    await db.exec("update organization_members set is_active=true where role='coach'; update organization_members set is_active=false where role='player'");
    assert.equal(await access(), false, "inactive junior");
  } finally {
    await db.close();
  }
});
