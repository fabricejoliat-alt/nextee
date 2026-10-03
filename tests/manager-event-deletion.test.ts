/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI and service test doubles. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { messages } from '../lib/i18n/messages.ts';
import { managerDatabase, loadManagerModule } from './helpers/managerRouteHarness.ts';
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from './helpers/coachComponentHarness.ts';

const eventId='10000000-0000-0000-0000-000000000001',seriesId='20000000-0000-0000-0000-000000000001';
const request=(suffix='',token=true)=>new Request(`https://local.invalid/api/manager/events/${eventId}${suffix}`,{method:'DELETE',headers:token?{authorization:'Bearer verified-token'}:{}});
const confirmed={ok:true,deleted_event_id:eventId,deleted_events:1,events:[{id:eventId,event_type:'training',starts_at:'2090-01-02T10:00:00Z',location_text:null}],recipient_ids:['private-recipient']};

test('Manager deletion routes pass the authenticated actor and explicit occurrence to one transaction',async()=>{
  for(const series of [false,true]) {
    const state=managerDatabase({}, {rpcResult:confirmed});let notified=0;
    const route=loadManagerModule(series?'app/api/manager/events/series/[seriesId]/route.ts':'app/api/manager/events/[eventId]/route.ts',{
      ...state.mocks,'@/lib/server/coachPlanningNotifications':{notifyPlanningDeletion:async(...args:unknown[])=>{notified++;assert.equal(args[1],'manager');assert.equal(state.rpcs.length,1);}},
    });
    const response=await route.DELETE(request('?scope=occurrence&actor=spoofed'),{params:Promise.resolve(series?{seriesId}:{eventId})});
    assert.equal(response.status,200);assert.equal(state.rpcs.length,1);assert.equal(state.writes.length,0);
    assert.deepEqual(state.rpcs[0],{name:'delete_manager_planning_v1',args:{p_actor_id:'manager',p_event_id:series?null:eventId,p_series_id:series?seriesId:null,p_occurrence_confirmed:true}});
    assert.equal(notified,1);assert.ok(!(await response.text()).includes('private-recipient'));
  }
});

test('Manager deletion refuses invalid authentication and identifiers before any mutation',async()=>{
  const state=managerDatabase();const helper=loadManagerModule('lib/server/managerPlanningDeletion.ts',{
    ...state.mocks,'@/app/api/messages/_lib':{requireCaller:async()=>{throw new Error('Invalid token');}},
    '@/lib/server/coachPlanningNotifications':{notifyPlanningDeletion:async()=>assert.fail('Unexpected notification')},
  });
  assert.equal((await helper.deleteManagerPlanning(request('',false),{eventId})).status,401);
  assert.equal((await helper.deleteManagerPlanning(request(),{eventId:'invalid'})).status,400);
  assert.equal((await helper.deleteManagerPlanning(request(),{eventId})).status,401);
  assert.equal(state.rpcs.length,0);assert.equal(state.writes.length,0);
});

test('Manager deletion does not fall back to partial writes when permission or transaction fails',async()=>{
  for(const [error,status] of [[{message:'forbidden'},403],[{message:'occurrence_confirmation_required'},400],[{message:'event_not_found'},404],[{message:'private schema detail',code:'PGRST202'},503]] as const){
    const state=managerDatabase({}, {rpcError:error});const helper=loadManagerModule('lib/server/managerPlanningDeletion.ts',{
      ...state.mocks,'@/lib/server/coachPlanningNotifications':{notifyPlanningDeletion:async()=>assert.fail('Unexpected notification')},
    });
    const response=await helper.deleteManagerPlanning(request(),{eventId});
    assert.equal(response.status,status);assert.equal(state.writes.length,0);assert.equal(state.rpcs.length,1);
    assert.ok(!(await response.text()).includes('private schema detail'));
  }
});

test('Manager deletion remains confirmed if notification delivery fails, but never accepts an unconfirmed result',async()=>{
  for(const data of [confirmed,{}]){
    const state=managerDatabase({}, {rpcResult:data});const helper=loadManagerModule('lib/server/managerPlanningDeletion.ts',{
      ...state.mocks,'@/lib/server/coachPlanningNotifications':{notifyPlanningDeletion:async()=>{throw new Error('Delivery failed');}},
    });
    const response=await helper.deleteManagerPlanning(request(),{eventId});const body=await response.json();
    assert.equal(response.status,data===confirmed?200:503);
    if(data===confirmed)assert.deepEqual(body,{ok:true,deleted_event_id:eventId,deleted_events:1,notification_warning:true});else assert.equal(body.error,'planning_delete_unconfirmed');
  }
});

const snapshot=(id='event')=>({event:{id,group_id:'group',club_id:'club',series_id:'series',status:'scheduled',event_type:'training',title:id,starts_at:'2090-01-02T10:00:00Z',ends_at:'2090-01-02T11:00:00Z',duration_minutes:60,location_text:`Place ${id}`,coach_note:null,requires_evaluation:true},coach_ids:[],player_ids:[],structure:[],criterion_ids:['old-criterion'],camp_day:null,series:{id:'series',title:'Original series title',coach_note:'Original series note',event_type:'event',weekday:1,time_of_day:'10:00',interval_weeks:1,start_date:'2090-01-01',end_date:'2090-01-31',is_active:true},future:[]});
const find=(tree:Element,fn:(e:Element)=>boolean)=>{const e=elements(tree).find(fn);assert.ok(e);return e;};
const button=(tree:Element,key:string,locale:'fr'|'en'|'de'|'it'='fr')=>find(tree,e=>e.type==='button'&&textContent(e).trim()===messages[locale][key]);
async function editor(fetcher:typeof fetch,read?:(id:string)=>Promise<any>){
  const state=managerDatabase({coach_groups:[{id:'group',club_id:'club',name:'Juniors'}],clubs:[{id:'club',name:'Club'}]});
  Object.assign(state.db.auth,{getSession:async()=>({data:{session:{access_token:'test-only'}}})});
  state.db.rpc=async(name,args)=>{if(name==='get_manager_planning_snapshot_v1')return read?read(args.p_event_id):{data:snapshot(args.p_event_id),error:null};state.rpcs.push({name,args});return {data:{ok:true,recipient_ids:[]},error:null};};
  const navigation:string[]=[],params={id:'group',eventId:'event'};
  const harness=coachComponentHarness('app/manager/groups/[id]/planning/[eventId]/edit/page.tsx',{database:state.db,params,searchParams:'season=2027',fetch:fetcher,navigate:p=>navigation.push(p),modules:{'@/components/evaluations/EventCriteriaSelector':{__esModule:true,default:'criteria-selector'}}});
  harness.render();await flush();harness.render();return {harness,navigation,params,...state};
}

test('Manager occurrence deletion has explicit scope, blocks duplicate clicks and offers a planning return after a delivery warning',async()=>{
  const pending=deferred<Response>(),calls:string[]=[];const state=await editor(async(input)=>{calls.push(String(input));return pending.promise;});const previous=globalThis.window;
  Object.assign(globalThis,{window:{confirm:()=>true}});
  try {
    const handler=button(state.harness.render(),'coach.form.deleteOccurrence').props.onClick;handler();handler();await flush();
    assert.deepEqual(calls,['/api/manager/events/event?scope=occurrence']);
    pending.resolve(Response.json({ok:true,notification_warning:true}));await flush();
    for(const locale of ['fr','en','de','it'] as const){state.harness.setLocale(locale);const tree=state.harness.render();assert.ok(textContent(tree).includes(messages[locale]['manager.editor.deleteNotification']));assert.equal(button(tree,'coach.form.deleteOccurrence',locale).props.disabled,true);assert.ok(elements(tree).some(n=>n.type==='a'&&n.props.href==='/manager/groups/group/planning?season=2027'&&textContent(n).includes(messages[locale]['coach.form.backPlanning'])));}
    handler();await flush();assert.equal(calls.length,1);assert.deepEqual(state.navigation,[]);
  } finally {Object.assign(globalThis,{window:previous});state.harness.cleanup();}
});

test('Manager deletion network failure keeps the draft and unlocks controls with a translated error',async()=>{
  const state=await editor(async()=>{throw new Error('Private network details');});const previous=globalThis.window;Object.assign(globalThis,{window:{confirm:()=>true}});
  try {button(state.harness.render(),'coach.form.deleteOccurrence').props.onClick();await flush();
    const tree=state.harness.render();assert.ok(textContent(tree).includes(messages.fr['manager.editor.deleteFailed']));assert.ok(!textContent(tree).includes('Private network details'));assert.equal(button(tree,'coach.form.deleteOccurrence').props.disabled,false);assert.ok(elements(tree).some(n=>n.props.value==='Place event'));assert.deepEqual(state.navigation,[]);
  } finally {Object.assign(globalThis,{window:previous});state.harness.cleanup();}
});

test('Manager edit ignores an old response after navigation and sends the current snapshot with selected criteria',async()=>{
  const pending=deferred<any>();const state=await editor(async()=>assert.fail('Unexpected fetch'),async id=>id==='event'?pending.promise:{data:snapshot(id),error:null});
  try {
    state.params.eventId='new-event';state.harness.render();await flush();state.harness.render();
    pending.resolve({data:snapshot(),error:null});await flush();
    assert.ok(elements(state.harness.render()).some(n=>n.props.value==='Place new-event'));
    assert.ok(elements(state.harness.render()).some(n=>n.type==='select'&&n.props.value==='training'));
    assert.ok(!elements(state.harness.render()).some(n=>n.props.value==='Original series note'));
    assert.ok(!elements(state.harness.render()).some(n=>n.props.value==='Place event'));
    find(state.harness.render(),n=>n.type==='criteria-selector').props.onChange(['new-criterion']);
    button(state.harness.render(),'coach.editor.saveOccurrence').props.onClick();await flush();
    assert.equal(state.rpcs[0].args.p_event_id,'new-event');assert.deepEqual(state.rpcs[0].args.p_expected,snapshot('new-event'));assert.deepEqual(state.rpcs[0].args.p_criterion_ids,['new-criterion']);
    assert.deepEqual(state.navigation,['/manager/groups/group/planning/new-event?season=2027']);
  } finally {state.harness.cleanup();}
});
