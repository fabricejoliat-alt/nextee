import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";
type SaveRoute=(req:Request,ctx:{params:Promise<{newsId:string}>})=>Promise<Response>;

test("Admin routes dispatch only a confirmed published save and return delivery failures honestly", async () => {
  for (const update of [false,true]) {
    const {db,mocks}=managerDatabase({app_admins:[{user_id:"manager"}],platform_news:[{id:"news",published_at:null}]});
    let sent=0;
    db.rpc=(async()=>({data:"news",error:null})) as unknown as typeof db.rpc;
    const route=loadManagerModule<{POST?:SaveRoute;PATCH?:SaveRoute}>(update?"app/api/admin/news/[newsId]/route.ts":"app/api/admin/news/route.ts",{
      ...mocks,
      "@/lib/server/adminAudit":{withAdminMutationAudit:(fn:unknown)=>fn},
      "@/lib/server/platformNewsNotifications":{dispatchPlatformNewsNotifications:async(_db:unknown,id:string)=>{assert.equal(id,"news");sent++;return {error:"Unavailable"};}},
    });
    const save=route.POST??route.PATCH!;
    const input=(status:string)=>new Request("https://app.invalid/api/admin/news",{method:update?"PATCH":"POST",headers:{authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify({status,targets:[{club_id:"club",roles:["player"]}],translations:{fr:{title:"News",body:"Body"}}})});
    assert.equal((await save(input("draft"),{params:Promise.resolve({newsId:"news"})})).status,200);
    assert.equal(sent,0);
    const response=await save(input("published"),{params:Promise.resolve({newsId:"news"})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).dispatch.error,"Unavailable");
    assert.equal(sent,1);
    db.rpc=(async()=>({data:null,error:{message:"Save failed"}})) as typeof db.rpc;
    assert.equal((await save(input("published"),{params:Promise.resolve({newsId:"news"})})).status,400);
    assert.equal(sent,1);
  }
});

test("push worker rechecks access, keeps localized parameters and persists the real push outcome", async () => {
  const {db,writes}=managerDatabase({notification_recipients:[{id:1,notification_id:"notice",user_id:"player",is_deleted:false}]});
  let visible=true;
  db.rpc=(async(name:string)=> name==="claim_platform_news_push_deliveries" ? {data:[{
    id:"delivery",news_id:"news",notification_id:"notice",user_id:"player",published:true,
    notification:{kind:"manager_news",title:"FR",body:"Résumé",data:{url:"/player/news",template_key:"notif.managerNews",template_params:{newsTitle:"FR"},template_params_by_locale:{de:{newsTitle:"DE"}}}},
  }],error:null}:{data:visible,error:null}) as typeof db.rpc;
  const pushes:Record<string,unknown>[]=[];
  const {processPlatformNewsPushes}=loadManagerModule<{processPlatformNewsPushes:(db:unknown,id:string)=>Promise<unknown>}>("lib/server/platformNewsNotifications.ts",{
    "./webPush":{sendWebPush:async(_db:unknown,input:Record<string,unknown>)=>{pushes.push(input);return {configured:true,attempted:1,sent:1,failed:0,cleaned:0};}},
  });
  await processPlatformNewsPushes(db,"news");
  assert.equal(pushes.length,1);
  assert.equal(pushes[0].url,"/player/news?news_id=news");
  assert.deepEqual(pushes[0].templateParamsByLocale,{de:{newsTitle:"DE"}});
  assert.equal(writes.at(-1)?.values.push_status,"completed");
  visible=false;
  await processPlatformNewsPushes(db,"news");
  assert.equal(pushes.length,1);
  assert.equal(writes.at(-1)?.values.push_status,"skipped");
});

test("enqueue errors surface without pretending that notification delivery succeeded", async () => {
  const {db}=managerDatabase();
  db.rpc=(async()=>({error:{message:"Queue unavailable"},data:null})) as typeof db.rpc;
  const {dispatchPlatformNewsNotifications}=loadManagerModule<{dispatchPlatformNewsNotifications:(db:unknown,id:string)=>Promise<{error?:string}>}>("lib/server/platformNewsNotifications.ts",{"./webPush":{sendWebPush:()=>{throw Error("must not send");}}});
  assert.equal((await dispatchPlatformNewsNotifications(db,"news")).error,"Queue unavailable");
});

test("each device receives the news content in its own language", async()=>{
  const {db}=managerDatabase({
    user_notification_preferences:[{user_id:"player",receive_push:true,receive_in_app:true,enabled_kinds:[]}],
    push_subscriptions:[{id:1,user_id:"player",endpoint:"https://web.push.apple.com/de",locale:"de"},{id:2,user_id:"player",endpoint:"https://fcm.googleapis.com/it",locale:"it"}],
  });
  const sent:Array<{title:string;body:string}>=[];
  const {sendWebPush}=loadManagerModule<{sendWebPush:(db:unknown,input:unknown)=>Promise<{sent:number}>}>("lib/server/webPush.ts",{
    "web-push":{__esModule:true,default:{setVapidDetails(){},async sendNotification(_sub:unknown,payload:string){sent.push(JSON.parse(payload));}}},
  },{NEXT_PUBLIC_VAPID_PUBLIC_KEY:"fixture",VAPID_PRIVATE_KEY:"fixture"});
  const result=await sendWebPush(db,{recipientUserIds:["player"],kind:"manager_news",title:"FR",templateKey:"notif.managerNews",templateParams:{newsTitle:"FR",newsSummary:"FR"},templateParamsByLocale:{de:{newsTitle:"Titel",newsSummary:"Deutsch"},it:{newsTitle:"Titolo",newsSummary:"Italiano"}}});
  assert.equal(result.sent,2);
  assert.deepEqual(sent.map(({title,body})=>({title,body})),[{title:"Neuigkeit · Titel",body:"Deutsch"},{title:"Novità · Titolo",body:"Italiano"}]);
});
