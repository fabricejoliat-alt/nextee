import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

function fixture(performance = true) {
  const org = '10000000-0000-4000-8000-000000000001';
  const tables:Record<string,Row[]> = {
    club_members:[{id:'member',club_id:org,user_id:'player',role:'player',is_active:true,is_performance:performance}],
    profiles:[{id:'player',handicap:14}],
    organizations:[{id:org,name:'Club'}], coach_groups:[{id:'group',club_id:org,name:'Group'}],
    training_sessions:[
      {id:'complete',user_id:'player',club_id:null,start_at:'2026-01-01',motivation:0,difficulty:3,satisfaction:4,club_event_id:null},
      {id:'unrated',user_id:'player',club_id:null,start_at:'2026-01-02',motivation:3,difficulty:null,satisfaction:4,club_event_id:null},
      {id:'zero-minutes',user_id:'player',club_id:null,start_at:'2026-01-03',motivation:3,difficulty:3,satisfaction:4,club_event_id:null},
      {id:'foreign',user_id:'player',club_id:'foreign',start_at:'2026-01-01',club_event_id:null},
    ],
    training_session_items:[{id:'1',session_id:'complete',minutes:30,category:'putting'},{id:'2',session_id:'unrated',minutes:30},{id:'3',session_id:'zero-minutes',minutes:0}],
    club_events:[
      {id:'required',club_id:org,group_id:'group',event_type:'training',starts_at:'2026-01-04',ends_at:'2026-01-04',status:'scheduled',requires_evaluation:true},
      {id:'optional',club_id:org,event_type:'training',starts_at:'2026-01-04',status:'scheduled',requires_evaluation:false},
      {id:'future',club_id:org,event_type:'training',starts_at:'2099-01-01',status:'scheduled',requires_evaluation:true},
      {id:'camp',club_id:org,event_type:'camp',starts_at:'2026-01-04',status:'scheduled',requires_evaluation:true},
      {id:'foreign-event',club_id:'foreign',event_type:'training',starts_at:'2026-01-04',status:'scheduled',requires_evaluation:true},
    ],
    club_event_attendees:['required','optional','future','camp','foreign-event'].map(event_id=>({event_id,player_id:'player',status:'present'})),
    club_camp_days:[{id:'day',event_id:'camp',camp_id:'cancelled'}], club_camps:[{id:'cancelled',club_id:org,status:'cancelled'}],
  };
  const {db,mocks} = managerDatabase(tables);
  const original = db.from.bind(db);
  const itemBatches:string[][]=[];
  db.from = ((table:string)=>{
    const query=original(table), originalIn=query.in.bind(query);
    query.in=(key:string,values:unknown[])=>{if(table==='training_session_items'&&key==='session_id')itemBatches.push(values as string[]);return originalIn(key,values)};
    return Object.assign(query,{or:()=>query.in('id',(tables[table]??[]).filter(row=>row.club_id==null||row.club_id===org).map(row=>row.id))});
  }) as typeof db.from;
  const route=loadManagerModule<{GET:(req:Request)=>Promise<Response>}>('app/api/player/golf-data/route.ts',{
    ...mocks,
    '@/lib/server/personalHistoryAccess':{canReadPlayerHistory:async()=>true},
    '@/app/api/player/access':{
      bearerTokenFromRequest:(req:Request)=>req.headers.get('Authorization'),
      resolveAuthenticatedPlayerAccess:async({accessToken}:{accessToken:string})=>{
        if(accessToken!=='permitted')throw Object.assign(new Error('Forbidden'),{status:403});
        return {supabaseAdmin:db,actorUserId:'player',subjectPlayerId:'player',organizationIds:[org],viewerRole:'player'};
      },
      playerAccessErrorStatus:(error:{status?:number})=>error.status??500,
    },
  });
  return {route,itemBatches};
}
const request=(view:string)=>new Request(`http://localhost/api/player/golf-data?view=${view}`,{headers:{Authorization:'permitted'}});

test('optimized pending reads preserve zero ratings, incomplete structure, authorization and cancelled camps',async()=>{
  const {route,itemBatches}=fixture();
  const response=await route.GET(request('pending'));
  assert.equal(response.status,200,await response.clone().text());
  const data=await response.json();
  assert.deepEqual(data.rows.map((row:Row)=>row.id),['required','zero-minutes','unrated']);
  assert.ok(!JSON.stringify(data).includes('foreign'));
  assert.deepEqual(itemBatches,[['complete','zero-minutes']]);
});

test('basic mode avoids structure reads and dashboard still retains all items',async()=>{
  const basic=fixture(false),response=await basic.route.GET(request('pending'));
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).rows,[]);
  assert.deepEqual(basic.itemBatches,[]);
  const {route}=fixture(),dashboard=await route.GET(request('dashboard'));
  assert.equal(dashboard.status,200,await dashboard.clone().text());
  assert.equal((await dashboard.json()).items.length,3);
});

test('unauthorized golf reads return no history',async()=>{
  const {route}=fixture(),response=await route.GET(new Request('http://localhost/api/player/golf-data?view=pending'));
  assert.equal(response.status,403);
});
