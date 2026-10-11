import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMinorJunior } from '../lib/juniorWarnings.ts';
import { loadManagerModule, managerDatabase, managerRequest } from './helpers/managerRouteHarness.ts';

test('minor warning uses birthday, rejects unknown, invalid and future dates',()=>{
  const today=new Date(2026,9,11);
  assert.equal(isMinorJunior('2008-10-12',today),true);
  assert.equal(isMinorJunior('2008-10-11',today),false);
  assert.equal(isMinorJunior('2014-10-11',today),true);
  for(const date of [null,'','2020-02-30','2030-01-01'])assert.equal(isMinorJunior(date,today),false);
});

test('detail member scope retains parents, excludes other juniors and cannot cross organizations',async()=>{
  const {db,mocks}=managerDatabase({
    club_members:[{id:'junior',club_id:'club',user_id:'player',role:'player'},{id:'parent',club_id:'club',user_id:'guardian',role:'parent'},{id:'other',club_id:'club',user_id:'other-player',role:'player'},{id:'foreign',club_id:'foreign',user_id:'foreign-player',role:'player'}],
    profiles:[{id:'player',first_name:'Junior'},{id:'guardian',first_name:'Parent'}],
  });
  Object.assign(db,{schema:()=>({from:()=>({select:()=>({in:async()=>({data:[],error:null})})})})});
  const route=loadManagerModule('app/api/manager/clubs/[clubId]/members/route.ts',{
    ...mocks,'@/lib/server/managerAccess':{requireManagerClub:async()=>({ok:true}),isPlatformAccount:()=>false},
  });
  const ctx={params:Promise.resolve({clubId:'club'})};
  const result=await route.GET(new Request('http://localhost/api/manager/clubs/club/members?member_id=junior'),ctx);
  assert.equal(result.status,200,await result.clone().text());
  assert.deepEqual((await result.json()).members.map((row:{id:string})=>row.id),['junior','parent']);
  const foreign=await route.GET(new Request('http://localhost/api/manager/clubs/club/members?member_id=foreign'),ctx);
  assert.equal(foreign.status,404);
  const full=await route.GET(managerRequest('GET'),ctx);
  assert.equal((await full.json()).members.length,3);
});
