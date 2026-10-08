import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const statePath=process.env.ACTIVITEE_ORG_FIXTURE_STATE;
if(!statePath)throw new Error('Set ACTIVITEE_ORG_FIXTURE_STATE to the local disposable fixture file');
const state=JSON.parse(readFileSync(statePath,'utf8'));
const app=process.env.ACTIVITEE_ORG_APP_URL??'http://127.0.0.1:3011';
let personalTrainingId;
const rest=process.env.ACTIVITEE_ORG_REST_URL??'http://127.0.0.1:4008/rest/v1';
for(const url of [app,rest])if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('This suite is restricted to localhost fixtures');
async function request(url,actor,body,method=body?'POST':'GET'){
 const response=await fetch(url,{method,headers:{Authorization:`Bearer ${state.tokens[actor]??state.keys[actor]}`,apikey:state.keys.anon,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'manual'});
 let data;try{data=await response.json();}catch{data=null;}
 return {status:response.status,data};
}
test('PostgREST: le manager académie lit son roster et ses relations explicites',async()=>{
 const result=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/roster`,'academyManager');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.roster.length,2);assert.equal(result.data.partners.length,1);
 assert.equal(result.data.organization.org_type,'academy');
 assert.equal(result.data.groups.length,1);
 const embedded=await request(`${rest}/coach_groups?select=id,clubs:organizations!coach_groups_club_id_fkey(id,name)&id=eq.${state.group}`,'coach');
 assert.equal(embedded.status,200,JSON.stringify(embedded.data));assert.equal(embedded.data[0].clubs.id,state.organizations.Centre);
});
test('API: org falsifiée refusée même avec un player_id connu',async()=>{
 const result=await request(`${app}/api/manager/organizations/${state.organizations.Sion}/roster`,'academyManager');assert.equal(result.status,403);
 const write=await request(`${app}/api/manager/organizations/${state.organizations.Sion}/roster`,'academyManager',{action:'request',player_id:state.users.player.id,origin_type:'no_declared_club'});assert.equal(write.status,403);
});
test('PostgREST: jointure familiale composite avec droits organisationnels',async()=>{
 const result=await request(`${rest}/player_guardian_scopes?select=player_id,guardian_user_id,identity:player_guardians(relation,is_primary)&organization_id=eq.${state.organizations.Centre}`,'parent');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.length,1);assert.equal(result.data[0].identity.relation,'father');
});
test('PostgREST: aucun roster tiers et aucune écriture client sensible',async()=>{
 const result=await request(`${rest}/academy_roster_entries?select=id`,'outsider');assert.equal(result.status,200);assert.deepEqual(result.data,[]);
 const write=await request(`${rest}/academy_roster_entries?id=eq.${state.entry}`,'parent',{status:'active'},'PATCH');assert.equal(write.status,403);
 const rpc=await request(`${rest}/rpc/approve_academy_source_checked`,'parent',{p_actor:state.users.admin.id,p_entry:state.entry,p_expected_revision:1,p_approve:true});assert.equal(rpc.status,403);
});
test('API: affiliation Sion disponible, Centre encore bloqué indépendamment',async()=>{
 const result=await request(`${app}/api/legal/status`,'parent');assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.organizations.find(row=>row.organization_id===state.organizations.Sion).accessible,true);
 assert.equal(result.data.organizations.find(row=>row.organization_id===state.organizations.Centre).accessible,false);
 const documents=await request(`${app}/api/player/documents?organization_id=${state.organizations.Centre}&child_id=${state.users.player.id}`,'parent');assert.equal(documents.status,403,JSON.stringify(documents.data));
});
test('API: recherche partenaire limitée, avec refus d’un club sans lien',async()=>{
 const result=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/discovery?club=${state.organizations.Sion}&q=player`,'academyManager');assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.players.length,1);
 const other=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/discovery?club=${state.organizations.External}&q=player`,'academyManager');assert.equal(other.status,403);
});
test('API: préparation des invitations dérivée des seuls droits du Centre',async()=>{
 const result=await request(`${app}/api/manager/clubs/${state.organizations.Centre}/access-invitations`,'academyManager');assert.equal(result.status,200,JSON.stringify(result.data));
});
test('API: club reçoit une demande sans accéder aux contenus de l’académie',async()=>{
 const result=await request(`${app}/api/manager/organizations/${state.organizations.Sion}/roster`,'sionManager');assert.equal(result.status,200);assert.equal(result.data.requests.length,1);assert.equal(result.data.roster.length,0);
});
test('API Coach: aucun accès au junior en attente, même avec une affectation de groupe',async()=>{
 for(const path of ['private-notes','validations','training-volume-summary','training-volume-level','training-volume-weekly-targets']){
  const result=await request(`${app}/api/coach/players/${state.users.player.id}/${path}?organization_id=${state.organizations.Centre}`,'coach');
  assert.equal(result.status,403,`${path}: ${JSON.stringify(result.data)}`);
 }
 const own=await request(`${app}/api/legal/status`,'coach');assert.equal(own.status,200);assert.equal(own.data.organizations.find(row=>row.organization_id===state.organizations.Centre).accessible,true);
});
test('PostgREST: les mutations de membres sont refusées au client et restent contrôlées côté serveur',async()=>{
 const forged=await request(`${rest}/organization_members?user_id=eq.${state.users.player.id}`,'academyManager',{is_active:true},'PATCH');assert.equal(forged.status,403);
 const helper=await request(`${rest}/rpc/request_organization_identity_checked`,'parent',{p_actor:state.users.admin.id,p_org:state.organizations.Centre,p_username:'fixture.player',p_kind:'parent'});assert.equal(helper.status,403);
});
test('API: affiliations externes réutilisées, Centre actif et nouveau club encore bloqué',async()=>{
 const result=await request(`${app}/api/legal/status`,'externalParent');assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.organizations.find(row=>row.organization_id===state.organizations.Centre).accessible,true);
 assert.equal(result.data.organizations.find(row=>row.organization_id===state.organizations.External).accessible,false);
 const foreign=await request(`${app}/api/player/validations?child_id=${state.users.externalPlayer.id}&organization_id=${state.organizations.External}`,'externalParent');assert.equal(foreign.status,403);
});
test('API: création contrôlée sans doublon de parent et sans décision juridique implicite',async()=>{
 const count=async table=>{const r=await request(`${rest}/${table}?select=*`,'service');assert.equal(r.status,200);return r.data.length;};
 const before=await count('profiles'),proofs=await count('legal_decisions');
 const nonce=Date.now().toString(36);
 const family={action:'provision',player:{first_name:`Provision ${nonce}`,last_name:'Fixture',birth_date:'2014-05-08'},parent:{first_name:'Parent provision',last_name:'Fixture',email:`provision.parent.${nonce}@fixtures.invalid`},relation:'mother'};
 const created=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/external`,'academyManager',family);
 assert.equal(created.status,201,JSON.stringify(created.data)); assert.equal(await count('profiles'),before+2);
 const roster=await request(`${rest}/academy_roster_entries?id=eq.${created.data.id}&select=player_id,status`,'service');
 assert.equal(roster.data[0].status,'pending');assert.equal(await count('legal_decisions'),proofs);
 const duplicate=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/external`,'academyManager',family);
 assert.equal(duplicate.status,409);assert.equal(await count('profiles'),before+2);
 const duplicateParent=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/external`,'academyManager',{...family,player:{...family.player,first_name:`Another provision ${nonce}`}});
 assert.equal(duplicateParent.status,409);assert.equal(await count('profiles'),before+2);
 const review=await request(`${rest}/rpc/request_organization_identity_checked`,'service',{p_actor:state.users.academyManager.id,p_org:state.organizations.Centre,p_username:created.data.guardian_username,p_kind:'parent'});
 assert.equal(review.status,200,JSON.stringify(review.data));
 const approved=await request(`${rest}/rpc/review_organization_identity_checked`,'service',{p_actor:state.users.admin.id,p_match:review.data,p_approve:true,p_evidence:'Fixture parent identity checked with both families'});
 assert.equal(approved.status,204,JSON.stringify(approved.data));
 const scoped=await request(`${rest}/player_guardian_scopes?player_id=eq.${roster.data[0].player_id}&select=guardian_user_id`,'service');
 const sibling=await request(`${app}/api/manager/organizations/${state.organizations.Centre}/external`,'academyManager',{...family,player:{...family.player,first_name:`Sibling provision ${nonce}`},guardian_id:scoped.data[0].guardian_user_id});
 assert.equal(sibling.status,201,JSON.stringify(sibling.data));assert.equal(await count('profiles'),before+3);assert.equal(await count('legal_decisions'),proofs);
});

test('API: progression globale ne révèle aucun joueur en attente ou hors affectation Coach',async()=>{
 const result=await request(`${app}/api/coach/validations?organization_id=${state.organizations.Centre}`,'coach');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.player_count,0);
});
test('API/PostgREST: historique personnel dans Sion, Centre en attente refusé, aucune attribution',async()=>{
 const training=await request(`${rest}/training_sessions`,'player',{user_id:state.users.player.id,start_at:new Date().toISOString(),session_type:'individual',notes:'Personal HTTP fixture',total_minutes:60});
 assert.equal(training.status,201,JSON.stringify(training.data));
 const created=await request(`${rest}/training_sessions?user_id=eq.${state.users.player.id}&notes=eq.Personal%20HTTP%20fixture&select=id,club_id`,'service');
 assert.equal(created.data.length,1); assert.equal(created.data[0].club_id,null); personalTrainingId = created.data[0].id;
 const history=await request(`${app}/api/player/trainings?organization_id=${state.organizations.Sion}`,'player');
 assert.equal(history.status,200,JSON.stringify(history.data)); assert.ok(JSON.stringify(history.data).includes(created.data[0].id));
 const pending=await request(`${app}/api/player/trainings?organization_id=${state.organizations.Centre}`,'player');assert.equal(pending.status,403,JSON.stringify(pending.data));
 const forgery=await request(`${app}/api/player/trainings?child_id=${state.users.player.id}&organization_id=${state.organizations.Sion}`,'outsider');assert.equal(forgery.status,403);
});
test('API: validation globale conservée après activation légale du second contexte',async()=>{
 const section=crypto.randomUUID(),exercise=crypto.randomUUID();
 assert.equal((await request(`${rest}/validation_sections`,'service',{id:section,slug:'http-personal-fixture',name:'HTTP fixture',sort_order:1})).status,201);
 assert.equal((await request(`${rest}/validation_exercises`,'service',{id:exercise,section_id:section,sequence_no:1,name:'HTTP personal exercise'})).status,201);
 const recorded=await request(`${app}/api/player/validations/attempts?organization_id=${state.organizations.Sion}`,'player',{exercise_id:exercise,result:'success',note:'Global HTTP fixture'});
 assert.equal(recorded.status,200,JSON.stringify(recorded.data));
 const stored=await request(`${rest}/player_validation_attempts?id=eq.${recorded.data.attempt_id}&select=organization_id,player_id`,'service');
 assert.equal(stored.data[0].organization_id,null); assert.equal(stored.data[0].player_id,state.users.player.id);
 const approve=await request(`${rest}/rpc/approve_academy_source_checked`,'service',{p_actor:state.users.sionManager.id,p_entry:state.entry,p_expected_revision:1,p_approve:true});assert.equal(approve.status,204,JSON.stringify(approve.data));
 const presentation=await request(`${rest}/rpc/present_legal_document`,'service',{p_document:state.docs.Centre,p_actor:state.users.parent.id,p_beneficiary:state.users.player.id,p_role:'parent',p_locale:'fr'});assert.equal(presentation.status,200,JSON.stringify(presentation.data));
 const decision=await request(`${rest}/rpc/decide_legal_document`,'service',{p_presentation:presentation.data,p_actor:state.users.parent.id,p_decision:'authorized',p_key:crypto.randomUUID()});assert.equal(decision.status,200,JSON.stringify(decision.data));
 const revision=await request(`${rest}/academy_roster_entries?id=eq.${state.entry}&select=revision`,'service');
 const activate=await request(`${rest}/rpc/set_academy_roster_status_checked`,'service',{p_actor:state.users.academyManager.id,p_entry:state.entry,p_status:'active',p_expected_revision:revision.data[0].revision});assert.equal(activate.status,204,JSON.stringify(activate.data));
 for(const org of [state.organizations.Sion,state.organizations.Centre]) {
  const progression=await request(`${app}/api/player/validations?organization_id=${org}`,'player');assert.equal(progression.status,200,JSON.stringify(progression.data));assert.ok(JSON.stringify(progression.data).includes(recorded.data.attempt_id));
  const history=await request(`${app}/api/player/trainings?organization_id=${org}`,'player');assert.equal(history.status,200,JSON.stringify(history.data));assert.ok(JSON.stringify(history.data).includes(personalTrainingId));
 }
 const coach=await request(`${app}/api/coach/validations?organization_id=${state.organizations.Centre}`,'coach');assert.equal(coach.status,200,JSON.stringify(coach.data));assert.equal(coach.data.player_count,1);
});
