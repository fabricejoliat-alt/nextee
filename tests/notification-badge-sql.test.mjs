import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("badge counts are private, account-wide, uncapped and respect read state, access and preferences", async () => {
  const db = new PGlite();
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
      create table user_notification_preferences(user_id uuid primary key,receive_in_app boolean,receive_push boolean,enabled_kinds text[]);
      create table notifications(id uuid primary key,kind text,visible boolean default true);
      create table notification_recipients(notification_id uuid,user_id uuid,is_read boolean default false,is_deleted boolean default false);
      create function organization_notification_visible(n uuid,u uuid) returns boolean language sql as $$select visible from notifications where id=n$$;
      insert into user_notification_preferences values('${a}',true,true,'{}'),('${b}',true,true,'{}');
      insert into notifications select md5(i::text)::uuid,'marketplace_message',true from generate_series(1,1105) i;
      insert into notification_recipients select id,'${a}',false,false from notifications;
      insert into notification_recipients select id,'${b}',false,false from notifications limit 2;
      update notification_recipients set is_read=true where user_id='${a}' and notification_id=md5('1')::uuid;
      update notification_recipients set is_deleted=true where user_id='${a}' and notification_id=md5('2')::uuid;
      update notifications set visible=false where id=md5('3')::uuid;
      update notifications set kind='thread_message' where id=md5('4')::uuid;`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261209_notification_badge_counts.sql", import.meta.url), "utf8"));
    const count = async ids => (await db.query("select * from notification_badge_counts_v1($1)", [ids])).rows;
    await db.exec(`set role service_role; set test.role='service_role'`);
    assert.equal(Number((await count([a]))[0].unread_count), 1102);
    assert.equal((await count([a,a,b])).length, 2);
    await db.exec(`reset role; set role authenticated; set test.role='authenticated'; set test.uid='${a}'`);
    assert.equal(Number((await count([a]))[0].unread_count), 1102);
    await assert.rejects(count([b]), /Forbidden/);
    await db.exec("reset role; set role anon; set test.role='anon'");
    await assert.rejects(count([a]), /permission denied/);
    await db.exec(`reset role; set test.role='service_role'; update user_notification_preferences set enabled_kinds='{thread_message}' where user_id='${a}'`);
    assert.equal(Number((await count([a]))[0].unread_count), 1);
    await db.exec(`update notification_recipients set is_read=true where user_id='${a}' and notification_id=md5('4')::uuid`);
    assert.equal(Number((await count([a]))[0].unread_count), 0);
    for (const column of ['receive_in_app','receive_push']) {
      await db.exec(`update user_notification_preferences set enabled_kinds='{}',receive_in_app=true,receive_push=true where user_id='${a}';
        update user_notification_preferences set ${column}=false where user_id='${a}'`);
      assert.equal(Number((await count([a]))[0].unread_count), 0);
    }
  } finally { await db.close(); }
});
