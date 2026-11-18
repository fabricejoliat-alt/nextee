import test from 'node:test';
import assert from 'node:assert/strict';
import {managerDatabase,loadManagerModule} from './helpers/managerRouteHarness.ts';
import { checklistDoc } from './helpers/legalChecklistFixtures.ts';
const document=(club:string,rule='all_members')=>({id:`doc-${club}`,document_key:`doc-${club}`,kind:'terms',scope:'club',club_id:club,audience_roles:['coach'],action_kind:'accept',active:true,required:true,applicability:{rule}});
async function missing(documents:object[]){
 // Stub data only: no environment or database switch is changed.
 const {db}=managerDatabase({legal_enforcement_control:[{singleton:true,enabled:true}],club_members:[{user_id:'coach-a',club_id:'A',role:'coach',is_active:true}],app_admins:[],legal_documents:documents});
 return (await loadManagerModule<{loadLegalGateStatus:(db:unknown,id:string,organization:string)=>Promise<{missing:unknown[]}>}>('lib/server/legalRequirements.ts',{}).loadLegalGateStatus(db,'coach-a','A')).missing;
}
test('an unsupported required rule in club B does not block a coach only in club A',async()=>{
 assert.deepEqual(await missing([document('B','review_pending')]),[]);
});
test('an unpublished required document in club B does not block club A',async()=>{
 assert.deepEqual(await missing([document('B')]),[]);
});
test('own-club unpublished required document still fails closed',async()=>{
 await assert.rejects(()=>missing([document('A')]),/no published version/);
});
test('database switch off leaves missing actions empty without reading user documents',async()=>{
 const {db}=managerDatabase({legal_enforcement_control:[{singleton:true,enabled:false}],club_members:[],app_admins:[],legal_documents:[document('A')]});
 const requirements=loadManagerModule<{loadLegalGateStatus:(db:unknown,id:string)=>Promise<{enabled:boolean;missing:unknown[]}>}>('lib/server/legalRequirements.ts',{});
 assert.deepEqual(await requirements.loadLegalGateStatus(db,'coach-a'),{enabled:false,missing:[]});
});

test('superadmin status is exempt without loading documents or creating acceptance evidence',async()=>{
 const {db,rpcs,writes}=managerDatabase({
  legal_enforcement_control:[{singleton:true,enabled:true}],
  app_admins:[{user_id:'admin'}],
  club_members:[{user_id:'admin',club_id:'A',role:'coach',is_active:true}],
  legal_documents:[document('A','review_pending')],
 },{failureTable:'legal_documents'});
 const requirements=loadManagerModule<{loadLegalGateStatus:(db:unknown,id:string)=>Promise<{enabled:boolean;missing:unknown[]}>}>('lib/server/legalRequirements.ts',{});
 assert.deepEqual(await requirements.loadLegalGateStatus(db,'admin'),{enabled:true,missing:[]});
 assert.deepEqual(rpcs,[]);
 assert.deepEqual(writes,[]);
});

test('a failed superadmin lookup never grants an exemption',async()=>{
 const {db}=managerDatabase({legal_enforcement_control:[{singleton:true,enabled:true}]},{failureTable:'app_admins'});
 const requirements=loadManagerModule<{loadLegalGateStatus:(db:unknown,id:string)=>Promise<unknown>}>('lib/server/legalRequirements.ts',{});
 await assert.rejects(()=>requirements.loadLegalGateStatus(db,'coach-a'),/Database failure/);
});

test('every organization needs a response and an explicit refusal satisfies a consent choice', async () => {
 const docs = ['A','B'].map(club => ({...checklistDoc(`choice-${club}`,club),active:true,audience_roles:['coach']}));
 const states = [{document_id:'choice-A',beneficiary_id:'coach',club_scope:'A',version_id:'v-choice-A',decision:'refused',conflict:false}];
 const {db} = managerDatabase({legal_enforcement_control:[{singleton:true,enabled:true}],app_admins:[],
  club_members:['A','B'].map(club_id=>({user_id:'coach',club_id,role:'coach',is_active:true})),legal_documents:docs,
  legal_versions:docs.map(doc=>({...doc.version,document_id:doc.id})),legal_current_state:states}, {rpcResult:true});
 const gate=loadManagerModule('lib/server/legalRequirements.ts',{});
 assert.deepEqual((await gate.loadLegalGateStatus(db,'coach','A')).missing.map(row=>row.document_id),['choice-B']);
 states.push({document_id:'choice-B',beneficiary_id:'coach',club_scope:'B',version_id:'v-choice-B',decision:'refused',conflict:false});
 assert.deepEqual((await gate.loadLegalGateStatus(db,'coach','A')).missing,[]);
});

test('a parent cannot enter before answering a represented child consent', async () => {
 const docs=[checklistDoc('authorization-A','A','parent_authorization'),checklistDoc('choice-A','A')].map(doc=>({...doc,active:true}));
 const states=[{document_id:'choice-A',beneficiary_id:'parent',club_scope:'A',version_id:'v-choice-A',decision:'refused',conflict:false},
  {document_id:'authorization-A',beneficiary_id:'child',club_scope:'A',version_id:'v-authorization-A',decision:'authorized',conflict:false}];
 const {db}=managerDatabase({legal_enforcement_control:[{singleton:true,enabled:true}],app_admins:[],
  club_members:[{user_id:'parent',club_id:'A',role:'parent',is_active:true}],legal_documents:docs,
  legal_versions:docs.map(doc=>({...doc.version,document_id:doc.id})),legal_current_state:states,
  player_guardian_scopes:[{guardian_user_id:'parent',organization_id:'A',player_id:'child',status:'active',can_view:true,can_edit:true}],
  player_guardians:[{guardian_user_id:'parent',player_id:'child',relation:'father'}],
  organization_members:[{user_id:'parent',organization_id:'A',role:'parent',is_active:true},
   {user_id:'child',organization_id:'A',role:'player',is_active:true,player_consent_status:'granted'}],
  legal_representative_assertions:[{guardian_id:'parent',child_id:'child',club_id:'A',status:'verified'}],
  profiles:[{id:'child',first_name:'Junior',last_name:'Test'}],organizations:[{id:'A',name:'Organisation A'}],
 },{rpcResult:true});
 const gate=loadManagerModule('lib/server/legalRequirements.ts',{});
 const missing=(await gate.loadLegalGateStatus(db,'parent')).missing;
 assert.deepEqual(missing.map(row=>[row.document_id,row.beneficiary_id]),[['choice-A','child']]);
 states.push({document_id:'choice-A',beneficiary_id:'child',club_scope:'A',version_id:'v-choice-A',decision:'refused',conflict:false});
 assert.deepEqual((await gate.loadLegalGateStatus(db,'parent')).missing,[]);
});
