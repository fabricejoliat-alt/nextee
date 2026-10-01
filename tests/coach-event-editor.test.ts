import assert from "node:assert/strict";
import test from "node:test";
import { coachEventEditSnapshot, coachEventSaveErrorKey } from "../lib/coachEventEditor.ts";
import { messages } from "../lib/i18n/messages.ts";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";

const page="app/coach/groups/[id]/planning/[eventId]/edit/page.tsx";
const profile={id:"player",first_name:"Junior",last_name:"Témoin",handicap:12,avatar_url:null};
const coach={...profile,id:"coach",first_name:"Coach"};
function detail() {
  return {event:{id:"event",group_id:"group",club_id:"club",event_type:"training",title:"Occurrence title",
    starts_at:"2020-01-01T10:00:00Z",ends_at:"2020-01-01T11:00:00Z",duration_minutes:60,location_text:"Old place",
    coach_note:"Occurrence note",series_id:null as string|null,status:"scheduled"},
    attendees:[{player_id:"player",status:"absent",profile}],selectedCoachIds:["coach"],
    structureItems:[{category:"putting",minutes:30,note:"Original structure",position:0}],
    campDay:null as Record<string,unknown>|null,groupName:"Groupe témoin",clubName:"Club témoin"};
}
type Result={data:unknown;error:unknown};
function database(save:(args:Record<string,unknown>)=>Promise<Result>, opts:{permission?:boolean;series?:unknown;historical?:boolean;expectedRpc?:string}={}) {
  const writes:string[]=[];let reads=0;
  return {writes,get reads(){return reads;},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      if(name==='can_manage_assigned_group') return {data:opts.permission??true,error:null};
      writes.push(name);assert.equal(name,opts.expectedRpc??'update_coach_event_occurrence_v1');return save(args);
    },
    from(table:string){
      let data:unknown=[];
      if(table==='coach_groups') data={id:'group',club_id:'club',name:'Groupe témoin',head_coach_user_id:'coach'};
      if(table==='clubs') data={name:'Club témoin'};
      if(table==='club_members') data=[{user_id:'coach',role:'coach'},...(opts.historical?[]:[{user_id:'player',role:'player'}])];
      if(table==='profiles') data=[profile,coach];
      if(table==='coach_group_coaches') data=[{coach_user_id:'coach',profiles:coach}];
      if(table==='coach_group_players') data=opts.historical?[]:[{player_user_id:'player',profiles:profile}];
      if(table==='club_event_series') data=opts.series??null;
      const query={select(){return query;},eq(){return query;},in(){return query;},order(){return query;},range(){return query;},maybeSingle(){return query;},
        insert(){throw new Error('Unexpected direct insert');},delete(){throw new Error('Unexpected direct delete');},update(){throw new Error('Unexpected direct update');},
        then(resolve:(value:Result)=>unknown){reads++;return Promise.resolve({data,error:null}).then(resolve);}};
      return query;
    }};
}
const find=(tree:Element,predicate:(node:Element)=>boolean)=>{const node=elements(tree).find(predicate);assert.ok(node);return node;};
const button=(tree:Element,label:string)=>find(tree,node=>node.type==='button'&&textContent(node).trim()===label);
const saveButton=(tree:Element,locale:'fr'|'en'|'de'|'it'='fr')=>button(tree,messages[locale]['coach.editor.saveOccurrence']);
const location=(tree:Element,value='Old place')=>find(tree,node=>node.type==='input'&&node.props.value===value);
const ok=async()=>({data:{ok:true,recipient_ids:[]},error:null});
async function init(db:ReturnType<typeof database>, data=detail(), options:{notify?:(input:unknown)=>Promise<unknown>;params?:Record<string,string>}={}) {
  const navigation:string[]=[];let fetches=0;
  const harness=coachComponentHarness(page,{params:options.params??{id:'group',eventId:'event'},database:db,
    fetch:async()=>{fetches++;return Response.json(data);},navigate:path=>navigation.push(path),notify:options.notify});
  harness.render();await flush();harness.render();
  return {harness,navigation,get fetches(){return fetches;}};
}

test('occurrence edit sends one atomic save, blocks double-clicks and never deletes/reinserts from the browser',async()=>{
  const pending=deferred<Result>();let payload:Record<string,unknown>|undefined;
  const db=database(async args=>{payload=args;return pending.promise;});const {harness,navigation}=await init(db);
  try {
    location(harness.render()).props.onChange({target:{value:'Draft place'}});
    const submit=saveButton(harness.render()).props.onClick;submit();submit();await flush();
    const tree=harness.render();assert.equal(location(tree,'Draft place').props.disabled,true);
    button(tree,'Supprimer cette occurrence').props.onClick(); // Must not reach window.confirm or DELETE.
    assert.deepEqual(db.writes,['update_coach_event_occurrence_v1']);
    assert.equal((payload?.p_changes as Record<string,unknown>).location_text,'Draft place');
    assert.deepEqual(payload?.p_expected,coachEventEditSnapshot(detail()));
    assert.deepEqual(payload?.p_player_ids,['player']);
    pending.resolve(await ok());await flush();
    assert.deepEqual(navigation,['/coach/groups/group/planning/event']);
    assert.equal(saveButton(harness.render()).props.disabled,true);
  } finally {harness.cleanup();}
});

test('save errors retain drafts and translate in four languages without reloading or leaking database text',async()=>{
  for(const error of [{message:'planning_conflict'},{message:'evaluated_attendee_removal'},{code:'PGRST202',message:'private SQL'},{message:'private SQL'}]) {
    const db=database(async()=>({data:null,error}));const state=await init(db);const {harness}=state;
    try {
      location(harness.render()).props.onChange({target:{value:'Draft place'}});
      saveButton(harness.render()).props.onClick();await flush();const reads=db.reads;
      for(const locale of ['fr','en','de','it'] as const){
        harness.setLocale(locale);const tree=harness.render();
        assert.equal(location(tree,'Draft place').props.value,'Draft place');
        assert.ok(textContent(tree).includes(messages[locale][coachEventSaveErrorKey(error)]));
        assert.ok(!textContent(tree).includes('private SQL'));
        assert.equal(saveButton(tree,locale).props.disabled,false);
      }
      assert.equal(db.reads,reads);assert.equal(state.fetches,1);assert.equal(db.writes.length,1);
    } finally {harness.cleanup();}
  }
});

test('a thrown transport failure releases the lock, keeps drafts and does not notify',async()=>{
  let notifications=0;
  const db=database(async()=>{throw new Error('private network detail');});
  const {harness,navigation}=await init(db,detail(),{notify:async()=>{notifications++;}});
  try {
    location(harness.render()).props.onChange({target:{value:'Draft place'}});
    saveButton(harness.render()).props.onClick();await flush();
    assert.ok(textContent(harness.render()).includes(messages.fr['coach.error.planningSave']));
    assert.equal(location(harness.render(),'Draft place').props.value,'Draft place');
    assert.equal(notifications,0);assert.deepEqual(navigation,[]);
    saveButton(harness.render()).props.onClick();await flush();assert.equal(db.writes.length,2);
  }finally{harness.cleanup();}
});

test('a committed save with failed notifications cannot be submitted again',async()=>{
  const notified:unknown[]=[];
  const db=database(async()=>({data:{ok:true,recipient_ids:['eligible-only']},error:null}));
  const {harness,navigation}=await init(db,detail(),{notify:async input=>{notified.push(input);throw new Error('notification detail');}});
  try{
    location(harness.render()).props.onChange({target:{value:'Draft place'}});
    saveButton(harness.render()).props.onClick();await flush();
    for(const locale of ['fr','en','de','it'] as const){
      harness.setLocale(locale);const tree=harness.render();
      assert.ok(textContent(tree).includes(messages[locale]['coach.error.planningNotification']));
      assert.equal(saveButton(tree,locale).props.disabled,true);saveButton(tree,locale).props.onClick();
      assert.ok(elements(tree).some(node=>node.type==='a'&&textContent(node)===messages[locale]['coach.editor.viewSaved']));
    }
    assert.deepEqual((notified[0] as {recipientUserIds:string[]}).recipientUserIds,['eligible-only']);
    assert.equal(db.writes.length,1);assert.deepEqual(navigation,[]);
  }finally{harness.cleanup();}
});

test('recurring occurrence retains its own title and note instead of the series template',async()=>{
  const data=detail();data.event.series_id='series';let payload:Record<string,unknown>|undefined;
  const db=database(async args=>{payload=args;return ok();},{series:{id:'series',group_id:'group',club_id:'club',event_type:'training',title:'Series title',coach_note:'Series note',
    weekday:1,time_of_day:'18:00:00',interval_weeks:1,start_date:'2020-01-01',end_date:'2099-01-01',is_active:true}});
  const {harness}=await init(db,data);
  try{
    assert.ok(elements(harness.render()).some(node=>node.type==='textarea'&&node.props.value==='Occurrence note'));
    saveButton(harness.render()).props.onClick();await flush();
    assert.equal((payload?.p_changes as Record<string,unknown>).title,'Occurrence title');
    assert.equal((payload?.p_changes as Record<string,unknown>).coach_note,'Occurrence note');
  }finally{harness.cleanup();}
});

test('historical participants remain selected when they are no longer group or active club members',async()=>{
  let payload:Record<string,unknown>|undefined;
  const db=database(async args=>{payload=args;return ok();},{historical:true});const {harness}=await init(db);
  try{
    assert.ok(textContent(harness.render()).includes('Junior Témoin'));
    saveButton(harness.render()).props.onClick();await flush();assert.deepEqual(payload?.p_player_ids,['player']);
  }finally{harness.cleanup();}
});

test('camp occurrence leaves its managed participant roster untouched',async()=>{
  const data=detail();data.event.event_type='camp';data.campDay={camp_id:'camp',day_index:0,starts_at:data.event.starts_at,ends_at:data.event.ends_at,location_text:'Old place'};
  let payload:Record<string,unknown>|undefined;
  const db=database(async args=>{payload=args;return ok();});const {harness}=await init(db,data);
  try{saveButton(harness.render()).props.onClick();await flush();assert.equal(payload?.p_player_ids,null);
    assert.deepEqual((payload?.p_expected as {camp_day:unknown}).camp_day,data.campDay);
  }finally{harness.cleanup();}
});

test('wrong-group routes and revoked planning rights cannot expose a save action',async()=>{
  for(const wrongGroup of [false,true]){
    const db=database(ok,{permission:wrongGroup});const data=detail();if(wrongGroup)data.event.group_id='foreign';
    const {harness}=await init(db,data);
    try{assert.ok(!elements(harness.render()).some(node=>node.type==='button'&&textContent(node)===messages.fr['coach.editor.saveOccurrence']));
      assert.equal(db.writes.length,0);
    }finally{harness.cleanup();}
  }
});

test('an old load cannot replace the next occurrence after a route change',async()=>{
  const pending=deferred<Response>();const params={id:'group',eventId:'old'};const db=database(ok);
  const harness=coachComponentHarness(page,{params,database:db,fetch:async url=>String(url).endsWith('/old')?pending.promise:Response.json(detail())});
  try{
    harness.render();await flush();params.eventId='event';harness.render();await flush();
    assert.equal(saveButton(harness.render()).props.disabled,false);
    const old=detail();old.event.id='old';old.event.location_text='Stale place';
    pending.resolve(Response.json(old));await flush();
    assert.ok(!elements(harness.render()).some(node=>node.type==='input'&&node.props.value==='Stale place'));
    assert.equal(location(harness.render()).props.value,'Old place');
  }finally{harness.cleanup();}
});

test('an old save response cannot navigate away from or disable the next occurrence',async()=>{
  const pending=deferred<Result>();const params={id:'group',eventId:'event'};const navigation:string[]=[];
  const db=database(async()=>pending.promise);
  const harness=coachComponentHarness(page,{params,database:db,navigate:path=>navigation.push(path),fetch:async()=>{
    const current=detail();current.event.id=params.eventId;return Response.json(current);
  }});
  try{
    harness.render();await flush();saveButton(harness.render()).props.onClick();await flush();
    params.eventId='next';harness.render();await flush();
    assert.equal(saveButton(harness.render()).props.disabled,false);
    pending.resolve(await ok());await flush();
    assert.equal(saveButton(harness.render()).props.disabled,false);
    assert.ok(!textContent(harness.render()).includes(messages.fr['coach.editor.saved']));
    assert.deepEqual(navigation,[]);
  }finally{harness.cleanup();}
});

test('edit deletion requires confirmation, serializes the request and leaves uncertain outcomes locked',async()=>{
  const pending=deferred<Response>(), writes:string[]=[], navigation:string[]=[];
  const harness=coachComponentHarness(page,{params:{id:'group',eventId:'event'},database:database(ok),navigate:path=>navigation.push(path),
    fetch:async(url,init)=>{if(init?.method==='DELETE'){writes.push(String(url));return pending.promise;}return Response.json(detail());}});
  try{
    harness.render();await flush();button(harness.render(),messages.fr['coach.form.deleteOccurrence']).props.onClick();
    assert.equal(writes.length,0);let tree=harness.render();
    const dialog=find(tree,node=>node.type==='dialog');assert.ok(textContent(dialog).includes(messages.fr['coach.planning.deleteOccurrenceHint']));
    const confirm=button(dialog,messages.fr['coach.planning.deleteConfirmOccurrence']).props.onClick;confirm();confirm();await flush();
    find(harness.render(),node=>node.type==='dialog').props.onClose();assert.ok(elements(harness.render()).some(node=>node.type==='dialog'));
    assert.deepEqual(writes,['/api/coach/events/event?scope=occurrence']);
    pending.resolve(Response.json({error:'private SQL'},{status:503}));await flush();tree=harness.render();
    assert.ok(textContent(tree).includes(messages.fr['coach.error.planningDelete']));assert.ok(!textContent(tree).includes('private SQL'));
    assert.equal(button(tree,messages.fr['coach.planning.deleteConfirmOccurrence']).props.disabled,true);assert.deepEqual(navigation,[]);
  }finally{harness.cleanup();}
});

test('edit deletion treats a delivery warning as a completed deletion without repeating the write',async()=>{
  let writes=0;const navigation:string[]=[];
  const harness=coachComponentHarness(page,{params:{id:'group',eventId:'event'},database:database(ok),navigate:path=>navigation.push(path),
    fetch:async(_url,init)=>{if(init?.method==='DELETE'){writes++;return Response.json({ok:true,notification_warning:true});}return Response.json(detail());}});
  try{
    harness.render();await flush();button(harness.render(),messages.fr['coach.form.deleteOccurrence']).props.onClick();
    button(harness.render(),messages.fr['coach.planning.deleteConfirmOccurrence']).props.onClick();await flush();
    const tree=harness.render();assert.ok(textContent(tree).includes(messages.fr['coach.error.deletionNotification']));
    button(tree,messages.fr['coach.planning.deleteConfirmOccurrence']).props.onClick();await flush();assert.equal(writes,1);assert.deepEqual(navigation,[]);
  }finally{harness.cleanup();}
});

test('series edit needs an explicit confirmation and a committed save cannot be resubmitted after notification failure',async()=>{
  const data=detail();data.event.series_id='series';let notices=0;
  const db=database(async()=>({data:{ok:true},error:null}),{expectedRpc:'update_coach_event_series_v1',series:{id:'series',group_id:'group',club_id:'club',
    weekday:1,time_of_day:'18:00:00',interval_weeks:1,start_date:'2020-01-01',end_date:'2099-01-01',is_active:true}});
  const {harness,navigation}=await init(db,data,{notify:async()=>{notices++;throw new Error('private notification detail');}});
  try{
    find(harness.render(),node=>node.type==='select'&&node.props.value==='occurrence').props.onChange({target:{value:'series'}});
    button(harness.render(),messages.fr['coach.editor.saveSeries']).props.onClick();assert.equal(db.writes.length,0);
    const dialog=find(harness.render(),node=>node.type==='dialog');assert.ok(textContent(dialog).includes(messages.fr['coach.form.seriesConfirmHint']));
    button(dialog,messages.fr['coach.editor.saveSeries']).props.onClick();await flush();
    assert.equal(db.writes.length,1);assert.equal(notices,1);assert.deepEqual(navigation,[]);
    assert.equal(button(harness.render(),messages.fr['coach.editor.saveSeries']).props.disabled,true);
  }finally{harness.cleanup();}
});

test('editor uses the same Manager section order and keeps camp registration management separate',async()=>{
  for (const camp of [false,true]) {
    const data=detail(); if(camp){data.event.event_type='camp';data.campDay={camp_id:'camp',day_index:0};}
    const {harness}=await init(database(ok),data);
    try {
      const nodes=elements(harness.render());
      assert.equal(nodes.filter(node=>node.type==='h1').length,1);
      assert.deepEqual(nodes.filter(node=>node.type==='h2').map(textContent).map(value=>value.trim()),
        (camp?['information','structure','coaches','participants']:['information','structure','coaches','players','guests']).map(key=>messages.fr[`coach.form.${key}`]));
      assert.ok(nodes.some(node=>node.type==='nav'&&node.props['aria-label']===messages.fr['common.breadcrumb']));
      assert.ok(nodes.some(node=>node.type==='a'&&node.props.href==='/coach/groups/group/planning'&&textContent(node).includes(messages.fr['coach.form.backPlanning'])));
    } finally {harness.cleanup();}
  }
});
