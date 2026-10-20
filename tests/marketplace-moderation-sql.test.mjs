import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = JSON.parse(readFileSync(new URL("./fixtures/account-deletion-schema.json", import.meta.url)));
const migration = readFileSync(new URL("../supabase/migrations/20261204_marketplace_moderation.sql", import.meta.url), "utf8");
const deletion = readFileSync(new URL("../supabase/migrations/20261203_account_deletion.sql", import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quote = name => `"${name.replaceAll('"', '""')}"`;
const sqlType = raw => raw === "uuid" || raw === "uuid[]" ? raw : raw?.endsWith("[]") || raw === "array" ? "text[]" :
  ["boolean", "integer", "bigint", "smallint", "numeric", "double precision", "real", "date", "timestamp with time zone", "timestamp without time zone", "time without time zone", "json", "jsonb"].includes(raw) ? raw : "text";

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'service_role') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"aal":"aal2"}'::jsonb $$;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
    alter table storage.objects enable row level security;
    create policy permissive_storage on storage.objects for all to authenticated using(true) with check(true);`);
  for (const [name, d] of Object.entries(schema)) {
    const primary = Object.entries(d.columns).filter(([, c]) => c.primary).map(([k]) => k);
    const columns = Object.entries(d.columns).map(([k, c]) =>
      `${quote(k)} ${sqlType(c.type)}${k === "id" && c.type === "uuid" ? " default gen_random_uuid()" : ""}`);
    await db.exec(`create table public.${quote(name)}(${columns.join(",")}${primary.length ? `,primary key(${primary.map(quote).join(",")})` : ""});`);
  }
  await db.exec(deletion);
  await db.exec(`
    create function organization_guardian_allowed(actor uuid,player uuid,org uuid,edit boolean,onboarding boolean) returns boolean language sql stable as $$
      select exists(select 1 from player_guardians where guardian_user_id=actor and player_id=player and can_view) $$;
    create function organization_actor_access(org uuid,actor uuid,player uuid,edit boolean) returns boolean language sql stable as $$
      select exists(select 1 from organization_members where organization_id=org and user_id=player and is_active)
       and (actor=player or organization_guardian_allowed(actor,player,org,edit,false)) $$;
    alter table marketplace_items enable row level security;
    alter table marketplace_images enable row level security;
    create policy baseline_items on marketplace_items for all to authenticated using(true) with check(true);
    create policy baseline_images on marketplace_images for all to authenticated using(true) with check(true);
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    grant select,insert,update,delete on marketplace_items,marketplace_images,storage.objects to authenticated;
  `);
  await db.exec(migration);
  for (const n of [1,2,3,4,5,6]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id(n), `fixture-${n}@example.test`]);
    await db.query("insert into profiles(id) values($1)", [id(n)]);
  }
  await db.query("insert into app_admins(user_id) values($1)", [id(1)]);
  for (const n of [10,11]) await db.query("insert into organizations(id,is_active) values($1,true)", [id(n)]);
  for (const [user, club, role] of [[2,10,"player"],[3,10,"player"],[4,10,"manager"],[5,11,"manager"],[6,11,"player"]]) {
    await db.query("insert into organization_members(organization_id,user_id,role,is_active) values($1,$2,$3,true)", [id(club),id(user),role]);
  }
  const item = async (n=20) => db.query("insert into marketplace_items(id,user_id,club_id,title,is_active) values($1,$2,$3,'Putter',true)",[id(n),id(2),id(10)]);
  const approve = (revision=1, actor=4) => db.query("select moderate_marketplace_item($1,$2,$3,'approve','')",[id(actor),id(20),revision]);
  const asUser = async n => { await db.query("select set_config('test.uid',$1,false),set_config('test.role','authenticated',false)",[id(n)]); await db.exec("set role authenticated"); };
  const service = async () => { await db.exec("reset role; select set_config('test.role','service_role',false)"); };
  const row = async () => (await db.query("select * from marketplace_items where id=$1",[id(20)])).rows[0];
  return { db,item,approve,asUser,service,row };
}

test("only reviewed listings and photos are visible; edits invalidate approval", async () => {
  const f=await fixture(); const {db}=f;
  try {
    await f.item();
    await f.asUser(3);
    assert.equal((await db.query("select * from marketplace_items")).rows.length,0);
    await f.asUser(2);
    assert.equal((await db.query("select * from marketplace_items")).rows.length,1);
    await assert.rejects(db.query("update marketplace_items set moderation_status='approved'"), /protected/);
    await assert.rejects(f.approve(), /permission denied/);
    await f.service();
    await assert.rejects(f.approve(1,5), /Forbidden/);
    await f.approve();
    await f.asUser(3);
    assert.equal((await db.query("select * from marketplace_items")).rows.length,1);
    await f.asUser(6);
    assert.equal((await db.query("select * from marketplace_items")).rows.length,0);
    await f.asUser(2);
    await db.query("update marketplace_items set title='Modified putter' where id=$1",[id(20)]);
    await f.service();
    assert.equal((await f.row()).moderation_status,"pending");
    assert.equal((await f.row()).moderation_revision,2);
    await assert.rejects(f.approve(1), /Listing changed/);
    await f.approve(2);
    await f.asUser(2);
    await db.query("insert into marketplace_images(item_id,path,sort_order) values($1,$2,0)",[id(20),`${id(2)}/${id(20)}/photo.jpg`]);
    await f.service();
    assert.equal((await f.row()).moderation_status,"pending");
    assert.equal((await f.row()).moderation_revision,3);
    await f.asUser(3);
    assert.equal((await db.query("select * from marketplace_images")).rows.length,0);
    await f.service(); await f.approve(3); await f.asUser(3);
    assert.equal((await db.query("select * from marketplace_images")).rows.length,1);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('marketplace','malicious.jpg')"),/row-level security/);
  } finally { await db.close(); }
});

test("blocks are bidirectional and follow the child for guardian reads; suspensions stop publication", async () => {
  const f=await fixture(); const {db}=f;
  try {
    await f.item(); await f.approve();
    await db.query("insert into player_guardians(player_id,guardian_user_id,can_view) values($1,$2,true)",[id(3),id(6)]);
    await db.query("insert into marketplace_blocks(blocker_id,blocked_id,created_by) values($1,$2,$3)",[id(3),id(2),id(6)]);
    for (const actor of [3,6]) {
      await f.asUser(actor);
      assert.equal((await db.query("select * from marketplace_items")).rows.length,0);
      await assert.rejects(db.query("select * from marketplace_reports"),/permission denied/);
      await f.service();
    }
    assert.equal((await db.query("select marketplace_pair_blocked($1,$1,$2,$3) blocked",[id(2),id(3),id(10)])).rows[0].blocked,true);
    await db.query("delete from marketplace_blocks");
    await db.query("insert into marketplace_suspensions(user_id,club_id,created_by,reason) values($1,$2,$3,'Abusive content')",[id(2),id(10),id(4)]);
    await f.asUser(3);
    assert.equal((await db.query("select * from marketplace_items")).rows.length,0);
    await f.service();
    await assert.rejects(f.item(21),/suspended/);
    await assert.rejects(f.approve(),/suspended/);
  } finally { await db.close(); }
});

test("account deletion clears moderation attribution without deleting another member's listing", async () => {
  const f=await fixture(); const {db}=f;
  try {
    await f.item(); await f.approve();
    await db.query("insert into marketplace_blocks(blocker_id,blocked_id,created_by) values($1,$2,$3)",[id(3),id(2),id(4)]);
    await db.query("insert into marketplace_reports(item_id,club_id,reporter_id,subject_id,reason,resolved_by) values($1,$2,$3,$4,'other',$5)",
      [id(20),id(10),id(3),id(2),id(4)]);
    const requested = (await db.query("select (request_account_deletion($1,$2,'fixture@example.test','fr')).*",[id(4),"a".repeat(64)])).rows[0];
    await db.query("select erase_account_data($1,$2)",[requested.id,id(1)]);
    assert.equal((await f.row()).moderated_by,null);
    assert.equal((await f.row()).moderation_status,"approved");
    assert.equal((await db.query("select created_by from marketplace_blocks")).rows[0].created_by,null);
    await db.query("update account_deletion_requests set files_ready_after=now() where id=$1",[requested.id]);
    await db.query("select finish_account_deletion($1,$2)",[requested.id,id(1)]);
    assert.equal((await db.query("select * from auth.users where id=$1",[id(4)])).rows.length,0);
    assert.ok(await f.row());
  } finally { await db.close(); }
});

test("contact reservations enforce scope, live blocks and a persistent sending limit", async () => {
  const f=await fixture(); const {db}=f;
  try {
    await f.item(); await f.approve();
    const send = (actor=3) => db.query("select reserve_marketplace_contact($1,$1,$2,'fixture@example.test','Putter availability','Hello, is the putter still available?')",[id(actor),id(20)]);
    await assert.rejects(send(6),/Contact unavailable/);
    await f.asUser(3);
    await assert.rejects(send(),/permission denied/);
    await assert.rejects(db.query("select * from marketplace_contact_messages"),/permission denied/);
    await f.service();
    await db.query("insert into marketplace_blocks(blocker_id,blocked_id) values($1,$2)",[id(2),id(3)]);
    await assert.rejects(send(),/Contact unavailable/);
    await db.query("delete from marketplace_blocks");
    await send(); await send(); await send();
    await assert.rejects(send(),/Rate limited/);
    assert.equal((await db.query("select * from marketplace_contact_messages")).rows.length,3);
    const requested = (await db.query("select (request_account_deletion($1,$2,'fixture@example.test','fr')).*",[id(3),"b".repeat(64)])).rows[0];
    await db.query("select erase_account_data($1,$2)",[requested.id,id(1)]);
    assert.equal((await db.query("select * from marketplace_contact_messages")).rows.length,0);
  } finally { await db.close(); }
});
