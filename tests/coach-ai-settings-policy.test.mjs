import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('rewrite settings seed once and direct application roles cannot read or mutate them',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;');
  const migration=readFileSync('supabase/migrations/20261218_coach_ai_rewrite_settings.sql','utf8');
  await db.exec(migration);
  assert.equal((await db.query('select revision from coach_ai_rewrite_settings')).rows[0].revision,1);
  await db.exec("update coach_ai_rewrite_settings set instructions='Consignes administrateur personnalisées à conserver.',revision=2");
  await db.exec(migration);
  assert.equal((await db.query('select revision from coach_ai_rewrite_settings')).rows[0].revision,2);
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(db.query('select * from coach_ai_rewrite_settings'),/permission denied/);
   await assert.rejects(db.query("update coach_ai_rewrite_settings set revision=3"),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const saved=await db.query("update coach_ai_rewrite_settings set revision=3 where singleton=true and revision=2 returning revision");
  assert.equal(saved.rows[0].revision,3);
  assert.equal((await db.query("update coach_ai_rewrite_settings set revision=4 where singleton=true and revision=2 returning revision")).rows.length,0);
 }finally{await db.close();}
});
