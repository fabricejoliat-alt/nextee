import assert from 'node:assert/strict';import test from 'node:test';
import{loadManagerModule,managerDatabase}from'./helpers/managerRouteHarness.ts';
function fixture(){
 const h=managerDatabase({club_members:[{club_id:'sion',user_id:'manager',role:'manager',is_active:true},{club_id:'academy',user_id:'manager',role:'manager',is_active:true},{club_id:'inactive',user_id:'manager',role:'manager',is_active:false}],club_camps:[{id:'sion-camp',club_id:'sion',title:'Club camp',head_coach_user_id:null},{id:'academy-camp',club_id:'academy',title:'Academy camp',head_coach_user_id:null},{id:'foreign-camp',club_id:'foreign',title:'Private camp',head_coach_user_id:null}],organizations:[{id:'sion',name:'Sion'},{id:'academy',name:'Academy'}]});
 const route=loadManagerModule('app/api/manager/camps/route.ts',{...h.mocks,'@/app/api/camps/_lib':{createAdminClient:()=>h.db,getCaller:async()=>({userId:'manager'}),uniq:(a:unknown[])=>[...new Set(a.filter(Boolean))],normalizeText:(v:unknown)=>String(v??'').trim()},'@/lib/server/managerCampSave':{}});
 const get=(query:string)=>route.GET(new Request('https://test.invalid/api/manager/camps'+query,{headers:{authorization:'Bearer test'}}));return{h,get};
}
test('a manager of both a club and academy receives only the selected organization camps',async()=>{
 const {get,h}=fixture();for(const club of['sion','academy']){const r=await get('?club_id='+club);assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data.camps.map((c:{club_id:string})=>c.club_id),[club]);}assert.deepEqual(h.writes,[]);
});
test('foreign and inactive organization scopes are rejected rather than falling back to all camps',async()=>{
 const {get,h}=fixture();for(const club of['foreign','inactive','invalid'])assert.equal((await get('?club_id='+club)).status,403);assert.deepEqual(h.writes,[]);assert.deepEqual(h.rpcs,[]);
});
test('camp versions and camp lookups remain limited to the chosen organization',async()=>{
 const {get,h}=fixture();const r=await get('?club_id=academy&camp_id=sion-camp');assert.equal(r.status,200);assert.deepEqual((await r.json()).camps,[]);assert.deepEqual(h.rpcs[0].args.p_club_ids,['academy']);
});
test('existing unscoped camp-detail callers retain their authorized set',async()=>{
 const {get}=fixture();const r=await get('');assert.equal(r.status,200);assert.deepEqual((await r.json()).camps.map((c:{id:string})=>c.id),['sion-camp','academy-camp']);
});
