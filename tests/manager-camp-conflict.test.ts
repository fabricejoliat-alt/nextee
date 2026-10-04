import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadManagerModule} from './helpers/managerRouteHarness.ts';

test('camp stale versions preserve a 409 response for current and legacy SQL codes without retrying',async()=>{
 const {saveManagerCamp}=loadManagerModule<{saveManagerCamp:(db:SupabaseClient,actor:string,camp:string,club:string,body:Record<string,unknown>)=>Promise<{status:number;data:{error:string}}>}>('lib/server/managerCampSave.ts',{
  '@/app/api/camps/_lib':{localDateTimeInputToIso:(v:string)=>v},
  '@/lib/server/managerMutationError':{managerMutationError:()=>({status:500,error:'unexpected fallback'})},
 });
 for(const code of ['PT409','40001']){
  let calls=0;
  const db={rpc:async()=>{calls++;return {error:{code,message:'camp_conflict'}}}} as unknown as SupabaseClient;
  const result=await saveManagerCamp(db,'fixture-manager','fixture-camp','fixture-club',{days:[]});
  assert.equal(result.status,409);assert.match(result.data.error,/changé/);assert.equal(calls,1);
 }
});
