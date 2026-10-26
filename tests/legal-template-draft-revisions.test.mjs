import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync('supabase/migrations/20261129_legal_template_draft_revisions.sql', 'utf8');
const actor = '10000000-0000-4000-8000-000000000001';
const club = '10000000-0000-4000-8000-000000000002';
const text = Object.fromEntries(['fr','en','de','it'].map(locale => [locale, {
  title: `Title ${locale}`, body: `Body ${locale}`, action_label: 'OK', status: 'needs_review', source_revision: 2,
}]));
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table app_admins(user_id uuid);
    create table organizations(id uuid primary key, org_type text);
    create function organization_require_actor(uuid,uuid,boolean) returns void language plpgsql as $$begin
      if not exists(select 1 from app_admins where user_id=$1) then raise exception 'Platform admin required'; end if;
    end$$;
    create table legal_organization_templates(purpose_key text primary key,kind text,audience_roles text[],action_kind text,
      required boolean,required_locales text[],allowed_variables text[],translations jsonb);
    create table legal_documents(id uuid primary key default gen_random_uuid(),document_key text,kind text,purpose_key text,
      scope text,club_id uuid,audience_roles text[],action_kind text,required boolean,active boolean,required_locales text[],created_by uuid);
    create table legal_drafts(document_id uuid primary key,source_revision integer default 1,change_summary text,
      allowed_variables text[],translations jsonb,updated_by uuid,updated_at timestamptz default now());
    create table legal_versions(id uuid default gen_random_uuid(),document_id uuid);
  `);
  await db.query('insert into app_admins values($1)', [actor]);
  await db.query("insert into organizations values($1,'club')", [club]);
  for (const purpose of ['service.parent_authorization','coaching.ai','coaching.rewrite']) {
    await db.query("insert into legal_organization_templates values($1,'parent_authorization',array['parent'],'authorize',true,array['fr','en','de','it'],'{}',$2)", [purpose, text]);
  }
  const approval = readFileSync('supabase/migrations/20261104_legal_shared_draft_text.sql', 'utf8');
  await db.exec(approval.slice(approval.indexOf('create function public.approve_legal_draft_translation_checked('), approval.indexOf('\nrevoke all on function public.approve_legal_draft_translation_checked')));
  return db;
}
async function oldDraft(db, { active=false, published=false, translations=text }={}) {
  const doc = (await db.query("insert into legal_documents(purpose_key,scope,active) values('service.parent_authorization','organization',$1) returning id", [active])).rows[0].id;
  await db.query('insert into legal_drafts(document_id,translations) values($1,$2)', [doc, translations]);
  if (published) await db.query('insert into legal_versions(document_id) values($1)', [doc]);
  return doc;
}
test('new catalog drafts have independent revisions and all four languages can be approved', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.query('select create_club_legal_drafts_from_templates($1,$2)', [club,actor]);
    const drafts = (await db.query('select * from legal_drafts')).rows;
    assert.equal(drafts.length,3);
    for (const draft of drafts) for (const locale of ['fr','en','de','it']) {
      const translation=draft.translations[locale];
      assert.equal(translation.source_revision, draft.source_revision);
      assert.equal(translation.status,'needs_review');
      assert.equal(translation.body,text[locale].body);
      await db.query('select approve_legal_draft_translation_checked($1,$2,$3,$4)',[draft.document_id,locale,translation,actor]);
    }
    assert.equal((await db.query("select count(*)::int n from legal_drafts,jsonb_each(translations) t where t.value->>'status'='approved'")).rows[0].n,12);
    const draft=drafts[0];
    await assert.rejects(db.query('select approve_legal_draft_translation_checked($1,$2,$3,$4)',[draft.document_id,'fr',{...draft.translations.fr,body:'Stale text'},actor]),/changed/);
  } finally { await db.close(); }
});
test('repair fixes only pristine unpublished drafts, preserves text, and never approves them', async () => {
  const db = await fixture();
  try {
    const repairable = await oldDraft(db);
    const excluded = [await oldDraft(db,{active:true}), await oldDraft(db,{published:true}),
      await oldDraft(db,{translations:{...text,fr:{...text.fr,body:'Edited by reviewer'}}}),
      await oldDraft(db,{translations:{...text,fr:{...text.fr,status:'approved'}}})];
    const before=(await db.query('select * from legal_drafts where document_id=any($1::uuid[]) order by document_id',[excluded])).rows;
    await db.exec(migration);
    const repaired=(await db.query('select * from legal_drafts where document_id=$1',[repairable])).rows[0];
    for (const locale of ['fr','en','de','it']) assert.deepEqual(repaired.translations[locale],{...text[locale],source_revision:1});
    assert.deepEqual((await db.query('select * from legal_drafts where document_id=any($1::uuid[]) order by document_id',[excluded])).rows,before);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from legal_drafts where document_id=$1',[repairable])).rows[0],repaired);
    await db.query('select approve_legal_draft_translation_checked($1,$2,$3,$4)',[repairable,'fr',repaired.translations.fr,actor]);
    assert.equal((await db.query("select translations->'fr'->>'status' status from legal_drafts where document_id=$1",[repairable])).rows[0].status,'approved');
  } finally { await db.close(); }
});
