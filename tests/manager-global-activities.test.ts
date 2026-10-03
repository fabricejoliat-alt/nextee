import assert from "node:assert/strict";
import test from "node:test";
import { messages } from "../lib/i18n/messages.ts";
import { managerActivityEntries } from "../lib/i18n/managerActivityMessages.ts";
import { coachComponentHarness, elements, textContent, flush, deferred, type Element } from "./helpers/coachComponentHarness.ts";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from "./helpers/managerRouteHarness.ts";
const page = "app/manager/events/new/page.tsx";
const find = (tree: Element, test: (node: Element) => boolean) => { const node = elements(tree).find(test); assert.ok(node); return node; };
const button = (tree: Element, key: string) => find(tree, node => node.type === "button" && textContent(node).trim() === messages.fr[`manager.activityForm.${key}`]);
const field = (tree: Element, key: string, type = "input") => find(find(tree,node => node.type === "label" && textContent(node).trim() === messages.fr[`manager.activityForm.${key}`]), node => node.type === type);
const data = { clubs: [{id:"A",name:"Club A"},{id:"B",name:"Club B"}], groups:[{id:"group",name:"Test group",club_id:"A"}],players:[{id:"player",club_id:"A",name:"Junior",birth_date:"2018-01-01"}],coaches:[{id:"coach",club_id:"A",name:"Test coach",birth_date:null}],group_players:[{group_id:"group",player_id:"player"}],group_coaches:[{group_id:"group",coach_id:"coach"}] };
async function init(send: (body: string) => Promise<Response>, edit = false) {
 const requests:string[] = [], navigation:string[] = [], reads:string[] = [];
 const harness = coachComponentHarness(page,{fetch:async(url,options)=>{
  if (options?.method === "POST" || options?.method === "PATCH") { requests.push(String(options.body)); return send(String(options.body)); }
  reads.push(String(url));return Response.json(String(url).endsWith("/create") ? data : { event:{id:"event",club_id:"A",title:"Existing",starts_at:"2090-07-09T22:00Z",ends_at:"2090-07-10T21:59:59Z"},player_ids:["player"],coach_ids:[],snapshot:{event:{id:"event"}},reminder:{status:"sent",message_template:"User text",scheduled_for:"2090-07-01T07:00Z",channel:"email"} });
 }, modules:{"@/components/evaluations/EventCriteriaSelector":{__esModule:true,default:"criteria-selector"},"next/navigation":{useSearchParams:()=>new URLSearchParams(edit ? "event=event" : ""),useRouter:()=>({push:(path:string)=>navigation.push(path),refresh:()=>{}})}}});
 harness.render();await flush();harness.render();harness.render();
 if (!edit) { field(harness.render(),"competitionName").props.onChange({target:{value:"Draft"}});harness.render(); }
 return {harness,requests,navigation,reads};
}

test("global activity form retains draft, manual roster and edited reminder across all four languages",async()=>{
 const {harness,reads}=await init(async()=>{throw Error("Unexpected write");});
 try {
  field(harness.render(),"scheduleReminder").props.onChange({target:{checked:true}});harness.render();
  field(harness.render(),"reminderText","textarea").props.onChange({target:{value:"User-authored reminder"}});
  button(harness.render(),"clearAll").props.onClick();harness.render();
  for(const locale of ["en","de","it","fr"] as const){harness.setLocale(locale);harness.render();const tree=harness.render();assert.ok(textContent(tree).includes(messages[locale]["manager.activityForm.competitionName"]));assert.ok(elements(tree).some(x=>x.props.value==="Draft"));assert.ok(elements(tree).some(x=>x.props.value==="User-authored reminder"));const picker=elements(tree).find(x=>x.props.label===messages[locale]["manager.activityForm.players"]);assert.equal(picker?.props.selected.size,0);}
  assert.equal(reads.length,1);
 }finally{harness.cleanup();}
});

test("global creation prevents double clicks, freezes unknown outcomes and retries the identical request",async()=>{
 const pending=deferred<Response>();let tries=0;const {harness,requests,navigation}=await init(async()=>++tries===1?pending.promise:Response.json({ok:true,firstEventId:"saved",replayed:true,notificationWarning:true}));
 try {
  const submit=button(harness.render(),"create").props.onClick;submit();submit();await flush();assert.equal(requests.length,1);
  pending.resolve(Response.json({}));await flush();harness.render();assert.ok(textContent(harness.render()).includes(messages.fr["manager.activityForm.error.unconfirmed"]));
  assert.ok(elements(harness.render()).filter(x=>["input","textarea","select"].includes(x.type)).every(x=>x.props.disabled));
  harness.setLocale("it");harness.render();harness.setLocale("fr");harness.render();
  await button(harness.render(),"verify").props.onClick();harness.render();assert.equal(requests[1],requests[0]);assert.equal(requests.length,2);assert.equal(navigation.length,0);assert.equal(button(harness.render(),"create").props.disabled,true);assert.ok(textContent(harness.render()).includes(messages.fr["manager.activityForm.error.notification"]));
 }finally{harness.cleanup();}
});

test("definite rejection keeps a correctable draft and uses a fresh retry key",async()=>{
 let tries=0;const {harness,requests,navigation}=await init(async()=>++tries===1?Response.json({error:"invalid_assignments",outcome:"rejected"},{status:400}):Response.json({ok:true,firstEventId:"created"}));
 try {await button(harness.render(),"create").props.onClick();harness.render();assert.equal(field(harness.render(),"competitionName").props.disabled,false);assert.equal(field(harness.render(),"competitionName").props.value,"Draft");await button(harness.render(),"create").props.onClick();assert.notEqual(JSON.parse(requests[0]).requestId,JSON.parse(requests[1]).requestId);assert.deepEqual(navigation,["/manager/calendar?event=created"]);}finally{harness.cleanup();}
});

test("competition edit sends the original snapshot, locks processed reminders and blocks uncertain resubmission",async()=>{
 const {harness,requests,reads}=await init(async()=>{throw Error("Network");},true);
 try{harness.render();assert.equal(field(harness.render(),"reminderText","textarea").props.disabled,true);harness.setLocale("de");harness.render();harness.setLocale("fr");harness.render();assert.equal(reads.length,2);await button(harness.render(),"save").props.onClick();harness.render();assert.deepEqual(JSON.parse(requests[0]).snapshot,{event:{id:"event"}});assert.equal(button(harness.render(),"save").props.disabled,true);assert.ok(textContent(harness.render()).includes(messages.fr["manager.activityForm.error.editUnconfirmed"]));}finally{harness.cleanup();}
});

test("every activity form translation exists with matching interpolation tokens",()=>{
 for(const [key,values] of Object.entries(managerActivityEntries))for(const [index,locale] of (["fr","en","de","it"] as const).entries()){assert.equal(messages[locale][`manager.activityForm.${key}`],values[index]);assert.ok(values[index].trim());assert.deepEqual((values[index].match(/\{\w+\}/g)||[]).sort(),(values[0].match(/\{\w+\}/g)||[]).sort());}
});

const createPath="app/api/manager/events/create/route.ts";
const editPath="app/api/manager/events/[eventId]/route.ts";
const requestId="00000000-0000-4000-8000-000000000001";
const commit={ok:true,firstEventId:"event",createdEvents:1,createdSeries:0,events:[{id:"event",event_type:"training",title:"Test",starts_at:"2090-01-01T10:00Z",ends_at:"2090-01-01T11:00Z",location_text:null,recipient_ids:["player"]}]};
function routeOptions(options: Parameters<typeof managerDatabase>[1]={}){
 const tables=managerFixture();tables.club_events=[{id:"event",club_id:"A",event_type:"competition"}];const h=managerDatabase(tables,options);
 const clients:Array<Record<string,unknown>|undefined>=[];h.mocks["@supabase/supabase-js"]={createClient:(_url?:unknown,_key?:unknown,opts?:Record<string,unknown>)=>{clients.push(opts);return h.db;}};
 return {...h,clients};
}
test("API commits through caller-authenticated RPC before notifications and never directly rewrites event tables",async()=>{
 const h=routeOptions({rpcResult:commit});let committed=false;const rpc=h.db.rpc;h.db.rpc=async(name,args)=>{assert.equal(h.writes.length,0);const result=await rpc(name,args);committed=true;return result;};
 const route=loadManagerModule(createPath,h.mocks);const response=await route.POST(managerRequest("POST",{requestId,eventType:"training"}));assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.ok(committed);assert.equal(h.rpcs[0].name,"create_manager_activity_batch_v1");assert.deepEqual(h.clients[1]?.global,{headers:{Authorization:"Bearer test"}});assert.ok(h.writes.every(x=>["notifications","notification_recipients"].includes(x.table)));assert.equal(h.writes.length,2);
});
test("API failures never notify, missing migrations fail closed, and replays never redeliver",async()=>{
 for(const options of [{rpcError:{code:"PGRST202",message:"private"}},{rpcResult:{}},{rpcResult:{...commit,replayed:true}}]){
  const h=routeOptions(options),route=loadManagerModule(createPath,h.mocks),response=await route.POST(managerRequest("POST",{requestId}));const json=await response.json();assert.equal(h.writes.length,0);assert.equal(response.status,"replayed" in (options.rpcResult??{})?200:503);assert.equal(JSON.stringify(json).includes("private"),false);
 }
});
test("notification failure is reported as a committed activity and competition conflicts preserve all records",async()=>{
 const h=routeOptions({rpcResult:commit,failureTable:"notification_recipients"});const result=await loadManagerModule(createPath,h.mocks).POST(managerRequest("POST",{requestId}));assert.deepEqual(await result.json(),{ok:true,firstEventId:"event",createdEvents:1,createdSeries:0,replayed:false,notificationWarning:true});
 const edit=routeOptions({rpcError:{message:"competition_conflict"}});const response=await loadManagerModule(editPath,edit.mocks).PATCH(managerRequest("PATCH",{snapshot:{event:{id:"event"}},eventType:"competition"}),{params:Promise.resolve({eventId:"event"})});assert.equal(response.status,409);assert.equal(edit.writes.length,0);assert.equal(edit.rpcs[0].name,"save_manager_competition_v1");assert.deepEqual(edit.rpcs[0].args.p_expected,{event:{id:"event"}});
});

test("single and recurring training payloads include the selected group roster and stable time values",async()=>{
 for(const series of [false,true]){
  const {harness,requests}=await init(async()=>Response.json({ok:true,firstEventId:"created"}));
  try{
   find(harness.render(),node=>node.type==="select"&&node.props.value==="competition").props.onChange({target:{value:"training"}});harness.render();harness.render();
   button(harness.render(),"select").props.onClick();harness.render();
   find(harness.render(),node=>node.props.label===messages.fr["manager.activityForm.groupSelection"]).props.onToggle("group");harness.render();harness.render();
   if(series){find(harness.render(),node=>node.type==="input"&&node.props.name==="event-mode"&&!node.props.checked).props.onChange();harness.render();}
   await button(harness.render(),"create").props.onClick();const payload=JSON.parse(requests[0]);assert.equal(payload.eventType,"training");assert.deepEqual(payload.playerTarget.ids,["player"]);assert.deepEqual(payload.coachTarget.ids,["coach"]);assert.deepEqual(payload.groupTarget.ids,["group"]);
   assert.equal(payload.mode,series?"series":"single");if(series){assert.equal(payload.startsAt,null);assert.equal(payload.series.timeOfDay,"18:00");}else assert.match(payload.startsAt,/Z$/);
  }finally{harness.cleanup();}
 }
});

test("a missing migration during recovery retains the original creation key",async()=>{
 let tries=0;const {harness,requests}=await init(async()=>++tries===1?Response.json({}):Response.json({error:"unavailable",outcome:"rejected"},{status:503}));
 try{await button(harness.render(),"create").props.onClick();harness.render();await button(harness.render(),"verify").props.onClick();harness.render();assert.equal(field(harness.render(),"competitionName").props.disabled,true);await button(harness.render(),"verify").props.onClick();assert.equal(requests.length,3);assert.ok(requests.every(x=>x===requests[0]));}finally{harness.cleanup();}
});
