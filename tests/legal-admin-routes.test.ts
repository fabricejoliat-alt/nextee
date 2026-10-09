import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {loadManagerModule} from './helpers/managerRouteHarness.ts';
const translation={title:'Fixture',body:'Texte fictif',action_label:'Test',source_revision:3,status:'needs_review'};
function route() {
 const requests:Array<{url:URL;method:string;body:Record<string,unknown>}> = [];
 const db=createClient('https://test.invalid','fixture-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
   const url=new URL(String(input));const method=init?.method??'GET';const body=init?.body?JSON.parse(String(init.body)):{};
   requests.push({url,method,body});
   const result=url.pathname.endsWith('legal_documents')?{id:'fixture',document_key:'activitee_autorisation_parentale_sion',purpose_key:'service.parent_authorization',scope:'club',active:false,required_locales:['fr','en','de','it']}:
     url.pathname.endsWith('save_legal_draft_text_checked')?{fixture:4}:
     url.pathname.endsWith('approve_legal_draft_translation_checked')?true:
     method==='GET'?{document_id:'fixture',source_revision:3,translations:{fr:translation}}:[{document_id:'fixture'}];
   return Response.json(result);
 }}});
 const handler=loadManagerModule<{POST:(r:Request)=>Promise<Response>}>('app/api/admin/legal/route.ts',{
  '@/lib/server/adminAudit':{withAdminMutationAudit:(handler:unknown)=>handler},
  'next/server':{NextResponse:{json:Response.json}},'@/lib/server/legalAccess':{legalDb:()=>db,legalAdmin:async()=>({id:'admin'}),legalNoStore:{'Cache-Control':'private, no-store'}}
 });
 return {requests,post:(body:object)=>handler.POST(new Request('http://test.invalid/api/admin/legal',{method:'POST',body:JSON.stringify({document_id:'fixture',locale:'fr',...body})}))};
}
test('saving text sends the exact draft snapshot in the RPC body rather than a long URL filter',async()=>{
 const r=route();const response=await r.post({operation:'save_translation',expected_revision:3,title:'Revised',body:'Fixture v2',action_label:'Test'});
 assert.equal(response.status,200);const write=r.requests.find(r=>r.url.pathname.endsWith('save_legal_draft_text_checked'))!;
 assert.equal(write.method,'POST');assert.equal(write.url.searchParams.has('translations'),false);
 assert.deepEqual(write.body.p_expected,{fixture:{source_revision:3,translations:{fr:translation}}});
 assert.equal(write.body.p_group_purpose,null);
});
test('approval rejects text modified since the reviewer opened it and performs no write',async()=>{
 const r=route();const response=await r.post({operation:'approve_translation',expected_revision:3,expected_translation:{...translation,body:'An earlier text'}});
 assert.equal(response.status,409);assert.equal(r.requests.filter(r=>r.url.pathname.endsWith('approve_legal_draft_translation_checked')).length,0);
});
test('approval without a reviewed snapshot is denied for an old client',async()=>{
 const r=route();assert.equal((await r.post({operation:'approve_translation'})).status,409);
 assert.equal(r.requests.filter(r=>r.url.pathname.endsWith('approve_legal_draft_translation_checked')).length,0);
});
test('approval records exactly the reviewed text and preserves optimistic concurrency',async()=>{
 const r=route();const response=await r.post({operation:'approve_translation',expected_revision:3,expected_translation:translation});
 assert.equal(response.status,200);const write=r.requests.find(r=>r.url.pathname.endsWith('approve_legal_draft_translation_checked'))!;
 assert.equal(write.method,'POST');assert.equal(write.url.searchParams.has('translations'),false);
 assert.deepEqual(write.body.p_expected,translation);
 assert.equal(write.body.p_actor,'admin');
});
test('shared club save carries all reviewed snapshots for one purpose',async()=>{
 const r=route();const expected={fixture:{source_revision:3,translations:{fr:translation}},other:{source_revision:3,translations:{fr:translation}}};
 const response=await r.post({operation:'save_translation',expected_revision:3,group_purpose:'service.parent_authorization',expected_drafts:expected,title:'Shared',body:'Fictional',action_label:'Test'});
 assert.equal(response.status,200);
 const write=r.requests.find(r=>r.url.pathname.endsWith('save_legal_draft_text_checked'))!;
 assert.deepEqual(write.body.p_expected,expected);
 assert.equal(write.body.p_group_purpose,'service.parent_authorization');
});
test('global activation requires a prior state and uses the service-only RPC',async()=>{
 const r=route();
 assert.equal((await r.post({operation:'set_enforcement',enabled:true})).status,400);
 assert.equal(r.requests.filter(item=>item.url.pathname.endsWith('set_legal_activation')).length,0);
 assert.equal((await r.post({operation:'set_enforcement',enabled:true,expected_enabled:false})).status,200);
 const write=r.requests.find(item=>item.url.pathname.endsWith('set_legal_activation'))!;
 assert.deepEqual(write.body,{p_target:'enforcement',p_document:null,p_enabled:true,
  p_expected:false,p_expected_version:null,p_actor:'admin'});
});
test('document activation carries the version the Admin inspected',async()=>{
 const r=route();
 assert.equal((await r.post({operation:'set_document_active',enabled:true,expected_enabled:false,expected_version:'v1'})).status,200);
 const write=r.requests.find(item=>item.url.pathname.endsWith('set_legal_activation'))!;
 assert.equal(write.body.p_target,'document');
 assert.equal(write.body.p_document,'fixture');
 assert.equal(write.body.p_expected_version,'v1');
});
test('audience configuration cannot claim a legal review through an old operation',async()=>{
 const r=route();
 assert.equal((await r.post({operation:'review_rule',note:'Fictional legal review',configuration:{status:'approved'}})).status,400);
 assert.equal((await r.post({operation:'configure_audience',expected:{status:'unapproved'}})).status,200);
 assert.equal(r.requests.filter(item=>item.url.pathname.endsWith('review_legal_applicability')).length,0);
});
