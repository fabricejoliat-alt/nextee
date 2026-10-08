import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizationDatabase } from './helpers/organizationDatabase.mjs';

// A schema-only export is mandatory: the historical repo migrations do not
// reconstruct the original database. This suite imports no application records.
const baselinePath = process.env.ACTIVITEE_ORG_BASELINE;
if (!baselinePath) throw new Error('Set ACTIVITEE_ORG_BASELINE to the schema-only SQL export');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const users = { admin:id(1), sionManager:id(2), academyManager:id(3), player:id(4), parent:id(5), coach:id(6), outsider:id(7), externalPlayer:id(8), externalParent:id(9) };
let db, sion, academy, externalClub, entry, reference, parentDoc, academyDoc;
async function query(sql, params=[]) { return (await db.query(sql,params)).rows; }
async function scalar(sql,params=[]) { return Object.values((await query(sql,params))[0])[0]; }
async function service() { await db.exec("reset role; set request.jwt.claim.role='service_role'; set request.jwt.claim.sub='';"); }
async function authenticated(user) {
  await db.exec(`reset role; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${user}'; set role authenticated;`);
}
async function denied(sql,params=[],pattern=/forbidden|unavailable|required|permission denied|changed/i) {
  await assert.rejects(()=>query(sql,params),pattern);
}
async function publish(org, key, kind='parent_authorization') {
  const doc = await scalar(`insert into public.legal_documents(document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active,applicability,created_by)
    values($1,$2,$3,'organization',$4,$5,$6,true,true,'{"status":"approved","rule":"all_members"}',$7) returning id`,
    [key,kind,kind==='parent_authorization'?'service.parent_authorization':key,org,kind==='parent_authorization'?['parent']:['player','parent'],kind==='parent_authorization'?'authorize':'accept',users.admin]);
  const translations=Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:'{{organization_name}}',body:'Fixture {{organization_name}}',action_label:'OK',status:'approved',source_revision:1}]));
  await query(`insert into public.legal_drafts(document_id,change_summary,allowed_variables,translations,updated_by) values($1,'Fixture review',array['organization_name'],$2,$3)`,[doc,translations,users.admin]);
  await query('select public.publish_legal_draft($1,$2)',[doc,users.admin]);
  return doc;
}
async function decide(doc,actor,beneficiary,decision='authorized') {
  const presentation=await scalar('select public.present_legal_document($1,$2,$3,$4,$5)',[doc,actor,beneficiary,actor===beneficiary?'player':'parent','fr']);
  return scalar('select public.decide_legal_document($1,$2,$3,gen_random_uuid())',[presentation,actor,decision]);
}
before(async()=>{
  db=await organizationDatabase({baselinePath});
  await service();
  for(const [name,uid] of Object.entries(users)) {
    await query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,`${name}@fixtures.invalid`]);
    await query('insert into public.profiles(id,first_name,last_name,birth_date,username) values($1,$2,$3,$4,$5)',[uid,name,'Fixture',name.includes('Player')||name==='player'?'2012-01-01':'1980-01-01',`fixture.${name}`]);
  }
  await query('insert into public.app_admins(user_id) values($1)',[users.admin]);
  sion=await scalar("select public.create_organization_checked($1,'Fixture Sion','fixture-sion','club')",[users.admin]);
  academy=await scalar("select public.create_organization_checked($1,'Fixture Centre','fixture-centre','academy')",[users.admin]);
  externalClub=await scalar("select public.create_organization_checked($1,'Fixture External Club','fixture-external','club')",[users.admin]);
  for(const [org,user,role] of [[sion,users.sionManager,'manager'],[academy,users.academyManager,'manager'],[sion,users.player,'player'],[sion,users.parent,'parent'],[academy,users.coach,'coach']])
    await query('insert into public.organization_members(organization_id,user_id,role,player_consent_status) values($1,$2,$3,$4)',[org,user,role,role==='player'?'pending':null]);
  await query("select set_config('activitee.actor_id',$1,true)",[users.admin]);
  // Identity link is global; each scope is separate. Use the manager transaction.
  await query("select public.manage_player_guardian_v1($1,$2,$3,$4,'upsert','father',true)",[users.sionManager,sion,users.player,users.parent]);
  await db.exec("insert into public.legal_parent_code_control(singleton,required) values(true,false); insert into public.legal_enforcement_control(singleton,enabled) values(true,true);");
  parentDoc=await publish(sion,'fixture_sion_parent');
  await decide(parentDoc,users.parent,users.player);
  academyDoc=await publish(academy,'fixture_academy_parent');
});
after(async()=>{await db?.close();});

test('canonique: aucune académie dans clubs, projections et FTEM cohérents',async()=>{
  assert.equal(await scalar('select count(*)::int from public.clubs where id=$1',[academy]),0);
  assert.equal(await scalar('select count(*)::int from public.training_volume_targets where organization_id=$1',[academy]),10);
  assert.equal(await scalar("select player_consent_status from public.organization_members where organization_id=$1 and user_id=$2 and role='player'",[sion,users.player]),'granted');
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[sion,users.player]),true);
});
test('recherche minimale: relation active, acteur et capacités contrôlés',async()=>{
  await denied('select * from public.discover_academy_players_checked($1,$2,$3,$4)',[users.academyManager,academy,sion,'player']);
  await query("select public.set_academy_partnership_checked($1,$2,$3,'active',true,true,0)",[users.admin,academy,sion]);
  await denied('select * from public.discover_academy_players_checked($1,$2,$3,$4)',[users.outsider,academy,sion,'player']);
  await denied('select * from public.discover_academy_players_checked($1,$2,$3,$4)',[users.academyManager,academy,sion,'%'],/Search/);
  const found=await query('select * from public.discover_academy_players_checked($1,$2,$3,$4)',[users.academyManager,academy,sion,'player']);
  assert.deepEqual(Object.keys(found[0]).sort(),['first_name','last_name','origin_organization_id','player_id']);
  assert.equal(found.length,1);
});
test('demande: ni autorisation implicite, ni duplication, validation source obligatoire',async()=>{
  entry=await scalar("select public.request_academy_roster_checked($1,$2,$3,'activitee_club',$4)",[users.academyManager,academy,users.player,sion]);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),false);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[sion,users.player]),true);
  await db.exec("set request.headers='{\"x-activitee-organization\":\""+academy+"\"}'");
  for(const actor of [users.player,users.parent,users.coach,users.academyManager]) assert.equal(await scalar('select public.personal_player_access($1,$2)',[users.player,actor]),false);
  await db.exec("set request.headers='{}'");
  await denied('select public.present_legal_document($1,$2,$3,$4,$5)',[academyDoc,users.parent,users.player,'parent','fr']);
  await denied("select public.set_academy_roster_status_checked($1,$2,'active',1)",[users.academyManager,entry]);
  await denied('select public.approve_academy_source_checked($1,$2,1,true)',[users.academyManager,entry]);
  await query('select public.approve_academy_source_checked($1,$2,1,true)',[users.sionManager,entry]);
  await denied('select public.approve_academy_source_checked($1,$2,2,true)',[users.sionManager,entry]);
  assert.equal(await scalar('select count(*)::int from public.profiles where id=$1',[users.player]),1);
  assert.equal(await scalar('select count(*)::int from public.player_guardians where player_id=$1',[users.player]),1);
});
test('Admin ne se substitue pas au parent; preuve avec organisation_name rendue',async()=>{
  await denied('select public.present_legal_document($1,$2,$3,$4,$5)',[academyDoc,users.admin,users.player,'parent','fr']);
  await decide(academyDoc,users.parent,users.player);
  assert.match(await scalar("select rendered_snapshot->>'body' from public.legal_presentations where document_id=$1 order by presented_at desc limit 1",[academyDoc]),/Fixture Centre/);
  await query("select public.set_academy_roster_status_checked($1,$2,'active',2)",[users.academyManager,entry]);
  assert.equal(await scalar('select public.organization_actor_access($1,$2,$3)',[academy,users.parent,users.player]),true);
});
test('RLS: Manager étranger, parent hors périmètre et écriture directe refusés',async()=>{
  await authenticated(users.outsider);
  assert.equal(await scalar('select count(*)::int from public.academy_roster_entries'),0);
  await denied('update public.academy_roster_entries set status=$1 where id=$2',['ended',entry]);
  await denied("select public.set_academy_roster_status_checked($1,$2,'ended',3)",[users.admin,entry]);
  await service();
  await query('insert into public.coach_groups(club_id,name) values($1,$2)',[academy,'Fixture group']);
  await authenticated(users.player);
  assert.equal(await scalar('select count(*)::int from public.coach_groups where club_id=$1',[academy]),0); // unassigned
  await service();
});
test('retrait Centre: historique immuable et Sion toujours accessible',async()=>{
  const previousHash=await scalar('select content_sha256 from public.legal_versions where document_id=$1',[academyDoc]);
  await decide(academyDoc,users.parent,users.player,'withdrawn');
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),false);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[sion,users.player]),true);
  assert.equal(await scalar('select status from public.academy_roster_entries where id=$1',[entry]),'suspended');
  assert.equal(await scalar('select content_sha256 from public.legal_versions where document_id=$1',[academyDoc]),previousHash);
  await denied('update public.legal_decisions set decision=$1 where document_id=$2',['authorized',academyDoc],/immutable/i);
  assert.equal(await scalar('select count(*)::int from public.legal_decisions where document_id=$1',[academyDoc]),2);
});
test('conflit et nouvelle version: nouvelle décision obligatoire, historique conservé',async()=>{
  const before=await scalar('select count(*)::int from public.legal_decisions where document_id=$1',[academyDoc]);
  await denied('select public.decide_legal_document($1,$2,$3,gen_random_uuid())',[
    await scalar("select public.present_legal_document($1,$2,$3,'parent','fr')",[academyDoc,users.parent,users.player]),users.parent,'authorized'],/conflict/);
  await query('select public.resolve_legal_withdrawal_conflict($1,$2,$3,$4,$5)',[academyDoc,users.player,academy,users.admin,'Fixture human parental conflict reviewed']);
  assert.equal(await scalar('select count(*)::int from public.legal_decisions where document_id=$1',[academyDoc]),before);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),false);
  await decide(academyDoc,users.parent,users.player);
  let revision=await scalar('select revision from public.academy_roster_entries where id=$1',[entry]);
  await query("select public.set_academy_roster_status_checked($1,$2,'active',$3)",[users.academyManager,entry,revision]);
  const stale=await scalar("select public.present_legal_document($1,$2,$3,'parent','fr')",[academyDoc,users.parent,users.player]);
  const hashes=await query('select id,content_sha256 from public.legal_versions where document_id=$1',[academyDoc]);
  const draft=(await query('select translations from public.legal_drafts where document_id=$1',[academyDoc]))[0].translations;
  for(const locale of Object.keys(draft)){draft[locale].body+=' version 2';draft[locale].source_revision=2;draft[locale].status='approved';}
  await query('update public.legal_drafts set source_revision=2,translations=$2 where document_id=$1',[academyDoc,draft]);
  await query('select public.publish_legal_draft($1,$2)',[academyDoc,users.admin]);
  await denied('select public.decide_legal_document($1,$2,$3,gen_random_uuid())',[stale,users.parent,'authorized'],/version changed/);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),false);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[sion,users.player]),true);
  assert.deepEqual(await query('select id,content_sha256 from public.legal_versions where id=$1',[hashes[0].id]),hashes);
  await decide(academyDoc,users.parent,users.player);
  revision=await scalar('select revision from public.academy_roster_entries where id=$1',[entry]);
  await query("select public.set_academy_roster_status_checked($1,$2,'active',$3)",[users.academyManager,entry,revision]);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),true);
  const relation=await scalar('select revision from public.organization_relationships where source_organization_id=$1 and target_organization_id=$2',[academy,sion]);
  await query("select public.set_academy_partnership_checked($1,$2,$3,'ended',false,false,$4)",[users.admin,academy,sion,relation]);
  await denied('select * from public.discover_academy_players_checked($1,$2,$3,$4)',[users.academyManager,academy,sion,'player']);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.player]),true);
});

test('propriétaire sportif obligatoire et notifications limitées aux droits du parent',async()=>{
  const group=await scalar("select id from public.coach_groups where club_id=$1 limit 1",[academy]);
  const event=await scalar("insert into public.club_events(club_id,group_id,created_by,event_type,title,starts_at,duration_minutes) values($1,$2,$3,'training','Fixture',now(),60) returning id",[academy,group,users.academyManager]);
  const notification=await scalar("insert into public.notifications(actor_user_id,type,kind,title,data) values($1,'coach_event_created','coach_event_created','Fixture',$2) returning id",[users.academyManager,{event_id:event,child_id:users.player}]);
  assert.equal(await scalar('select club_id from public.notifications where id=$1',[notification]),academy);
  await query('insert into public.notification_recipients(notification_id,user_id) values($1,$2)',[notification,users.externalParent]);
  assert.equal(await scalar('select count(*)::int from public.notification_recipients where notification_id=$1',[notification]),0);
  await authenticated(users.player);
  const sport=await scalar("insert into public.player_activity_events(user_id,organization_id,event_type,title,starts_at,ends_at) values($1,$2,'competition','Fixture',now(),now()+interval '1 hour') returning id",[users.player,sion]);
  await denied("update public.player_activity_events set organization_id=$1 where id=$2",[academy,sport],/immutable/);
  await db.exec("set request.headers='{\"x-activitee-organization\":\""+academy+"\"}'");
  assert.equal(await scalar('select count(*)::int from public.player_activity_events where id=$1',[sport]),0);
  await db.exec("set request.headers='{}'");
  await service();
});

test('ancien RPC golf: droit d’édition par organisation et cascade contrôlée',async()=>{
  await service();
  await query("select set_config('activitee.actor_id',$1,false)",[users.admin]);
  const round=await scalar('insert into public.golf_rounds(user_id,club_id,start_at) values($1,$2,now()) returning id',[users.player,sion]);
  await query('insert into public.golf_round_holes(round_id,hole_no,par,score) values($1,1,4,5)',[round]);
  await query('update public.player_guardian_scopes set can_edit=false where organization_id=$1 and player_id=$2 and guardian_user_id=$3',[sion,users.player,users.parent]);
  await authenticated(users.parent);
  await denied('select public.save_player_golf_hole_transactional($1,$2)',[round,{hole_no:1,par:4,score:6}],/forbidden/i);
  await service();
  await query('update public.player_guardian_scopes set can_edit=true where organization_id=$1 and player_id=$2 and guardian_user_id=$3',[sion,users.player,users.parent]);
  // A second pending academy membership must not block the Sion scorecard.
  await query("update public.organization_members set player_consent_status='pending' where organization_id=$1 and user_id=$2 and role='player'",[academy,users.player]);
  await authenticated(users.parent);
  await query('select public.save_player_golf_hole_transactional($1,$2)',[round,{hole_no:1,par:4,score:6}]);
  await query('delete from public.golf_rounds where id=$1',[round]);
  await service();
  assert.equal(await scalar('select count(*)::int from public.golf_round_holes where round_id=$1',[round]),0);
});

test('club externe: revendication sans accès, rapprochement humain sans nouveaux comptes',async()=>{
  reference=await scalar("select public.create_external_reference_checked($1,$2,'Fixture Outside','CH','VS')",[users.academyManager,academy]);
  const match=await scalar('select public.request_organization_identity_checked($1,$2,$3)',[users.academyManager,academy,'fixture.externalPlayer']);
  await denied("select public.request_academy_roster_checked($1,$2,$3,'external_club',null,$4)",[users.academyManager,academy,users.externalPlayer,reference]);
  await query('select public.review_organization_identity_checked($1,$2,true,$3)',[users.admin,match,'Human identity verified with fixture source']);
  const externalEntry=await scalar("select public.request_academy_roster_checked($1,$2,$3,'external_club',null,$4)",[users.academyManager,academy,users.externalPlayer,reference]);
  await query('select public.claim_external_club_checked($1,$2,$3)',[users.admin,reference,externalClub]);
  assert.equal(await scalar('select count(*)::int from public.organization_members where organization_id=$1 and user_id=$2',[externalClub,users.externalPlayer]),0);
  await query('select public.confirm_external_affiliation_checked($1,$2,$3,$4,$5)',[users.admin,reference,users.externalPlayer,externalClub,'Human membership verified with fixture source']);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[externalClub,users.externalPlayer]),false);
  assert.equal(await scalar('select count(*)::int from auth.users'),9);
  assert.equal(await scalar('select status from public.academy_roster_entries where id=$1',[externalEntry]),'pending');
});
test('refus parental Centre: activation interdite, affiliation Sion indépendante',async()=>{
  const externalEntry=await scalar('select id from public.academy_roster_entries where academy_id=$1 and player_id=$2',[academy,users.externalPlayer]);
  const match=await scalar('select public.request_organization_identity_checked($1,$2,$3,$4)',[users.academyManager,academy,'fixture.externalParent','parent']);
  await query('select public.review_organization_identity_checked($1,$2,true,$3)',[users.admin,match,'Fictitious verified parental identity for external fixture']);
  await query("select public.attach_academy_guardian_checked($1,$2,$3,'mother')",[users.academyManager,externalEntry,users.externalParent]);
  await decide(academyDoc,users.externalParent,users.externalPlayer,'refused');
  const revision=await scalar('select revision from public.academy_roster_entries where id=$1',[externalEntry]);
  await denied("select public.set_academy_roster_status_checked($1,$2,'active',$3)",[users.academyManager,externalEntry,revision]);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[academy,users.externalPlayer]),false);
  assert.equal(await scalar('select public.organization_actor_access($1,$2)',[sion,users.player]),true);
});
test('suppression organisation: refus avec histoire, comptes et autres affiliations préservés',async()=>{
  await denied('select public.delete_empty_organization_checked($1,$2)',[users.admin,academy],/retention/i);
  const member=await scalar("select id from public.club_members where club_id=$1 and user_id=$2 and role='parent'",[academy,users.parent]);
  await query('select public.remove_manager_parent_v1($1,$2,$3,$4,$5)',[users.academyManager,academy,member,[users.player],[users.player]]);
  assert.equal(await scalar('select count(*)::int from public.player_guardians where player_id=$1 and guardian_user_id=$2',[users.player,users.parent]),1);
  assert.equal(await scalar('select public.organization_actor_access($1,$2,$3)',[sion,users.parent,users.player]),true);
});

test('rollback refuse après une utilisation; replay et rollback vierge restaurent les fonctions', async () => {
  await service();
  await assert.rejects(() => db.exec(readFileSync('supabase/rollbacks/20261110_organization_remodel.sql','utf8')), /Rollback denied/);
  await db.exec('rollback');
  const isolated = await organizationDatabase({baselinePath});
  try {
    await isolated.exec(readFileSync('supabase/rollbacks/20261110_organization_remodel.sql','utf8'));
    assert.equal((await isolated.query("select to_regclass('public.player_guardian_scopes') as table_name")).rows[0].table_name,null);
    assert.equal((await isolated.query("select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='player_camps' and column_name='organization_id'")).rows[0].count,0);
    assert.equal((await isolated.query("select count(*)::int as count from pg_proc where proname in ('organization_view_scope','organization_sports_owner','organization_notification_owner')")).rows[0].count,0);
    assert.equal((await isolated.query("select count(*)::int as count from pg_constraint where contype='f' and confrelid='public.clubs'::regclass")).rows[0].count > 0,true);
    assert.equal((await isolated.query("select to_regprocedure('public.remove_manager_parent_v1(uuid,uuid,uuid,uuid[],uuid[])')::text as fn")).rows[0].fn.includes('remove_manager_parent_v1'),true);
  } finally { await isolated.close(); }
});

test('preuves anciennes: migration et retour arrière conservent versions, présentations et décisions',async()=>{
  let snapshots;
  const legacy=await organizationDatabase({baselinePath,beforeMigrations:async database=>{
    await database.exec("set request.jwt.claim.role='service_role'; set request.jwt.claim.sub='';");
    for(const [name,uid] of [['admin',id(81)],['player',id(82)],['parent',id(83)]]){
      await database.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid,`${name}.legacy@fixtures.invalid`]);
      await database.query('insert into public.profiles(id,first_name,last_name,birth_date,username) values($1,$2,$3,$4,$5)',[uid,name,'Legacy Fixture',name==='player'?'2012-01-01':'1980-01-01',`legacy.${name}`]);
    }
    await database.query('insert into public.app_admins(user_id) values($1)',[id(81)]);
    await database.query('insert into public.clubs(id,name,slug) values($1,$2,$3)',[id(84),'Legacy Fixture Sion','legacy-fixture-sion']);
    for(const [uid,role] of [[id(82),'player'],[id(83),'parent']])await database.query("insert into public.club_members(club_id,user_id,role,player_consent_status) values($1,$2,$3,$4)",[id(84),uid,role,role==='player'?'pending':null]);
    await database.query("insert into public.player_guardians(player_id,guardian_user_id,relation,is_primary) values($1,$2,'father',true)",[id(82),id(83)]);
    await database.exec("insert into public.legal_parent_code_control(singleton,required) values(true,false); insert into public.legal_enforcement_control(singleton,enabled) values(true,true)");
    await database.query(`insert into public.legal_documents(id,document_key,kind,purpose_key,scope,club_id,audience_roles,action_kind,required,active,applicability,created_by)
      values($1,'fixture_legacy_parent','parent_authorization','service.parent_authorization','club',$2,array['parent'],'authorize',true,true,'{"status":"approved","rule":"all_members"}',$3)`,[id(85),id(84),id(81)]);
    const translations=Object.fromEntries(['fr','en','de','it'].map(locale=>[locale,{title:'{{club_name}}',body:'Legacy fixture {{club_name}}',action_label:'OK',status:'approved',source_revision:1}]));
    await database.query('insert into public.legal_drafts(document_id,change_summary,allowed_variables,translations,updated_by) values($1,$2,$3,$4,$5)',[id(85),'Reviewed legacy fixture',['club_name'],translations,id(81)]);
    await database.query('select public.publish_legal_draft($1,$2)',[id(85),id(81)]);
    const presented=(await database.query("select public.present_legal_document($1,$2,$3,'parent','fr') as id",[id(85),id(83),id(82)])).rows[0].id;
    await database.query("select public.decide_legal_document($1,$2,'authorized',gen_random_uuid())",[presented,id(83)]);
    snapshots={};for(const table of ['legal_versions','legal_presentations','legal_decisions'])snapshots[table]=(await database.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows;
  }});
  try{
    for(const table of Object.keys(snapshots))assert.deepEqual((await legacy.query(`select to_jsonb(t)-'organization_id' as row from public.${table} t order by id`)).rows,snapshots[table]);
    assert.equal((await legacy.query('select public.organization_actor_access($1,$2) as allowed',[id(84),id(82)])).rows[0].allowed,true);
    await legacy.exec(readFileSync('supabase/rollbacks/20261110_organization_remodel.sql','utf8'));
    for(const table of Object.keys(snapshots))assert.deepEqual((await legacy.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows,snapshots[table]);
  }finally{await legacy.close();}
});
