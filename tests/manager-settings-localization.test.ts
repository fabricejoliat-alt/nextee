/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated UI fixtures, no live writes. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerSettingsEntries } from "../lib/i18n/managerSettingsMessages.ts";
import { managerSettingsPresentation } from "../lib/managerSettingsPresentation.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
const locales: AppLocale[] = ["fr", "en", "de", "it"];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;
const label = (locale: AppLocale, key: string) => tr(locale)(`manager.settings.${key}`);
const paths = ["app/manager/ai-assistance/page.tsx", "app/manager/user-management/seasons/page.tsx", "app/manager/training-volume/page.tsx"];
const ui = (tree: any) => elements(tree).map(n => [textContent(n), n.props.label, n.props.title, n.props["aria-label"], n.props.placeholder, n.props["data-label"]].filter(v => typeof v === "string").join(" ")).join(" ");
const button = (tree: any, text: string) => { const found = elements(tree).find(n => n.type === "button" && textContent(n).trim() === text); assert.ok(found, text); return found; };
const field = (tree: any, name: string) => { const found = elements(tree).find(n => n.props.label === name || n.type === "label" && elements(n).some(c => c.type === "span" && textContent(c) === name)); assert.ok(found, name); const input = elements(found).find(n => ["input", "select", "textarea"].includes(n.type)); assert.ok(input, name); return input; };
function localized() { let locale: AppLocale = "fr"; const translators=Object.fromEntries(locales.map(l=>[l,tr(l)]));return {set(l:AppLocale){locale=l;}, module:{useI18n:()=>({locale,t:translators[locale]})}}; }
const event = { preventDefault(){} };
const club = {id:"club",name:"Club du test"};

test("settings UI keys and interpolation resolve in all languages, with localized known API feedback",()=>{
  for(const [key,values] of Object.entries(managerSettingsEntries)) for(const locale of locales){
    const text=label(locale,key);assert.ok(text?.trim());
    const tokens=(value:string)=>[...value.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(text),tokens(values[0]),`${locale}: ${key}`);
  }
  for(const path of paths){const source=readFileSync(path,"utf8"),ast=ts.createSourceFile(path,source,99,true,ts.ScriptKind.TSX);
    function visit(node:ts.Node){if(ts.isJsxText(node))assert.doesNotMatch(node.text,/[A-Za-zÀ-ÿ]{2}/,`${path}: fixed JSX`);ts.forEachChild(node,visit);}visit(ast);
    for(const [,key]of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of locales)assert.ok(messages[locale][key],`${locale}: ${key}`);
  }
  const p=managerSettingsPresentation(tr("de"),"de");
  assert.equal(p.errorText("Une saison porte déjà ce nom dans ce club."),label("de","seasons.duplicate"));
  assert.equal(p.errorText("Unknown diagnostic"),"Unknown diagnostic");
  assert.equal(p.format("ai.enabledSuccess",{name:"Coach {name}"}),"KI-Unterstützung für Coach {name} aktiviert.");
  assert.equal(p.count("volume.levelCount",1),"1 Niveau konfiguriert.");assert.equal(p.count("volume.levelCount",0),"0 Niveaus konfiguriert.");
});

test("AI access keeps canonical IDs and booleans, preserves search across locales and rolls back failed updates",async()=>{
  const lang=localized();const writes:any[]=[];let reads=0,fail=false;
  const coaches=[{id:"active",role:"coach",is_active:true,coach_training_assistance_enabled:false,profiles:{first_name:"Zoé",last_name:"Exemple",staff_function:"Fonction personnalisée"}},{id:"inactive",role:"coach",is_active:false,coach_training_assistance_enabled:true,profiles:{first_name:"Alex",last_name:"Inactif"}},{id:"player",role:"player",is_active:true,profiles:{first_name:"Junior"}}];
  const h=coachComponentHarness(paths[0],{modules:{"@/components/i18n/AppI18nProvider":lang.module,"@/components/manager/ManagerMemberAvatar":{default:"avatar"}},fetch:async(url,init)=>{if(init?.method==="PATCH"){writes.push(JSON.parse(String(init.body)));return Response.json(fail?{error:"Forbidden"}:{ok:true},{status:fail?403:200});}reads++;return Response.json(String(url).includes("my-clubs")?{clubs:[club]}:{members:coaches});}});
  let tree=h.render();for(let index=0;index<4;index++){await flush();tree=h.render();}assert.equal(elements(tree).filter(n=>n.props.role==="switch").length,2);assert.ok(elements(tree).find(n=>n.props.role==="switch"&&n.props.disabled));
  elements(tree).find(n=>n.type==="input")!.props.onChange({target:{value:"Zoé"}});tree=h.render();const initialReads=reads;
  for(const locale of locales){lang.set(locale);tree=h.render();await flush();tree=h.render();assert.equal(reads,initialReads);assert.equal(elements(tree).find(n=>n.type==="input")!.props.value,"Zoé");assert.ok(ui(tree).includes("Fonction personnalisée"));assert.ok(ui(tree).includes(label(locale,"ai.title")));assert.equal(elements(tree).filter(n=>n.props.role==="switch").length,1);assert.doesNotMatch(ui(tree),/manager\.settings\./);}
  elements(tree).find(n=>n.props.role==="switch")!.props.onClick();await flush();tree=h.render();assert.deepEqual(writes[0],{memberId:"active",coach_training_assistance_enabled:true});assert.equal(elements(tree).find(n=>n.props.role==="switch")!.props["aria-checked"],true);
  lang.set("de");tree=h.render();assert.ok(ui(tree).includes("KI-Unterstützung für Zoé Exemple aktiviert."));
  fail=true;elements(tree).find(n=>n.props.role==="switch")!.props.onClick();await flush();tree=h.render();assert.equal(elements(tree).find(n=>n.props.role==="switch")!.props["aria-checked"],true);assert.ok(ui(tree).includes(label("de","forbidden")));assert.deepEqual(writes[1],{memberId:"active",coach_training_assistance_enabled:false});h.cleanup();
});

test("season drafts and rename state survive locale switches; dates and payloads keep their canonical values",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;
  const season={id:"season",name:"Saison {name}",starts_on:"2026-09-01",ends_on:"2027-08-31",is_current:true};
  const h=coachComponentHarness(paths[1],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async(url,init)=>{if(init?.method){const body=JSON.parse(String(init.body));writes.push({method:init.method,body});return Response.json({season:{...season,name:body.name}});}reads++;return Response.json(String(url).includes("my-clubs")?{clubs:[club]}:{seasons:[season]});}});
  let tree=h.render();for(let index=0;index<4;index++){await flush();tree=h.render();}field(tree,label("fr","name")).props.onChange({target:{value:"Ma saison"}});field(tree,label("fr","seasons.start")).props.onChange({target:{value:"2027-09-01"}});field(tree,label("fr","seasons.end")).props.onChange({target:{value:"2028-08-31"}});
  elements(tree).find(n=>n.props.title===label("fr","seasons.edit"))!.props.onClick();tree=h.render();field(tree,label("fr","seasons.name")).props.onChange({target:{value:"Nom conservé"}});const before=reads;
  for(const locale of locales){lang.set(locale);tree=h.render();await flush();tree=h.render();assert.equal(reads,before);assert.equal(field(tree,label(locale,"name")).props.value,"Ma saison");assert.equal(field(tree,label(locale,"seasons.name")).props.value,"Nom conservé");assert.equal(field(tree,label(locale,"seasons.start")).props.value,"2027-09-01");assert.ok(ui(tree).includes(label(locale,"seasons.configured")));assert.doesNotMatch(ui(tree),/manager\.settings\./);}
  await elements(tree).find(n=>n.type==="form"&&elements(n).some(c=>c.props.title===label("it","save")))!.props.onSubmit(event);await flush();tree=h.render();assert.deepEqual(writes[0],{method:"PATCH",body:{season_id:"season",name:"Nom conservé"}});
  await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);await flush();assert.deepEqual(writes[1],{method:"POST",body:{name:"Ma saison",starts_on:"2027-09-01",ends_on:"2028-08-31",is_current:true}});h.cleanup();
});

test("season club load errors leave loading state and localize without another request",async()=>{
  const lang=localized();let reads=0;
  const h=coachComponentHarness(paths[1],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async()=>{reads++;return Response.json({error:"Forbidden"},{status:403});}});
  h.render();await flush();let tree=h.render();assert.ok(ui(tree).includes(label("fr","forbidden")));assert.equal(elements(tree).filter(n=>n.type==="skeleton").length,0);lang.set("it");tree=h.render();assert.ok(ui(tree).includes(label("it","forbidden")));assert.equal(reads,1);h.cleanup();
});

const volumeRow={id:"row",ftem_code:"T1",level_label:"Niveau du club",handicap_label:"Libellé maison",handicap_min:10,handicap_max:20,motivation_text:"Texte du club",minutes_offseason:120,minutes_inseason:240,sort_order:10};
test("FTEM months, draft validation and authored labels survive locale switches; save sends stable codes and months",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;
  const payload={rows:[volumeRow],settings:{season_months:[4,5,6,7,8,9]},defaults:{rows:[volumeRow],settings:{season_months:[4,5,6,7,8,9]}}};
  const h=coachComponentHarness(paths[2],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async(url,init)=>{if(init?.method==="PUT"){writes.push(JSON.parse(String(init.body)));return Response.json({ok:true});}reads++;return Response.json(String(url).includes("my-clubs")?{clubs:[club]}:payload);}});
  let tree=h.render();for(let index=0;index<4;index++){await flush();tree=h.render();}elements(tree).find(n=>n.props.role==="switch")!.props.onClick();elements(tree).find(n=>n.props.title===label("fr","edit"))!.props.onClick();tree=h.render();field(tree,label("fr","volume.levelName")).props.onChange({target:{value:"Nom personnalisé"}});field(tree,label("fr","volume.inSeasonMinutes")).props.onChange({target:{value:"360"}});
  const before=reads;
  for(const locale of locales){lang.set(locale);tree=h.render();await flush();tree=h.render();assert.equal(reads,before);assert.equal(field(tree,label(locale,"volume.levelName")).props.value,"Nom personnalisé");assert.equal(field(tree,label(locale,"volume.inSeasonMinutes")).props.value,"360");assert.equal(elements(tree).filter(n=>n.props.role==="switch").length,12);assert.equal(elements(tree).find(n=>n.props.role==="switch")!.props["aria-checked"],true);assert.ok(ui(tree).includes("Libellé maison"));assert.ok(ui(tree).includes("Texte du club"));assert.doesNotMatch(ui(tree),/manager\.settings\./);}
  await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);tree=h.render();button(tree,label("it","volume.saveChanges")).props.onClick();await flush();tree=h.render();assert.equal(writes.length,1);assert.deepEqual(writes[0].season_months,[1,4,5,6,7,8,9]);assert.deepEqual(writes[0].offseason_months,[2,3,10,11,12]);assert.deepEqual(writes[0].rows,[{ftem_code:"T1",level_label:"Nom personnalisé",handicap_label:"Libellé maison",handicap_min:"10",handicap_max:"20",motivation_text:"Texte du club",minutes_offseason:"120",minutes_inseason:"360",sort_order:"10"}]);
  button(tree,label("it","volume.add")).props.onClick();tree=h.render();field(tree,label("it","volume.ftemCode")).props.onChange({target:{value:"T1"}});tree=h.render();await elements(tree).find(n=>n.type==="form")!.props.onSubmit(event);tree=h.render();assert.ok(ui(tree).includes(label("it","volume.duplicateCode")));lang.set("de");tree=h.render();assert.ok(ui(tree).includes(label("de","volume.duplicateCode")));assert.equal(field(tree,label("de","volume.ftemCode")).props.value,"T1");assert.equal(writes.length,1,"validation cannot persist configuration");h.cleanup();
});
