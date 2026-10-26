import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const club=id(1), secondClub=id(2), manager=id(3), parent=id(4), child=id(5), doc=id(6), otherDoc=id(7);
const migration=readFileSync('supabase/migrations/20261212_neutral_parent_relationship.sql','utf8');
function routine(file,name) {
  const source=readFileSync(`supabase/migrations/${file}`,'utf8');
  const occurrence=source.indexOf(`function public.${name}(`);
  assert.ok(occurrence>=0, name);
  const start=source.lastIndexOf('create ',occurrence), end=source.indexOf('$$;',occurrence)+3;
  return source.slice(start,end);
}

test('neutral parent migration preserves access boundaries, identity guards and function privileges', async t => {
  const db=new PGlite();
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const allowed=()=>scalar('select public.legal_document_actor_allowed($1,$2,$3,\'parent\')',[doc,parent,child]);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key,first_name text,last_name text,birth_date date,username text,app_role text);
      create table organizations(id uuid primary key,org_type text,is_active boolean default true);
      create table organization_members(organization_id uuid,user_id uuid,role text,is_active boolean default true,player_consent_status text,unique(organization_id,user_id,role));
      create table player_guardians(player_id uuid,guardian_user_id uuid,relation text check(relation in ('mother','father','legal_guardian','other')),is_primary boolean default false,can_view boolean default true,can_edit boolean default false,primary key(player_id,guardian_user_id));
      create table player_guardian_scopes(organization_id uuid,player_id uuid,guardian_user_id uuid,status text,can_view boolean,can_edit boolean,created_by uuid,ended_at timestamptz,updated_at timestamptz,unique(organization_id,player_id,guardian_user_id));
      create table legal_representative_assertions(guardian_id uuid,child_id uuid,club_id uuid,status text);
      create table legal_documents(id uuid primary key,club_id uuid,kind text,purpose_key text,scope text);
      create table legal_current_state(document_id uuid,beneficiary_id uuid,decision text);
      create table academy_roster_entries(id uuid,academy_id uuid,player_id uuid,status text,origin_type text,source_approved_at timestamptz);
      create table player_periodic_report_configs(club_id uuid,player_user_id uuid,recipient_user_ids uuid[],updated_at timestamptz);
      create function is_app_admin(uuid) returns boolean language sql as $$ select false $$;
      create function require_manager_player_scope_v1(actor uuid,club uuid,player uuid) returns void language plpgsql as $$ begin
        if not exists(select 1 from organization_members where organization_id=club and user_id=actor and role='manager' and is_active)
          or not exists(select 1 from organization_members where organization_id=club and user_id=player and role='player' and is_active)
          then raise exception 'Forbidden manager scope'; end if;
      end $$;
    `);
    const access='20261112_organization_access_legal.sql';
    for(const name of ['organization_guardian_allowed','legal_actor_allowed','legal_document_actor_allowed','manage_player_guardian_v1']) await db.exec(routine(access,name));
    await db.exec(routine('20261114_organization_onboarding_admin.sql','provision_academy_family_checked'));
    await db.exec(routine('20261115_organization_legacy_guardians.sql','attach_academy_guardian_checked'));
    await db.exec(routine('20261121_organization_guardian_provisioning.sql','provision_academy_guardian_checked'));
    await db.exec(`revoke all on function manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean),provision_academy_family_checked(uuid,uuid,uuid,jsonb,uuid,jsonb,text,uuid),attach_academy_guardian_checked(uuid,uuid,uuid,text),provision_academy_guardian_checked(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
      grant execute on function manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean),provision_academy_family_checked(uuid,uuid,uuid,jsonb,uuid,jsonb,text,uuid),attach_academy_guardian_checked(uuid,uuid,uuid,text),provision_academy_guardian_checked(uuid,uuid,uuid,jsonb,text) to service_role;
      insert into organizations values('${club}','club'),('${secondClub}','club');
      insert into organization_members values('${club}','${manager}','manager',true,null),('${club}','${parent}','parent',true,null),('${club}','${child}','player',true,'pending');
      insert into player_guardians values('${child}','${parent}','other',false,true,true);
      insert into player_guardian_scopes values('${club}','${child}','${parent}','active',true,true,'${manager}',null,null);
      insert into legal_documents values('${doc}','${club}','parent_authorization','service.parent_authorization','organization'),('${otherDoc}','${club}','specific_consent','coaching.ai','organization');
    `);
    assert.equal(await allowed(),false);
    const privilegesSql=`select proname,proowner,proacl::text,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace order by proname`;
    const privileges=(await db.query(privilegesSql)).rows;
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query(privilegesSql)).rows,privileges);
    assert.equal(await scalar('select relation from player_guardians'),'other','schema upgrade does not classify any contact');
    await db.exec("update player_guardians set relation='parent'");
    assert.equal(await allowed(),true);
    assert.equal(await scalar('select count(*)::int from legal_current_state'),0);
    assert.equal(await scalar('select count(*)::int from legal_representative_assertions'),0);
    assert.equal(await scalar("select public.legal_document_actor_allowed($1,$2,$3,'parent')",[otherDoc,parent,child]),false,'optional consents still need verified representation');

    for(const [name,sql] of [
      ['revoked authority',`insert into legal_representative_assertions values('${parent}','${child}','${club}','revoked')`],
      ['read-only scope','update player_guardian_scopes set can_edit=false'],
      ['hidden scope','update player_guardian_scopes set can_view=false'],
      ['ended scope',"update player_guardian_scopes set status='ended'"],
      ['inactive parent',"update organization_members set is_active=false where role='parent'"],
      ['inactive player',"update organization_members set is_active=false where role='player'"],
      ['adult player',"update organization_members set player_consent_status='adult' where role='player'"],
      ['another organization',`update legal_documents set club_id='${secondClub}' where id='${doc}'`],
      ['unverified other contact',"update player_guardians set relation='other'"],
      ['academy source approval missing',`insert into academy_roster_entries values('${id(8)}','${club}','${child}','pending','activitee_club',null)`],
    ]) await t.test(name,async()=>{
      await db.exec('begin'); try {await db.exec(sql);assert.equal(await allowed(),false);} finally {await db.exec('rollback');}
    });

    await t.test('manager can attach a new neutral parent but cannot rewrite an existing family identity',async()=>{
      await db.exec('begin'); try {
        await db.exec(`delete from player_guardians; delete from player_guardian_scopes;`);
        await db.query("select public.manage_player_guardian_v1($1,$2,$3,$4,'upsert','parent',false)",[manager,club,child,parent]);
        assert.equal(await scalar('select relation from player_guardians'),'parent');
        assert.equal(await allowed(),true,'pending scope permits onboarding only');
        await db.query("select public.manage_player_guardian_v1($1,$2,$3,$4,'upsert','father',true)",[manager,club,child,parent]);
        assert.equal(await scalar('select relation from player_guardians'),'parent');
        await assert.rejects(db.query("select public.manage_player_guardian_v1($1,$2,$3,$4,'upsert','parent',false)",[parent,club,child,parent]),/Forbidden manager scope/);
      } finally {await db.exec('rollback');}
    });

    await t.test('119-link correction is audited, preserves decisions and refuses changed scope or a replay',async()=>{
      await db.exec(`alter table legal_documents add column active boolean default true;
        create table organization_audit_events(organization_id uuid,object_type text,object_id text,actor_id uuid,action text,previous_state jsonb,next_state jsonb);
        insert into legal_current_state values('${doc}','${child}','authorized');`);
      for(let n=0;n<119;n++) {
        const player=id(1000+n);
        await db.query("insert into organization_members values($1,$2,'player',true,$3)",[club,player,n<9?'adult':'pending']);
        await db.query("insert into player_guardians values($1,$2,'other',false,true,true)",[player,parent]);
        await db.query("insert into player_guardian_scopes values($1,$2,$3,'active',true,true,$4,null,null)",[club,player,parent,manager]);
      }
      const fingerprint=await scalar("select md5(string_agg(player_id::text||':'||guardian_user_id::text,',' order by player_id,guardian_user_id)) from player_guardians where relation='other'");
      const correction=readFileSync('scripts/migrations/sion/parent-relations-data.sql','utf8')
        .replaceAll('97b6dce7-e904-4751-9184-72d9080a0c68',club)
        .replaceAll('d782fdb0-aa31-46ea-93ef-75796b1d4e07',manager)
        .replaceAll('0ee0cbae5ecd7cb389c2bca4816f1299',fingerprint);
      await db.exec('begin');
      await db.exec("update player_guardians set can_edit=false where player_id='"+id(1000)+"'");
      await assert.rejects(db.exec(correction),/Existing family rights/);
      await db.exec('rollback');
      assert.equal(await scalar("select count(*)::int from player_guardians where relation='parent'"),1);
      await db.exec('begin'); await db.exec(correction); await db.exec('commit');
      assert.equal(await scalar("select count(*)::int from player_guardians where relation='parent'"),120);
      assert.equal(await scalar("select count(*)::int from organization_audit_events where previous_state->>'relation'='other' and next_state->>'relation'='parent'"),119);
      assert.equal(await scalar('select count(*)::int from legal_current_state'),1);
      assert.equal(await scalar('select count(*)::int from legal_representative_assertions'),0);
      await assert.rejects(db.exec(correction),/already recorded/);
    });
  } finally {await db.close();}
});
