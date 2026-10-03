/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated test doubles. */
import assert from 'node:assert/strict';
import { messages } from "../lib/i18n/messages.ts";
import test from 'node:test';
import { managerDatabase, loadManagerModule, managerFixture, managerRequest } from './helpers/managerRouteHarness.ts';
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from './helpers/coachComponentHarness.ts';
import { remapCampDayReferences } from '../lib/campsManagement.ts';

const path='app/manager/groups/[id]/planning/[eventId]/edit/page.tsx';
const profile={id:'player',first_name:'Junior',last_name:'Test',handicap:12};
const planning=()=>({event:{id:'event',group_id:'group',club_id:'club',series_id:null as string|null,status:'scheduled',event_type:'training',title:'Weekly',
  starts_at:'2090-01-02T10:00:00Z',ends_at:'2090-01-02T11:00:00Z',duration_minutes:60,location_text:'Practice',coach_note:null,requires_evaluation:false},
  coach_ids:['coach'],player_ids:['player'],structure:[],criterion_ids:[],camp_day:null as null|{camp_id:string},series:null as any,future:[]});
async function editor(save:(name:string,args:any)=>Promise<any>, snapshot=planning()) {
  const context=managerDatabase({coach_groups:[{id:'group',club_id:'club',name:'Juniors'}],clubs:[{id:'club',name:'Club'}],
    club_members:[{user_id:'player',role:'player',club_id:'club',is_active:true},{user_id:'coach',role:'coach',club_id:'club',is_active:true}],
    profiles:[profile,{...profile,id:'coach'}],coach_group_players:[{group_id:'group',player_user_id:'player',profiles:profile}]});
  context.db.rpc=async(name,args)=>{
    if(name==='get_manager_planning_snapshot_v1')return {data:snapshot,error:null};
    context.rpcs.push({name,args});return save(name,args);
  };
  const navigation:string[]=[];
  const harness=coachComponentHarness(path,{database:context.db,params:{id:'group',eventId:'event'},fetch:async()=>{throw new Error('Unexpected HTTP write');},navigate:p=>navigation.push(p),
    modules:{'@/components/evaluations/EventCriteriaSelector':{__esModule:true,default:'criteria-selector'}}});
  harness.render();await flush();harness.render();
  return {harness,navigation,...context};
}
const find=(tree:Element,fn:(e:Element)=>boolean)=>{const e=elements(tree).find(fn);assert.ok(e);return e;};
const button=(tree:Element,label:string)=>find(tree,e=>e.type==='button'&&textContent(e).trim()===label);
const ok=()=>Promise.resolve({data:{ok:true,recipient_ids:[]},error:null});

test('Manager editor uses one transactional call and blocks a double click',async()=>{
  const pending=deferred<any>();const state=await editor(()=>pending.promise);
  try {
    const submit=button(state.harness.render(),'Enregistrer cette occurrence').props.onClick;
    submit();submit();await flush();assert.equal(state.rpcs.length,1);assert.equal(state.writes.length,0);
    assert.equal(state.rpcs[0].name,'update_manager_event_occurrence_v1');
    assert.deepEqual(state.rpcs[0].args.p_expected,planning());assert.deepEqual(state.rpcs[0].args.p_player_ids,['player']);
    pending.resolve(await ok());await flush();assert.deepEqual(state.navigation,['/manager/groups/group/planning/event']);
    assert.equal(button(state.harness.render(),'Enregistrer cette occurrence').props.disabled,true);
  } finally {state.harness.cleanup();}
});

test('planning conflict keeps the draft without legacy mutations or navigation',async()=>{
  const state=await editor(async()=>({data:null,error:{message:'planning_conflict'}}));
  try {
    find(state.harness.render(),e=>e.type==='input'&&e.props.value==='Practice').props.onChange({target:{value:'Draft'}});
    button(state.harness.render(),'Enregistrer cette occurrence').props.onClick();await flush();
    assert.ok(textContent(state.harness.render()).includes(messages.fr["coach.error.planningConflict"]));
    assert.ok(elements(state.harness.render()).some(e=>e.props.value==='Draft'));
    assert.equal(state.writes.length,0);assert.deepEqual(state.navigation,[]);
    assert.equal(button(state.harness.render(),'Enregistrer cette occurrence').props.disabled,false);
  }finally{state.harness.cleanup();}
});

test('Manager recurrence submits the loaded series snapshot and never writes other group events',async()=>{
  const snapshot=planning();snapshot.event.series_id='series';snapshot.series={id:'series',weekday:1,time_of_day:'10:00',interval_weeks:1,start_date:'2090-01-01',end_date:'2090-01-31',is_active:true};
  const state=await editor(ok,snapshot);const previous=globalThis.window;
  Object.assign(globalThis,{window:{confirm:()=>true}});
  try{
    const radios=elements(state.harness.render()).filter(e=>e.type==='input'&&e.props.name==='edit-scope');radios[1].props.onChange();
    button(state.harness.render(),'Enregistrer la récurrence').props.onClick();await flush();
    assert.equal(state.rpcs[0].name,'update_manager_event_series_v1');assert.deepEqual(state.rpcs[0].args.p_expected,snapshot);
    assert.equal(state.rpcs[0].args.p_timezone,Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(state.writes.length,0);assert.deepEqual(state.navigation,['/manager/groups/group/planning']);
  }finally{Object.assign(globalThis,{window:previous});state.harness.cleanup();}
});

test('camp-backed occurrence opens the complete camp editor',async()=>{
  const snapshot=planning();snapshot.camp_day={camp_id:'camp'};const state=await editor(ok,snapshot);
  assert.deepEqual(state.navigation,['/manager/camps/new?campId=camp']);assert.equal(state.writes.length,0);state.harness.cleanup();
});

test('season endpoint uses verified actor and reports transactional failure without partial API writes',async()=>{
  const state=managerDatabase(managerFixture(),{rpcError:{code:'PGRST202',message:'Internal function missing'}});
  const route=loadManagerModule('app/api/manager/clubs/[clubId]/seasons/route.ts',state.mocks);
  const response=await route.POST(managerRequest('POST',{name:'2027',starts_on:'2027-01-01',ends_on:'2027-12-31',is_current:true}),{params:Promise.resolve({clubId:'A'})});
  assert.equal(response.status,503);assert.equal(state.writes.length,0);assert.equal(state.rpcs[0].name,'create_manager_season_v1');
  assert.equal(state.rpcs[0].args.p_actor,'manager');assert.ok(!(await response.text()).includes('Internal function'));
});

test('camp create and edit explain a missing head coach on a draft with days without writing',async()=>{
  const state=managerDatabase(managerFixture());
  const body={club_id:'club',title:'Draft',status:'draft',days:[{starts_at:'2090-02-01T09:00',ends_at:'2090-02-01T10:00'}]};
  for(const [file,method] of [['app/api/manager/camps/route.ts','POST'],['app/api/manager/camps/[campId]/route.ts','PATCH']]){
    const route=loadManagerModule(file,state.mocks);
    const response=await route[method](managerRequest(method,body),{params:Promise.resolve({campId:'camp'})});
    assert.equal(response.status,400);assert.match((await response.json()).error,/head coach.*journée/);
  }
  assert.equal(state.rpcs.length,0);assert.equal(state.writes.length,0);
});

test('camp API validates all dates before RPC and forwards a single atomic save with edit version',async()=>{
  const state=managerDatabase(managerFixture(),{rpcResult:{ok:true,camp_id:'camp'}});
  const helper=loadManagerModule('lib/server/managerCampSave.ts',state.mocks);
  const body={title:'Camp',status:'scheduled',edit_version:'loaded-version',days:[{starts_at:'2090-02-01T09:00',ends_at:'2090-02-01T10:00'}],options:[]};
  assert.equal((await helper.saveManagerCamp(state.db,'manager','camp','club',{...body,days:[{starts_at:'invalid',ends_at:'invalid'}]})).status,400);
  assert.equal(state.rpcs.length,0);
  assert.equal((await helper.saveManagerCamp(state.db,'manager','camp','club',body)).status,200);
  assert.equal(state.rpcs.length,1);assert.equal(state.rpcs[0].args.p_expected_version,'loaded-version');
  assert.equal(state.rpcs[0].args.p_values.days[0].starts_at,'2090-02-01T08:00:00.000Z');assert.equal(state.writes.length,0);
});

test('camp concurrent response and history conflicts produce actionable errors',async()=>{
  for(const [error,pattern] of [[{code:'40001',message:'camp_conflict'},/dernières réponses/],[{code:'23000',message:'camp_history_removal'},/historique/]] as const){
    const state=managerDatabase({}, {rpcError:error});const helper=loadManagerModule('lib/server/managerCampSave.ts',state.mocks);
    const result=await helper.saveManagerCamp(state.db,'manager','camp','club',{days:[]});assert.equal(result.status,409);assert.match(result.data.error,pattern);
  }
});

test('moving or removing a camp day keeps attendance and option choices attached to that day',()=>{
  const a={id:'day-a'},b={id:'day-b'},c={id:'day-c'};
  const registrations={junior:{day_status_by_day_index:{0:'absent',1:'present',2:'excused'}}};const options=[{name:'Lunch',day_indexes:[0,2]}];
  const moved=remapCampDayReferences([a,b,c],[c,a,b],registrations,options);
  assert.deepEqual(moved.registrations.junior.day_status_by_day_index,{0:'excused',1:'absent',2:'present'});assert.deepEqual(moved.options[0].day_indexes,[0,1]);
  const removed=remapCampDayReferences([a,b,c],[a,c],registrations,options);
  assert.deepEqual(removed.registrations.junior.day_status_by_day_index,{0:'absent',1:'excused'});assert.deepEqual(removed.options[0].day_indexes,[0,1]);
});
