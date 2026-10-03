import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, test } from "node:test";
import { pathToFileURL } from "node:url";
const modulePath = process.env.MANAGER_PGLITE_MODULE;
const db = modulePath ? new (await import(pathToFileURL(modulePath).href)).PGlite() : null;
const sqlTest = (name, fn) => test(name, { skip: !db && "Set MANAGER_PGLITE_MODULE" }, fn);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const manager=id(1),player=id(2),parent=id(3),club=id(10),news=id(20);
const claim = (hash="junior", consume=true) => db.query("select claim_access_invitation_v1($1,$2) as result",[hash,consume]).then(r=>r.rows[0].result);
const reserve = (actor=manager, c=club, recipient=player) => db.query("select claim_manager_news_email_v1($1,$2,$3,$4,$5) as result",[actor,c,news,recipient,recipient===player?'junior@example.invalid':'parent@example.invalid']).then(r=>r.rows[0].result);
const finish = (attempt,status) => db.query("select finish_manager_news_email_v1($1,$2,$3,$4,$5,$6,null)",[manager,club,news,player,attempt,status]);
before(async()=>{
 if(!db)return;
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text);
 create table profiles(id uuid primary key); create table clubs(id uuid primary key);
 create table app_admins(user_id uuid primary key);
 create table club_members(id uuid default gen_random_uuid(),club_id uuid,user_id uuid,role text,is_active boolean);
 create table player_guardians(player_id uuid,guardian_user_id uuid,can_view boolean,can_edit boolean);
 create table club_news(id uuid primary key,club_id uuid,last_email_sent_at timestamptz);
 create function require_manager_club_scope_v1(a uuid,c uuid) returns void language plpgsql as $$ begin
 if not exists(select 1 from club_members where user_id=a and club_id=c and role='manager' and is_active) then raise exception 'manager_forbidden' using errcode='42501'; end if; end $$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260317_add_access_invitation_tokens.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260325_expand_access_invitation_token_kinds.sql',import.meta.url),'utf8'));
 await db.exec(`insert into profiles values('${parent}'),('${player}'); insert into clubs values('${club}');
 insert into access_invitation_tokens(club_id,user_id,invitation_kind,sent_to_email,token_hash,expires_at,sent_by) values('${club}','${player}','account_recovery','parent@example.invalid','existing-recovery',now()+interval '1 day','${parent}');`);
 const migration=await readFile(new URL('../supabase/migrations/20261011_manager_communications_batch3.sql',import.meta.url),'utf8');
 await db.exec(migration); await db.exec(migration);
});
beforeEach(async()=>{
 if(!db)return;
 await db.exec(`truncate club_news_email_deliveries,access_invitation_tokens,club_news,club_members,player_guardians,app_admins,profiles,clubs,auth.users cascade;
 insert into profiles values('${manager}'),('${player}'),('${parent}'); insert into clubs values('${club}');
 insert into auth.users values('${player}','junior@example.invalid'),('${parent}','parent@example.invalid');
 insert into club_members(club_id,user_id,role,is_active) values('${club}','${manager}','manager',true),('${club}','${player}','player',true),('${club}','${parent}','parent',true);
 insert into player_guardians values('${player}','${parent}',true,true); insert into club_news values('${news}','${club}',null);
 insert into access_invitation_tokens(club_id,user_id,recipient_user_id,invitation_kind,sent_to_email,token_hash,expires_at,sent_by) values
 ('${club}','${player}','${parent}','junior_access','parent@example.invalid','junior',now()+interval '7 days','${manager}'),
 ('${club}','${player}','${player}','junior_access','junior@example.invalid','direct',now()+interval '7 days','${manager}'),
 ('${club}','${player}',null,'account_recovery','parent@example.invalid','legacy-recovery',now()+interval '1 day','${parent}'),
 ('${club}','${parent}',null,'parent_access','parent@example.invalid','legacy-parent',now()+interval '7 days','${manager}');`);
});
after(()=>db?.close());
sqlTest('batch 3 migration is repeatable and all 14 postflight checks pass',async()=>{
 const result=await db.query(await readFile(new URL('../supabase/checks/20261011_manager_communications_postflight.sql',import.meta.url),'utf8'));
 assert.equal(result.rows.length,14);assert.deepEqual(result.rows.filter(r=>!r.ok),[]);
 await db.exec('set role authenticated');try {await assert.rejects(()=>claim(),/permission denied/);}finally{await db.exec('reset role');}
});
sqlTest('invitation preview does not consume; claim consumes all outstanding account links once',async()=>{
 assert.equal((await claim('junior',false)).user_id,player);
 const results=await Promise.all([claim('junior'),claim('direct')]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(await claim('junior'),null);
 assert.equal((await claim('legacy-parent')).user_id,parent);
});
sqlTest('expired links and revoked guardian permissions cannot reset Auth',async()=>{
 await db.exec("update access_invitation_tokens set expires_at=now()-interval '1 second' where token_hash='direct'");assert.equal(await claim('direct'),null);
 await db.exec('update player_guardians set can_edit=false');assert.equal(await claim(),null);
 assert.equal((await db.query("select consumed_at from access_invitation_tokens where token_hash='junior'")).rows[0].consumed_at,null);
});
sqlTest('membership, sender authorization, email and protected roles are revalidated',async()=>{
 for(const change of ["update club_members set is_active=false where role='parent'",`update auth.users set email='changed@example.invalid' where id='${parent}'`,`insert into app_admins values('${player}')`,`insert into club_members(club_id,user_id,role,is_active) values('${club}','${player}','coach',false)`,"update club_members set is_active=false where role='manager'"]){
  await db.exec('begin');await db.exec(change);assert.equal(await claim(),null,change);await db.exec('rollback');
 }
});
sqlTest('delivery reservations deduplicate concurrent sends and only retry explicit failures',async()=>{
 const results=await Promise.all([reserve(),reserve()]);assert.equal(results.filter(r=>r.status==='claimed').length,1);
 const attempt=results.find(r=>r.status==='claimed').attempt_id;await finish(attempt,'failed');
 const retry=await reserve();assert.equal(retry.status,'claimed');assert.notEqual(retry.attempt_id,attempt);
 await assert.rejects(()=>finish(attempt,'sent'),/delivery_attempt_not_found/);
 await finish(retry.attempt_id,'sent');assert.equal((await reserve()).status,'sent');
});
sqlTest('uncertain sends and unacknowledged sends stay reserved across retries',async()=>{
 const first=await reserve();assert.equal((await reserve()).status,'sending');
 await finish(first.attempt_id,'uncertain');assert.equal((await reserve()).status,'uncertain');
});
sqlTest('delivery RPC rejects foreign news, foreign actors and departed recipients',async()=>{
 await assert.rejects(()=>reserve(parent),/manager_forbidden/);
 await db.exec(`insert into club_members(club_id,user_id,role,is_active) values('${id(11)}','${manager}','manager',true)`);
 await assert.rejects(()=>reserve(manager,id(11)),/news_not_found/);
 await db.exec("update club_members set is_active=false where role='player'");await assert.rejects(()=>reserve(),/recipient_no_longer_available/);
});
sqlTest('historical aggregate sent markers never cause old news to be resent',async()=>{
 await db.exec('update club_news set last_email_sent_at=now()');assert.equal((await reserve()).status,'legacy_sent');
 assert.equal((await db.query('select count(*)::int as count from club_news_email_deliveries')).rows[0].count,0);
});

sqlTest('existing parent-assisted recovery links survive the migration and recheck guardian rights',async()=>{
 assert.equal((await claim('legacy-recovery',false)).user_id,player);
 await db.exec('update player_guardians set can_view=false');assert.equal(await claim('legacy-recovery'),null);
 await db.exec('update player_guardians set can_view=true');assert.equal((await claim('legacy-recovery')).user_id,player);
 assert.equal(await claim('direct'),null);
});
