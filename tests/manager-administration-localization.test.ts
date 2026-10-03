/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI fixtures; no live account or data writes. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerAdministrationEntries } from "../lib/i18n/managerAdministrationMessages.ts";
import { managerAdministrationFeedback, managerAdministrationFormat, managerCriterionDomain, managerNewCriterionChoices } from "../lib/managerAdministrationPresentation.ts";
import { defaultEvaluationChoices, EVALUATION_RESPONSE_FORMATS } from "../lib/evaluationCriteria.ts";
import { loadManagerModule, managerDatabase, managerFixture } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
const locales: AppLocale[] = ["fr", "en", "de", "it"];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;
const label = (locale: AppLocale, key: string) => tr(locale)(`manager.administration.${key}`);
const paths = ["app/manager/evaluation-criteria/page.tsx", ...["PlayersManagementPage","CoachesManagementPage","ManagersManagementPage","CoachCreatePage","CoachEditPage","ManagerCreatePage","ManagerEditPage","ManagerCoachStatistics"].map(name => `components/manager/${name}.tsx`)];
const ui = (tree: any) => elements(tree).map(n => [textContent(n), n.props.label, n.props.detail, n.props.error, n.props.title, n.props["aria-label"], n.props.placeholder, n.props["data-label"]].filter(v => typeof v === "string").join(" ")).join(" ");
const button = (tree: any, text: string) => { const found = elements(tree).find(n => n.type === "button" && textContent(n).trim() === text); assert.ok(found, text); return found; };
const field = (tree: any, name: string) => { const found = elements(tree).find(n => n.props.label === name || n.type === "label" && elements(n).some(c => c.type === "span" && textContent(c).trim().replace(/\s*\*$/, "") === name)); assert.ok(found, name); return found.props.label ? found : elements(found).find(n => ["input","select","textarea"].includes(n.type))!; };
const change = (tree: any, name: string, value: string) => { const n = field(tree, name); n.props.onChange(n.props.label ? value : {target:{value}}); };
function localized() { let locale: AppLocale = "fr"; const translators=Object.fromEntries(locales.map(l=>[l,tr(l)]));return {set(l:AppLocale){locale=l;}, module:{useI18n:()=>({locale,t:translators[locale]})}}; }
const event = { preventDefault(){} };
const club = {id:"club",name:"Club du test"};
const season = {id:"season",name:"Saison maison",is_current:true,starts_on:"2026-01-01",ends_on:"2026-12-31"};
const navigation = { useSearchParams: () => new URLSearchParams({club:"club",season:"season"}) };
async function settle(h: ReturnType<typeof coachComponentHarness>) { let tree=h.render(); for(let i=0;i<4;i++){await flush();tree=h.render();}return tree; }

test("administration keys, fixed UI and placeholders resolve in all four languages",()=>{
  for(const [key,values] of Object.entries(managerAdministrationEntries)) for(const locale of locales){
    const value=label(locale,key);assert.ok(value?.trim()); const tokens=(s:string)=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(value),tokens(values[0]),`${locale}: ${key}`);
  }
  for(const path of paths){const source=readFileSync(path,"utf8"),ast=ts.createSourceFile(path,source,99,true,ts.ScriptKind.TSX);
    function visit(n:ts.Node){if(ts.isJsxText(n))assert.doesNotMatch(n.text,/[A-Za-zÀ-ÿ]{2}/,`${path}: fixed JSX`);if(ts.isJsxAttribute(n)&&["label","title","placeholder","aria-label","data-label"].includes(n.name.getText(ast))&&n.initializer&&ts.isStringLiteral(n.initializer))assert.doesNotMatch(n.initializer.text,/[A-Za-zÀ-ÿ]{2}/,`${path}: fixed attribute`);ts.forEachChild(n,visit);}visit(ast);
    for(const [,key]of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of locales)assert.ok(messages[locale][key],`${locale}: ${key}`);
  }
  assert.equal(managerAdministrationFeedback(tr("de"),"Le nom est requis. Le domaine est requis."),label("de","criteria.nameRequired")+" "+label("de","criteria.domainRequired"));
  assert.equal(managerAdministrationFeedback(tr("it"),"Ce critère a déjà été utilisé et doit être archivé."),label("it","criteria.usedError"));
  assert.equal(managerAdministrationFeedback(tr("en"),"Custom diagnostic {name}"),"Custom diagnostic {name}");
  assert.equal(managerAdministrationFormat(tr("de"),"criteria.copyName",{name:"Focus {name}"}),"Focus {name} (Kopie)");
  for(const locale of locales)for(const format of EVALUATION_RESPONSE_FORMATS){const actual=managerNewCriterionChoices(tr(locale),format),canonical=defaultEvaluationChoices(format);assert.deepEqual(actual.map(({value,icon})=>({value,icon})),canonical.map(({value,icon})=>({value,icon})));assert.ok(actual.every(c=>c.label&&!c.label.startsWith("manager.")));}
  assert.equal(managerCriterionDomain(tr("de"),"technique","Technique"),"Technik");assert.equal(managerCriterionDomain(tr("de"),"technique","Approche du club"),"Approche du club");
});

const criterion={id:"criterion",club_id:"club",name:"Focus {name}",description:"Consigne maison",respondent:"both",response_format:"sentiment",choices_json:[{value:"negative",label:"À travailler chez nous"},{value:"positive",label:"Objectif maison"}],activity_types:["training","camp"],domain_key:"technique",domain_label:"Approche du club",is_required:false,is_active:true,sort_order:7,archived_at:null,used_count:2};
test("criterion edits and duplicates keep authored labels, choices and canonical values across locale changes",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0,fail=false;
  const h=coachComponentHarness(paths[0],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async(url,init)=>{if(init?.method){writes.push({url:String(url),method:init.method,body:JSON.parse(String(init.body))});return Response.json(fail?{error:"Le nom est requis."}:{ok:true},{status:fail?400:200});}reads++;return Response.json(String(url).includes("my-clubs")?{clubs:[club]}:{criteria:[criterion]});}});
  let tree=await settle(h);elements(tree).find(n=>n.props.title===tr("fr")("manager.content.edit"))!.props.onClick();tree=h.render();change(tree,label("fr","criteria.description"),"Nouvelle consigne");const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(field(tree,tr(locale)("manager.content.name")).props.value,criterion.name);assert.equal(field(tree,label(locale,"criteria.description")).props.value,"Nouvelle consigne");assert.ok(ui(tree).includes("Approche du club"));assert.equal(elements(tree).find(n=>n.props.choices)?.props.choices[0].label,criterion.choices_json[0].label);assert.doesNotMatch(ui(tree),/manager\.administration\./);}
  fail=true;button(tree,tr("it")("manager.save")).props.onClick();tree=await settle(h);assert.ok(ui(tree).includes(label("it","criteria.nameRequired")));assert.equal(field(tree,label("it","criteria.description")).props.value,"Nouvelle consigne");
  fail=false;button(tree,tr("it")("manager.save")).props.onClick();tree=await settle(h);assert.equal(writes[1].method,"PATCH");assert.equal(writes[1].body.domain_label,"Approche du club");assert.deepEqual(writes[1].body.choices_json,criterion.choices_json);assert.deepEqual(writes[1].body.activity_types,["training","camp"]);
  elements(tree).find(n=>n.props.title===tr("it")("manager.content.duplicate"))!.props.onClick();tree=h.render();button(tree,tr("it")("manager.save")).props.onClick();tree=await settle(h);assert.equal(writes[2].method,"POST");assert.equal(writes[2].body.name,"Focus {name} (copia)");assert.deepEqual(writes[2].body.choices_json,criterion.choices_json);
  button(tree,label("it","criteria.create")).props.onClick();tree=h.render();change(tree,label("it","criteria.format"),"yes_no");tree=h.render();assert.deepEqual(elements(tree).find(n=>n.props.choices)?.props.choices,[{value:false,label:"No"},{value:true,label:"Sì"}]);h.cleanup();
});

test("missing club and failed directory context leave loading and show localized feedback",async()=>{
  const criteria=coachComponentHarness(paths[0],{fetch:async()=>Response.json({clubs:[]})});let tree=await settle(criteria);assert.equal(button(tree,label("fr","criteria.create")).props.disabled,true);assert.ok(ui(tree).includes(tr("fr")("manager.noClub")));criteria.cleanup();
  const lang=localized();let reads=0;const players=coachComponentHarness(paths[1],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async()=>{reads++;return Response.json({error:"Forbidden"},{status:403});}});tree=await settle(players);assert.equal(elements(tree).filter(n=>n.type==="skeleton").length,0);lang.set("de");tree=players.render();assert.ok(ui(tree).includes(tr("de")("manager.settings.forbidden")));assert.equal(reads,1);players.cleanup();
});

for(const [path,role] of [[paths[1],"player"],[paths[2],"coach"],[paths[3],"manager"]])test(`${role} directory preserves filters, records and links across locales`,async()=>{
  const lang=localized();let reads=0;const member={id:"member",role,is_active:true,auth_email:"qa@example.test",player_consent_status:"granted",profiles:{first_name:"Zoé",last_name:"Exemple",birth_date:"2014-04-03",staff_function:"Fonction maison"}};
  const query:any={select:()=>query,eq:()=>query,order:async()=>({data:[season]})};
  const h=coachComponentHarness(path,{modules:{"@/components/i18n/AppI18nProvider":lang.module},database:{from:()=>query},fetch:async(url)=>{reads++;const u=String(url);return Response.json(u.includes("my-clubs")?{clubs:[club]}:u.endsWith("members")?{members:[member]}:u.endsWith("seasons")?{seasons:[season]}:{records:[{id:"record",club_member_id:"member",registration_status:"active"}]});}});
  let tree=await settle(h);elements(tree).find(n=>n.type==="input")!.props.onChange({target:{value:"zoé"}});tree=h.render();if(role==="player"){field(tree,label("fr","consent")).props.onChange({target:{value:"granted"}});tree=h.render();}const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(elements(tree).find(n=>n.type==="input")!.props.value,"zoé");assert.ok(ui(tree).includes("Exemple"));assert.ok(ui(tree).includes(label(locale,"active")));const link=elements(tree).find(n=>n.type==="a"&&n.props.href.includes("/member?"));assert.ok(link);assert.ok(link.props.href.includes("club=club"));assert.ok(link.props["aria-label"].includes("Zoé"));if(role==="player")assert.equal(field(tree,label(locale,"consent")).props.value,"granted");assert.doesNotMatch(ui(tree),/manager\.(administration|content|settings)\./);}
  h.cleanup();
});

for(const [path,role] of [[paths[4],"coach"],[paths[6],"manager"]])test(`new ${role} validates without writes and preserves a draft before sending the correct account role`,async()=>{
  const lang=localized(),writes:any[]=[],navigated:string[]=[];let reads=0;
  const h=coachComponentHarness(path,{modules:{"@/components/i18n/AppI18nProvider":lang.module},navigate:p=>navigated.push(p),fetch:async(url,init)=>{if(init?.method){writes.push({url:String(url),body:JSON.parse(String(init.body))});return Response.json({ok:true});}reads++;return Response.json({clubs:[club]});}});
  let tree=await settle(h);await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);tree=h.render();assert.equal(writes.length,0);assert.ok(ui(tree).includes(label("fr","firstNameRequired")));
  for(const[key,value]of [["manager.profile.firstName","Zoé"],["manager.content.name","Exemple"],["manager.profile.function","Fonction maison"],["manager.administration.email"," QA@Example.Test "]]){change(tree,tr("fr")(key),value);tree=h.render();}const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(field(tree,tr(locale)("manager.profile.function")).props.value,"Fonction maison");assert.ok(ui(tree).includes(label(locale,"firstNameRequired")));assert.doesNotMatch(ui(tree),/manager\.administration\./);}
  await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);await flush();assert.equal(writes.length,1);assert.equal(writes[0].url,"/api/admin/clubs/club/create-member");assert.equal(writes[0].body.role,role);assert.equal(writes[0].body.email,"qa@example.test");assert.equal(writes[0].body.staff_function,"Fonction maison");assert.equal(writes[0].body.password,undefined);assert.deepEqual(navigated,[`/manager/user-management/${role === "coach" ? "coaches" : "managers"}?club=club`]);h.cleanup();
});

for(const [path,role] of [[paths[5],"coach"],[paths[7],"manager"]])test(`${role} profile retains permissions and custom values and never changes login email when language changes`,async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;
  const member={id:"member",user_id:"user",role,is_active:true,auth_email:"qa@example.test",can_manage_assigned_groups:true,can_manage_assigned_group_planning:false,can_transfer_players_between_club_groups:false,coach_training_assistance_enabled:true,custom_field_values:{permanent:"Valeur du club"},profiles:{first_name:"Zoé",last_name:"Exemple",username:"zoe",staff_function:"Fonction maison",phone:"",address:"",postal_code:"",city:""}};
  const fields=[{id:"permanent",label:"Libellé maison",field_type:"short_text",scope:"permanent",is_active:true,applies_to_roles:["coach"]},{id:"seasonal",label:"Option maison",field_type:"boolean",scope:"season",is_active:true,applies_to_roles:["coach"]}];
  const h=coachComponentHarness(path,{props:{memberId:"member"},modules:{"@/components/i18n/AppI18nProvider":lang.module,"next/navigation":navigation,"@/components/manager/ManagerCoachStatistics":{default:"statistics"}},fetch:async(url,init)=>{if(init?.method){writes.push(JSON.parse(String(init.body)));return Response.json({ok:true});}reads++;return Response.json(String(url).endsWith("members")?{members:[member],playerFields:fields}:String(url).endsWith("seasons")?{seasons:[season]}:{records:[{club_member_id:"member",registration_status:"inactive",custom_field_values:{seasonal:false}}]});}});
  let tree=await settle(h);change(tree,tr("fr")("manager.profile.firstName"),"Prénom conservé");tree=h.render();const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(field(tree,tr(locale)("manager.profile.firstName")).props.value,"Prénom conservé");assert.equal(field(tree,label(locale,"loginEmail")).props.readOnly,true);if(role==="coach"){assert.equal(elements(tree).find(n=>n.props.field?.id==="permanent")?.props.value,"Valeur du club");assert.equal(elements(tree).find(n=>n.props.field?.id==="seasonal")?.props.value,false);assert.equal(field(tree,label(locale,"permissions.groups")).props.checked,true);assert.equal(field(tree,label(locale,"permissions.planning")).props.checked,false);}assert.doesNotMatch(ui(tree),/manager\.administration\./);}
  await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);await flush();assert.equal(writes[0].memberId,"member");assert.equal(writes[0].role,role);assert.equal(writes[0].first_name,"Prénom conservé");assert.equal(writes[0].email,undefined);assert.equal(writes[0].password,undefined);
  if(role==="coach"){assert.equal(writes[0].can_manage_assigned_groups,true);assert.equal(writes[0].can_manage_assigned_group_planning,false);assert.equal(writes[0].can_transfer_players_between_club_groups,false);assert.equal(writes[0].coach_training_assistance_enabled,true);assert.deepEqual(writes[0].custom_field_values,{permanent:"Valeur du club"});tree=h.render();await elements(tree).filter(n=>n.type==="form")[2].props.onSubmit(event);assert.deepEqual(writes[1],{member_ids:["member"],registration_status:"inactive",custom_field_values:{seasonal:false}});}
  h.cleanup();
});

test("coach statistics localize numbers, months, roles and overdue reasons while preserving group and activity names",async()=>{
  const lang=localized();let reads=0;
  const coach={groups:[{id:"group",name:"Groupe maison",role:"Responsable",juniors:3}],coachHours:12.5,previousCoachHours:10,activities:2,uniquePlayers:3,medianGroupSize:1.5,activeWeeks:2,camps:0,evaluationsExpected:2,evaluationsCompleted:1,evaluationsInProgress:0,evaluationsOverdue:1,visibleFeedbackRate:50.5,lastActivity:"2026-09-01T10:00:00Z",evaluationTodo:[{eventId:"event",playerId:"player",groupId:"group",eventTitle:"Activité maison",overdueAfterDays:7,reason:"Évaluation en retard de plus de 7 jours"}]};
  const charts=Object.fromEntries(["Bar","BarChart","CartesianGrid","ResponsiveContainer","Tooltip","XAxis","YAxis"].map(n=>[n,n]));
  const h=coachComponentHarness(paths[8],{props:{clubId:"club",coachId:"coach",seasonId:"season"},modules:{"@/components/i18n/AppI18nProvider":lang.module,"recharts":charts,"@/components/manager/usePerformanceContext":{performanceHeaders:async()=>({})}},fetch:async()=>{reads++;return Response.json({coach,distribution:{monthly:[{month:"2026-09",coachHours:12.5}]}});}});
  let tree=await settle(h);const before=reads;for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.ok(ui(tree).includes(label(locale,"stats.lead")));assert.ok(ui(tree).includes(tr(locale)("manager.performance.head")));assert.ok(ui(tree).includes(managerAdministrationFormat(tr(locale),"stats.overdueReason",{days:7})));assert.ok(ui(tree).includes("Activité maison"));assert.ok(elements(tree).find(n=>n.props.href==="/manager/groups/group/planning/event"));const axis=elements(tree).find(n=>n.type==="XAxis")!;assert.notEqual(axis.props.tickFormatter("2026-09"),"2026-09");assert.doesNotMatch(ui(tree),/manager\.administration\./);}
  assert.equal(elements(tree).find(n=>n.props.label===label("it","stats.hours"))!.props.value,"12.5 h");h.cleanup();
});

test("coach API provides the overdue threshold and correct activity destination without writes",async()=>{
  const tables=managerFixture();tables.coach_groups[0]={...tables.coach_groups[0],name:"Groupe maison",is_active:true,head_coach_user_id:"target"};
  tables.club_events=[{id:"event",club_id:"A",group_id:"group-A",title:"Activité maison",starts_at:"2020-09-01T08:00:00Z",ends_at:"2020-09-01T09:00:00Z",event_type:"training",requires_evaluation:true}];
  tables.club_event_coaches=[{event_id:"event",coach_id:"target"}];tables.club_event_attendees=[{event_id:"event",player_id:"player",status:"present"}];
  const fixture=managerDatabase(tables);
  const mockedLib={performanceContext:async()=>({ok:true,db:fixture.db}),resolveRange:async()=>({range:{from:"2020-09-01",to:"2020-09-30"},previous:{from:"2020-08-01",to:"2020-08-31"},season:{id:"season-A"},seasons:[]}),dateKey:(value:string)=>value.slice(0,10),startIso:(value:string)=>`${value}T00:00:00Z`,queryRows:async(query:any)=>(await query).data};
  const route=loadManagerModule("app/api/manager/clubs/[clubId]/performance/coaches/route.ts",{...fixture.mocks,"../_lib":mockedLib,"@/lib/server/coachEvaluation":{loadCoachEvaluationState:async()=>({attendees:[{event_id:"event",player_id:"player",coach_recorded_status:null}],criteria:[],responses:[]})}});
  const response=await route.GET({nextUrl:new URL("http://local?coachId=target")},{params:Promise.resolve({clubId:"A"})});assert.equal(response.status,200);const json=await response.json();assert.deepEqual(json.coach.evaluationTodo,[{eventId:"event",playerId:"player",groupId:"group-A",eventTitle:"Activité maison",overdueAfterDays:7,reason:"Évaluation en retard de plus de 7 jours"}]);assert.equal(fixture.writes.length,0);
});
