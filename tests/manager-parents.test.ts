/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated API and component fixtures. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";
import { messages } from "../lib/i18n/messages.ts";
import { managerScopedHref } from "../lib/managerNavigationContext.ts";

const route = "app/api/manager/clubs/[clubId]/parents/route.ts", page = "components/manager/ParentsManagementPage.tsx";
const context = { params: Promise.resolve({ clubId: "A" }) };
test("parent directory includes unlinked and inactive parents and never exposes other clubs' families", async () => {
  const tables = managerFixture();
  tables.club_members.push({ id:"unlinked-A",user_id:"unlinked",club_id:"A",role:"parent",is_active:false },
    {id:"parent-coach",user_id:"parent",club_id:"A",role:"coach",is_active:true},
    {id:"foreign-parent",user_id:"foreign",club_id:"B",role:"parent",is_active:true},
    {id:"shared",user_id:"player",club_id:"B",role:"player",is_active:false});
  tables.profiles.push({id:"parent",first_name:"Parent",last_name:"QA",phone:"123"},{id:"unlinked",first_name:"Unlinked"});
  tables.player_guardians.push({player_id:"outside",guardian_user_id:"parent",can_view:true});
  const h=managerDatabase(tables,{users:[{id:"parent",email:"parent@example.invalid"},{id:"unlinked",email:"technical@noemail.local"}]});
  const r=await loadManagerModule(route,h.mocks).GET(managerRequest("GET"),context);
  assert.equal(r.status,200);const result=await r.json();assert.equal(result.parents.length,2);
  const parent=result.parents.find((row:any)=>row.user_id==="parent");
  assert.equal(parent.email,"parent@example.invalid");assert.deepEqual(parent.other_roles,["coach"]);
  assert.deepEqual(parent.juniors,[{player_id:"player",member_id:"player-A",name:"Junior",shared:true}]);
  assert.equal(result.parents.find((row:any)=>row.user_id==="unlinked").email,null);
  assert.ok(!JSON.stringify(result).includes("outside"));assert.deepEqual(h.writes,[]);
});
test("parent directory rejects inactive managers, hides protected actions and paginates large clubs", async () => {
  const inactive=managerFixture();inactive.club_members[0].is_active=false;
  let h=managerDatabase(inactive);assert.equal((await loadManagerModule(route,h.mocks).GET(managerRequest("GET"),context)).status,403);
  const tables=managerFixture();tables.app_admins=[{user_id:"parent"}];
  for(let i=0;i<1001;i++)tables.club_members.push({id:`p-${i}`,user_id:`p-${i}`,role:"parent",club_id:"A",is_active:true});
  h=managerDatabase(tables);const r=await loadManagerModule(route,h.mocks).GET(managerRequest("GET"),context);
  const data=await r.json();assert.equal(data.parents.length,1002);assert.equal(data.parents.find((p:any)=>p.user_id==="parent").can_manage,false);
});
test("parent deletion passes the server actor and confirmation snapshot to one transaction, never to an Auth deletion",async()=>{
  const h=managerDatabase(managerFixture(),{rpcResult:{ok:true,removed_links:1,preserved_shared_links:0}});
  const response=await loadManagerModule(route,h.mocks).DELETE(managerRequest("DELETE",{member_id:"parent-A",actor_id:"attacker",expected_player_ids:["player"],expected_shared_player_ids:[]}),context);
  assert.equal(response.status,200);
  assert.deepEqual(h.rpcs,[{name:"remove_manager_parent_v1",args:{p_actor_id:"manager",p_club_id:"A",p_member_id:"parent-A",p_expected_player_ids:["player"],p_expected_shared_player_ids:[]}}]);
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.authWrites,[]);
});
test("stale links, absent migration and unauthorized parent deletions fail without fallback writes",async()=>{
  for(const [code,status,error]of [["40001",409,"parent_links_changed"],["PGRST202",503,"parent_removal_migration_required"],["42501",403,null]] as const){
    const h=managerDatabase(managerFixture(),{rpcError:{code,message:"private SQL detail"}});
    const r=await loadManagerModule(route,h.mocks).DELETE(managerRequest("DELETE",{member_id:"parent-A",expected_player_ids:[],expected_shared_player_ids:[]}),context);
    assert.equal(r.status,status);const json=await r.json();if(error)assert.equal(json.error,error);assert.doesNotMatch(json.error,/private SQL/);assert.deepEqual(h.writes,[]);
  }
  const h=managerDatabase(managerFixture());assert.equal((await loadManagerModule(route,h.mocks).DELETE(managerRequest("DELETE",{member_id:"parent-A"}),context)).status,400);assert.equal(h.rpcs.length,0);
});

const parent=(id="p")=>({id,user_id:id,first_name:"Alex",last_name:"Parent",email:`${id}@example.invalid`,phone:"123",is_active:true,can_manage:true,other_roles:["coach"],juniors:[{player_id:"junior",member_id:"member",name:"Junior QA",shared:false}]});
const button=(tree:any,name:string)=>{const value=elements(tree).find(n=>n.type==="button"&&(n.props["aria-label"]===name||textContent(n).trim()===name));assert.ok(value,name);return value;};
async function settle(h:ReturnType<typeof coachComponentHarness>){let tree=h.render();for(let i=0;i<8;i++){await flush();tree=h.render();}return tree;}
function setup(removeResponse?:()=>Promise<Response>){
  const scope={clubs:[{id:"A",name:"Club A"},{id:"B",name:"Club B"}],clubId:"A",loading:false,error:"",setClubId:(id:string)=>{scope.clubId=id;}};
  let rows=[parent(),{...parent("orphan"),first_name:"Orphan",juniors:[],is_active:false}],reads=0;
  const writes:any[]=[];
  const h=coachComponentHarness(page,{modules:{"@/components/manager/useManagerClubSelection":{useManagerClubSelection:()=>scope},"./useManagerClubSelection":{useManagerClubSelection:()=>scope}},fetch:async(input,init)=>{
    if(!init?.method){reads++;return Response.json({parents:scope.clubId==="A"?rows:[{...parent("B-parent"),first_name:"Second"}]});}
    const body=JSON.parse(String(init.body));writes.push({url:String(input),method:init.method,body});
    if(init.method==="DELETE"){
      if(removeResponse)return removeResponse();
      rows=rows.filter(p=>p.id!==body.member_id);
    }else if(init.method==="PATCH")rows=rows.map(row=>row.id===body.memberId?{...row,...body}:row);
    return Response.json({ok:true});
  }});
  return{h,scope,writes,reads:()=>reads};
}
test("parent directory searches and filters, preserves club navigation and confirms removal before updating its list",async()=>{
  const x=setup();try{
    let tree=await settle(x.h);assert.ok(textContent(tree).includes("Parent Alex"));
    const link=elements(tree).find(n=>n.type==="a"&&textContent(n)==="Junior QA")!;assert.equal(link.props.href,"/manager/user-management/players/member?club=A&tab=parent-access");
    assert.equal(managerScopedHref("/manager/user-management/parents","A"),"/manager/user-management/parents?club=A");
    elements(tree).find(n=>n.type==="input")!.props.onChange({target:{value:"orphan@example.invalid"}});tree=x.h.render();assert.ok(!textContent(tree).includes("Parent Alex"));
    elements(tree).find(n=>n.type==="input")!.props.onChange({target:{value:""}});tree=x.h.render();
    button(tree,"Supprimer Alex Parent du club").props.onClick();tree=x.h.render();assert.equal(x.writes.length,0);assert.ok(textContent(tree).includes("Liens familiaux supprimés : 1."));
    button(tree,"Annuler").props.onClick();tree=x.h.render();assert.equal(x.writes.length,0);
    button(tree,"Supprimer Alex Parent du club").props.onClick();tree=x.h.render();
    const submit=elements(tree).find(n=>n.type==="form")!.props.onSubmit;
    await Promise.all([submit({preventDefault(){}}),submit({preventDefault(){}})]);tree=await settle(x.h);
    assert.equal(x.writes.length,1);assert.deepEqual(x.writes[0].body,{member_id:"p",expected_player_ids:["junior"],expected_shared_player_ids:[]});
    assert.ok(!textContent(tree).includes("Parent Alex"));assert.ok(textContent(tree).includes("Parent Orphan"));assert.ok(textContent(tree).includes(messages.fr["manager.administration.parents.removed"]));
  }finally{x.h.cleanup();}
});
test("parent editing preserves credentials and other roles and interface strings resolve in all four languages",async()=>{
  const x=setup();try{
    let tree=await settle(x.h);const reads=x.reads();
    for(const locale of ["fr","en","de","it"] as const){x.h.setLocale(locale);tree=await settle(x.h);assert.equal(x.reads(),reads);assert.ok(textContent(tree).includes(messages[locale]["manager.administration.parents.title"]));assert.doesNotMatch(textContent(tree),/manager\.(content|administration|nav)\./);}
    x.h.setLocale("fr");tree=x.h.render();button(tree,messages.fr["manager.administration.editNamed"].replace("{name}","Alex Parent")).props.onClick();tree=x.h.render();
    const form=elements(tree).find(n=>n.type==="form")!;
    const inputs=elements(form).filter(n=>n.type==="input");assert.equal(inputs.find(n=>n.props.type==="email")!.props.readOnly,true);
    inputs.find(n=>n.props.type==="tel")!.props.onChange({target:{value:"456"}});tree=x.h.render();
    await elements(tree).find(n=>n.type==="form")!.props.onSubmit({preventDefault(){}});tree=await settle(x.h);
    assert.deepEqual(x.writes[0].body,{memberId:"p",role:"parent",first_name:"Alex",last_name:"Parent",phone:"456"});assert.ok(textContent(tree).includes("456"));
  }finally{x.h.cleanup();}
});
test("missing migration retains the parent and stale dialog handlers cannot remove a parent after changing clubs",async()=>{
  const x=setup(async()=>Response.json({error:"parent_removal_migration_required"},{status:503}));try{
    let tree=await settle(x.h);button(tree,"Supprimer Alex Parent du club").props.onClick();tree=x.h.render();
    const submit=elements(tree).find(n=>n.type==="form")!.props.onSubmit;await submit({preventDefault(){}});tree=await settle(x.h);
    assert.ok(textContent(tree).includes(messages.fr["manager.administration.parents.migration"]));assert.ok(textContent(tree).includes("Alex Parent"));
    x.scope.clubId="B";tree=await settle(x.h);assert.ok(!elements(tree).some(n=>n.type==="form"));await submit({preventDefault(){}});assert.equal(x.writes.length,1);
  }finally{x.h.cleanup();}
});
test("a delayed removal result cannot replace another club's list or show a false success there",async()=>{
  const response=deferred<Response>(),x=setup(()=>response.promise);try{
    let tree=await settle(x.h);button(tree,"Supprimer Alex Parent du club").props.onClick();tree=x.h.render();
    const pending=elements(tree).find(n=>n.type==="form")!.props.onSubmit({preventDefault(){}});await flush();x.scope.clubId="B";tree=await settle(x.h);
    response.resolve(Response.json({ok:true}));await pending;tree=await settle(x.h);
    assert.ok(textContent(tree).includes("Parent Second"));assert.ok(!textContent(tree).includes(messages.fr["manager.administration.parents.removed"]));
  }finally{x.h.cleanup();}
});
