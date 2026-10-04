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
   const result=url.pathname.endsWith('legal_documents')?{id:'fixture',active:false,required_locales:['fr','en','de','it']}:
     method==='GET'?{document_id:'fixture',source_revision:3,translations:{fr:translation}}:[{document_id:'fixture'}];
   return Response.json(result);
 }}});
 const handler=loadManagerModule<{POST:(r:Request)=>Promise<Response>}>('app/api/admin/legal/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},'@/lib/server/legalAccess':{legalDb:()=>db,legalAdmin:async()=>({id:'admin'}),legalNoStore:{'Cache-Control':'private, no-store'}}
 });
 return {requests,post:(body:object)=>handler.POST(new Request('http://test.invalid/api/admin/legal',{method:'POST',body:JSON.stringify({document_id:'fixture',locale:'fr',...body})}))};
}
test('saving text serializes the JSON concurrency filter for real PostgREST request construction',async()=>{
 const r=route();const response=await r.post({operation:'save_translation',expected_revision:3,title:'Revised',body:'Fixture v2',action_label:'Test'});
 assert.equal(response.status,200);const write=r.requests.find(r=>r.method==='PATCH')!;
 const filter=write.url.searchParams.get('translations')!;assert.deepEqual(JSON.parse(filter.slice(3)),{fr:translation});
 assert.equal((write.body.translations as {fr:{status:string}}).fr.status,'needs_review');
});
test('approval rejects text modified since the reviewer opened it and performs no write',async()=>{
 const r=route();const response=await r.post({operation:'approve_translation',expected_revision:3,expected_translation:{...translation,body:'An earlier text'}});
 assert.equal(response.status,409);assert.equal(r.requests.filter(r=>r.method==='PATCH').length,0);
});
test('approval without a reviewed snapshot is denied for an old client',async()=>{
 const r=route();assert.equal((await r.post({operation:'approve_translation'})).status,409);
 assert.equal(r.requests.filter(r=>r.method==='PATCH').length,0);
});
test('approval records exactly the reviewed text and preserves optimistic concurrency',async()=>{
 const r=route();const response=await r.post({operation:'approve_translation',expected_revision:3,expected_translation:translation});
 assert.equal(response.status,200);const write=r.requests.find(r=>r.method==='PATCH')!;
 assert.deepEqual(JSON.parse(write.url.searchParams.get('translations')!.slice(3)),{fr:translation});
 assert.equal((write.body.translations as {fr:{body:string;approved_by:string}}).fr.body,translation.body);
 assert.equal((write.body.translations as {fr:{approved_by:string}}).fr.approved_by,'admin');
});
