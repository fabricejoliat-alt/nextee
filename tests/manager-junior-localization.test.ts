/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated fixtures; no real accounts, imports or emails. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as XLSX from "xlsx";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerJuniorEntries } from "../lib/i18n/managerJuniorMessages.ts";
import { managerJuniorFeedback } from "../lib/managerJuniorPresentation.ts";
import { juniorImportDate, parseJuniorImportRows, createJuniorImportProgress, runJuniorImport } from "../lib/managerJuniorImport.ts";
import { defaultFamilyMailConfig } from "../lib/familyAccess.ts";
import { loadManagerModule, managerDatabase, managerFixture } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
const locales: AppLocale[] = ["fr", "en", "de", "it"];
const tr = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;
function localized() { let locale: AppLocale = "fr"; const translators=Object.fromEntries(locales.map(l=>[l,tr(l)]));return {set(l:AppLocale){locale=l;}, module:{useI18n:()=>({locale,t:translators[locale]})}}; }
const paths = ["PlayerCreatePage", "PlayersExcelImportPage", "FamilyEmailConfigurationPage", "PlayerEditPage", "ManagerPlayerStatistics", "ManagerPeriodicReport"].map(name => `components/manager/${name}.tsx`);
async function settle(h: ReturnType<typeof coachComponentHarness>) { let tree=h.render(); for(let i=0;i<4;i++){await flush();tree=h.render();}return tree; }
const ui = (tree: any) => elements(tree).map(n => [textContent(n), n.props.label, n.props.error, n.props.title, n.props["aria-label"], n.props.placeholder, n.props["data-label"]].filter(v => typeof v === "string").join(" ")).join(" ");
const button = (tree: any, text: string) => { const found=elements(tree).find(n=>n.type==="button"&&textContent(n).trim()===text);assert.ok(found,text);return found; };
const source = { junior_first_name:"Léa",junior_last_name:"Exemple",junior_birth_date:"2014-02-28",parent_first_name:"Alex",parent_last_name:"Exemple",parent_email:"QA@Example.Test",parent_relation:"mother",is_primary:"true" };

test("junior messages resolve in four languages with matching placeholders and no fixed interface copy",()=>{
  for(const [key,values]of Object.entries(managerJuniorEntries))for(const locale of locales){const actual=tr(locale)(`manager.junior.${key}`);assert.ok(actual.trim());const tokens=(s:string)=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(actual),tokens(values[0]),`${locale}: ${key}`);}
  for(const path of paths){const source=readFileSync(path,"utf8"),ast=ts.createSourceFile(path,source,99,true,ts.ScriptKind.TSX);function visit(n:ts.Node){if(ts.isJsxText(n)&&!["Français","Deutsch","Italiano","English"].includes(n.text))assert.doesNotMatch(n.text,/[A-Za-zÀ-ÿ]{2}/,`${path}: ${n.text}`);if(ts.isJsxAttribute(n)&&["label","title","placeholder","aria-label","data-label"].includes(n.name.getText(ast))&&n.initializer&&ts.isStringLiteral(n.initializer))assert.doesNotMatch(n.initializer.text,/[A-Za-zÀ-ÿ]{2}/,path);ts.forEachChild(n,visit);}visit(ast);for(const [,key]of source.matchAll(/\bt\("([^"]+)"\)/g))for(const locale of locales)assert.ok(messages[locale][key],`${locale}: ${key}`);}
  assert.equal(managerJuniorFeedback(tr("de"),"Date de naissance manquante ou invalide"),tr("de")("manager.junior.import.birthInvalid"));
  assert.equal(managerJuniorFeedback(tr("it"),"Diagnostic du club {name}"),"Diagnostic du club {name}");
});

test("import rejects impossible calendar dates and preserves leap days without timezone shifts",()=>{
  for(const value of ["2025-02-29","31.04.2014","2014-13-01","00/01/2014","2014-00-01","not a date",""])assert.equal(juniorImportDate(value),"",value);
  for(const value of ["2024-02-29","29.02.2024","29/2/2024"])assert.equal(juniorImportDate(value),"2024-02-29");
});

test("legacy and localized spreadsheet headers produce identical canonical rows",()=>{
  const variants = [
    {"Prénom junior":"Léa","Nom junior":"Exemple","Date de naissance":"28.02.2014","Prénom parent":"Alex","Nom parent":"Exemple","E-mail parent":"QA@Example.Test","Relation":"Mère","Parent principal":"oui"},
    {"Junior first name":"Léa","Junior last name":"Exemple","Date of birth":"28.02.2014","Parent first name":"Alex","Parent last name":"Exemple","Parent email":"QA@Example.Test","Relation":"Mother","Primary parent":"yes"},
    {"Vorname Junior":"Léa","Nachname Junior":"Exemple","Geburtsdatum":"28.02.2014","Vorname Elternteil":"Alex","Nachname Elternteil":"Exemple","E-Mail Elternteil":"QA@Example.Test","Beziehung":"Mutter","Hauptkontakt":"ja"},
    {"Nome junior":"Léa","Cognome junior":"Exemple","Data di nascita":"28.02.2014","Nome genitore":"Alex","Cognome genitore":"Exemple","E-mail genitore":"QA@Example.Test","Relazione":"Madre","Genitore principale":"sì"},
  ];
  const expected=parseJuniorImportRows([source],[])[0];for(const raw of variants)assert.deepEqual(parseJuniorImportRows([raw],[])[0],expected);
  const rows=parseJuniorImportRows([source,{...source,junior_first_name:"Lea"},{...source,junior_birth_date:"31.02.2014"}],[{role:"parent",user_id:"parent",auth_email:"qa@example.test"}]);assert.equal(rows[0].parent_exists,true);assert.equal(rows[1].possible_duplicate,true);assert.deepEqual(rows[2].errors,["manager.junior.import.birthInvalid"]);
});

test("import retry resumes only failed steps and keeps successful juniors, parents and links",async()=>{
  const rows=parseJuniorImportRows([source,{...source,junior_first_name:"Tom",is_primary:"false"},{...source,junior_first_name:"Invalid",junior_birth_date:"31/02/2014"}],[]);
  const progress=createJuniorImportProgress(),writes:any[]=[];let fail=true;
  const request=async(path:string,body:any)=>{writes.push({path,body});if(body.role==="player")return{user:{id:body.first_name}};if(body.role==="parent")return{user:{id:"parent"}};if(body.player_id==="Tom"&&fail)throw new Error("manager.junior.import.linkError");return{};};
  const first=await runJuniorImport(rows,"club",progress,request);assert.deepEqual(first,{juniors_created_or_updated:2,parents_created_or_updated:1,associations:1,errors:[{row:3,error:"manager.junior.import.linkError"}]});
  fail=false;const before=writes.length;const second=await runJuniorImport(rows,"club",progress,request);assert.equal(writes.length,before+1);assert.deepEqual(writes.at(-1),{path:"/api/manager/clubs/club/guardians",body:{player_id:"Tom",guardian_user_id:"parent",relation:"mother",is_primary:false}});assert.deepEqual(second,{juniors_created_or_updated:2,parents_created_or_updated:1,associations:2,errors:[]});
  await runJuniorImport(rows,"club",progress,request);assert.equal(writes.length,before+1);assert.ok(writes.every(w=>!w.path.includes("invitation")));assert.equal(writes.filter(w=>w.body.role==="player").length,2);
});

test("junior creation keeps drafts and custom values across locales, then retries a failed season without recreating the account",async()=>{
  const lang=localized(),writes:any[]=[],navigated:string[]=[];let reads=0,fail=true;
  const fields=[{id:"flag",label:"Champ du club",field_type:"boolean",scope:"permanent",is_active:true,is_required:true},{id:"choices",label:"Choix maison",field_type:"checkbox",scope:"season",is_active:true},{id:"restricted",label:"Secret",field_type:"short_text",scope:"permanent",is_active:true,is_sensitive:true}];
  const h=coachComponentHarness(paths[0],{modules:{"@/components/i18n/AppI18nProvider":lang.module},navigate:p=>navigated.push(p),fetch:async(url,init)=>{if(init?.method){const body=JSON.parse(String(init.body));writes.push({url:String(url),body});return init.method==="POST"?Response.json({member:{id:"member"}}):Response.json(fail?{error:"Le junior est créé, mais ses paramètres de saison n’ont pas pu être enregistrés."}:{ok:true},{status:fail?500:200});}reads++;return Response.json(String(url).endsWith("my-clubs")?{clubs:[{id:"club",name:"Club maison"}]}:String(url).endsWith("members")?{playerFields:fields}:{seasons:[{id:"season",name:"Saison maison",is_current:true}]});}});
  let tree=await settle(h);
  for(const [key,value]of [["firstRequired","Léa"],["lastRequired","Exemple"],["birthRequiredLabel","2014-02-28"]]){elements(tree).find(n=>n.props.label===tr("fr")(`manager.junior.${key}`))!.props.onChange(value);tree=h.render();}
  elements(tree).find(n=>n.props.errorPrefix==="permanent")!.props.setValues({flag:false,restricted:"MUST NOT SEND"});tree=h.render();elements(tree).find(n=>n.type==="select"&&elements(n).some(c=>c.type==="option"&&c.props.value==="season"))!.props.onChange({target:{value:"season"}});tree=h.render();elements(tree).find(n=>n.props.errorPrefix==="season")!.props.setValues({choices:["Option maison"]});tree=h.render();const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(elements(tree).find(n=>n.props.label===tr(locale)("manager.junior.firstRequired"))!.props.value,"Léa");assert.doesNotMatch(ui(tree),/manager\.(junior|administration)\./);}
  const submit=()=>elements(tree).find(n=>n.type==="form")!.props.onSubmit({preventDefault(){}});await Promise.all([submit(),submit()]);tree=h.render();assert.equal(writes.length,2);assert.deepEqual(writes[0].body.player_field_values,{flag:false});assert.equal(writes[0].body.role,"player");assert.deepEqual(writes[1].body,{member_ids:["member"],custom_field_values:{choices:["Option maison"]}});assert.ok(elements(tree).find(n=>n.type==="fieldset"&&n.props.disabled));assert.equal(navigated.length,0);
  fail=false;await submit();assert.equal(writes.length,3);assert.ok(writes[2].url.endsWith("/records"));assert.deepEqual(navigated,["/manager/user-management/players/member?club=club&season=season"]);h.cleanup();
});

test("email template interface changes language without replacing authored templates or draft edits",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;const original={...defaultFamilyMailConfig(),parent_subject:"Objet du club {{parent_name}}",parent_body:"Texte du club {{junior_name}}"};
  const h=coachComponentHarness(paths[2],{modules:{"@/components/i18n/AppI18nProvider":lang.module},fetch:async(url,init)=>{if(init?.method){const body=JSON.parse(String(init.body));writes.push(body);return Response.json({mail_config:body});}reads++;return Response.json(String(url).endsWith("my-clubs")?{clubs:[{id:"club"}]}:{mail_config:original});}});
  let tree=await settle(h);elements(tree).find(n=>n.type==="textarea"&&n.props.value===original.parent_body)!.props.onChange({target:{value:"Brouillon {{junior_name}}"}});tree=h.render();const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.ok(elements(tree).some(n=>n.type==="textarea"&&n.props.value==="Brouillon {{junior_name}}"));assert.ok(ui(tree).includes(tr(locale)("manager.junior.emails.parent.title")));assert.doesNotMatch(ui(tree),/manager\.junior\./);}
  button(tree,tr("it")("manager.save")).props.onClick();tree=await settle(h);assert.equal(writes.length,1);assert.deepEqual(writes[0],{...original,parent_body:"Brouillon {{junior_name}}"});assert.ok(ui(tree).includes(tr("it")("manager.junior.emails.saved")));h.cleanup();
});

test("periodic report keeps its own language and recipients, requires saving drafts, and displays partial delivery failures",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;
  let config={is_enabled:true,frequency:"monthly",send_day:5,timezone:"Europe/Zurich",locale:"fr",recipient_user_ids:["parent"],sections:{attendance:true,training:false},coach_priority:"Priorité maison",coach_objective:"Objectif maison",coach_encouragement:"Bravo",coach_comment:"Commentaire maison",next_send_at:"2026-10-05T08:00:00Z",last_sent_at:null,last_status:"failed"};
  const h=coachComponentHarness("components/manager/ManagerPeriodicReport.tsx",{props:{clubId:"club",playerId:"player",familyUrl:"/manager/access"},modules:{"@/components/i18n/AppI18nProvider":lang.module,"@/components/parent/PeriodicReportView":{PeriodicReportView:"report-view"}},fetch:async(_url,init)=>{if(init?.method){const body=JSON.parse(String(init.body));writes.push({method:init.method,body});if(init.method==="PUT"){config=body;return Response.json({config});}return body.action==="preview"?Response.json({preview:{clubName:"Club maison",periodLabel:"Septembre",sections:{coachComment:"Commentaire maison"}}}):Response.json({sent:["qa@example.test"],errors:[{email:"failed@example.test",error:"Diagnostic de livraison"}]});}reads++;return Response.json({config,recipients:[{userId:"parent",name:"Parent maison",email:"qa@example.test",isPrimary:true}],history:[{id:"history",period_from:"2026-09-01",period_to:"2026-09-30",delivery_mode:"automatic",status:"failed",error_message:null,attempt_count:1,sent_at:null,created_at:"invalid-date"}]});}});
  let tree=await settle(h);elements(tree).find(n=>n.type==="input"&&n.props.value==="Priorité maison")!.props.onChange({target:{value:"Nouvelle priorité"}});tree=h.render();const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(elements(tree).find(n=>n.type==="select"&&n.props.value==="fr")!.props.value,"fr");assert.ok(ui(tree).includes(tr(locale)("manager.junior.report.saveFirst")));assert.ok(ui(tree).includes(tr(locale)("manager.junior.report.status.failed")));assert.ok(button(tree,tr(locale)("manager.junior.report.preview")).props.disabled);assert.doesNotMatch(ui(tree),/manager\.junior\./);}
  button(tree,tr("it")("manager.junior.report.preview")).props.onClick();await flush();assert.equal(writes.length,0);
  button(tree,tr("it")("manager.junior.report.save")).props.onClick();tree=await settle(h);assert.equal(writes[0].body.coach_priority,"Nouvelle priorité");assert.equal(writes[0].body.locale,"fr");assert.equal(writes[0].body.sections.training,false);assert.deepEqual(writes[0].body.recipient_user_ids,["parent"]);
  button(tree,tr("it")("manager.junior.report.preview")).props.onClick();tree=await settle(h);assert.equal(elements(tree).find(n=>n.type==="report-view")!.props.report.personalized_comment,"Commentaire maison");assert.equal(elements(tree).find(n=>n.type==="report-view")!.props.locale,"fr");
  button(tree,tr("it")("manager.junior.report.test")).props.onClick();tree=await settle(h);assert.ok(ui(tree).includes("failed@example.test"));assert.ok(ui(tree).includes("Diagnostic de livraison"));assert.ok(ui(tree).includes("qa@example.test"));assert.deepEqual(writes.at(-1).body,{action:"test"});h.cleanup();
});

test("junior profile and family tabs retain drafts, consent and custom fields in every language without changing credentials",async()=>{
  const lang=localized(),writes:any[]=[];let reads=0;
  const member={id:"member",user_id:"player",role:"player",is_active:true,is_performance:true,player_consent_status:"pending",auth_email:"junior@example.test",custom_field_values:{flag:false},profiles:{first_name:"Léa",last_name:"Exemple",birth_date:"2014-02-28",username:"junior",sex:"female",handicap:0,avs_no:""}};
  const parent={id:"parent-member",user_id:"parent",role:"parent",auth_email:"parent@example.test",profiles:{first_name:"Alex",last_name:"Exemple",username:"alex"}};
  const consent={status:"pending",decided_at:null,signer_guardian_user_id:"parent",signer_name:"Alex Exemple",source:"manager",consent_version:"v1",internal_notes:"Note privée maison"};
  const families={club:{name:"Club maison"},mail_config:{...defaultFamilyMailConfig(),parent_subject:"Objet maison {{parent_name}}"},parents:[{parent_user_id:"parent",parent_name:"Alex Exemple",parent_username:"alex",parent_email:null,parent_status:"not_ready",parent_send_count:0}],juniors:[{junior_user_id:"player",junior_name:"Léa Exemple",junior_username:"junior",junior_email:"junior@example.test",parents:[],recipient_email:"junior@example.test",recipient_name:"Léa Exemple",junior_status:"ready",junior_send_count:0}]};
  const h=coachComponentHarness("components/manager/PlayerEditPage.tsx",{props:{memberId:"member"},modules:{"@/components/i18n/AppI18nProvider":lang.module,"next/navigation":{useSearchParams:()=>new URLSearchParams({club:"club",season:"season"})},"@/components/manager/ManagerPlayerStatistics":{default:"statistics"},"@/components/manager/ManagerPeriodicReport":{default:"periodic-report"},recharts:Object.fromEntries(["CartesianGrid","Line","LineChart","ResponsiveContainer","Tooltip","XAxis","YAxis"].map(n=>[n,n]))},fetch:async(url,init)=>{if(init?.method){writes.push({url:String(url),body:JSON.parse(String(init.body??"{}"))});return Response.json({ok:true});}reads++;const path=String(url);return Response.json(path.endsWith("members")?{members:[member,parent],playerFields:[{id:"flag",label:"Option du club",field_type:"boolean",scope:"permanent",is_active:true},{id:"seasonFlag",label:"Choix maison",field_type:"boolean",scope:"season",is_active:true}]}:path.endsWith("seasons")?{seasons:[{id:"season",name:"Saison maison",is_current:true}]}:path.endsWith("guardians")?{parents:[parent],all_links:[{player_id:"player",guardian_user_id:"parent",relation:"mother",is_primary:true}]}:path.endsWith("consent")?{consent,history:[],guardians:[{guardian_user_id:"parent",guardian_name:"Alex Exemple",email:"parent@example.test"}]}:path.endsWith("access-invitations")?families:path.endsWith("handicap-history")?{entries:[],current_handicap:0}:{records:[{club_member_id:"member",registration_status:"cancelled",custom_field_values:{seasonFlag:false}}]});}});
  let tree=await settle(h);elements(tree).find(n=>n.props.label===tr("fr")("manager.profile.firstName"))!.props.onChange("Prénom conservé");tree=h.render();const before=reads;
  for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(reads,before);assert.equal(elements(tree).find(n=>n.props.label===tr(locale)("manager.profile.firstName"))!.props.value,"Prénom conservé");assert.equal(elements(tree).find(n=>n.props.label===tr(locale)("manager.administration.loginEmail"))!.props.readOnly,true);assert.equal(elements(tree).find(n=>n.props.prefix==="permanent")!.props.values.flag,false);assert.equal(elements(tree).find(n=>n.props.prefix==="season")!.props.values.seasonFlag,false);assert.ok(!elements(tree).some(n=>n.props.label===tr(locale)("manager.junior.avs")));assert.doesNotMatch(ui(tree),/manager\.junior\./);}
  await elements(tree).find(n=>n.type==="form")!.props.onSubmit({preventDefault(){}});tree=await settle(h);assert.equal(writes[0].body.role,"player");assert.equal(writes[0].body.first_name,"Prénom conservé");assert.equal(writes[0].body.email,undefined);assert.equal(writes[0].body.password,undefined);assert.deepEqual(writes[0].body.custom_field_values,{flag:false});
  await elements(tree).filter(n=>n.type==="form")[1].props.onSubmit({preventDefault(){}});tree=await settle(h);assert.deepEqual(writes[1].body,{member_ids:["member"],registration_status:"cancelled",custom_field_values:{seasonFlag:false}});
  button(tree,tr("it")("manager.junior.edit.family")).props.onClick();tree=h.render();elements(tree).find(n=>n.props["aria-label"]==="Anteprima dell’invito per Alex Exemple")!.props.onClick();tree=h.render();let preview=elements(tree).find(n=>n.props.preview)?.props.preview;assert.equal(preview.canSend,false);assert.equal(preview.recipient,null);assert.equal(preview.subject,"Objet maison Alex Exemple");
  lang.set("de");tree=await settle(h);preview=elements(tree).find(n=>n.props.preview)?.props.preview;assert.equal(preview.canSend,false);assert.equal(preview.subject,"Objet maison Alex Exemple");assert.equal(writes.length,2);assert.ok(ui(tree).includes(tr("de")("manager.junior.edit.status.ready")));h.cleanup();
});

test("adding an existing parent account links the selected junior and reports reuse after reloading the family", async () => {
  const lang = localized(), writes: any[] = [];
  let linked = false;
  const member = { id: "member", user_id: "player", role: "player", is_active: true, profiles: { first_name: "Junior", last_name: "QA" } };
  const parent = { user_id: "parent", profiles: { first_name: "Parent", last_name: "QA" } };
  const h = coachComponentHarness("components/manager/PlayerEditPage.tsx", {
    props: { memberId: "member" },
    modules: {
      "@/components/i18n/AppI18nProvider": lang.module,
      "next/navigation": { useSearchParams: () => new URLSearchParams({ club: "club", tab: "parent-access" }) },
      "@/components/manager/ManagerPlayerStatistics": { default: "statistics" },
      "@/components/manager/ManagerPeriodicReport": { default: "periodic-report" },
    },
    fetch: async (url, init) => {
      const path = String(url);
      if (init?.method) {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });
        if (path.endsWith("create-member")) return Response.json({ user: { id: "parent" }, username: "existing.parent", tempPassword: null });
        assert.ok(path.endsWith("guardians"));
        linked = true;
        return Response.json({ ok: true });
      }
      return Response.json(path.endsWith("members") ? { members: [member], playerFields: [] }
        : path.endsWith("seasons") ? { seasons: [] }
        : path.endsWith("guardians") ? { parents: linked ? [parent] : [], all_links: linked ? [{ player_id: "player", guardian_user_id: "parent", relation: "mother", is_primary: false }] : [] }
        : path.endsWith("consent") ? { consent: { status: "pending" }, history: [], guardians: [] }
        : path.endsWith("access-invitations") ? { club: { name: "Club QA" }, mail_config: defaultFamilyMailConfig(), parents: [], juniors: [] }
        : { entries: [] });
    },
  });
  try {
    let tree = await settle(h);
    for (const [key, value] of [["manager.profile.firstName", "Parent"], ["manager.content.name", "QA"], ["manager.administration.email", "PARENT@EXAMPLE.TEST"]]) {
      elements(tree).find(n => n.props.label === tr("fr")(key))!.props.onChange(value);
      tree = h.render();
    }
    await elements(tree).find(n => n.type === "form")!.props.onSubmit({ preventDefault() {} });
    tree = await settle(h);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].body.player_id, "player");
    assert.equal(writes[0].body.role, "parent");
    assert.equal(writes[0].body.email, "parent@example.test");
    assert.equal(writes[1].body.player_id, "player");
    assert.equal(writes[1].body.guardian_user_id, "parent");
    assert.ok(ui(tree).includes("existing.parent"));
    assert.ok(ui(tree).includes(tr("fr")("manager.junior.edit.parentLinked")));
    assert.ok(ui(tree).includes(tr("fr")("manager.junior.edit.existingLinked")));
    assert.ok(!ui(tree).includes(tr("fr")("manager.junior.edit.passwordPrefix")));
    assert.ok(ui(tree).includes("Parent QA"));
  } finally { h.cleanup(); }
});

test("statistical presentation preserves zeroes, custom responses and sample thresholds", async()=>{
  const { managerJuniorStatisticsLabels } = await import("../lib/managerJuniorStatisticsPresentation.ts");
  const { playerSummarySignals } = await import("../lib/playerStatistics.ts");
  assert.deepEqual(playerSummarySignals({attendanceRate:75,objectiveRate:null,regularityRate:null,handicapChange:null,samples:2}),[]);
  assert.deepEqual(playerSummarySignals({attendanceRate:75,objectiveRate:0,regularityRate:50,handicapChange:1,samples:3}).map(s=>s.kind),["attendance","objective","improvement"]);
  for(const locale of locales){const labels=managerJuniorStatisticsLabels(tr(locale),locale);assert.equal(labels.value(0),"0");assert.equal(labels.value(null),"—");assert.equal(labels.minutes(59.8),"1 h 00");assert.equal(labels.customResponse(false),tr(locale)("manager.content.no"));assert.equal(labels.customResponse(false,[{value:false,label:"Choix maison"}]),"Choix maison");assert.equal(labels.customResponse("Texte libre maison"),"Texte libre maison");assert.equal(labels.category("Catégorie maison"),"Catégorie maison");assert.equal(labels.category("long_game"),tr(locale)("cat.long_game"));assert.ok(!labels.responseFormat("yes_no").startsWith("manager."));assert.equal(labels.summary({attendance:{rate:null,denominator:0},training:{objectiveRate:null},regularity:{rate:null},handicap:{change:null}}),tr(locale)("manager.junior.stats.summaryEmpty"));}
});

test("all junior statistics tabs localize loaded data and dates, preserve authored content, and tolerate a cleared date",async()=>{
  const lang=localized();let reads=0;
  const stats={generatedAt:"2026-09-01T10:00:00Z",summary:"Server French summary",player:{isPerformance:true},benchmark:{enabled:false,cohortSize:2,reason:"Server French reason"},overview:{attendance:{rate:75,present:3,denominator:4},training:{minutes:90,sessions:2,averageMinutes:45,weeklyAverageMinutes:20.5,objectiveMinutes:100,objectiveRate:90,ftemCode:"T1",ftemLabel:"Niveau maison",change:0},regularity:{rate:50,activeWeeks:2,totalWeeks:4,longestStreak:2,inactiveWeeks:2},handicap:{end:0,change:1},play:{competitions:1,rounds:2,holes:36,results:2},evaluations:{coachCompleted:1,playerCompleted:1,expected:2,completionRate:50}},attendance:{rate:75,change:2.5,invited:4,present:3,absent:1,excused:0,pending:0,monthly:[{month:"2026-09",rate:75}],byType:[{label:"Stages et camps",present:3,invited:4}]},training:{byOrigin:[{key:"club",minutes:90,sessions:2,percentage:100}],byCategory:[{key:"long_game",minutes:90,sessions:2,percentage:100}],feelings:{motivation:0,difficulty:3,satisfaction:4,completed:1}},play:{holes:36,completedRounds:2,frequencyPerMonth:2.5,averageScore:72,averagePutts:30,girRate:75,girSample:36,fairwayRate:50,fairwaySample:20,scramblingRate:null,scramblingSample:0,averagePar3:3,averagePar4:4,averagePar5:5,averageFront:4,averageBack:4,competitionLevels:["Niveau maison"],orderOfMeritPoints:12.5,scores:{eagles:0,birdies:2,pars:20,bogeys:10,doublesPlus:4}},handicapHistory:[{effectiveDate:"2026-09-01",value:0}],evaluations:{events:[{id:"event",title:"Activité maison"}],coach:[{event_id:"event",engagement:3,attitude:4,performance:5,visible_to_player:false,player_note:"PRIVATE DO NOT SHOW"}],custom:[{event_criterion_id:"custom",respondent_role:"player",value_json:false,criterion:{snapshot_name:"Critère maison",snapshot_domain_label:"Domaine maison",snapshot_response_format:"yes_no",snapshot_choices:[{value:false,label:"Choix maison"}]}}],perceptionDifferences:[{criterion:"Critère maison",event:"Activité maison",startsAt:"2026-09-01",player:2,coach:3,difference:-1}]},quality:{attendancePending:0,trainingsWithoutDuration:0,performanceSessionsIncomplete:1,playerEvaluationsMissing:1,coachEvaluationsMissing:1,competitionsWithoutResult:0,lastDataAt:"invalid-date",lowSample:true}};
  const h=coachComponentHarness("components/manager/ManagerPlayerStatistics.tsx",{props:{clubId:"club",playerId:"player",seasonRange:{from:"2026-01-01",to:"2026-12-31"}},inlineComponentNames:["Overview","Attendance","Training","Bars","Play","Evaluations","Quality","Kpi"],modules:{"@/components/i18n/AppI18nProvider":lang.module,recharts:Object.fromEntries(["CartesianGrid","Line","LineChart","ResponsiveContainer","Tooltip","XAxis","YAxis"].map(n=>[n,n]))},fetch:async()=>{reads++;return Response.json(stats);}});
  let tree=await settle(h);const before=reads;
  for(const locale of locales){lang.set(locale);for(const section of ["overview","attendance","training","play","evaluations"]){elements(tree).find(n=>n.type==="tabs")!.props.onChange(section);tree=await settle(h);assert.equal(reads,before);assert.doesNotMatch(ui(tree),/manager\.(junior|administration)\.|Server French|PRIVATE DO NOT SHOW/);if(section==="overview")assert.ok(ui(tree).includes("Niveau maison"));if(section==="training")assert.ok(ui(tree).includes(tr(locale)("cat.long_game")));if(section==="attendance"){assert.ok(ui(tree).includes(tr(locale)("manager.junior.stats.event.camp")));assert.notEqual(elements(tree).find(n=>n.type==="XAxis")!.props.tickFormatter("2026-09"),"2026-09");}if(section==="evaluations"){assert.ok(ui(tree).includes("Choix maison"));assert.ok(ui(tree).includes("Domaine maison"));assert.ok(ui(tree).includes(tr(locale)("manager.fields.boolean")));assert.ok(elements(tree).filter(n=>n.type==="td").every(n=>n.props["data-label"]));}}}
  elements(tree).find(n=>n.type==="select"&&n.props.value==="season")!.props.onChange({target:{value:"custom"}});tree=h.render();elements(tree).find(n=>n.type==="input"&&n.props.type==="date")!.props.onChange({target:{value:""}});tree=await settle(h);assert.equal(reads,before);assert.ok(elements(tree).some(n=>n.props.role==="alert"));assert.equal(elements(tree).filter(n=>n.type==="table").length,0);h.cleanup();
});

test("Excel preview and progress survive language changes and a failed refresh cannot restart completed rows",async()=>{
  const lang=localized(),writes:any[]=[];let memberReads=0,failRefresh=false;
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,"window");const confirmations:string[]=[];Object.defineProperty(globalThis,"window",{configurable:true,value:{confirm:(message:string)=>{confirmations.push(message);return true;}}});
  const h=coachComponentHarness("components/manager/PlayersExcelImportPage.tsx",{modules:{"@/components/i18n/AppI18nProvider":lang.module,xlsx:{...XLSX,read:()=>({Sheets:{first:XLSX.utils.json_to_sheet([source,{...source,junior_birth_date:"31.02.2014"}])},SheetNames:["first"]})}},fetch:async(url,init)=>{if(init?.method){const body=JSON.parse(String(init.body));writes.push({url:String(url),body});return Response.json({user:{id:body.role??"link"}});}if(String(url).endsWith("my-clubs"))return Response.json({clubs:[{id:"club",name:"Club maison"}]});memberReads++;return Response.json(failRefresh && writes.length?{error:"Chargement impossible."}:{members:[]},{status:failRefresh && writes.length?500:200});}});
  try{
    let tree=await settle(h);elements(tree).find(n=>n.type==="input"&&n.props.type==="file")!.props.onChange({target:{files:[{name:"fixture.xlsx",arrayBuffer:async()=>new ArrayBuffer(0)}],value:"fixture.xlsx"}});tree=await settle(h);const before=memberReads;
    for(const locale of locales){lang.set(locale);tree=await settle(h);assert.equal(memberReads,before);assert.ok(ui(tree).includes("fixture.xlsx"));assert.ok(ui(tree).includes(tr(locale)("manager.junior.import.birthInvalid")));assert.ok(ui(tree).includes(tr(locale)("manager.junior.relation.mother")));assert.doesNotMatch(ui(tree),/manager\.junior\./);}
    failRefresh=true;const importButton=button(tree,"Importa 1 riga");importButton.props.onClick();importButton.props.onClick();tree=await settle(h);assert.equal(confirmations.length,1);assert.equal(writes.length,3);assert.ok(ui(tree).includes(tr("it")("manager.loadError")));assert.ok(ui(tree).includes(tr("it")("manager.junior.import.finished")));assert.ok(button(tree,"Importa 0 righe").props.disabled);
    failRefresh=false;button(tree,tr("it")("manager.refresh")).props.onClick();tree=await settle(h);assert.equal(writes.length,3);assert.ok(button(tree,"Importa 0 righe").props.disabled);
  } finally {h.cleanup();if(previousWindow)Object.defineProperty(globalThis,"window",previousWindow);else Reflect.deleteProperty(globalThis,"window");}
});

test("generated report language follows its configuration and excluded sections are absent from the summary",async()=>{
  const { periodicReportLabels, periodicReportEntries } = await import("../lib/periodicReportPresentation.ts");
  for(const values of Object.values(periodicReportEntries)){const tokens=(s:string)=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();for(const value of values)assert.deepEqual(tokens(value),tokens(values[0]));}
  const tables=managerFixture();tables.profiles=[{id:"player",first_name:"Léa",last_name:"{facts}",handicap:10}];tables.training_sessions=[{id:"session",user_id:"player",club_id:"A",start_at:"2020-09-02T10:00:00Z",total_minutes:90,session_type:"individual"}];tables.golf_rounds=[{id:"round",user_id:"player",start_at:"2020-09-03T10:00:00Z",round_type:"competition",total_score:80}];tables.club_event_attendees=[];tables.player_handicap_history=[];tables.training_volume_settings=[];tables.training_volume_targets=[];tables.club_event_coach_feedback=[];
  const fixture=managerDatabase(tables);const {buildPeriodicReportContent}=loadManagerModule("lib/periodicReportContent.ts",fixture.mocks);
  for(const locale of locales){const content=await buildPeriodicReportContent(fixture.db,{club_id:"A",player_user_id:"player",frequency:"monthly",locale,coach_comment:"Commentaire du club"},{from:"2020-09-01",to:"2020-09-30"});assert.equal(content.locale,locale);assert.ok(content.summary.includes("Léa {facts}"));assert.ok(content.summary.includes(periodicReportLabels(locale).format("factTraining",{duration:"1 h 30"})));assert.equal(content.sections.coachComment,"Commentaire du club");}
  const hidden=await buildPeriodicReportContent(fixture.db,{club_id:"A",player_user_id:"player",frequency:"monthly",locale:"de",sections:{attendance:false,training:false,competitions:false,handicap:false,coach_comment:false},coach_comment:"PRIVATE HIDDEN"},{from:"2020-09-01",to:"2020-09-30"});assert.equal(hidden.summary,periodicReportLabels("de").format("summaryEmpty",{name:"Léa {facts}"}));assert.equal(hidden.sections.training,null);assert.equal(hidden.sections.coachComment,null);assert.equal(fixture.writes.length,0);
});

test("report preview uses the report language, preserves authored and archived content and formats zero values",async()=>{
  const { periodicReportLabels } = await import("../lib/periodicReportPresentation.ts");
  const base={id:"report",club_name:"Club maison",period_label:"Période archivée",personalized_comment:"Commentaire maison",published_content:{playerName:"Léa Exemple",summary:"Synthèse archivée",sections:{attendance:{present:0,invited:1,absent:1,excused:0,rate:0},training:{minutes:90,sessions:1,regularityRate:0,objectiveRate:0},competitions:{competitions:0,rounds:1,results:1},handicap:{end:0,change:1,ftemCode:"T1"},evaluations:{sample:3,engagement:3,attitude:4,application:5},upcoming:[{id:"event",title:"Activité maison",startsAt:"2026-10-04T10:00:00Z"}],nextPeriod:{priority:"Priorité maison"}}}};
  const h=coachComponentHarness("components/parent/PeriodicReportView.tsx",{exportName:"PeriodicReportView",props:{report:base},inlineComponentNames:["Card"],fetch:async()=>{throw Error("View must not fetch");}});
  try{for(const locale of locales){const tree=h.render({report:{...base,published_content:{...base.published_content,locale}}});const labels=periodicReportLabels(locale);assert.ok(ui(tree).includes(labels.t("title")));assert.ok(ui(tree).includes(labels.t("summary")));assert.ok(ui(tree).includes(labels.t("coachMessage")));assert.ok(ui(tree).includes("Synthèse archivée"));assert.ok(ui(tree).includes("Commentaire maison"));assert.ok(ui(tree).includes("Activité maison"));assert.ok(ui(tree).includes("0 / 1"));assert.ok(ui(tree).includes("1 h 30"));}const override=h.render({report:base,locale:"en"});assert.ok(ui(override).includes("Period summary"));}finally{h.cleanup();}
});
