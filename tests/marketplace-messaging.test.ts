import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = { id: id(1), item_id: id(20), sender_id: id(3), actor_id: id(3), recipient_id: id(2), club_id: id(10), subject: "Putter", message: "Bonjour !", created_at: "2026-10-20", reply_email: "example@example.test" };
function setup(options: { denied?: boolean; canEdit?: boolean; blocked?: boolean; rpcError?: { code: string }; pushError?: boolean } = {}) {
  const f=managerDatabase({ marketplace_contact_messages: [row, {...row,id:id(4),recipient_id:id(6)}, {...row,id:id(5),recipient_deleted_at:"today"}, {...row,id:id(7),sender_id:id(2),recipient_id:id(3)}], profiles: [{id:id(3),first_name:"Alex",last_name:"Martin"}], organization_members:[{user_id:id(3),organization_id:id(10),role:"player",is_active:true}] }, { rpcResult:id(30),rpcError:options.rpcError });
  const accessCalls: unknown[][]=[], pushes: unknown[]=[];
  const route=loadManagerModule<{GET:(req:Request)=>Promise<Response>;POST:(req:Request)=>Promise<Response>}>("app/api/player/marketplace/messages/route.ts",{
    "../_lib": { createAdminClient:()=>f.db, resolveMarketplaceAccess:async (...args: unknown[])=>{accessCalls.push(args.slice(1));return options.denied ? {error:"Forbidden",status:403} : {viewerUserId:id(9),effectiveUserId:id(2),clubIds:[id(10)],canEdit:options.canEdit!==false};} },
    "@/lib/server/marketplaceSafety": { marketplaceSafetyHeaders:{"Cache-Control":"no-store"},marketplaceUuid:(v:unknown)=>typeof v==="string"&&/^[0-9a-f-]{36}$/.test(v),marketplaceSafetyContext:async()=>({canMessage:()=>!options.blocked}) },
    "@/lib/server/marketplaceMessageNotifications": {processMarketplaceMessagePushes:async (_db:unknown,mid:unknown)=>{pushes.push(mid);if(options.pushError)throw Error("offline");}},
  });
  const req=(method:string,body:object={},query="")=>new Request(`https://activitee.app/api/player/marketplace/messages${query}`, {method,headers:{Authorization:"Bearer test","Content-Type":"application/json"},...(method==="POST"?{body:JSON.stringify(body)}:{})});
  return {...f,route,req,accessCalls,pushes};
}

test("inbox excludes other people's and deleted messages; sent mailbox hides reply addresses",async()=>{
  const f=setup();
  const response=await f.route.GET(f.req("GET"));assert.equal(response.status,200);
  const inbox=await response.json();assert.deepEqual(inbox.messages.map((m:{id:string})=>m.id),[id(1)]);
  assert.equal(inbox.messages[0].can_reply,true);assert.equal(inbox.messages[0].correspondent,"Alex Martin");
  assert.ok(!("sender_id" in inbox.messages[0]));assert.ok(!("actor_id" in inbox.messages[0]));
  const sent=await (await f.route.GET(f.req("GET",{},"?box=sent"))).json();assert.equal(sent.messages[0].id,id(7));assert.equal(sent.messages[0].reply_email,"");assert.equal(sent.messages[0].can_reply,false);
  const targeted=await (await f.route.GET(f.req("GET",{},`?message=${id(4)}`))).json();assert.deepEqual(targeted.messages,[]);
  assert.equal((await f.route.GET(f.req("GET",{},"?offset=-1"))).status,400);
});

test("reply and delete authorization is resolved for editing and cannot be forged across accounts",async()=>{
  const f=setup();
  for(const message_id of [id(4),id(8)])assert.equal((await f.route.POST(f.req("POST",{action:"delete",message_id}))).status,404);
  assert.equal((await f.route.POST(f.req("POST",{action:"reply",message_id:id(7),message:"Oui",request_id:id(30)}))).status,404);
  assert.equal(f.rpcs.length,0);
  const denied=setup({denied:true});assert.equal((await denied.route.POST(denied.req("POST",{action:"delete",message_id:id(1)}))).status,403);
  for(const action of ["delete","restore"])assert.equal((await f.route.POST(f.req("POST",{action,message_id:id(1),child_id:id(2),sender_id:id(100)}))).status,200);
  assert.deepEqual(f.rpcs.map(r=>r.args),[true,false].map(p_deleted=>({p_actor:id(9),p_subject:id(2),p_message_id:id(1),p_deleted})));
  assert.ok(f.accessCalls.every(args=>args[2]==="edit"));
});

test("reply validates content, uses an idempotency key, handles durable limits, and survives push failure",async()=>{
  const f=setup({pushError:true});
  const input={action:"reply",message_id:id(1),message:" Oui ! ",request_id:id(30)};
  for(const bad of [{message:""},{request_id:"invalid"},{message:"https://example.test"}])assert.equal((await f.route.POST(f.req("POST",{...input,...bad}))).status,400);
  const response=await f.route.POST(f.req("POST",input));assert.equal(response.status,200);assert.equal((await response.json()).message_id,id(30));
  assert.deepEqual(f.rpcs[0],{name:"reply_marketplace_message",args:{p_actor:id(9),p_subject:id(2),p_message_id:id(1),p_message:"Oui !",p_request_id:id(30)}});
  assert.deepEqual(f.pushes,[id(30)]);
  const limited=setup({rpcError:{code:"P0001"}});assert.equal((await limited.route.POST(limited.req("POST",input))).status,429);assert.equal(limited.pushes.length,0);
  const blocked=setup({blocked:true});assert.equal((await (await blocked.route.GET(blocked.req("GET"))).json()).messages[0].can_reply,false);
  const viewer=setup({canEdit:false});assert.equal((await (await viewer.route.GET(viewer.req("GET"))).json()).messages[0].can_reply,false);
});

test("push recovery rechecks deletion, membership, and blocking of both child and actual author",async()=>{
  const f=managerDatabase({marketplace_contact_messages:[{id:id(1),push_status:"processing"}],notification_recipients:[{notification_id:id(40),user_id:id(2),is_deleted:false},{notification_id:id(40),user_id:id(8),is_deleted:false}]});
  const delivery={...row,actor_id:id(9),notification_id:id(40),notification:{title:"Message",body:"Nouveau message",data:{url:`/player/marketplace/messages?message=${id(1)}`}}};
  const calls:unknown[]=[];
  Object.assign(f.db,{rpc:async(name:string,args:Record<string,unknown>)=>({error:null,data:name==="claim_marketplace_message_pushes"?[delivery]:name==="organization_notification_visible"?true:args.p_actor===id(8)&&args.p_other===id(9)})});
  const notificationModule=loadManagerModule("lib/server/marketplaceMessageNotifications.ts",{"@/lib/server/webPush":{sendWebPush:async(_db:unknown,input:unknown)=>{calls.push(input);return {configured:true,sent:1,failed:0};}}});
  assert.deepEqual(await notificationModule.processMarketplaceMessagePushes(f.db),{processed:1,failed:0});
  assert.deepEqual((calls[0] as {recipientUserIds:string[]}).recipientUserIds,[id(2)]);
  assert.equal(f.writes[0].values.push_status,"completed");
});

test("the delivery helper honors global, push and category preferences and localizes generic payloads",async()=>{
  const f=managerDatabase({user_notification_preferences:[
    {user_id:"all",receive_in_app:true,receive_push:true,enabled_kinds:[]},
    {user_id:"category",receive_in_app:true,receive_push:true,enabled_kinds:["marketplace_message"]},
    {user_id:"none",receive_in_app:true,receive_push:true,enabled_kinds:["__none__"]},
    {user_id:"other",receive_in_app:true,receive_push:true,enabled_kinds:["manager_news"]},
    {user_id:"off",receive_in_app:false,receive_push:true,enabled_kinds:[]},
    {user_id:"noPush",receive_in_app:true,receive_push:false,enabled_kinds:[]},
  ],push_subscriptions:["all","category","none","other","off","noPush"].map((user_id,i)=>({id:i,user_id,endpoint:`https://fcm.googleapis.com/${user_id}`,p256dh:"key",auth:"auth",locale:user_id==="all"?"fr":"en"}))});
  const payloads:{title:string;url:string}[]=[];
  const notificationModule=loadManagerModule("lib/server/webPush.ts",{"web-push":{default:{setVapidDetails:()=>{},sendNotification:async(_s:unknown,payload:string)=>payloads.push(JSON.parse(payload))}},"@/lib/server/notificationTemplates":{serverNotificationMessage:async(_db:unknown,key:string,locale:string)=>({title:`${key}:${locale}`,body:"Generic"})}}, {NEXT_PUBLIC_VAPID_PUBLIC_KEY:"test",VAPID_PRIVATE_KEY:"test"});
  const result=await notificationModule.sendWebPush(f.db,{recipientUserIds:["all","category","none","other","off","noPush"],kind:"marketplace_message",title:"Generic",url:"/player/marketplace/messages?message=example",templateKey:"notif.marketplaceMessage"});
  assert.equal(result.sent,2);assert.deepEqual(payloads.map(p=>p.title).sort(),["notif.marketplaceMessage:en","notif.marketplaceMessage:fr"]);
  assert.ok(payloads.every(p=>p.url==="/player/marketplace/messages?message=example"));
});

test("Marketplace category appears in Player settings and has four translated templates without altering defaults",()=>{
  const prefs=loadManagerModule("lib/notificationPreferences.ts",{"@/lib/supabaseClient":{supabase:{}}});
  const catalog=loadManagerModule("lib/notificationCatalog.ts",{});
  assert.ok(prefs.NOTIFICATION_KIND_OPTIONS.some((r:{kind:string})=>r.kind==="marketplace_message"));
  assert.ok(catalog.notificationKindsForRole("player").includes("marketplace_message"));
  assert.equal(prefs.DEFAULT_NOTIFICATION_PREFERENCES.receivePush,false);
  assert.equal(prefs.isKindEnabled("marketplace_message",{receiveInApp:true,enabledKinds:["__none__"]}),false);
  assert.equal(prefs.isKindEnabled("marketplace_message",{receiveInApp:true,enabledKinds:[]}),true);
  for(const locale of ["fr","en","de","it"])assert.ok(catalog.notificationTemplateDefaults["notif.marketplaceMessage"][locale].title.length>5);
});
