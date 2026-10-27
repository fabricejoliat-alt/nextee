import test from 'node:test';import assert from 'node:assert/strict';
import{loadManagerModule,managerDatabase}from'./helpers/managerRouteHarness.ts';
const errors=loadManagerModule('lib/server/organizationAccess.ts',{'next/server':{NextResponse:{json:Response.json}},'@/lib/server/legalAccess':{legalNoStore:{}}});
test('missing consent, player documents and source approval have specific translated refusal keys',async()=>{
 for(const[message,key]of[['Academy authorization required','parentAuthorizationRequired'],['Legal action required','playerLegalActionRequired'],['Source approval required','sourceApprovalRequired']]){
  const h=managerDatabase({academy_roster_entries:[{id:'entry',academy_id:'academy'}]},{rpcError:{code:'P0001',message}});
  const route=loadManagerModule('app/api/manager/organizations/[organizationId]/roster/route.ts',{'@/lib/server/organizationAccess':{...errors,organizationActor:async()=>({db:h.db,actor:{id:'manager'}})}});
  const response=await route.POST(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'status',entry_id:'entry',status:'active',expected_revision:1})}),{params:Promise.resolve({organizationId:'academy'})});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'organization.'+key);assert.deepEqual(h.writes,[]);assert.equal(h.rpcs[0].name,'set_academy_roster_status_checked');
 }
});
test('stale revisions and unrecognized database messages retain the safe generic response',async()=>{
 for(const error of[{code:'40001',message:'Roster changed'},{code:'P0001',message:'private diagnostic'},{code:'42501',message:'Forbidden'},{code:'XX000',message:'Academy authorization required'}]){
  const response=errors.organizationRosterFailure(error);assert.equal((await response.json()).error,'organization.operationFailed');
 }
});
