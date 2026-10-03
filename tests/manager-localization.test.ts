/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated JSX trees and API fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { messages, type AppLocale } from "../lib/i18n/messages.ts";
import { managerOverviewEntries } from "../lib/i18n/managerOverviewMessages.ts";
import { managerPerformanceEntries } from "../lib/i18n/managerPerformanceMessages.ts";
import { managerCount, managerFormat } from "../lib/managerLocale.ts";
import { managerPerformanceFormatters } from "../lib/managerPerformancePresentation.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
import { loadManagerModule, managerDatabase, managerFixture } from "./helpers/managerRouteHarness.ts";

const locales: AppLocale[] = ["fr", "en", "de", "it"];
const translate = (locale: AppLocale) => (key: string) => messages[locale][key] ?? key;

test("Manager messages cover every locale, preserve interpolation tokens and resolve static UI keys", () => {
  for (const entries of [managerOverviewEntries, managerPerformanceEntries]) {
    for (const [key, values] of Object.entries(entries)) {
      const tokens = (value: string) => [...value.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
      assert.equal(values.length, 4, key);
      for (const value of values) { assert.ok(value.trim(), key); assert.deepEqual(tokens(value), tokens(values[0]), key); }
    }
  }
  for (const file of ["app/manager/page.tsx", "components/manager/ManagerDesktopDrawer.tsx", "components/manager/ManagerCoachPerformancePage.tsx", "components/manager/ManagerJuniorPerformancePage.tsx"]) {
    const source = readFileSync(file, "utf8");
    for (const [, key] of source.matchAll(/\bt\("([^"]+)"\)/g)) for (const locale of locales) assert.ok(messages[locale][key], `${file} ${locale} ${key}`);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && !["Activi", "Tee"].includes(node.text.trim())) assert.doesNotMatch(node.text.trim(), /[A-Za-zÀ-ÿ]{2}/, `${file}: untranslated JSX`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});

test("counts, decimal values, chart months and dates follow each locale without losing zero or rounding to 60 minutes", () => {
  const expected = { fr: ["1 fille", "2 filles"], en: ["1 girl", "2 girls"], de: ["1 Mädchen", "2 Mädchen"], it: ["1 ragazza", "2 ragazze"] };
  for (const locale of locales) {
    const t = translate(locale); const f = managerPerformanceFormatters(t, locale);
    assert.equal(managerCount(t, locale, "manager.home.girl", 1), expected[locale][0]);
    assert.equal(managerCount(t, locale, "manager.home.girl", 2), expected[locale][1]);
    assert.equal(f.metric(0), "0"); assert.equal(f.duration(59.9), "1 h 00");
    assert.equal(f.metric(1234.5), (1234.5).toLocaleString(locale === "en" ? "en-GB" : `${locale}-CH`));
    assert.notEqual(f.month("2026-09"), "2026-09"); assert.equal(f.month("invalid"), "invalid");
    assert.equal(f.date(null), t("manager.performance.noActivity"));
    assert.equal(f.date("2026-10-02T23:30:00Z"), new Intl.DateTimeFormat(locale === "en" ? "en-GB" : `${locale}-CH`, {dateStyle:"short", timeZone:"Europe/Zurich"}).format(new Date("2026-10-02T23:30:00Z")));
  }
  assert.equal(managerFormat(() => "{name} · {count}", "unused", {name:"Junior {count}", count:2}), "Junior {count} · 2");
});

test("API attention values are rendered from structured numbers and dates, never from French prose", () => {
  const f = managerPerformanceFormatters(translate("de"), "de");
  assert.equal(f.juniorAttention({type:"attendance-down",value:"ne pas afficher",amount:-20}), "-20 Punkte");
  assert.match(f.juniorAttention({type:"inactive",value:"ne pas afficher",since:"2026-09-01T12:00:00Z"}), /^Seit /);
  assert.equal(f.juniorAttention({type:"progress",value:"ne pas afficher",signals:[{kind:"attendance",value:20},{kind:"volume",value:15.5}]}), "Anwesenheit +20 Punkte · Umfang +15.5 %");
  assert.equal(f.coachAttention({type:"group-no-head",value:"ne pas afficher"}), "Haupttrainer festzulegen");
  assert.equal(f.coachAttention({type:"load",value:"ne pas afficher",hours:12,medianHours:5}), "12 h · Median 5 h");
  assert.equal(f.coachAttention({type:"evaluation",value:"ne pas afficher",amount:0}), "0");
});

const group = {id:"group",name:"Groupe Élite"};
const junior = {id:"junior",memberId:"member",name:"Émilie Exemple",avatarUrl:null,groupName:group.name,ftemCode:"F3",attendance:{rate:87.5,denominator:8},trainingMinutes:95,objectiveRate:65.5,competitions:1,reasons:["Français hérité"],progressionSignals:[{kind:"attendance",value:20}]};
const coach = {id:"coach",memberId:"coach-member",name:"Alex Exemple",avatarUrl:null,function:"Responsable école",groupCount:1,headGroupCount:1,role:"Français hérité",activities:4,coachHours:8.5,uniquePlayers:7,medianGroupSize:3.5,evaluationsCompleted:2,evaluationsExpected:4,evaluationsOverdue:2,lastActivity:"2026-09-01T12:00:00Z"};
const juniorData = {
  filters:{groups:[group],ftem:[{code:"F3",label:"Libellé du club"}],activityTypes:["training","competition"]},
  overview:{activeJuniors:1,attendanceRate:87.5,medianActivities:8,medianTrainingMinutes:95,progressing:1,evaluationCoverage:50,competitionParticipation:100,dataCompleteness:100},
  attendance:{monthly:[{month:"2026-09",rate:87.5}],present:7,absent:1,excused:0,pending:0,assiduous:1},
  training:{totalMinutes:95,medianMinutes:95,medianObjectiveRate:65.5,medianRegularityRate:80,objectiveDistribution:{below60:0,from60to89:1,from90to120:0,above120:0,undefined:0}},
  competition:{participating:1,medianCompetitions:1,rounds:1,missingResults:0},evaluations:{expected:2,completed:1,missing:1,coverage:50},
  byGroup:[{...group,label:group.name,count:1,attendanceRate:87.5,medianTrainingMinutes:95}],rows:[junior],
  attention:[{playerId:"junior",playerName:junior.name,type:"attendance-down",reason:"Français hérité",value:"Français hérité",amount:-20,severity:"warning"}]
};
const coachData = {
  filters:{groups:[group]},overview:{activeCoaches:1,activities:4,activityHours:6,coachHours:8.5,medianPlayers:7,coverageRate:100,evaluationCompletionRate:50,pendingAttendance:2},
  distribution:{medianCoachHours:8.5,monthly:[{month:"2026-09",activityHours:6,coachHours:8.5}]},
  coverage:{groupsWithoutHead:[group],singleCoachGroups:[group],futureWithoutCoach:[{id:"event",title:"Stage du club",startsAt:"2026-10-20T12:00:00Z"}]},evaluations:{expected:4,completed:2,overdue:2,completionRate:50},rows:[coach],
  attention:[{type:"evaluation",reason:"Français hérité",value:"Français hérité",amount:2,label:coach.name,href:"/manager/calendar"}]
};
const context = {clubs:[{id:"A",name:"Club Exemple"}],clubId:"A",seasons:[{id:"season",name:"Saison du club",starts_on:"2026-01-01",ends_on:"2026-12-31",is_current:true}],seasonId:"season",loading:false,error:"",setClubId(){},setSeasonId(){}};
const localComponents = new Set(["Kpi","Small","Header","DataList","CoachTable","JuniorTable","Distribution","GroupTable","AttentionList"]);
function expand(tree: any): any {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== "object" || !tree.props) return tree;
  if (typeof tree.type === "function" && localComponents.has(tree.type.name)) return expand(tree.type(tree.props));
  return {...tree, props:{...tree.props,children:expand(tree.props.children)}};
}
function uiText(tree: any) {
  return elements(expand(tree)).map((node) => [textContent(node), ...["label","title","text","detail","aria-label","ariaLabel","name"].map((key)=>typeof node.props[key] === "string" ? node.props[key] : ""), ...(node.props.items ?? []).map((item:any)=>item.label)].join(" ")).join(" ");
}
for (const [name,data,tabValues] of [["Junior",juniorData,["overview","attendance","training","competition","evaluations","attention"]],["Coach",coachData,["overview","load","coverage","evaluations","attention"]]] as const) {
  test(`${name} statistics translate every tab, table, empty and loading state and preserve filter values`, () => {
    let current: any = data; let loading = false;
    const harness = coachComponentHarness(`components/manager/Manager${name}PerformancePage.tsx`, {
      fetch:async()=>{throw Error("No IO expected");},
      modules:{"@/components/manager/usePerformanceContext":{usePerformanceContext:()=>context},"./useManagerResource":{useManagerResource:()=>({data:current,loading,error:"",reload(){}})},recharts:new Proxy({},{get:(_,name)=>String(name)})}
    });
    for (const locale of locales) {
      harness.setLocale(locale);
      for (const tab of tabValues) {
        let tree = harness.render(); elements(tree).find((node)=>node.type === "tabs")!.props.onChange(tab); tree=harness.render();
        const text=uiText(tree); assert.doesNotMatch(text,/manager\.(performance|nav)|Français hérité/);
        if (locale !== "fr") assert.doesNotMatch(text,/Données insuffisantes|Vue d’ensemble|Centre d’attention|Chargement des statistiques|dans le périmètre filtré/);
        if(tab === "overview") {
          assert.match(text,/Exemple/);assert.match(text,name === "Junior" ? /Groupe Élite/ : /Responsable école/);
          const cells=elements(expand(tree)).filter((node)=>node.type === "td" && node.props["data-label"]);
          assert.equal(cells.length,name === "Junior" ? 7 : 9);
          assert.ok(cells.some((node)=>node.props["data-label"] === messages[locale][name === "Junior" ? "manager.performance.progress" : "manager.performance.lastActivity"]));
        }
      }
      if(name === "Junior") {
        const options=elements(harness.render()).filter((node)=>node.type === "option");
        const option=options.find((node)=>node.props.value === "training")!; assert.equal(textContent(option),messages[locale]["manager.activity.training"]);
      }
      current={...data,rows:[],attention:[]}; elements(harness.render()).find((node)=>node.type === "tabs")!.props.onChange("overview");
      assert.ok(uiText(harness.render()).includes(messages[locale][`manager.performance.${name === "Junior" ? "noJuniors" : "noCoaches"}`]));
      current=null;loading=true;
      assert.ok(uiText(harness.render()).includes(messages[locale][`manager.performance.loading${name === "Junior" ? "Juniors" : "Coaches"}`]));
      current=data;loading=false;
    }
    harness.cleanup();
  });
}

test("dashboard changes language with plural counts, preserving authored event titles and destinations", async () => {
  const stats={clubsCount:1,activeUsersCount:2,usersCount:2,playersCount:1,girlsCount:1,boysCount:0,activeGroupsCount:1,archivedGroupsCount:0,pastEventsCount:3,plannedEventsCount:1,unreadNotificationsCount:0,juniorsWithoutParentCount:1,usersWithoutUsernameCount:0,groupsWithoutHeadCoachCount:0,pendingAttendanceCount:0,activitiesAwaitingCoachEvaluationCount:0,inactiveMemberships:0};
  let activeLocale: AppLocale="fr"; const translators=Object.fromEntries(locales.map((locale)=>[locale,translate(locale)]));
  const harness=coachComponentHarness("app/manager/page.tsx",{fetch:async()=>Response.json({stats,me:{first_name:"Zoé"},upcomingEvents:[{id:"event",group_id:"group",event_type:"training",starts_at:"2026-10-03T10:00:00Z",label:"Entraînement Élite",href:"/manager/calendar"}],groupNameById:{}}),modules:{"@/lib/clientPageCache":{readClientPageCache:()=>null,writeClientPageCache(){}},"@/components/i18n/AppI18nProvider":{useI18n:()=>({locale:activeLocale,t:translators[activeLocale]})}}});
  for(const locale of locales) { activeLocale=locale; harness.render(); await flush(); const tree=harness.render(); const text=textContent(tree); assert.match(text,/Zoé/);assert.match(text,/Entraînement Élite/);assert.doesNotMatch(text,/manager\./);assert.ok(text.includes(managerCount(translate(locale),locale,"manager.home.withoutParent",1)));assert.ok(elements(tree).some((node)=>node.props.href === "/manager/calendar")); }
  harness.cleanup();
});

test("performance APIs provide language-neutral signals and values without changing legacy consumers or writing data", async () => {
  const tables=managerFixture();
  tables.coach_groups[0]={...tables.coach_groups[0],name:"Élite",is_active:true,head_coach_user_id:"target"};
  tables.club_player_season_records=[{club_member_id:"player-A",club_season_id:"season-A",registration_status:"active",group_id:"group-A"}];
  tables.player_handicap_history=[{user_id:"player",effective_date:"2026-01-01",value:25},{user_id:"player",effective_date:"2026-09-30",value:23}];
  tables.training_sessions=[{id:"old",user_id:"player",start_at:"2026-08-10T10:00:00Z",total_minutes:60},{id:"new",user_id:"player",start_at:"2026-09-10T10:00:00Z",total_minutes:120}];
  const fixture=managerDatabase(tables);
  const mockedLib={performanceContext:async()=>({ok:true,db:fixture.db}),resolveRange:async()=>({range:{from:"2026-09-01",to:"2026-09-30"},previous:{from:"2026-08-01",to:"2026-08-31"},season:{id:"season-A"},seasons:[]}),dateKey:(value:string)=>value.slice(0,10),startIso:(value:string)=>`${value}T00:00:00Z`,endIso:(value:string)=>`${value}T23:59:59Z`,queryRows:async(query:any)=>(await query).data};
  const juniors=loadManagerModule("app/api/manager/clubs/[clubId]/performance/juniors/route.ts",{...fixture.mocks,"../_lib":mockedLib});
  const request=(comparison:string)=>({nextUrl:new URL(`http://local?comparison=${comparison}`)});
  let response=await juniors.GET(request("previous"),{params:Promise.resolve({clubId:"A"})}); assert.equal(response.status,200);let json=await response.json();
  assert.ok(json.rows[0].progressionSignals.some((signal:any)=>signal.kind === "volume" && signal.value === 100));
  assert.ok(json.rows[0].reasons.includes("Volume +100 %"));
  assert.deepEqual(json.attention.find((item:any)=>item.type === "progress").signals,json.rows[0].progressionSignals);
  response=await juniors.GET(request("none"),{params:Promise.resolve({clubId:"A"})});json=await response.json();assert.deepEqual(json.rows[0].progressionSignals,[{kind:"handicap",value:2}]);
  const coaches=loadManagerModule("app/api/manager/clubs/[clubId]/performance/coaches/route.ts",{...fixture.mocks,"../_lib":mockedLib});
  response=await coaches.GET(request("previous"),{params:Promise.resolve({clubId:"A"})});assert.equal(response.status,200);json=await response.json();assert.equal(json.rows[0].headGroupCount,1);assert.equal(json.rows[0].role,"1 responsable");assert.equal(fixture.writes.length,0);
});
