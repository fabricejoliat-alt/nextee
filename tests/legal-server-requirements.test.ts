import test from 'node:test';
import assert from 'node:assert/strict';
import {managerDatabase,loadManagerModule} from './helpers/managerRouteHarness.ts';
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
