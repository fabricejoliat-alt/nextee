/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated component fixtures. */
import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {messages} from '../lib/i18n/messages.ts';import {managerParticipantEntries} from '../lib/i18n/managerParticipantMessages.ts';
import {coachComponentHarness,elements,textContent,flush,deferred,type Element} from './helpers/coachComponentHarness.ts';
import {managerDatabase,loadManagerModule} from './helpers/managerRouteHarness.ts';
const base='app/manager/groups/[id]/planning/[eventId]/players',edit=`${base}/[playerId]/edit/page.tsx`,view=`${base}/[playerId]/page.tsx`;
const player=(id='player')=>({id,first_name:id,last_name:'Test',handicap:12.4,avatar_url:null});
const snapshot=(id='player')=>({event:{id:'event',group_id:'group',club_id:'club',status:'scheduled',event_type:'training',starts_at:'2020-01-01T10:00Z',ends_at:'2020-01-01T11:00Z',duration_minutes:60,requires_evaluation:true},attendee:{player_id:id,status:'present',coach_recorded_status:null,coach_recorded_at:null},feedback:[{event_id:'event',player_id:id,coach_id:'manager',engagement:4,attitude:5,performance:6,visible_to_player:true,private_note:'Private draft',player_note:'Public draft'}],criteria:[{id:'criterion',snapshot_name:'Custom focus',snapshot_is_required:true,snapshot_response_format:'yes_no',snapshot_choices:[{value:true},{value:false}],snapshot_respondent:'coach'}],responses:[{event_criterion_id:'criterion',value_json:true}]});
const detail=(id='player')=>({event:snapshot(id).event,player:player(id),meId:'manager',orderedPlayerIds:['player','next'],attendanceStatus:'expected',feedback:snapshot(id).feedback[0],playerFeedback:null,session:null,sessionItems:[]});
const find=(tree:Element,fn:(n:Element)=>boolean)=>{const n=elements(tree).find(fn);assert.ok(n);return n;};
const button=(tree:Element,key:string,locale='fr')=>find(tree,n=>n.type==='button'&&textContent(n).trim()===messages[locale][key]);
async function setup(opts:{path?:string;save?:(args:any)=>Promise<any>;read?:(id:string)=>Promise<any>;snap?:any;fetch?:typeof fetch;notify?:()=>Promise<any>}={}){
 const rpcs:any[]=[],navigation:string[]=[],params={id:'group',eventId:'event',playerId:'player'};let reads=0;
 const tables=managerDatabase({clubs:[{id:'club',name:'My club'}],coach_groups:[{id:'group',name:'My group'}]});
 const h=coachComponentHarness(opts.path??edit,{params,searchParams:'season=season',navigate:p=>navigation.push(p),notify:opts.notify,
  fetch:opts.fetch??(async input=>Response.json(detail(String(input).split('/').at(-1)))),database:{from:tables.db.from,rpc:async(name,args)=>{if(name==='get_manager_evaluation_snapshot_v1'){reads++;return opts.read?opts.read(args.p_player_id):{data:opts.snap??snapshot(args.p_player_id),error:null};}rpcs.push({name,args});return opts.save?opts.save(args):{data:{ok:true,notification_required:false},error:null};}},
  modules:{'@/components/evaluations/EvaluationResponseField':{__esModule:true,default:'response-field'}}});
 h.render();await flush();h.render();return {h,rpcs,navigation,params,tables,reads:()=>reads};
}

test('participant pages resolve all labels in four languages with preserved interpolation tokens',()=>{
 for(const[key,values]of Object.entries(managerParticipantEntries))for(const locale of ['fr','en','de','it']){const tokens=(value:string)=>[...value.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(messages[locale][`manager.participant.${key}`]),tokens(values[0]));}
 for(const file of [edit,view]){const source=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,99,true,ts.ScriptKind.TSX);
  function scan(n:ts.Node){if(ts.isJsxText(n))assert.doesNotMatch(n.text,/[a-zA-ZÀ-ÿ]{2}/,`${file}: ${n.text}`);if(ts.isJsxAttribute(n)&&['label','placeholder','aria-label'].includes(n.name.getText(ast))&&n.initializer&&ts.isStringLiteral(n.initializer))assert.doesNotMatch(n.initializer.text,/[a-zA-ZÀ-ÿ]{2}/);ts.forEachChild(n,scan);}scan(ast);
  for(const[,key]of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of ['fr','en','de','it'])assert.ok(messages[locale][key],`${locale}:${key}`);
 }
});

test('presence is explicit, stays in the draft, and one click saves attendance, evaluation and criteria atomically',async()=>{
 const pending=deferred<any>(),x=await setup({save:async()=>pending.promise});
 try{assert.equal(button(x.h.render(),'manager.participant.next').props.disabled,true);assert.equal(button(x.h.render(),'manager.content.present').props['aria-pressed'],false);
  button(x.h.render(),'manager.content.present').props.onClick();assert.equal(x.rpcs.length,0);assert.equal(x.tables.writes.length,0);
  const submit=button(x.h.render(),'manager.participant.next').props.onClick;submit();submit();await flush();assert.equal(x.rpcs.length,1);
  assert.equal(x.rpcs[0].name,'save_manager_event_feedback_v2');assert.deepEqual(x.rpcs[0].args.p_expected,snapshot());assert.equal(x.rpcs[0].args.p_values.attendance,'present');assert.deepEqual(x.rpcs[0].args.p_values.responses,{criterion:true});
  pending.resolve({data:{ok:true,notification_required:false},error:null});await flush();assert.deepEqual(x.navigation,['/manager/groups/group/planning/event/players/next/edit?season=season']);
 }finally{x.h.cleanup();}
});

test('changing language preserves private notes, criteria and attendance without reloading',async()=>{
 const x=await setup();try{button(x.h.render(),'manager.content.present').props.onClick();find(x.h.render(),n=>n.type==='textarea'&&n.props.value==='Private draft').props.onChange({target:{value:'Modified private draft'}});const reads=x.reads();
  for(const locale of ['fr','en','de','it'] as const){x.h.setLocale(locale);const tree=x.h.render();assert.ok(textContent(tree).includes(messages[locale]['manager.participant.attendanceDraft']));assert.ok(elements(tree).some(n=>n.props.value==='Modified private draft'));assert.equal(find(tree,n=>n.type==='response-field').props.value,true);assert.equal(button(tree,'manager.content.present',locale).props['aria-pressed'],true);assert.equal(elements(tree).filter(n=>n.type==='h1').length,1);}
  assert.equal(x.reads(),reads);
 }finally{x.h.cleanup();}
});

test('a conflicting save keeps the full draft, unlocks controls and never sends a notification',async()=>{
 const x=await setup({save:async()=>({data:null,error:{message:'evaluation_conflict'}}),notify:async()=>assert.fail('Unexpected notification')});
 try{button(x.h.render(),'manager.content.present').props.onClick();await button(x.h.render(),'manager.participant.next').props.onClick();const tree=x.h.render();assert.ok(textContent(tree).includes(messages.fr['manager.participant.conflict']));assert.ok(elements(tree).some(n=>n.props.value==='Private draft'));assert.equal(button(tree,'manager.participant.next').props.disabled,false);assert.deepEqual(x.navigation,[]);assert.equal(x.tables.writes.length,0);}finally{x.h.cleanup();}
});

test('network or missing migration errors cannot leave the editor stuck or lose the draft',async()=>{
 for(const mode of ['network','migration','unconfirmed']){const x=await setup({save:async()=>{if(mode==='network')throw new Error('Private network detail');return mode==='migration'?{data:null,error:{code:'PGRST202'}}:{data:null,error:null};}});
  try{button(x.h.render(),'manager.content.present').props.onClick();await button(x.h.render(),'manager.participant.next').props.onClick();const tree=x.h.render();assert.equal(button(tree,'manager.participant.next').props.disabled,false);assert.ok(elements(tree).some(n=>n.props.value==='Private draft'));assert.ok(!textContent(tree).includes('Private network detail'));assert.deepEqual(x.navigation,[]);}finally{x.h.cleanup();}
 }
});

test('notification failure after confirmed save preserves success and blocks resubmission',async()=>{
 const x=await setup({save:async()=>({data:{ok:true,notification_required:true},error:null}),notify:async()=>{throw new Error('Delivery failed');}});
 try{button(x.h.render(),'manager.content.present').props.onClick();const submit=button(x.h.render(),'manager.participant.next').props.onClick;await submit();const tree=x.h.render();assert.ok(textContent(tree).includes(messages.fr['coach.error.planningNotification']));assert.equal(button(tree,'manager.participant.next').props.disabled,true);await submit();assert.equal(x.rpcs.length,1);assert.ok(elements(tree).some(n=>n.props.href==='/manager/groups/group/planning/event/players/player?season=season'&&textContent(n).includes(messages.fr['coach.editor.viewSaved'])));}finally{x.h.cleanup();}
});

test('future, cancelled and evaluation-disabled activities cannot be saved',async()=>{
 for(const patch of [{ends_at:'2099-01-01T11:00Z'},{status:'cancelled'},{requires_evaluation:false}]){const snap=snapshot();Object.assign(snap.event,patch);const x=await setup({snap});try{const tree=x.h.render();assert.equal(button(tree,'manager.content.present').props.disabled,true);assert.equal(button(tree,'manager.participant.next').props.disabled,true);assert.ok(textContent(tree).includes(messages.fr['manager.participant.unavailable']));}finally{x.h.cleanup();}}
});

test('an old participant response cannot replace the next participant or its criteria',async()=>{
 const pending=deferred<any>(),x=await setup({read:async id=>id==='player'?pending.promise:{data:snapshot(id),error:null}});
 try{x.params.playerId='next';x.h.render();await flush();x.h.render();pending.resolve({data:snapshot(),error:null});await flush();const tree=x.h.render();assert.ok(textContent(tree).includes('next Test'));assert.ok(!textContent(tree).includes('player Test'));button(tree,'manager.content.present').props.onClick();await button(x.h.render(),'manager.participant.close').props.onClick();assert.equal(x.rpcs[0].args.p_player_id,'next');}finally{x.h.cleanup();}
});

test('participant detail uses the scoped endpoint, propagates errors, and keeps season navigation in every locale',async()=>{
 const x=await setup({path:view});try{for(const locale of ['fr','en','de','it'] as const){x.h.setLocale(locale);const tree=x.h.render();assert.ok(textContent(tree).includes(messages[locale]['manager.participant.noSession']));assert.ok(textContent(tree).includes(messages[locale]['manager.planning.expected']));assert.ok(elements(tree).some(n=>n.props.href==='/manager/groups/group/planning/event?season=season'));}}finally{x.h.cleanup();}
 for(const response of [()=>Response.json({error:'Forbidden'},{status:403}),()=>Response.json({...detail(),event:{...detail().event,group_id:'other'}})]){const x=await setup({path:view,fetch:async()=>response()});try{const tree=x.h.render();assert.ok(elements(tree).some(n=>n.props.role==='alert'));assert.ok(!textContent(tree).includes('Private draft'));}finally{x.h.cleanup();}}
});

test('legacy participants URL redirects to the activity with the season preserved',async()=>{
 let destination='';const page=loadManagerModule(`${base}/page.tsx`,{'next/navigation':{redirect:(path:string)=>{destination=path;}}});await page.default({params:Promise.resolve({id:'group',eventId:'event'}),searchParams:Promise.resolve({season:'2027'})});assert.equal(destination,'/manager/groups/group/planning/event?season=2027');
});
