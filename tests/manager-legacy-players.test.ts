/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated API and UI fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {messages,type AppLocale} from '../lib/i18n/messages.ts';
import {managerLegacyPlayerMessages} from '../lib/i18n/managerLegacyPlayerMessages.ts';
import {managerDatabase,loadManagerModule,managerRequest,type Row} from './helpers/managerRouteHarness.ts';
import {coachComponentHarness,elements,textContent,flush,deferred,type Element} from './helpers/coachComponentHarness.ts';
const routePath='app/api/manager/players/directory/route.ts',pagePath='app/manager/players/page.tsx';
const locales:AppLocale[]=['fr','en','de','it'];
const p=(id:string,first_name=id)=>({id,first_name,last_name:'Junior',avatar_url:null,handicap:12.5,sex:'male'});
const fixture=()=>({club_members:[
 {id:'mA',club_id:'A',user_id:'manager',role:'manager',is_active:true},
 {id:'coachB',club_id:'B',user_id:'manager',role:'coach',is_active:true},
 {id:'parentC',club_id:'C',user_id:'manager',role:'parent',is_active:true},
 {id:'pA',club_id:'A',user_id:'juniorA',role:'player',is_active:true},
 {id:'pB',club_id:'B',user_id:'juniorB',role:'player',is_active:true},
 {id:'pInactive',club_id:'A',user_id:'old',role:'player',is_active:false},
 ],clubs:[{id:'A',name:'Golf A'},{id:'B',name:'Golf B'},{id:'C',name:'Golf C'}],profiles:[p('juniorA','Chloé'),p('juniorB','Hidden'),p('old','Old')]});
const load=async(tables:Record<string,Row[]>,options:Record<string,any>={})=>{const h=managerDatabase(tables,options);const response=await loadManagerModule(routePath,h.mocks).GET(managerRequest('GET'));return {h,response,body:await response.json()};};

test('directory requires a real session and an active Manager membership',async()=>{
 const anonymous=await load(fixture(),{caller:null});assert.equal(anonymous.response.status,401);assert.deepEqual(anonymous.h.writes,[]);
 for(const role of ['coach','parent','player']){const tables=fixture();tables.club_members[0].role=role;const result=await load(tables);assert.equal(result.response.status,200);assert.deepEqual(result.body,{clubs:[],players:[]});assert.deepEqual(result.h.writes,[]);}
 const inactive=fixture();inactive.club_members[0].is_active=false;assert.deepEqual((await load(inactive)).body,{clubs:[],players:[]});
});

test('a multi-role Manager sees only players of clubs they manage, without exposing private profile fields',async()=>{
 const x=await load(fixture());assert.equal(x.response.status,200);assert.deepEqual(x.body.clubs,[{id:'A',name:'Golf A'}]);assert.equal(x.body.players.length,1);assert.equal(x.body.players[0].id,'juniorA');assert.deepEqual(x.body.players[0].club_ids,['A']);assert.ok(!JSON.stringify(x.body).includes('Hidden'));assert.deepEqual(x.h.writes,[]);
 const multi=fixture();multi.club_members.push({id:'mB',club_id:'B',user_id:'manager',role:'manager',is_active:true},{id:'pAB',club_id:'B',user_id:'juniorA',role:'player',is_active:true});const y=await load(multi);assert.deepEqual(y.body.players.map((row:Row)=>row.id).sort(),['juniorA','juniorB']);assert.deepEqual(y.body.players.find((row:Row)=>row.id==='juniorA').club_ids,['A','B']);
});

test('paging includes players beyond the Supabase row cap and separates large club/profile batches',async()=>{
 const tables=fixture();tables.club_members=tables.club_members.filter((r:Row)=>r.id!=='pA');tables.profiles=[];
 for(let n=0;n<1005;n++){const id=`p${String(n).padStart(4,'0')}`;tables.club_members.push({id:`z${String(n).padStart(4,'0')}`,club_id:'A',user_id:id,role:'player',is_active:true});tables.profiles.push(p(id));}
 const x=await load(tables,{maxRows:1000});assert.equal(x.response.status,200);assert.equal(x.body.players.length,1005);assert.deepEqual(x.h.writes,[]);
});

test('database failures return a generic error without stale club or player data',async()=>{
 const x=await load(fixture(),{failureTable:'profiles'});assert.equal(x.response.status,500);assert.deepEqual(x.body,{error:'directory_load_failed'});assert.ok(!JSON.stringify(x.body).includes('Database failure'));
});

const find=(tree:Element,fn:(node:Element)=>boolean)=>{const result=elements(tree).find(fn);assert.ok(result);return result;};
async function settle(h:ReturnType<typeof coachComponentHarness>){let tree=h.render();for(let n=0;n<4;n++){await flush();tree=h.render();}return tree;}
function view(options:{get?:()=>Promise<Response>}={}){
 let reads=0;const h=coachComponentHarness(pagePath,{fetch:async()=>{reads++;return options.get?options.get():Response.json({clubs:[{id:'A',name:'Golf A'},{id:'B',name:'Golf B'}],players:[{...p('one','Chloé'),club_ids:['A'],club_names:['Golf A']},{...p('two','Mario'),club_ids:['B'],club_names:['Golf B'],sex:'female'}]});}});return {h,reads:()=>reads};
}

test('the four languages preserve a name query and club filter without refetching',async()=>{
 const x=view();try{let tree=await settle(x.h);find(tree,n=>n.type==='input'&&n.props.placeholder==='Rechercher nom ou prénom…').props.onChange({target:{value:'Chloé'}});find(x.h.render(),n=>n.type==='select'&&n.props.value==='all'&&elements(n).some(i=>textContent(i).includes('Golf A'))).props.onChange({target:{value:'A'}});const reads=x.reads();for(const locale of locales){x.h.setLocale(locale);tree=await settle(x.h);assert.ok(textContent(tree).includes(messages[locale]['manager.legacyPlayers.lead']));assert.ok(textContent(tree).includes('Chloé'));assert.ok(!textContent(tree).includes('Mario'));assert.equal(find(tree,n=>n.type==='input'&&n.props.value==='Chloé').props.value,'Chloé');assert.ok(!textContent(tree).includes('manager.legacyPlayers.'));}assert.equal(x.reads(),reads);}finally{x.h.cleanup();}
});

test('failed refresh hides stale player cards and shows a localized retry',async()=>{
 let fail=false;const x=view({get:async()=>fail?Response.json({error:'private SQL failure'},{status:500}):Response.json({clubs:[{id:'A',name:'Golf A'}],players:[{...p('one','Chloé'),club_ids:['A'],club_names:['Golf A']}]})});try{assert.ok(textContent(await settle(x.h)).includes('Chloé'));fail=true;find(x.h.render(),n=>n.type==='button'&&textContent(n).trim()===messages.fr['manager.legacyPlayers.refresh']).props.onClick();const tree=await settle(x.h);assert.ok(!textContent(tree).includes('Chloé'));assert.ok(textContent(tree).includes(messages.fr['manager.legacyPlayers.loadError']));assert.ok(!textContent(tree).includes('private SQL failure'));}finally{x.h.cleanup();}
});

test('incomplete directory loads do not show an empty list as if it were complete',async()=>{
 const response=deferred<Response>(),x=view({get:()=>response.promise});try{let tree=x.h.render();assert.ok(!textContent(tree).includes(messages.fr['manager.legacyPlayers.empty']));response.resolve(Response.json({clubs:[],players:[]}));tree=await settle(x.h);assert.ok(textContent(tree).includes(messages.fr['manager.legacyPlayers.noClubs']));}finally{x.h.cleanup();}
});

test('translation keys, placeholders and roles are present in every locale',()=>{
 const expected=Object.keys(managerLegacyPlayerMessages.fr).sort();for(const locale of locales){assert.deepEqual(Object.keys(managerLegacyPlayerMessages[locale]).sort(),expected);for(const key of expected){const source=messages[locale][key];assert.ok(source,`${locale}:${key}`);assert.deepEqual([...source.matchAll(/\{\w+\}/g)].map(v=>v[0]),[...messages.fr[key].matchAll(/\{\w+\}/g)].map(v=>v[0]));}}
});
