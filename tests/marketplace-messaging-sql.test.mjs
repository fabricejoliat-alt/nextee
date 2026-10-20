import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, id } from './helpers/marketplaceSqlFixture.mjs';
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
async function messaging() {
  const f = await fixture(), { db } = f;
  try {
  await db.exec(`
    create or replace function organization_guardian_allowed(actor uuid,player uuid,org uuid,edit boolean,onboarding boolean) returns boolean language sql stable as $$
      select exists(select 1 from player_guardian_scopes where organization_id=org and guardian_user_id=actor and player_id=player and status='active' and can_view and (not edit or can_edit)) $$;
    create or replace function organization_actor_access(org uuid,actor uuid,player uuid default null,edit boolean default false) returns boolean language sql stable as $$
      select exists(select 1 from organization_members where organization_id=org and user_id=player and is_active and role='player')
      and (actor=player or organization_guardian_allowed(actor,player,org,edit,false)) $$;
    create function organization_actor_legal_ready(org uuid,actor uuid) returns boolean language sql stable as $$ select actor is not null $$;
    create function is_app_admin(actor uuid) returns boolean language sql stable as $$ select exists(select 1 from app_admins where user_id=actor) $$;
    alter table notification_recipients drop column id;
    alter table notification_recipients add column id bigint generated always as identity primary key;
    alter table notification_recipients alter column is_deleted set default false;
    alter table notification_recipients add foreign key(notification_id) references notifications(id) on delete cascade;
    create table if not exists organization_migration_baseline(object_key text primary key,definition text);
  `);
  await db.exec(sql('20261118_organization_notifications'));
  await db.exec(sql('20261206_marketplace_messaging'));
  await f.item(); await f.approve();
  const send = async (actor=3, subject=3, request=30) => (await db.query("select send_marketplace_contact_v2($1,$2,$3,'buyer@example.test','Putter availability','Hello, is the putter still available?',$4) id",[id(actor),id(subject),id(20),id(request)])).rows[0].id;
  const reply = async (message,actor=2,subject=2,request=40,text='Oui !') => (await db.query('select reply_marketplace_message($1,$2,$3,$4,$5) id',[id(actor),id(subject),message,text,id(request)])).rows[0].id;
  const remove = (message,actor,subject=actor,deleted=true) => db.query('select set_marketplace_message_deleted($1,$2,$3,$4)',[id(actor),id(subject),message,deleted]);
  const message = async mid => (await db.query('select * from marketplace_contact_messages where id=$1',[mid])).rows[0];
  const recipients = async mid => (await db.query('select r.user_id from notification_recipients r join marketplace_contact_messages m on m.notification_id=r.notification_id where m.id=$1 order by user_id',[mid])).rows.map(r=>r.user_id);
  const guardian = async (parent,child,edit=true) => db.query("insert into player_guardian_scopes(organization_id,player_id,guardian_user_id,status,can_view,can_edit) values($1,$2,$3,'active',true,$4)",[id(10),id(child),id(parent),edit]);
  return { ...f, send, reply, remove, message, recipients, guardian };
  } catch(error) { await db.close(); throw error; }
}

test('messages and generic notifications are atomic, idempotent and bound to the original participants', async () => {
  const f=await messaging();
  try {
    const mid=await f.send();
    assert.deepEqual(await f.recipients(mid),[id(2)]);
    const row=await f.message(mid); assert.equal(row.push_status,'pending');
    const notification=(await f.db.query('select * from notifications where id=$1',[row.notification_id])).rows[0];
    assert.equal(notification.kind,'marketplace_message');
    assert.equal(notification.data.url,`/player/marketplace/messages?message=${mid}&child_id=${id(2)}`);
    assert.ok(!JSON.stringify(notification).includes('putter'));
    assert.equal(await f.send(),mid);
    await assert.rejects(f.db.query("select send_marketplace_contact_v2($1,$1,$2,'buyer@example.test','Different subject','Hello, is the putter still available?',$3)",[id(3),id(20),id(30)]), /Request already used/);
    const rid=await f.reply(mid); assert.equal(await f.reply(mid),rid);
    assert.deepEqual(await f.recipients(rid),[id(3)]);
    assert.equal((await f.message(rid)).reply_to_id,mid);
    assert.equal((await f.message(rid)).subject,'Re: Putter availability');
    await assert.rejects(f.reply(mid,3,3),/Reply unavailable/);
    await assert.rejects(f.reply(mid,6,6),/Reply unavailable/);
    await assert.rejects(f.reply(mid,2,2,40,'A different reply'),/Request already used/);
    await f.asUser(2);
    await assert.rejects(f.reply(mid),/permission denied/);
    await assert.rejects(f.db.query('select * from marketplace_contact_messages'),/permission denied/);
  } finally { await f.db.close(); }
});

test('parent sends belong to the child; guardian scopes and every recipient preference are respected', async () => {
  const f=await messaging();
  try {
    await f.guardian(4,3); await f.guardian(5,2,false);
    const mid=await f.send(4,3);
    assert.equal((await f.message(mid)).sender_id,id(3)); assert.equal((await f.message(mid)).actor_id,id(4));
    assert.deepEqual(await f.recipients(mid),[id(2),id(5)]);
    await assert.rejects(f.reply(mid,5,2),/Reply unavailable/);
    await assert.rejects(f.remove(mid,5,2),/Message unavailable/);
    const rid=await f.reply(mid); assert.deepEqual(await f.recipients(rid),[id(3),id(4)]);
    await f.db.query('insert into user_notification_preferences(user_id,receive_in_app,receive_push,enabled_kinds) values($1,true,true,$2),($3,false,true,$4)',[id(2),['__none__'],id(5),[]]);
    const silent=await f.send(4,3,31); assert.deepEqual(await f.recipients(silent),[]); assert.equal((await f.message(silent)).push_status,'skipped');
    await f.db.query('update user_notification_preferences set enabled_kinds=$1 where user_id=$2',[['marketplace_message'],id(2)]);
    const enabled=await f.send(4,3,32); assert.deepEqual(await f.recipients(enabled),[id(2)]);
    await f.db.query("update marketplace_contact_messages set created_at=now()-interval '11 minutes'");
    await f.db.query('update user_notification_preferences set enabled_kinds=$1 where user_id=$2',[['manager_news'],id(2)]);
    assert.deepEqual(await f.recipients(await f.send(4,3,33)),[]);
    const mapping=(await f.db.query('select account_erasure_attributions() mapping')).rows[0].mapping;
    assert.deepEqual(mapping.marketplace_contact_messages,['actor_id']);
    const request=(await f.db.query("select (request_account_deletion($1,$2,'fixture@example.test','fr')).*",[id(4),id(4).replaceAll('-','').repeat(2)])).rows[0];
    await f.db.query('select erase_account_data($1,$2)',[request.id,id(1)]);
    assert.equal((await f.message(mid)).sender_id,id(3));
    assert.equal((await f.message(mid)).actor_id,null);
    assert.ok(await f.message(rid));
  } finally { await f.db.close(); }
});

test('deleting hides only your own copy, cancels its alerts and keeps reports; undo restores the copy', async () => {
  const f=await messaging();
  try {
    const mid=await f.send();
    await assert.rejects(f.remove(mid,6),/Message unavailable/);
    await f.remove(mid,3); assert.ok((await f.message(mid)).sender_deleted_at); assert.equal((await f.message(mid)).recipient_deleted_at,null);
    const rid=await f.reply(mid); assert.ok(rid);
    await f.remove(mid,2); assert.ok((await f.message(mid)).recipient_deleted_at);
    assert.equal((await f.db.query('select bool_and(is_deleted) hidden from notification_recipients where notification_id=$1',[(await f.message(mid)).notification_id])).rows[0].hidden,true);
    await assert.rejects(f.reply(mid,2,2,41),/Reply unavailable/);
    await f.remove(mid,2,2,false); assert.equal((await f.message(mid)).recipient_deleted_at,null); assert.ok((await f.message(mid)).sender_deleted_at);
    const notification=(await f.message(mid)).notification_id;
    await f.db.query('delete from marketplace_contact_messages where id=$1',[mid]);
    assert.equal((await f.db.query('select count(*)::int n from notifications where id=$1',[notification])).rows[0].n,0);
    assert.equal((await f.message(rid)).reply_to_id,null);
  } finally { await f.db.close(); }
});

test('blocking in either direction, revoked access and durable limits prevent replies; push claims are exclusive', async () => {
  const f=await messaging();
  try {
    const mid=await f.send();
    for (const [a,b] of [[2,3],[3,2]]) {
      await f.db.query('insert into marketplace_blocks(blocker_id,blocked_id) values($1,$2)',[id(a),id(b)]);
      await assert.rejects(f.reply(mid),/Reply unavailable/);
      await f.db.exec('delete from marketplace_blocks');
    }
    await f.db.query('update organization_members set is_active=false where user_id=$1',[id(3)]);
    await assert.rejects(f.reply(mid),/Reply unavailable/);
    await f.db.query('update organization_members set is_active=true where user_id=$1',[id(3)]);
    for(let n=0;n<10;n++) await f.reply(mid,2,2,100+n);
    await assert.rejects(f.reply(mid,2,2,111),/Rate limited/);
    assert.ok(await f.reply(mid,2,2,100));
    const first=await f.db.query('select * from claim_marketplace_message_pushes($1,4)',[mid]); assert.equal(first.rows.length,1);
    assert.equal((await f.db.query('select * from claim_marketplace_message_pushes($1,4)',[mid])).rows.length,0);
    await f.db.query("update marketplace_contact_messages set push_claimed_at=now()-interval '16 minutes' where id=$1",[mid]);
    await f.db.query('select * from claim_marketplace_message_pushes($1,4)',[mid]); assert.equal((await f.message(mid)).push_status,'uncertain');
  } finally { await f.db.close(); }
});
