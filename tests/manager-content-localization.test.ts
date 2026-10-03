/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated component fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerProfileEntries } from "../lib/i18n/managerProfileMessages.ts";
import { managerContentEntries } from "../lib/i18n/managerContentMessages.ts";
import { managerContentPresentation } from "../lib/managerContentPresentation.ts";
import { coachComponentHarness, deferred, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";

const locales: AppLocale[] = ["fr", "en", "de", "it"];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;
const files = ["components/manager/ManagerNewsWorkspace.tsx", "app/manager/camps/page.tsx", "app/manager/camps/new/page.tsx", "app/manager/camps/[campId]/page.tsx", "components/ui/TiptapSimpleEditor.tsx", "components/evaluations/EventCriteriaSelector.tsx"];
function ui(tree: any) { return elements(tree).map(n => [textContent(n), n.props.label, n.props.title, n.props["aria-label"], n.props.placeholder, n.props["data-label"]].filter(v => typeof v === "string").join(" ")).join(" "); }
function button(tree: any, label: string) { const node = elements(tree).find(n => n.type === "button" && textContent(n).trim() === label); assert.ok(node, label); return node; }
const editorMocks = { "@/components/ui/TiptapSimpleEditor": {TiptapSimpleEditor:"editor"}, "@/components/evaluations/EventCriteriaSelector":{default:"criteria"} };
function localized() { let locale: AppLocale = "fr"; const translators=Object.fromEntries(locales.map(l=>[l,tr(l)]));return {set(l:AppLocale){locale=l;}, module:{useI18n:()=>({locale,t:translators[locale]})}}; }

test("content translations resolve in all four languages with intact interpolation and no fixed JSX labels", () => {
  for (const [prefix, entries] of [["manager.content", managerContentEntries], ["manager.profile", managerProfileEntries]] as const) for (const [key, values] of Object.entries(entries)) for (const locale of locales) {
    const value = messages[locale][`${prefix}.${key}`]; assert.ok(value?.trim());
    const tokens = (s:string) => [...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
    assert.deepEqual(tokens(value), tokens(values[0]), `${locale}: ${key}`);
  }
  for(const file of [...files, "app/manager/profile/page.tsx"]) {
    const source=readFileSync(file,"utf8"), ast=ts.createSourceFile(file,source,99,true,ts.ScriptKind.TSX);
    function visit(node:ts.Node){if(ts.isJsxText(node) && node.text.trim() !== "HCP PRO")assert.doesNotMatch(node.text,/[A-Za-zÀ-ÿ]{2}/,`${file}: fixed JSX`);ts.forEachChild(node,visit);} visit(ast);
    for(const [,key] of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of locales)assert.ok(messages[locale][key],`${locale}: ${key}`);
  }
});

test("plural counts, known server validation and age groups localize without changing unknown content",()=>{
  const f=managerContentPresentation(tr("de"),"de");
  assert.equal(f.count("dayCount",1),"1 Tag");assert.equal(f.count("dayCount",2),"2 Tage");
  assert.equal(f.count("placeCount",0),"0 Plätze");
  assert.equal(f.format("editNamed",{name:"Stage {count}"}),"Stage {count} bearbeiten");
  assert.equal(f.errorText("Le stage a changé depuis l’ouverture du formulaire. Rechargez la page pour conserver les dernières réponses."),tr("de")("manager.content.staleCamp"));
  assert.equal(f.errorText("Unknown diagnostic"),"Unknown diagnostic");
  assert.equal(f.ageBandLabel("adult","Adultes"),"Erwachsene");assert.equal(f.ageBandLabel("custom","Cadets du club"),"Cadets du club");
});

const news = { id:"news",title:"Actualité du club",body:"<p>Texte du club</p>",summary:"Résumé du club",status:"draft",created_at:"2026-10-02T10:00:00Z",targets:[],last_dispatch_result:{email_failed_count:1,email_uncertain_count:2} };
const bootstrap = {selected_club_id:"club",clubs:[],news:[news],platform_news:[],target_options:{members:[{user_id:"player",role:"player",full_name:"Zoé Exemple"}],groups:[{id:"group",name:"Groupe Élite"}],group_categories:["Loisirs"],age_bands:[{key:"u10",label:"U10 et moins"},{key:"adult",label:"Adultes"}],club_events:[],camps:[]}};

test("Manager news switches clubs without showing stale news or discarding a draft silently", async () => {
  const lang = localized(); const params = new URLSearchParams(); const routes: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); let allowDiscard = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => allowDiscard } });
  const clubs = [{ id: "club", name: "Club A" }, { id: "other", name: "Club B" }];
  const response = (id: string) => Response.json({ ...bootstrap, clubs, selected_club_id: id, news: [{ ...news, id: id + "-news", club_id: id, title: id === "club" ? "Actualité A" : "Actualité B" }] });
  const late = deferred<Response>(); let delayA = false;
  const h = coachComponentHarness(files[0], { modules: { ...editorMocks, "@/components/i18n/AppI18nProvider": lang.module,
    "next/navigation": { useSearchParams: () => params, useRouter: () => ({ replace: (url: string) => { routes.push(url); params.delete("club"); new URL(url, "http://local").searchParams.forEach((value, key) => params.set(key, value)); } }) },
  }, fetch: async (url) => String(url).includes("club_id=other") ? response("other") : delayA ? late.promise : response("club") });
  try {
    let tree = h.render(); await flush(); tree = h.render();
    assert.ok(ui(tree).includes("Actualité A"));
    button(tree, tr("fr")("manager.content.newNews")).props.onClick(); tree = h.render();
    const select = () => elements(tree).find(n => n.props.clubs?.length === 2)!;
    select().props.onChange("other"); assert.equal(routes.length, 0);
    allowDiscard = true; select().props.onChange("other");
    tree = h.render(); assert.equal(routes.at(-1), "/manager/news?club=other"); assert.ok(!ui(tree).includes("Actualité A"));
    await flush(); tree = h.render(); assert.ok(ui(tree).includes("Actualité B"));
    delayA = true; params.set("club", "club"); tree = h.render(); await flush();
    assert.ok(!ui(tree).includes("Actualité B"));
    params.set("club", "other"); tree = h.render(); await flush(); tree = h.render();
    late.resolve(response("club")); await flush(); tree = h.render();
    assert.ok(ui(tree).includes("Actualité B")); assert.ok(!ui(tree).includes("Actualité A"));
  } finally {
    h.cleanup();
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a failed news lookup blocks creation until a successful retry", async () => {
  let reads = 0;
  const h = coachComponentHarness(files[0], { modules: editorMocks, fetch: async () => {
    reads += 1;
    return reads === 1 ? Response.json({ error: "Temporary outage" }, { status: 503 }) : Response.json({ ...bootstrap, clubs: [{ id: "club", name: "Club A" }] });
  } });
  let tree = h.render(); await flush(); tree = h.render();
  assert.equal(button(tree, tr("fr")("manager.content.newNews")).props.disabled, true);
  button(tree, tr("fr")("manager.refresh")).props.onClick();
  await flush(); tree = h.render();
  assert.equal(button(tree, tr("fr")("manager.content.newNews")).props.disabled, false);
  h.cleanup();
});
test("news editor preserves entered content and target IDs across locale switches; submitted payload remains unchanged",async()=>{
  const lang=localized(), writes:any[]=[];
  const h=coachComponentHarness(files[0],{modules:{...editorMocks,"@/components/i18n/AppI18nProvider":lang.module},fetch:async(url,init)=>{if(init?.method==="POST"){writes.push(JSON.parse(String(init.body)));return Response.json({ok:true});}return Response.json(bootstrap);}});
  h.render();await flush();let tree=h.render();
  button(tree,tr("fr")("manager.content.newNews")).props.onClick();tree=h.render();
  elements(tree).find(n=>n.props.placeholder===tr("fr")("manager.content.newsTitle"))!.props.onChange({target:{value:"Mon titre inchangé"}});
  elements(tree).find(n=>n.type==="editor")!.props.onChange("<p>Mon contenu inchangé</p>");
  const playerLabel=elements(tree).find(n=>n.type==="label"&&textContent(n).trim()==="Joueur")!;
  elements(playerLabel).find(n=>n.type==="input")!.props.onChange();
  for(const locale of locales){lang.set(locale);tree=h.render();await flush();tree=h.render();
    assert.ok(ui(tree).includes(tr(locale)("manager.content.targeting")));
    assert.ok(ui(tree).includes(tr(locale)("manager.content.ageUnder10")));
    assert.ok(ui(tree).includes("Groupe Élite"));
    assert.equal(elements(tree).find(n=>n.props.placeholder===tr(locale)("manager.content.newsTitle"))!.props.value,"Mon titre inchangé");
    assert.equal(elements(tree).find(n=>n.type==="editor")!.props.value,"<p>Mon contenu inchangé</p>");
    assert.doesNotMatch(ui(tree),/manager\.content\./);
  }
  await button(tree,tr("it")("manager.content.createNews")).props.onClick();await flush();
  assert.equal(writes.length,1);assert.equal(writes[0].title,"Mon titre inchangé");assert.equal(writes[0].body,"<p>Mon contenu inchangé</p>");assert.deepEqual(writes[0].targets,[{target_type:"role",target_value:"player"}]);assert.equal(writes[0].status,"draft");h.cleanup();
});

const profile = {id:"player",first_name:"Zoé",last_name:"Exemple",avatar_url:null};
const day = {id:"day",event_id:"event",day_index:0,starts_at:"2026-10-03T08:00:00Z",ends_at:"2026-10-03T14:00:00Z",counts:{present:1},evaluation:{completed:1,required:2},evaluation_enabled:true,group_id:"group"};
const camp = {id:"camp",title:"Stage du club",notes:"Notes du club",status:"scheduled",capacity:3,head_coach:null,coach_ids:[],days:[day],player_ids:["player"],stats:{invited:1,registered:1,coaches:0},evaluation:{completed:1,required:2},player_registrations:[{player_id:"player",player:profile,registration_status:"registered",day_status_by_day_index:{"0":"present"}}],options:[{id:"option",name:"Transport du club",description:"Texte inchangé",is_active:true,applies_to_all_days:false,day_indexes:[0],capacity:2,input_type:"yes_no",player_assignments:[{player_id:"player",quantity:1,selected_value:"yes"}],assigned_count:1,assigned_quantity:1}]};
test("camp details localize all five tabs, attendance controls and answers, preserving URL/status values",async()=>{
  const lang=localized();let tab="overview";const writes:any[]=[];
  const h=coachComponentHarness(files[3],{modules:{"@/components/i18n/AppI18nProvider":lang.module,"next/navigation":{useParams:()=>({campId:"camp"}),useSearchParams:()=>new URLSearchParams({tab})}},fetch:async(url,init)=>{if(init?.method==="PATCH")writes.push(JSON.parse(String(init.body)));return Response.json({camps:[camp]});}});
  h.render();await flush();
  const tabs=["overview","days","participants","evaluations","options"];
  for(const locale of locales){lang.set(locale);for(tab of tabs){const tree=h.render(),text=ui(tree);assert.ok(text.includes("Stage du club"));assert.doesNotMatch(text,/manager\.content\./);
    const links=elements(tree).filter(n=>n.type==="a"&&n.props.href?.includes("?tab="));assert.equal(links.length,5);assert.deepEqual(links.map(n=>n.props.href.split("=")[1]),tabs);
    if(tab==="participants"){const select=elements(tree).find(n=>n.type==="select")!;assert.equal(select.props.value,"present");assert.deepEqual(elements(select).filter(n=>n.type==="option").map(n=>n.props.value),["expected","present","absent","excused","not_registered"]);assert.ok(text.includes(tr(locale)("manager.content.excused")));}
    if(tab==="options"){assert.ok(text.includes("Transport du club"));assert.ok(text.includes(tr(locale)("manager.content.yes")));}
  }}
  tab="participants";const tree=h.render();await elements(tree).find(n=>n.type==="select")!.props.onChange({target:{value:"excused"}});await flush();assert.deepEqual(writes[0].attendance_updates,[{player_id:"player",status:"excused"}]);h.cleanup();
});

test("camp form keeps unsaved names, days, options and custom choices when switching languages",async()=>{
  const lang=localized();const reads:string[]=[];const writes:any[]=[];
  const tables:any={club_members:[{club_id:"club",user_id:"coach",role:"manager",is_active:true}],profiles:[],coach_groups:[],coach_group_players:[]};
  const database={from(table:string){reads.push(table);const q:any={then(resolve:any){return Promise.resolve({data:tables[table]??[],error:null}).then(resolve);}};for(const key of ["select","eq","in","order"])q[key]=()=>q;return q;}};
  const h=coachComponentHarness(files[2],{database,modules:{...editorMocks,"@/components/i18n/AppI18nProvider":lang.module,"next/navigation":{useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push(){},refresh(){}})}},fetch:async(_url,init)=>{if(init?.method==="POST")writes.push(JSON.parse(String(init.body)));return Response.json({camps:[],camp_id:"created"});}});
  h.render();await flush();let tree=h.render();
  elements(tree).find(n=>n.props.placeholder===tr("fr")("manager.content.springCamp"))!.props.onChange({target:{value:"Stage personnalisé"}});
  button(tree,tr("fr")("manager.content.addDay")).props.onClick();button(tree,tr("fr")("manager.content.addOption")).props.onClick();tree=h.render();
  elements(tree).find(n=>n.props.placeholder===tr("fr")("manager.content.travelPass"))!.props.onChange({target:{value:"Choix du club"}});
  const readCount=reads.length;
  for(const locale of locales){lang.set(locale);tree=h.render();await flush();tree=h.render();assert.equal(reads.length,readCount,"locale changes must not reload or hydrate the form");assert.equal(elements(tree).find(n=>n.props.placeholder===tr(locale)("manager.content.springCamp"))!.props.value,"Stage personnalisé");assert.equal(elements(tree).find(n=>n.props.placeholder===tr(locale)("manager.content.travelPass"))!.props.value,"Choix du club");assert.ok(ui(tree).includes(tr(locale)("manager.content.dayNumber").replace("{number}","1")));assert.doesNotMatch(ui(tree),/manager\.content\./);}
  await button(tree,tr("it")("manager.content.saveDraft")).props.onClick();await flush();tree=h.render();
  assert.equal(writes.length,0,"a draft with days needs a head coach before any write");
  assert.ok(ui(tree).includes(tr("it")("manager.content.headRequired")));
  const headLabel=elements(tree).find(n=>n.type==="label"&&textContent(n).includes(tr("it")("manager.content.headCoach")));
  assert.ok(headLabel);elements(headLabel).find(n=>n.type==="select")!.props.onChange({target:{value:"coach"}});tree=h.render();
  await button(tree,tr("it")("manager.content.saveDraft")).props.onClick();await flush();assert.equal(writes.length,1);assert.equal(writes[0].title,"Stage personnalisé");assert.equal(writes[0].status,"draft");assert.equal(writes[0].head_coach_user_id,"coach");assert.equal(writes[0].days.length,1);assert.equal(writes[0].options[0].name,"Choix du club");assert.equal(writes[0].options[0].input_type,"checkbox");h.cleanup();
});

test("Manager profile retains edits and canonical field values in all locales; invalid passwords never write",async()=>{
  const lang=localized();const writes:any[]=[];let reads=0;
  const fixture={id:"coach",first_name:"Alex",last_name:"Exemple",phone:"",birth_date:"2000-01-01",sex:"other",handedness:"left",handicap:0,address:"",postal_code:"",city:"Sion",staff_function:"Responsable du club",avatar_url:null};
  const database={from(table:string){reads++;let single=false;const q:any={maybeSingle(){single=true;return q;},upsert(value:any){writes.push({table,value});return Promise.resolve({error:null});},then(resolve:any){return Promise.resolve({data:single?fixture:[],error:null}).then(resolve);}};for(const key of ["select","eq","in"])q[key]=()=>q;return q;}};
  const h=coachComponentHarness("app/manager/profile/page.tsx",{database,modules:{"@/components/i18n/AppI18nProvider":lang.module,"react-easy-crop":{default:"cropper"}},fetch:async()=>{throw Error("No email or auth changes expected");}});
  h.render();await flush();let tree=h.render();
  const field=(key:string)=>elements(tree).find(n=>n.props.label===tr(active)(`manager.profile.${key}`))!;let active:AppLocale="fr";
  elements(field("firstName")).find(n=>n.type==="input")!.props.onChange({target:{value:"Nom conservé"}});
  const before=reads;
  for(const locale of locales){active=locale;lang.set(locale);tree=h.render();assert.equal(reads,before);assert.equal(elements(field("firstName")).find(n=>n.type==="input")!.props.value,"Nom conservé");assert.equal(elements(field("handedness")).find(n=>n.type==="select")!.props.value,"left");assert.equal(elements(field("sex")).find(n=>n.type==="select")!.props.value,"other");assert.ok(ui(tree).includes(tr(locale)("manager.profile.title")));assert.doesNotMatch(ui(tree),/manager\.profile\./);}
  elements(tree).find(n=>n.props.name==="manager_new_password")!.props.onChange({target:{value:"short"}});tree=h.render();
  await button(tree,tr("it")("manager.profile.save")).props.onClick();tree=h.render();assert.equal(writes.length,0);assert.ok(ui(tree).includes(tr("it")("manager.profile.passwordShort")));
  elements(tree).find(n=>n.props.name==="manager_new_password")!.props.onChange({target:{value:""}});tree=h.render();
  await button(tree,tr("it")("manager.profile.save")).props.onClick();tree=h.render();assert.equal(writes.length,1);assert.equal(writes[0].table,"profiles");assert.equal(writes[0].value.first_name,"Nom conservé");assert.equal(writes[0].value.handedness,"left");assert.equal(writes[0].value.handicap,0);assert.ok(ui(tree).includes(tr("it")("manager.profile.saved")));h.cleanup();
});
