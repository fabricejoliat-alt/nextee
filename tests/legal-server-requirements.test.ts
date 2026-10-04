import test from 'node:test';
import assert from 'node:assert/strict';
import {managerDatabase,loadManagerModule} from './helpers/managerRouteHarness.ts';
const document=(club:string,rule='all_members')=>({id:`doc-${club}`,document_key:`doc-${club}`,kind:'terms',scope:'club',club_id:club,audience_roles:['coach'],action_kind:'accept',active:true,required:true,applicability:{rule}});
async function missing(documents:object[]){
 // Stub data only: no environment or database switch is changed.
 const {db}=managerDatabase({legal_enforcement_control:[{singleton:true,enabled:true}],club_members:[{user_id:'coach-a',club_id:'A',role:'coach',is_active:true}],app_admins:[],legal_documents:documents});
 return loadManagerModule<{loadMissingLegalActions:(db:unknown,id:string)=>Promise<unknown[]>}>('lib/server/legalRequirements.ts',{}).loadMissingLegalActions(db,'coach-a');
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
