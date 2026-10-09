import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {loadManagerModule} from './helpers/managerRouteHarness.ts';
function fixture(code:string|null) {
 const db=createClient('https://test.invalid','fixture-key',{auth:{persistSession:false},global:{fetch:async()=>code
  ? Response.json({code,message:'Internal details must not leak'},{status:404})
  : Response.json({contact_email:'fixture@example.invalid',updated_at:'2026-10-09T12:00:00Z'})}});
 const handlers=loadManagerModule<{GET:(r:Request)=>Promise<Response>;PUT:(r:Request)=>Promise<Response>}>('app/api/admin/contact-settings/route.ts',{
  '@/lib/server/adminAudit':{withAdminMutationAudit:(handler:unknown)=>handler},
  'next/server':{NextResponse:{json:Response.json}},
  '@/lib/server/legalAccess':{legalDb:()=>db,legalAdmin:async()=>({id:'00000000-0000-4000-8000-000000000001'}),legalNoStore:{'Cache-Control':'private, no-store'}}
 });
 return (method:'GET'|'PUT')=>handlers[method](new Request('http://test.invalid/api/admin/contact-settings',{method,...(method==='PUT'?{body:JSON.stringify({contact_email:'fixture@example.invalid'})}:{})}));
}
test('missing contact table returns the same actionable error on loading and saving without internal details',async()=>{
 for(const code of ['PGRST205','42P01'])for(const method of ['GET','PUT'] as const){
  const response=await fixture(code)(method);const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.code,'CONTACT_SETTINGS_NOT_INSTALLED');
  assert.ok(!JSON.stringify(body).includes('Internal details'));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
});
test('contact update succeeds with the installed dependency; other failures retain a generic message',async()=>{
 assert.equal((await fixture(null)('PUT')).status,200);
 const response=await fixture('42501')('PUT');
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Enregistrement impossible.'});
});
